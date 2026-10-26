// The run pipeline shared by REST (/v1), MCP (run_scraper) and bulk jobs.
//   resolve → enabled? → verb → plan gate → rate limit → path params → validate
//   → cache → handler (with timeout) → envelope → metering/stats

import { E, HttpError, okRun, nowIso } from "./envelope.js";
import { maxPlan, planAllows, getPlan } from "./plans.js";
import { pathFieldNames } from "./catalog.js";
import { validateParams } from "./validate.js";
import { effectiveTtl } from "./cache.js";
import { stableStringify } from "./util.js";

/** Throw from a scraper handler when the upstream/source fails in a known way → HTTP 400 exec error. */
export class ScraperError extends Error {
  constructor(message, { errors = [], context } = {}) {
    super(message);
    this.errors = errors;
    this.context = context;
  }
}

export class Executor {
  constructor({ catalog, store, limiter, cache, webhooks, publicUrl, fetchImpl = globalThis.fetch, lookupImpl = null, logger = null }) {
    Object.assign(this, { catalog, store, limiter, cache, webhooks, publicUrl, fetchImpl, lookupImpl, logger });
  }

  /**
   * @returns {Promise<{status:number, body:any, headers:Record<string,string>}>}
   * Never throws for HTTP-level failures; returns the error response instead.
   */
  async run({ keyRec, projectKey, endpointSlug, method, params = {}, pathRest, reserved = false, signal }) {
    let ticket = null;
    const headers = {};
    try {
      const { scraper, endpoint } = this.catalog.resolve(projectKey, endpointSlug);
      if (!scraper) throw E.notFound(`Invalid project key "${projectKey}"`);
      if (!endpoint) throw E.notFound(`Endpoint "${endpointSlug}" not found on ${projectKey}`);
      if (!scraper.enabled || !endpoint.enabled) throw E.disabled();
      if (method && method !== endpoint.method && !(method === "HEAD" && endpoint.method === "GET"))
        throw E.methodNotAllowed(endpoint.method);

      const required = maxPlan(scraper.minPlan, endpoint.minPlan);
      if (!planAllows(keyRec.plan, required)) throw E.planGate(required, `${this.publicUrl}/pricing`);

      if (!reserved) {
        ticket = this.limiter.reserve(keyRec, 1);
      }

      // Path params (pathTemplate ":username" ⇒ /v1/x:y/profile/<username>)
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

      const requestedTtl = merged.ttl;
      delete merged.ttl;

      const { value, errors } = validateParams(endpoint.fields, merged);
      if (errors.length) throw E.invalidParams(errors);

      const plan = getPlan(keyRec.plan);
      const { readTtl, writeTtl } = effectiveTtl(endpoint.cacheTtl, requestedTtl, plan.minCacheTtl);
      const cacheKey = `${scraper.key}/${endpoint.slug}?${stableStringify(value)}`;

      let data;
      const cached = readTtl > 0 ? this.cache.get(cacheKey) : undefined;
      const fresh = cached && Date.now() - cached.at <= readTtl * 1000;
      if (fresh) {
        data = cached.value;
        headers["X-Cache"] = "HIT";
        headers["Age"] = String(Math.floor((Date.now() - cached.at) / 1000));
      } else {
        headers["X-Cache"] = writeTtl > 0 ? (readTtl === 0 ? "BYPASS" : "MISS") : "NONE";
        data = await withTimeout(
          (sig) =>
            endpoint.handler(value, {
              fetch: this.fetchImpl,
              lookup: this.lookupImpl,
              signal: sig,
              key: { id: keyRec.id, plan: keyRec.plan },
              project: scraper.key,
              endpoint: endpoint.slug,
            }),
          endpoint.timeoutMs,
          signal
        );
        this.cache.set(cacheKey, data, writeTtl);
      }

      this.store.recordStat(scraper.id, true);
      if (ticket) Object.assign(headers, ticket.headers());
      return { status: 200, body: okRun(scraper.key, data), headers };
    } catch (err) {
      return this._fail(err, { ticket, headers, keyRec, projectKey, endpointSlug });
    }
  }

  _fail(err, { ticket, headers, keyRec, projectKey, endpointSlug }) {
    const { scraper } = this.catalog.resolve(projectKey, endpointSlug);
    let status, body, extra = {};
    if (err instanceof HttpError) {
      status = err.status;
      body = err.body;
      extra = err.headers;
    } else if (err instanceof ScraperError) {
      status = 400;
      body = { project: projectKey, error: err.message, errors: err.errors, ...(err.context ? { context: err.context } : {}), timestamp: nowIso() };
    } else if (err?.name === "ZieTimeout") {
      status = 504;
      body = { content: null, message: "Upstream timed out", errors: [] };
    } else {
      status = 500;
      body = { content: null, message: "Internal error", errors: [] };
      this.logger?.error?.(err);
    }
    // 5xx is never billed (E02). 4xx after reservation is billed.
    if (ticket && status >= 500) ticket.refund();
    if (scraper && ticket) this.store.recordStat(scraper.id, false);
    if (ticket) extra = { ...ticket.headers(), ...extra };
    if (status >= 500 || err instanceof ScraperError) {
      this.webhooks?.emit(keyRec?.id, "request.error", { project: projectKey, endpoint: endpointSlug, status, message: body.message ?? body.error });
    }
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
  const onAbort = () => ac.abort(outer.reason);
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
