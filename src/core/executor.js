// Run pipeline shared by REST, MCP and bulk:
// resolve → enabled → verb → plan gate → quota → path params → validate → cache → handler/upstream → envelope → logs/stats

import { E, HttpError, okRun, nowIso } from "./envelope.js";
import { maxPlan, planAllows, getPlan, getFinancePlan } from "./plans.js";
import { isFinanceKey } from "./sources.js";
import { pathFieldNames } from "./catalog.js";
import { validateParams } from "./validate.js";
import { stableStringify, dayKey, monthKey, sha256, ulid } from "./util.js";
import { recordCommands } from "./analytics.js";
import { ScraperError, NotConfiguredError, UpstreamError } from "./errors.js";
import { buildSource } from "./sources.js";

export { ScraperError, NotConfiguredError };

export function effectiveTtl(endpointTtl, requested, planMin) {
  const base = Number(endpointTtl) || 0;
  if (requested === undefined || requested === null || planMin === null || planMin === undefined) return { readTtl: base, writeTtl: base };
  return { readTtl: Math.max(planMin, Math.min(Number(requested) || 0, base)), writeTtl: base };
}

export class Executor {
  constructor({ catalog, repo, limiter, webhooks, publicUrl, fetchImpl = globalThis.fetch, lookupImpl = null, upstream = null, logger = null, background = null }) {
    Object.assign(this, { catalog, repo, limiter, webhooks, publicUrl, fetchImpl, lookupImpl, upstream, logger, background });
    this.mem = new Map(); // L1 cache (per instance)
  }

  /**
   * caller = { owner, plan, keyId, keyPreview, ip, source:"rest"|"mcp"|"bulk"|"playground" }
   * Returns {status, body, headers}; never throws for HTTP-level failures.
   */
  async run({ caller, projectKey, endpointSlug, method, params = {}, pathRest, reserved = false, signal, upstreamAuth = null, fresh = false }) {
    const t0 = Date.now();
    let ticket = null;
    const headers = {};
    let scraper = null;
    let access = null;
    upstreamAuth = upstreamAuth ?? caller.upstreamAuth ?? null;
    try {
      const r = this.catalog.resolve(projectKey, endpointSlug);
      scraper = r.scraper;
      const endpoint = r.endpoint;
      if (!scraper) throw E.notFound(`Invalid project key "${projectKey}"`);
      if (!endpoint) throw E.notFound(`Endpoint "${endpointSlug}" not found on ${projectKey}`);
      const disabled = await this.repo.disabledScrapers();
      if (disabled.has(scraper.key) || !endpoint.enabled) throw E.disabled();
      if (method && method !== endpoint.method && !(method === "HEAD" && endpoint.method === "GET")) throw E.methodNotAllowed(endpoint.method);
      // Key permissions (checked before any quota is used, so a refused call is never billed).
      access = endpoint.access ?? "read";
      if (access === "write" && caller.access === "read")
        throw E.coded(403, "key_read_only", `This key is read-only, and ${scraper.key}/${endpoint.slug} changes data at ${scraper.provider ?? "the provider"}. Allow writes for this key in the dashboard (API keys) to use it.`, { required_access: "read_write" });
      const cats = caller.scope?.categories;
      if (cats?.length && !cats.includes(scraper.category))
        throw E.coded(403, "key_scope", `This key can only call: ${cats.join(", ")}. ${scraper.key} is in "${scraper.category}". Change the key's allowed categories in the dashboard to use it.`, { allowed_categories: cats });
      // Apizie Finance (premium): the official financial sources need an active Finance plan. Refused before any
      // quota is touched, so it is never billed.
      const finance = isFinanceKey(scraper.key);
      if (finance && !caller.financePlan)
        throw E.coded(403, "finance_plan_required", `${scraper.key} is part of Apizie Finance, a premium add-on with official data from SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF and the World Bank, cited on every answer. Add a Finance plan to use it: ${this.publicUrl}/finance#pricing`, { upgrade_url: `${this.publicUrl}/finance#pricing`, product: "finance" });
      const required = finance ? null : maxPlan(scraper.minPlan, endpoint.minPlan);
      if (!planAllows(caller.plan, required)) throw E.planGate(required, `${this.publicUrl}/pricing`);
      if (endpoint.status === "planned" || (endpoint.status === "upstream" && !this.upstream))
        throw new HttpError(501, { content: { status: "planned" }, message: `${projectKey}/${endpointSlug} is in the catalog but not live on this server yet.`, errors: [] });

      // Prepare params and the cache lookup first (pure work), then run the quota check and the cache read in parallel:
      // one storage round trip instead of two. Errors found here are raised after the quota check, as before.
      let pre = null, value, errors = [], requestedTtl, cacheKey = null, readTtl = 0, writeTtl = 0;
      try {
        const merged = { ...params };
        const names = pathFieldNames(endpoint);
        if (pathRest && names.length) {
          const segs = pathRest.split("/").filter(Boolean).map(safeDecode);
          names.forEach((n, i) => {
            const v = i === names.length - 1 ? segs.slice(i).join("/") : segs[i];
            if (v !== undefined && v !== "") merged[n] = v;
          });
        } else if (pathRest && !names.length) {
          throw E.notFound(`Endpoint "${endpointSlug}/${pathRest}" not found on ${projectKey}`);
        }
        requestedTtl = merged.ttl;
        delete merged.ttl;
        ({ value, errors } = validateParams(endpoint.fields, merged));
        ({ readTtl, writeTtl } = effectiveTtl(endpoint.cacheTtl, requestedTtl, finance ? getFinancePlan(caller.financePlan).minCacheTtl : getPlan(caller.plan).minCacheTtl));
        if (fresh) readTtl = 0; // data alerts always compare against the source itself
        // Never share cached responses fetched with someone's own upstream credentials.
        const authTag = upstreamAuth && (upstreamAuth.key || upstreamAuth.authorization) ? `#${caller.owner}:${sha256(JSON.stringify(upstreamAuth)).slice(0, 16)}` : "";
        cacheKey = `cache:${scraper.key}/${endpoint.slug}?${stableStringify(value)}${authTag}`;
      } catch (e) {
        pre = e;
      }
      const cachedP = !pre && !errors.length && readTtl > 0 ? this._cacheGet(cacheKey) : Promise.resolve(null);
      cachedP.catch(() => {});

      if (!reserved) ticket = await this.limiter.reserve(caller.owner, caller.plan, 1, finance ? { finance: caller.financePlan } : undefined);
      if (pre) throw pre;
      if (errors.length) throw E.invalidParams(errors);

      let data, source = null;
      const cmds = [];
      const cached = await cachedP;
      if (cached && Date.now() - cached.at <= readTtl * 1000) {
        data = cached.value;
        // The citation keeps the time the data was actually fetched from the source, not the cache hit.
        source = cached.src ? buildSource(cached.src, new Date(cached.at).toISOString()) : null;
        headers["X-Cache"] = "HIT";
        headers["Age"] = String(Math.floor((Date.now() - cached.at) / 1000));
      } else {
        headers["X-Cache"] = writeTtl > 0 ? (readTtl === 0 ? "BYPASS" : "MISS") : "NONE";
        const urls = [];
        data = endpoint.handler ? await this._runHandler(endpoint, value, caller, scraper, signal, upstreamAuth, urls) : await this._runUpstream(scraper, endpoint, value, pathRest, signal);
        const fetchedAt = Date.now();
        source = buildSource(urls, new Date(fetchedAt).toISOString());
        if (writeTtl > 0) {
          const setCmd = this._cacheSet(cacheKey, data, writeTtl, { deferred: true, src: urls, at: fetchedAt });
          if (setCmd) cmds.push(setCmd);
        }
      }
      // Cache write, stats, usage rollups and the log line go out in one batch, after the response when the host allows.
      await this._later(this._after(caller, scraper, endpoint.slug, 200, Date.now() - t0, !!ticket, { method: method ?? endpoint.method, cache: headers["X-Cache"], cmds, access }));
      if (ticket) Object.assign(headers, ticket.headers());
      if (source) headers["X-Source"] = source.apiUrl.slice(0, 512);
      return { status: 200, body: okRun(scraper.key, data, source), headers };
    } catch (err) {
      return this._fail(err, { ticket, headers, caller, projectKey, endpointSlug, scraper, t0, method, access });
    }
  }

  async _runHandler(endpoint, value, caller, scraper, outer, upstreamAuth, urls = null) {
    try {
      return await this._callHandler(endpoint, value, caller, scraper, outer, upstreamAuth, urls);
    } catch (e) {
      // A handler crashing on data it did not expect (TypeError/SyntaxError) means the upstream answered in an
      // unexpected shape, and undici reports network failures as TypeError("fetch failed"). Report both as a 502 (not billed) instead of a generic 500.
      if (e instanceof TypeError || e instanceof SyntaxError) {
        this.logger?.warn?.(`${scraper.key}/${endpoint.slug}: unexpected upstream response: ${e.message}`);
        throw new HttpError(502, { content: null, message: /fetch failed|network/i.test(e.message) ? `${scraper.displayName ?? scraper.key} could not be reached` : `${scraper.displayName ?? scraper.key} returned an unexpected response`, errors: [] });
      }
      throw e;
    }
  }

  _callHandler(endpoint, value, caller, scraper, outer, upstreamAuth, urls = null) {
    // Record every upstream URL the handler fetches: that list becomes the response's citation.
    const base = this.fetchImpl;
    const fetch = urls ? (u, init) => (urls.push(typeof u === "string" ? u : u?.url ?? String(u)), base(u, init)) : base;
    return withTimeout(
      (signal) => endpoint.handler(value, { fetch, lookup: this.lookupImpl, signal, upstreamAuth, key: { id: caller.keyId, plan: caller.plan }, project: scraper.key, endpoint: endpoint.slug }),
      endpoint.timeoutMs,
      outer
    );
  }

  /** Forward a catalog-only endpoint to a compatible upstream gateway (configure ZIE_UPSTREAM_*). */
  async _runUpstream(scraper, endpoint, value, pathRest, outer) {
    const up = this.upstream;
    const names = pathFieldNames(endpoint);
    const pathVals = names.map((n) => encodeURIComponent(value[n] ?? "")).filter(Boolean);
    const rest = names.length ? "/" + pathVals.join("/") : "";
    const query = Object.fromEntries(Object.entries(value).filter(([k]) => !names.includes(k)));
    let target = `${up.url}/v1/${scraper.key}/${endpoint.slug}${rest}`;
    const init = { method: endpoint.method, headers: { [up.header]: up.key, "user-agent": "apizie-upstream/2" } };
    if (endpoint.method === "GET") {
      const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])).toString();
      if (qs) target += "?" + qs;
    } else {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(query);
    }
    const res = await withTimeout((signal) => this.fetchImpl(target, { ...init, signal }), endpoint.timeoutMs, outer);
    const body = await res.json().catch(() => null);
    if (res.ok && body && "data" in body) return body.data;
    if (res.ok && body && "content" in body) return body.content;
    if (res.status >= 500) throw new HttpError(502, { content: null, message: "Upstream gateway error", errors: [] });
    throw new ScraperError(body?.message ?? body?.error?.message ?? (typeof body?.error === "string" ? body.error : `Upstream returned ${res.status}`), { errors: body?.errors ?? [] });
  }

  async _cacheGet(k) {
    const m = this.mem.get(k);
    if (m && m.exp > Date.now()) return m;
    try {
      const raw = await this.repo.kv.get(k);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  /** Returns the storage command when deferred, so the cache write can join the request's single batch. */
  _cacheSet(k, value, ttl, { deferred = false, src = null, at = Date.now() } = {}) {
    const entry = { value, at, ...(src?.length ? { src: [...new Set(src)].slice(-8) } : {}) };
    if (this.mem.size > 2000) this.mem.delete(this.mem.keys().next().value);
    this.mem.set(k, { ...entry, exp: Date.now() + ttl * 1000 });
    let s;
    try {
      s = JSON.stringify(entry);
    } catch {
      return null;
    }
    if (s.length >= 512_000) return null;
    if (deferred) return ["SET", k, s, ttl];
    return Promise.resolve(this.repo.kv.set(k, s, { ex: ttl })).catch(() => {});
  }

  /** Let bookkeeping finish after the response when the host supports it (Vercel waitUntil); otherwise await it. */
  _later(p) {
    return this.background ? this.background(p) : p;
  }

  /** All per-request bookkeeping (stats, usage, log line, dashboard rollups) in one storage round trip. */
  async _after(caller, scraper, endpointSlug, status, ms, billed, extra = {}) {
    try {
      const day = dayKey();
      const owner = caller.owner;
      const cmds = [["INCRBY", "g:requests", 1], ...(extra.cmds ?? [])];
      if (scraper.id) cmds.push(["INCRBY", `stat:${scraper.id}:req`, 1], ...(status < 400 ? [["INCRBY", `stat:${scraper.id}:ok`, 1]] : []));
      // Remember when a key last changed data at a provider: keys that never do are offered read-only.
      if (extra.access === "write" && status < 400 && caller.keyId) cmds.push(["SET", `kwrite:${caller.keyId}`, nowIso(), 400 * 86400]);
      if (billed) cmds.push(["INCRBY", `useday:${owner}:${day}`, 1, 100 * 86400], ["INCRBY", `g:day:${day}`, 1, 100 * 86400], ["HINCRBY", `usescr:${owner}:${monthKey()}`, scraper.key, 1]);
      if (owner && caller.source !== "playground-public") {
        const entry = {
          id: caller.requestId ?? ulid(),
          at: nowIso(),
          method: extra.method ?? "GET",
          project: scraper.key,
          endpoint: endpointSlug,
          category: scraper.category,
          status,
          ms,
          keyId: caller.keyId ?? null,
          key: caller.keyPreview ?? null,
          keyName: caller.keyName ?? null,
          ip: caller.ip ?? null,
          source: caller.source ?? "rest",
          billed,
          cache: extra.cache ?? null,
          access: extra.access ?? null,
          error: extra.error ? String(extra.error).slice(0, 300) : null,
          code: extra.code ?? null,
        };
        cmds.push(this.repo.logCommand(owner, entry), ...recordCommands(owner, entry));
      }
      await this.repo.kv.batch(cmds);
    } catch (e) {
      this.logger?.warn?.("metering failed: " + e.message);
    }
  }

  async _fail(err, { ticket, headers, caller, projectKey, endpointSlug, scraper, t0, method: ctxMethod, access = null }) {
    let status, body, extra = {};
    if (err instanceof HttpError) {
      status = err.status;
      body = err.body;
      extra = err.headers;
    } else if (err instanceof ScraperError || err?.name === "ScraperError") {
      status = 400;
      body = { project: projectKey, error: err.message, errors: err.errors ?? [], ...(err.context ? { context: err.context } : {}), timestamp: nowIso() };
    } else if (err instanceof UpstreamError || err?.name === "UpstreamError") {
      status = err.httpStatus ?? 502;
      body = { content: { upstreamStatus: err.upstreamStatus ?? null, ...(status === 429 ? { window: "upstream" } : {}) }, message: err.message, errors: [] };
      if (status === 429) extra = { "Retry-After": String(err.retryAfter ?? "60") };
    } else if (err instanceof NotConfiguredError || err?.name === "NotConfiguredError") {
      status = 503;
      body = { content: { code: "not_configured" }, message: err.message, errors: [] };
    } else if (err?.name === "ZieTimeout") {
      status = 504;
      body = { content: null, message: "Upstream timed out", errors: [] };
    } else {
      status = 500;
      body = { content: null, message: "Internal error", errors: [] };
      this.logger?.error?.(err);
    }
    const free = status >= 500 || body?.error?.code === "upstream_key_required";
    if (ticket && free) await ticket.refund();
    const subject = scraper ?? (projectKey?.includes(":") ? { id: null, key: projectKey, category: projectKey.split(":")[0] } : null);
    if (subject && caller?.owner) await this._after(caller, subject, endpointSlug, status, Date.now() - t0, !!ticket && !free, { method: ctxMethod, access, error: body?.message ?? body?.error?.message ?? (typeof body?.error === "string" ? body.error : null), code: body?.error?.code ?? body?.content?.code ?? null });
    const blocked = body?.error?.code === "key_read_only" || body?.error?.code === "key_scope";
    if (blocked && caller?.owner) this.webhooks?.emit(caller.owner, "key.blocked", { key: caller.keyName ?? caller.keyPreview ?? null, keyId: caller.keyId ?? null, project: projectKey, endpoint: endpointSlug, reason: body.error.code, message: body.error.message });
    if (ticket) extra = { ...ticket.headers(), ...extra };
    if (status >= 500 || status === 400) this.webhooks?.emit(caller.owner, "request.error", { project: projectKey, endpoint: endpointSlug, status, message: body.message ?? body.error });
    return { status, body, headers: { ...headers, ...extra } };
  }
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function withTimeout(fn, ms, outer) {
  const ac = new AbortController();
  const onAbort = () => ac.abort(outer?.reason);
  outer?.addEventListener?.("abort", onAbort, { once: true });
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(ac.signal)),
      new Promise((_, rej) => {
        timer = setTimeout(() => {
          const e = new Error("timeout");
          e.name = "ZieTimeout";
          ac.abort(e);
          rej(e);
        }, ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener?.("abort", onAbort);
  }
}

export { dayKey };
