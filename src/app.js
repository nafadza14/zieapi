// HTTP gateway. Zero dependencies (node:http). Routes:
//   Public  : GET / , /healthz, /openapi.json, /llms.txt
//   Catalog : GET /api/public/categories, /api/scrapers/list, /api/scrapers/:slug,
//             /api/public/scrapers/:slug/endpoints/:ep/schema, /api/public/scrapers/:slug/stats
//   API key : GET|POST /v1/:cat::scraper/:endpoint[/*], POST …/bulk, GET|DELETE /v1/bulk/:id,
//             GET /v1/me, GET /v1/usage, GET|PUT /v1/webhooks, POST /v1/webhooks/test
//   MCP     : POST /mcp
//   Admin   : /admin/keys (Bearer ZIE_ADMIN_TOKEN)

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Store } from "./store.js";
import { Catalog } from "./catalog.js";
import { RateLimiter } from "./ratelimit.js";
import { TtlCache } from "./cache.js";
import { Executor } from "./executor.js";
import { BulkManager } from "./bulk.js";
import { WebhookDispatcher, WEBHOOK_EVENTS, newWebhookSecret } from "./webhooks.js";
import { createMcpHandler } from "./mcp.js";
import { buildOpenApi, buildLlmsTxt } from "./openapi.js";
import { authenticate, createApiKey, clientIp } from "./auth.js";
import { E, HttpError, okContent, errBody } from "./envelope.js";
import { PLANS, getPlan } from "./plans.js";
import { ulid } from "./util.js";
import defaultScrapers from "./scrapers/index.js";

export const VERSION = "1.0.0";
const MAX_BODY = 1_000_000;

export function createApp(opts = {}) {
  const apiUrl = (opts.apiUrl ?? process.env.ZIE_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");
  const publicUrl = (opts.publicUrl ?? process.env.ZIE_PUBLIC_URL ?? apiUrl).replace(/\/+$/, "");
  const adminToken = opts.adminToken ?? process.env.ZIE_ADMIN_TOKEN ?? null;
  const logger = opts.logger === undefined ? console : opts.logger;

  const store = opts.store ?? new Store({ file: opts.dataFile ?? process.env.ZIE_DATA_FILE ?? null });
  const catalog = new Catalog({ publicUrl });
  for (const s of opts.scrapers ?? defaultScrapers) catalog.register(s);

  const webhooks = new WebhookDispatcher(store, { fetchImpl: opts.webhookFetch ?? globalThis.fetch, backoffMs: opts.webhookBackoffMs ?? 500, logger });
  const limiter = new RateLimiter(store, {
    now: opts.now,
    onUsage: (key, before, after, plan) => {
      const warnAt = Math.floor(plan.monthly * 0.8);
      if (before < warnAt && after >= warnAt) webhooks.emit(key.id, "quota.warning", { used: after, limit: plan.monthly, percent: 80 });
      if (before < plan.monthly && after >= plan.monthly) webhooks.emit(key.id, "quota.exceeded", { used: after, limit: plan.monthly });
    },
  });
  const cache = new TtlCache({ now: opts.now });
  const executor = new Executor({ catalog, store, limiter, cache, webhooks, publicUrl, fetchImpl: opts.fetch ?? globalThis.fetch, lookupImpl: opts.lookup ?? null, logger });
  const bulk = new BulkManager({ catalog, store, executor, limiter, webhooks, publicUrl, apiUrl, concurrency: opts.bulkConcurrency ?? 4 });
  const auth = (req) => authenticate(store, req);
  const mcp = createMcpHandler({ catalog, store, executor, limiter, bulk, version: VERSION, authenticate: auth });
  const stats = (id) => store.getStat(id);

  let openapiCache = null;
  let llmsCache = null;

  async function route(req, url, body) {
    const p = url.pathname.replace(/\/+$/, "") || "/";
    const q = queryObject(url.searchParams);
    const m = req.method;

    // ---------- public ------------------------------------------------------
    if (p === "/" && m === "GET")
      return json(200, okContent({ name: "zieapi", version: VERSION, ...catalog.totals(), docs: `${apiUrl}/llms.txt`, openapi: `${apiUrl}/openapi.json`, mcp: `${apiUrl}/mcp` }));
    if (p === "/healthz") return json(200, { ok: true, version: VERSION, uptimeSec: Math.round(process.uptime()) });
    if (p === "/openapi.json" && m === "GET") return json(200, (openapiCache ??= buildOpenApi(catalog, { apiUrl, version: VERSION })), { "Cache-Control": "public, max-age=300" });
    if (p === "/llms.txt" && m === "GET")
      return { status: 200, body: (llmsCache ??= buildLlmsTxt(catalog, { apiUrl, publicUrl })), headers: { "content-type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } };

    // ---------- catalog (public, no auth) -----------------------------------
    const LIST_CACHE = { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" };
    if (m === "GET" && p === "/api/public/categories") return json(200, okContent(catalog.categoryList()), LIST_CACHE);
    if (m === "GET" && p === "/api/scrapers/list") return json(200, okContent(catalog.list(q, stats)), LIST_CACHE);
    let mm;
    if (m === "GET" && (mm = /^\/api\/scrapers\/([^/]+)$/.exec(p))) {
      const d = catalog.detail(decodeURIComponent(mm[1]), stats);
      if (!d) throw E.notFound(`Scraper "${mm[1]}" not found`);
      return json(200, okContent(d));
    }
    if (m === "GET" && (mm = /^\/api\/public\/scrapers\/([^/]+)\/endpoints\/([^/]+)\/schema$/.exec(p))) {
      const sc = catalog.schema(decodeURIComponent(mm[1]), decodeURIComponent(mm[2]));
      if (!sc) throw E.notFound("Endpoint not found");
      return json(200, okContent(sc));
    }
    if (m === "GET" && (mm = /^\/api\/public\/scrapers\/([^/]+)\/stats$/.exec(p))) {
      const s = catalog.find(decodeURIComponent(mm[1]));
      if (!s) throw E.notFound(`Scraper "${mm[1]}" not found`);
      const st = stats(s.id);
      return json(200, okContent({ requests: st.requests, successRate: st.requests ? Math.round((st.success / st.requests) * 1000) / 10 : 100 }));
    }

    // ---------- MCP ---------------------------------------------------------
    if (p === "/mcp") {
      const r = await mcp(req, body);
      return r.body === null ? { status: r.status, body: "", headers: r.headers ?? {} } : json(r.status, r.body, r.headers);
    }

    // ---------- admin -------------------------------------------------------
    if (p.startsWith("/admin/")) return admin(req, p, m, body);

    // ---------- /v1 (API key) -----------------------------------------------
    if (p === "/v1" || p.startsWith("/v1/")) {
      const key = auth(req);
      const noStore = { "Cache-Control": "no-store, private" };

      if (p === "/v1/me" && m === "GET") {
        const plan = getPlan(key.plan);
        return json(200, okContent({ key: publicKey(key), plan }), noStore);
      }
      if (p === "/v1/usage" && m === "GET") return json(200, okContent({ plan: key.plan, ...limiter.snapshot(key) }), noStore);
      if (p === "/v1/webhooks") {
        if (!getPlan(key.plan).webhooks) throw E.planGate("pro", `${publicUrl}/pricing`);
        if (m === "GET") return json(200, okContent(store.getWebhooks(key.id).map(({ secret, ...h }) => ({ ...h, secretPreview: secret.slice(0, 10) + "…" }))), noStore);
        if (m === "PUT") return json(200, okContent(setWebhooks(key, body)), noStore);
        throw E.methodNotAllowed("GET, PUT");
      }
      if (p === "/v1/webhooks/test" && m === "POST") {
        if (!getPlan(key.plan).webhooks) throw E.planGate("pro", `${publicUrl}/pricing`);
        const hooks = store.getWebhooks(key.id);
        const results = await Promise.all(hooks.map((h) => webhooks.deliver(h, "webhook.test", { message: "Hello from zieapi" })));
        return json(200, okContent(results.map((r, i) => ({ webhookId: hooks[i].id, ok: r.ok, status: r.status }))), noStore);
      }
      if ((mm = /^\/v1\/bulk\/([^/]+)$/.exec(p))) {
        if (m === "GET") return json(200, bulk.status(key, mm[1]), noStore);
        if (m === "DELETE") return json(200, bulk.cancel(key, mm[1]), noStore);
        throw E.methodNotAllowed("GET");
      }

      // /v1/{category}:{scraper}/{endpoint}[/{rest...}]
      const parts = p.slice(4).split("/");
      const projectKey = safeDecode(parts[0] ?? "");
      const endpointSlug = safeDecode(parts[1] ?? "");
      if (!projectKey.includes(":")) throw E.notFound(`Invalid project key "${projectKey}"`);
      if (!endpointSlug) throw E.notFound(`Missing endpoint for ${projectKey}`);
      const rest = parts.slice(2).join("/");

      if (rest === "bulk" && m === "POST") {
        const items = Array.isArray(body) ? body : body?.items;
        const job = bulk.submit(key, projectKey, endpointSlug, items, req.headers["idempotency-key"]);
        return json(202, job, noStore);
      }
      if (m !== "GET" && m !== "POST" && m !== "HEAD") throw E.methodNotAllowed(catalog.resolve(projectKey, endpointSlug).endpoint?.method ?? "GET");

      const params = m === "POST" ? { ...q, ...(isPlainObject(body) ? body : {}) } : q;
      const r = await executor.run({ keyRec: key, projectKey, endpointSlug, method: m, params, pathRest: rest || undefined });
      return json(r.status, r.body, { ...noStore, ...r.headers });
    }

    throw E.notFound(`Route ${m} ${p} not found`);
  }

  function setWebhooks(key, body) {
    const list = Array.isArray(body) ? body : body?.webhooks;
    if (!Array.isArray(list) || list.length > 5) throw E.invalidParams([{ path: "webhooks", message: "Provide an array of up to 5 webhooks" }]);
    const prev = store.getWebhooks(key.id);
    const errors = [];
    const next = list.map((h, i) => {
      let u;
      try {
        u = new URL(h.url);
      } catch {}
      if (!u || !["https:", "http:"].includes(u.protocol)) errors.push({ path: `webhooks.${i}.url`, message: "Must be an http(s) URL" });
      const events = Array.isArray(h.events) && h.events.length ? h.events : ["*"];
      const bad = events.filter((e) => e !== "*" && !WEBHOOK_EVENTS.includes(e));
      if (bad.length) errors.push({ path: `webhooks.${i}.events`, message: `Unknown events: ${bad.join(", ")}` });
      const existing = prev.find((x) => x.url === h.url);
      return { id: existing?.id ?? ulid(), url: h.url, events, secret: existing?.secret ?? newWebhookSecret() };
    });
    if (errors.length) throw E.invalidParams(errors);
    store.setWebhooks(key.id, next);
    // Secrets are returned in full only here (on save).
    return next;
  }

  function admin(req, p, m, body) {
    const tok = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!adminToken || !tok || !safeEqual(tok, adminToken)) throw E.unauthorized("Admin token required");
    if (p === "/admin/keys" && m === "GET") return json(200, okContent(store.listKeys().map(publicKey)));
    if (p === "/admin/keys" && m === "POST") {
      const plan = body?.plan ?? "free";
      if (!PLANS[plan]) throw E.invalidParams([{ path: "plan", message: `One of ${Object.keys(PLANS).join(", ")}` }]);
      const { key, record } = createApiKey(store, { plan, name: body?.name ?? "default", owner: body?.owner ?? null, ipAllowlist: body?.ipAllowlist ?? [] });
      webhooks.emit(record.id, "key.created", { keyId: record.id });
      return json(201, okContent({ key, record: publicKey(record) }, "Created — store this key now, it is shown only once."));
    }
    let mm;
    if ((mm = /^\/admin\/keys\/([^/]+)$/.exec(p)) && m === "PATCH") {
      const patch = {};
      if (body?.plan !== undefined) {
        if (!PLANS[body.plan]) throw E.invalidParams([{ path: "plan", message: "Unknown plan" }]);
        patch.plan = body.plan;
      }
      if (body?.status !== undefined) {
        if (!["active", "disabled"].includes(body.status)) throw E.invalidParams([{ path: "status", message: "active | disabled" }]);
        patch.status = body.status;
      }
      if (body?.ipAllowlist !== undefined) patch.ipAllowlist = Array.isArray(body.ipAllowlist) ? body.ipAllowlist : [];
      const rec = store.updateKey(mm[1], patch);
      if (!rec) throw E.notFound("Key not found");
      if (patch.status === "disabled") webhooks.emit(rec.id, "key.disabled", { keyId: rec.id });
      return json(200, okContent(publicKey(rec)));
    }
    throw E.notFound("Admin route not found");
  }

  // ---------- node:http glue ------------------------------------------------
  async function handler(req, res) {
    const t0 = process.hrtime.bigint();
    const requestId = sanitizeId(req.headers["x-request-id"]) ?? ulid();
    let out;
    try {
      const url = new URL(req.url, "http://local");
      if (req.method === "OPTIONS") out = { status: 204, body: "", headers: {} };
      else {
        const body = await readBody(req);
        out = await route(req, url, body);
      }
    } catch (err) {
      if (err instanceof HttpError) out = json(err.status, err.body, err.headers);
      else {
        logger?.error?.(err);
        out = json(500, errBody("Internal error"));
      }
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const headers = {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...out.headers,
      "x-request-id": requestId,
      "X-Response-Time": `${Math.round(ms)}`,
    };
    const payload = typeof out.body === "string" ? out.body : JSON.stringify(out.body);
    res.writeHead(out.status, headers);
    res.end(req.method === "HEAD" ? undefined : payload);
    if (logger?.info && !opts.quiet) logger.info(`${req.method} ${req.url?.split("?")[0]} ${out.status} ${ms.toFixed(1)}ms ip=${clientIp(req)} id=${requestId}`);
  }

  const server = createServer(handler);
  return { server, handler, store, catalog, limiter, cache, executor, bulk, webhooks, apiUrl, publicUrl };
}

// ---------- helpers ---------------------------------------------------------
function json(status, body, headers = {}) {
  return { status, body, headers };
}
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-api-key, api-key, authorization, idempotency-key, x-request-id, mcp-protocol-version",
    "Access-Control-Expose-Headers":
      "x-request-id, X-Response-Time, Retry-After, X-Cache, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Limit-Minute, X-RateLimit-Remaining-Minute, X-RateLimit-Limit-Month, X-RateLimit-Remaining-Month",
    "Access-Control-Max-Age": "86400",
  };
}
function queryObject(sp) {
  const o = {};
  for (const [k, v] of sp) {
    if (k in o) o[k] = Array.isArray(o[k]) ? [...o[k], v] : [o[k], v];
    else o[k] = v;
  }
  return o;
}
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
function sanitizeId(v) {
  return typeof v === "string" && /^[A-Za-z0-9._-]{6,64}$/.test(v) ? v : null;
}
function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function publicKey(k) {
  const { hash, ...rest } = k;
  return rest;
}
async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") return undefined;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, errBody("Payload too large"));
    chunks.push(c);
  }
  if (!size) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, errBody("Invalid JSON body", { errors: [{ path: "body", message: "Malformed JSON" }] }));
  }
}
