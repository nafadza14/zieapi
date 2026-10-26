// Apizie HTTP application (zero dependencies). One handler serves the website,
// dashboard, admin, public catalog API, /v1 scraper API and /mcp.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, normalize, extname } from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { kvFromEnv } from "./db/kv.js";
import { withEnvAliases, applyEnvAliases } from "./env.js";
import { Repo } from "./db/repo.js";
import { Catalog } from "./core/catalog.js";
import { Limiter } from "./core/limits.js";
import { Executor } from "./core/executor.js";
import { BulkManager } from "./core/bulk.js";
import { WebhookDispatcher, WEBHOOK_EVENTS, newWebhookSecret } from "./core/webhooks.js";
import { createMcpHandler } from "./core/mcp.js";
import { buildOpenApi, buildLlmsTxt } from "./core/openapi.js";
import { E, HttpError, okContent, errBody } from "./core/envelope.js";
import { PLANS, getPlan } from "./core/plans.js";
import { ulid, monthKey } from "./core/util.js";
import { apiKeyCaller, clientIp, parseCookies, cookie, SESSION_COOKIE, hashPassword, verifyPassword, enabledProviders, authorizeUrl, exchangeCode, PROVIDERS } from "./auth/index.js";
import { createOAuth, OAuthError, oauthErrorBody } from "./auth/oauth.js";
import { supabaseAuthConfig, pkcePair, supabaseAuthorizeUrl, supabaseExchange } from "./auth/supabase.js";
import liveScrapers from "./scrapers/index.js";

import { homePage } from "./web/pages/home.js";
import { scrapersPage, categoryPage, scraperPage } from "./web/pages/catalog.js";
import { pricingPage } from "./web/pages/pricing.js";
import { docsPage, DOC_SLUGS } from "./web/pages/docs.js";
import { mcpPage, showcasePage, reportPage, statusPage, legalPage, authPage, notFoundPage, dashboardPage, adminPage, consentPage, oauthErrorPage } from "./web/pages/misc.js";

export const VERSION = "2.0.0";
const MAX_BODY = 1_000_000;
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MIME = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".webp": "image/webp", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };

export function createApp(opts = {}) {
  if (!opts.env) applyEnvAliases();
  const env = withEnvAliases(opts.env ?? process.env);
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  const apiUrl = (opts.apiUrl ?? env.ZIE_API_URL ?? env.ZIE_PUBLIC_URL ?? (vercelHost ? `https://${vercelHost}` : `http://localhost:${env.PORT ?? 8787}`)).replace(/\/+$/, "");
  const publicUrl = (opts.publicUrl ?? env.ZIE_PUBLIC_URL ?? apiUrl).replace(/\/+$/, "");
  const serverless = opts.serverless ?? env.VERCEL === "1";
  const production = env.NODE_ENV === "production" || serverless;
  const logger = opts.logger === undefined ? console : opts.logger;
  const adminEmails = new Set(String(env.ZIE_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  // Must be identical on every serverless instance; falls back to a value derived from the Supabase secret.
  const sbSecret = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  const stateSecret = env.ZIE_SESSION_SECRET ?? (sbSecret ? createHmac("sha256", "apizie-state").update(sbSecret).digest("hex") : randomBytes(32).toString("hex"));
  const bank = env.ZIE_BANK_INFO ?? "Bank transfer details are not configured yet. Set APIZIE_BANK_INFO on the server.";
  const upstream = env.ZIE_UPSTREAM_URL ? { url: env.ZIE_UPSTREAM_URL.replace(/\/+$/, ""), key: env.ZIE_UPSTREAM_KEY ?? "", header: (env.ZIE_UPSTREAM_HEADER ?? "x-api-key").toLowerCase() } : null;

  const kv = opts.kv ?? kvFromEnv(env, { file: opts.dataFile ?? env.ZIE_DATA_FILE ?? null });
  const sbAuth = opts.supabaseAuth === undefined ? supabaseAuthConfig(env) : opts.supabaseAuth;
  const loginProviders = () => {
    const own = enabledProviders(env);
    const sb = (sbAuth?.providers ?? []).filter((id) => PROVIDERS[id] && !own.some((o) => o.id === id)).map((id) => ({ id, label: PROVIDERS[id].label }));
    return [...sb, ...own].sort((a, b) => (a.id === "google" ? -1 : b.id === "google" ? 1 : 0));
  };
  const repo = new Repo(kv);
  repo.seedEnvKeys(opts.keys ?? env.ZIE_KEYS);
  const catalog = opts.catalog ?? new Catalog({ live: opts.scrapers ?? liveScrapers, upstream: !!upstream, seed: opts.seed !== false });

  const planOfOwner = async (owner) => {
    if (owner?.startsWith("key_")) return [...repo.envKeys.values()].find((k) => `key_${k.id}` === owner)?.plan ?? "free";
    return repo.effectivePlan(await repo.getUser(owner));
  };
  const webhooks = new WebhookDispatcher(repo, { fetchImpl: opts.webhookFetch ?? globalThis.fetch, backoffMs: opts.webhookBackoffMs ?? 400, logger, planOf: planOfOwner });
  const limiter = new Limiter(repo, {
    now: opts.now,
    onUsage: (owner, plan, before, after) => {
      const p = getPlan(plan);
      const warnAt = Math.floor(p.monthly * 0.8);
      if (before < warnAt && after >= warnAt) webhooks.emit(owner, "quota.warning", { used: after, limit: p.monthly, percent: 80 });
      if (before < p.monthly && after >= p.monthly) webhooks.emit(owner, "quota.exceeded", { used: after, limit: p.monthly });
    },
  });
  const executor = new Executor({ catalog, repo, limiter, webhooks, publicUrl, fetchImpl: opts.fetch ?? globalThis.fetch, lookupImpl: opts.lookup ?? null, upstream, logger });
  const bulk = new BulkManager({ catalog, repo, executor, limiter, webhooks, publicUrl, apiUrl });
  const oauth = createOAuth({ repo, apiUrl, publicUrl, fetchImpl: opts.fetch ?? globalThis.fetch, lookup: opts.lookup ?? null });
  const mcp = createMcpHandler({ catalog, repo, executor, limiter, bulk, version: VERSION, authenticate: (req) => apiKeyCaller(repo, req, oauth), wwwAuthenticate: oauth.wwwAuthenticate });

  const cacheText = new Map();
  const memo = (k, fn) => (cacheText.has(k) ? cacheText.get(k) : (cacheText.set(k, fn()), cacheText.get(k)));
  const statsFor = async (scrapers) => {
    catalog.overrides = await repo.iconOverrides();
    const st = await repo.getStats(scrapers.map((s) => s.id));
    return st;
  };

  // ---------- helpers --------------------------------------------------------
  const userCaller = (user, req, source = "playground") => ({ owner: user.id, plan: repo.effectivePlan(user), keyId: null, keyPreview: "dashboard", ip: clientIp(req), user, source });
  const isAdmin = (u) => u?.role === "admin" || (u?.email && adminEmails.has(u.email));
  const requireUser = (ctx) => {
    if (!ctx.user) throw E.unauthorized("Sign in required");
    return ctx.user;
  };
  const requireAdmin = (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u)) throw E.forbidden("Admin only");
    return u;
  };
  const requireCsrf = (req) => {
    if (req.headers["x-zie-csrf"] !== "1") throw E.forbidden("Missing CSRF header");
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers["x-forwarded-host"] ?? req.headers.host;
      try {
        if (new URL(origin).host !== host) throw E.forbidden("Cross-origin request blocked");
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw E.forbidden("Bad origin");
      }
    }
  };
  const signState = (v) => `${v}.${createHmac("sha256", stateSecret).update(v).digest("base64url")}`;
  const checkState = (signed) => {
    const i = signed?.lastIndexOf(".") ?? -1;
    if (i < 0) return null;
    const v = signed.slice(0, i);
    const a = Buffer.from(signState(v));
    const b = Buffer.from(signed);
    return a.length === b.length && timingSafeEqual(a, b) ? v : null;
  };
  const safeNext = (n) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard");

  async function login(user, req) {
    const { token, maxAge } = await repo.createSession(user.id);
    return cookie(SESSION_COOKIE, token, { maxAge, secure: isHttps(req) });
  }
  async function findOrCreateUser({ email, name, avatar, provider, pid }) {
    let user = provider ? await repo.getUserByProvider(provider, pid) : null;
    if (!user && email) user = await repo.getUserByEmail(email);
    if (!user) {
      const firstUser = !production && (await repo.listUsers()).length === 0;
      user = await repo.createUser({ email, name, avatar, role: firstUser || (email && adminEmails.has(email.toLowerCase())) ? "admin" : "user" });
    }
    if (provider) user = await repo.linkProvider(user.id, provider, pid);
    if (avatar && !user.avatar) user = await repo.updateUser(user.id, { avatar });
    if (email && adminEmails.has(email.toLowerCase()) && user.role !== "admin") user = await repo.updateUser(user.id, { role: "admin" });
    return user;
  }

  // ---------- routes -----------------------------------------------------------
  async function route(ctx) {
    const { req, url, body } = ctx;
    const m = req.method;
    const p = url.pathname.replace(/\/+$/, "") || "/";
    const q = Object.fromEntries(url.searchParams);
    const user = ctx.user;
    let mm;

    // static assets (Vercel serves /public itself; this is for local + fallback)
    if (p.startsWith("/assets/") || p === "/favicon.ico" || p === "/robots.txt") return serveStatic(p === "/favicon.ico" ? "/assets/favicon.ico" : p);

    // ----- machine-readable ----------------------------------------------------
    if (p === "/healthz") return json(200, { ok: true, version: VERSION, uptimeSec: Math.round(process.uptime()), storage: kv.constructor.name });
    if (p === "/api/info") return json(200, okContent({ name: "apizie", version: VERSION, ...catalog.totals(), docs: `${publicUrl}/docs`, openapi: `${apiUrl}/openapi.json`, mcp: `${apiUrl}/mcp` }));
    if (p === "/openapi.json") return json(200, memo("oa", () => buildOpenApi(catalog, { apiUrl, version: VERSION })), { "Cache-Control": "public, max-age=600" });
    if (p === "/llms.txt") return text(memo("llms", () => buildLlmsTxt(catalog, { apiUrl, publicUrl, full: false })));
    if (p === "/llms-full.txt") return text(memo("llmsf", () => buildLlmsTxt(catalog, { apiUrl, publicUrl, full: true })));
    if ((mm = /^\/category\/([a-z0-9-]+)\/(openapi\.json|llms\.txt)$/.exec(p))) {
      if (!catalog.categories.some((c) => c.slug === mm[1])) throw E.notFound("Unknown category");
      return mm[2] === "llms.txt" ? text(buildLlmsTxt(catalog, { apiUrl, publicUrl, category: mm[1] })) : json(200, buildOpenApi(catalog, { apiUrl, version: VERSION, category: mm[1] }));
    }
    // ----- OAuth 2.1 for MCP clients ------------------------------------------------
    if (m === "GET" && (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp")) return json(200, oauth.metadata.protectedResource(), { "Cache-Control": "public, max-age=3600" });
    if (m === "GET" && (p === "/.well-known/oauth-authorization-server" || p === "/.well-known/oauth-authorization-server/mcp" || p === "/.well-known/openid-configuration")) return json(200, oauth.metadata.authorizationServer(), { "Cache-Control": "public, max-age=3600" });
    if (p.startsWith("/oauth/")) return oauthRoutes(ctx, p, m, q, body);
    if (p === "/sitemap.xml") return { status: 200, body: memo("sm", sitemap), headers: { "content-type": "application/xml; charset=utf-8" } };

    // ----- public catalog API -----------------------------------------------
    const LIST_CACHE = { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" };
    if (m === "GET" && p === "/api/public/categories") return json(200, okContent(catalog.categoryList()), LIST_CACHE);
    if (m === "GET" && p === "/api/scrapers/list") return json(200, okContent(catalog.list(q, await statsFor(catalog.scrapers), await repo.disabledScrapers())), LIST_CACHE);
    if (m === "GET" && (mm = /^\/api\/scrapers\/([^/]+)$/.exec(p))) {
      const s = catalog.find(decodeURIComponent(mm[1]));
      if (!s) throw E.notFound(`Scraper "${mm[1]}" not found`);
      return json(200, okContent(catalog.detail(s.key, (await statsFor([s]))[s.id], await repo.disabledScrapers())));
    }
    if (m === "GET" && (mm = /^\/api\/public\/scrapers\/([^/]+)\/endpoints\/([^/]+)\/schema$/.exec(p))) {
      const sc = catalog.schema(decodeURIComponent(mm[1]), decodeURIComponent(mm[2]));
      if (!sc) throw E.notFound("Endpoint not found");
      return json(200, okContent(sc));
    }
    if (m === "GET" && (mm = /^\/api\/public\/scrapers\/([^/]+)\/stats$/.exec(p))) {
      const s = catalog.find(decodeURIComponent(mm[1]));
      if (!s) throw E.notFound("Scraper not found");
      const st = (await statsFor([s]))[s.id];
      return json(200, okContent({ requests: st.requests, successRate: st.requests ? Math.round((st.success / st.requests) * 1000) / 10 : 100 }));
    }

    // ----- auth ------------------------------------------------------------------
    // Supabase Auth (Google by default) when the provider is not configured directly.
    if ((mm = /^\/auth\/(github|google|discord)$/.exec(p)) && m === "GET" && sbAuth?.providers.includes(mm[1]) && !enabledProviders(env).some((x) => x.id === mm[1])) {
      const { verifier, challenge } = pkcePair();
      const st = signState(`${verifier}|${safeNext(q.next)}`);
      return redirect(supabaseAuthorizeUrl(sbAuth, { provider: mm[1], redirectTo: `${publicUrl}/auth/supabase/callback`, challenge }), { "Set-Cookie": cookie("apz_sb", st, { maxAge: 600, secure: isHttps(req) }) });
    }
    if (p === "/auth/supabase/callback" && m === "GET") {
      const raw = checkState(parseCookies(req.headers.cookie).apz_sb);
      const [verifier, next] = raw ? raw.split("|") : [];
      if (q.error) return redirect("/login?error=" + encodeURIComponent(String(q.error_description ?? q.error).slice(0, 200)));
      if (!verifier || !q.code) return redirect("/login?error=" + encodeURIComponent("Sign-in expired, please try again"));
      try {
        const prof = await supabaseExchange(sbAuth, { code: q.code, verifier, fetchImpl: opts.oauthFetch ?? globalThis.fetch });
        const u = await findOrCreateUser({ email: prof.email, name: prof.name, avatar: prof.avatar, provider: "supabase", pid: prof.id });
        if (u.status !== "active") return redirect("/login?error=" + encodeURIComponent("Account suspended"));
        return redirect(safeNext(next), { "Set-Cookie": [await login(u, req), cookie("apz_sb", "", { maxAge: 0 })] });
      } catch (e) {
        logger?.warn?.(e.message);
        return redirect("/login?error=" + encodeURIComponent("Google sign-in failed, please try again"));
      }
    }
    if ((mm = /^\/auth\/(github|google|discord)$/.exec(p)) && m === "GET") {
      if (!enabledProviders(env).some((x) => x.id === mm[1])) return redirect(`/login?error=${encodeURIComponent(PROVIDERS[mm[1]].label + " sign-in is not configured")}`);
      const nonce = randomBytes(16).toString("base64url");
      const state = signState(`${nonce}|${safeNext(q.next)}`);
      return redirect(authorizeUrl(mm[1], { redirectUri: `${publicUrl}/auth/${mm[1]}/callback`, state: nonce, env }), { "Set-Cookie": cookie("apz_oauth", state, { maxAge: 600, secure: isHttps(req) }) });
    }
    if ((mm = /^\/auth\/(github|google|discord)\/callback$/.exec(p)) && m === "GET") {
      const raw = checkState(parseCookies(req.headers.cookie).apz_oauth);
      const [nonce, next] = raw ? raw.split("|") : [];
      if (!nonce || nonce !== q.state || !q.code) return redirect("/login?error=" + encodeURIComponent("Sign-in expired, please try again"));
      try {
        const prof = await exchangeCode(mm[1], { code: q.code, redirectUri: `${publicUrl}/auth/${mm[1]}/callback`, fetchImpl: opts.oauthFetch ?? globalThis.fetch, env });
        const u = await findOrCreateUser({ email: prof.email, name: prof.name, avatar: prof.avatar, provider: mm[1], pid: prof.id });
        if (u.status !== "active") return redirect("/login?error=" + encodeURIComponent("Account suspended"));
        return redirect(safeNext(next), { "Set-Cookie": [await login(u, req), cookie("apz_oauth", "", { maxAge: 0 })] });
      } catch (e) {
        logger?.warn?.(e.message);
        return redirect("/login?error=" + encodeURIComponent("Sign-in failed, please try again"));
      }
    }
    if (p === "/auth/register" && m === "POST") {
      requireCsrf(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      const name = String(body?.name ?? "").trim().slice(0, 60);
      const errors = [];
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ path: "email", message: "Enter a valid email" });
      if (password.length < 8) errors.push({ path: "password", message: "At least 8 characters" });
      if (errors.length) throw E.invalidParams(errors);
      if (await repo.getUserByEmail(email)) throw new HttpError(409, errBody("An account with this email already exists. Sign in instead."));
      const u = await findOrCreateUser({ email, name: name || email.split("@")[0] });
      await repo.updateUser(u.id, { passwordHash: await hashPassword(password) });
      return json(200, okContent({ ok: true }), { "Set-Cookie": await login(u, req) });
    }
    if (p === "/auth/login" && m === "POST") {
      requireCsrf(req);
      const u = await repo.getUserByEmail(String(body?.email ?? ""));
      const ok = u && (await verifyPassword(String(body?.password ?? ""), u.passwordHash));
      if (!ok) throw E.unauthorized("Wrong email or password");
      if (u.status !== "active") throw E.forbidden("Account suspended");
      return json(200, okContent({ ok: true }), { "Set-Cookie": await login(u, req) });
    }
    if (p === "/auth/logout" && m === "POST") {
      requireCsrf(req);
      await repo.deleteSession(ctx.sessionToken);
      return json(200, okContent({ ok: true }), { "Set-Cookie": cookie(SESSION_COOKIE, "", { maxAge: 0 }) });
    }

    // ----- account API (session) -----------------------------------------------
    if (p.startsWith("/api/me")) return meApi(ctx, p, m, q, body);
    if (p.startsWith("/api/admin")) return adminApi(ctx, p, m, q, body);
    if (p === "/api/report" && m === "POST") {
      requireCsrf(req);
      const msg = String(body?.message ?? "").trim();
      if (!msg || !/^[^\s@]+@[^\s@]+$/.test(String(body?.email ?? ""))) throw E.invalidParams([{ path: "message", message: "Email and details are required" }]);
      await repo.put("report", { id: ulid(), type: String(body.type ?? "issue").slice(0, 20), email: String(body.email).slice(0, 200), scraper: String(body.scraper ?? "").slice(0, 100), requestId: String(body.requestId ?? "").slice(0, 64), message: msg.slice(0, 4000), status: "open", userId: user?.id ?? null, createdAt: new Date().toISOString() });
      return json(200, okContent({ ok: true }));
    }
    if (p === "/api/showcase" && m === "POST") {
      requireCsrf(req);
      const u = requireUser(ctx);
      let link;
      try {
        link = new URL(String(body?.url ?? ""));
      } catch {}
      if (!link || !/^https?:$/.test(link.protocol) || !body?.name) throw E.invalidParams([{ path: "url", message: "Name and a valid URL are required" }]);
      await repo.put("showcase", { id: ulid(), userId: u.id, name: String(body.name).slice(0, 80), url: link.toString(), description: String(body.description ?? "").slice(0, 280), status: "pending", createdAt: new Date().toISOString() });
      return json(200, okContent({ ok: true }));
    }

    // ----- MCP -------------------------------------------------------------------
    if (p === "/mcp" && (m === "POST" || /text\/event-stream/.test(req.headers.accept ?? "") || m === "DELETE")) {
      const r = await mcp(req, body);
      return r.body === null ? { status: r.status, body: "", headers: r.headers ?? {} } : json(r.status, r.body, r.headers);
    }

    // ----- /v1 scraper API ---------------------------------------------------------
    if (p === "/v1" || p.startsWith("/v1/")) return v1(ctx, p, m, q, body);

    // ----- website ---------------------------------------------------------------
    if (m !== "GET" && m !== "HEAD") throw E.notFound(`Route ${m} ${p} not found`);
    return pages(ctx, p, q);
  }

  async function oauthRoutes(ctx, p, m, q, body) {
    const { req, user } = ctx;
    const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };
    const htmlOut = (s, status = 200) => ({ status, body: s, headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    try {
      if (p === "/oauth/register" && m === "POST") return json(201, await oauth.register(body), noStore);
      if (p === "/oauth/token" && m === "POST") return json(200, await oauth.token(req, body), noStore);
      if (p === "/oauth/revoke" && m === "POST") return json(200, await oauth.revoke(req, body), noStore);
      if (p === "/oauth/authorize" && m === "GET") {
        const v = await oauth.validateAuthorize(q);
        if (v.fatal) return htmlOut(oauthErrorPage({ user, message: v.fatal }), 400);
        if (v.redirect) return redirect(v.redirect);
        if (!user) return redirect(`/login?next=${encodeURIComponent(p + ctx.url.search)}`);
        const tx = signState(Buffer.from(JSON.stringify({ ...v.params, uid: user.id, exp: Date.now() + 600_000 })).toString("base64url"));
        return htmlOut(consentPage({ user, client: v.client, scope: v.params.scope, tx, redirectHost: safeHost(v.params.redirect_uri) }));
      }
      if (p === "/oauth/authorize" && m === "POST") {
        const raw = checkState(String(body?.tx ?? ""));
        const params = raw ? JSON.parse(Buffer.from(raw, "base64url").toString()) : null;
        if (!params || params.exp < Date.now()) return htmlOut(oauthErrorPage({ user, message: "This request expired. Start the connection again from your app." }), 400);
        if (!user || user.id !== params.uid) return redirect("/login");
        const { uid, exp, ...rest } = params;
        return redirect(body?.decision === "approve" ? await oauth.approve(user, rest) : oauth.deny(rest));
      }
    } catch (e) {
      if (e instanceof OAuthError || e instanceof HttpError) return json(e.status === 401 ? 401 : 400, oauthErrorBody(e), noStore);
      throw e;
    }
    throw E.notFound("Not found");
  }

  async function v1(ctx, p, m, q, body) {
    const { req } = ctx;
    const caller = await apiKeyCaller(repo, req, oauth);
    caller.upstreamAuth = upstreamAuthFrom(req.headers);
    const noStore = { "Cache-Control": "no-store, private" };
    let mm;
    if (p === "/v1/me" && m === "GET") return json(200, okContent({ user: caller.user ? publicUser(caller.user) : null, key: { id: caller.keyId, preview: caller.keyPreview }, plan: getPlan(caller.plan) }), noStore);
    if (p === "/v1/usage" && m === "GET") return json(200, okContent(await limiter.snapshot(caller.owner, caller.plan)), noStore);
    if ((mm = /^\/v1\/bulk\/([^/]+)$/.exec(p))) {
      if (m !== "GET") throw E.methodNotAllowed("GET");
      return json(200, await bulk.status(caller, mm[1]), noStore);
    }
    const parts = p.slice(4).split("/");
    const projectKey = safeDecode(parts[0] ?? "");
    const endpointSlug = safeDecode(parts[1] ?? "");
    if (!projectKey.includes(":")) throw E.notFound(`Invalid project key "${projectKey}"`);
    if (!endpointSlug) throw E.notFound(`Missing endpoint for ${projectKey}`);
    const rest = parts.slice(2).join("/");
    if (rest === "bulk" && m === "POST") {
      const items = Array.isArray(body) ? body : body?.items;
      return json(202, await bulk.submit({ ...caller, source: "bulk" }, projectKey, endpointSlug, items, ctx.req.headers["idempotency-key"]), noStore);
    }
    if (!["GET", "POST", "HEAD"].includes(m)) throw E.methodNotAllowed(catalog.resolve(projectKey, endpointSlug).endpoint?.method ?? "GET");
    const params = m === "POST" ? { ...q, ...(isPlainObject(body) ? body : {}) } : q;
    const r = await executor.run({ caller: { ...caller, source: "rest" }, projectKey, endpointSlug, method: m, params, pathRest: rest || undefined });
    return json(r.status, r.body, { ...noStore, ...r.headers });
  }

  async function meApi(ctx, p, m, q, body) {
    const { req } = ctx;
    const user = requireUser(ctx);
    if (m !== "GET") requireCsrf(req);
    const plan = repo.effectivePlan(user);
    let mm;
    if (p === "/api/me" && m === "GET") return json(200, okContent({ user: publicUser(user), plan: getPlan(plan), admin: isAdmin(user), providers: Object.keys(user.providers ?? {}) }));
    if (p === "/api/me" && m === "PATCH") {
      const patch = {};
      if (body?.name !== undefined) patch.name = String(body.name).trim().slice(0, 60) || user.name;
      if (body?.newPassword !== undefined) {
        if (String(body.newPassword).length < 8) throw E.invalidParams([{ path: "newPassword", message: "At least 8 characters" }]);
        if (user.passwordHash && !(await verifyPassword(String(body.currentPassword ?? ""), user.passwordHash))) throw E.invalidParams([{ path: "currentPassword", message: "Current password is wrong" }]);
        patch.passwordHash = await hashPassword(String(body.newPassword));
      }
      return json(200, okContent(publicUser(await repo.updateUser(user.id, patch))));
    }
    if (p === "/api/me/overview" && m === "GET") {
      const [snap, keys, days, scr, logs] = await Promise.all([limiter.snapshot(user.id, plan), repo.listKeys(user.id), repo.dailyUsage(user.id, 14), repo.scraperUse(user.id), repo.getLogs(user.id, { limit: 6 })]);
      return json(200, okContent({ usage: snap, plan: getPlan(plan), planExpiresAt: user.planExpiresAt, keys: keys.map(publicKey), days, top: topN(scr, 5), recent: logs }));
    }
    if (p === "/api/me/keys" && m === "GET") return json(200, okContent((await repo.listKeys(user.id)).map(publicKey)));
    if (p === "/api/me/keys" && m === "POST") {
      const keys = await repo.listKeys(user.id);
      if (keys.length >= 20) throw E.invalidParams([{ path: "name", message: "Maximum 20 keys per account" }]);
      const { secret, rec } = await repo.createKey(user.id, { name: String(body?.name ?? "New key").slice(0, 60) });
      webhooks.emit(user.id, "key.created", { keyId: rec.id, name: rec.name });
      return json(201, okContent({ key: secret, record: publicKey(rec) }, "Created. Copy this key now, it is shown only once."));
    }
    if ((mm = /^\/api\/me\/keys\/([^/]+)$/.exec(p))) {
      const k = await repo.getKeyById(mm[1]);
      if (!k || k.userId !== user.id) throw E.notFound("Key not found");
      if (m === "DELETE") {
        await repo.deleteKey(k.id);
        return json(200, okContent({ ok: true }));
      }
      if (m === "PATCH") {
        const patch = {};
        if (body?.name !== undefined) patch.name = String(body.name).slice(0, 60);
        if (body?.status !== undefined) {
          if (!["active", "disabled"].includes(body.status)) throw E.invalidParams([{ path: "status", message: "active | disabled" }]);
          patch.status = body.status;
          if (body.status === "disabled") webhooks.emit(user.id, "key.disabled", { keyId: k.id });
        }
        if (body?.ipAllowlist !== undefined) {
          if (!getPlan(plan).webhooks) throw E.planGate("pro", `${publicUrl}/pricing`);
          patch.ipAllowlist = (Array.isArray(body.ipAllowlist) ? body.ipAllowlist : String(body.ipAllowlist).split(/[\s,]+/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
        }
        return json(200, okContent(publicKey(await repo.updateKey(k.id, patch))));
      }
    }
    if (p === "/api/me/apps" && m === "GET") return json(200, okContent(await oauth.listGrants(user.id)));
    if ((mm = /^\/api\/me\/apps\/([^/]+)$/.exec(p)) && m === "DELETE") {
      await oauth.revokeGrant(user.id, decodeURIComponent(mm[1]));
      return json(200, okContent({ ok: true }));
    }
    if (p === "/api/me/usage" && m === "GET") {
      const [snap, days, scr] = await Promise.all([limiter.snapshot(user.id, plan), repo.dailyUsage(user.id, 30), repo.scraperUse(user.id, q.month || monthKey())]);
      return json(200, okContent({ ...snap, days, scrapers: topN(scr, 50) }));
    }
    if (p === "/api/me/logs" && m === "GET") {
      const limit = Math.min(100, Number(q.limit) || 50);
      const offset = Math.max(0, Number(q.offset) || 0);
      const cutoff = Date.now() - getPlan(plan).logDays * 86400000;
      const logs = (await repo.getLogs(user.id, { limit, offset })).filter((l) => Date.parse(l.at) >= cutoff);
      return json(200, okContent({ items: logs, limit, offset, retentionDays: getPlan(plan).logDays }));
    }
    if (p === "/api/me/bulk" && m === "GET") return json(200, okContent(await bulk.list(user.id)));
    if ((mm = /^\/api\/me\/bulk\/([^/]+)$/.exec(p)) && m === "GET") return json(200, okContent(await bulk.status({ owner: user.id }, mm[1])));
    if (p === "/api/me/webhooks") {
      if (m === "GET") return json(200, okContent({ enabled: getPlan(plan).webhooks, events: WEBHOOK_EVENTS, hooks: (await repo.getWebhooks(user.id)).map(({ secret, ...h }) => ({ ...h, secretPreview: secret.slice(0, 10) + "…" })) }));
      if (m === "PUT") {
        if (!getPlan(plan).webhooks) throw E.planGate("pro", `${publicUrl}/pricing`);
        const list = Array.isArray(body) ? body : body?.webhooks;
        if (!Array.isArray(list) || list.length > 5) throw E.invalidParams([{ path: "webhooks", message: "Up to 5 webhooks" }]);
        const prev = await repo.getWebhooks(user.id);
        const errors = [];
        const next = list.map((h, i) => {
          let u;
          try {
            u = new URL(h.url);
          } catch {}
          if (!u || !/^https?:$/.test(u.protocol)) errors.push({ path: `webhooks.${i}.url`, message: "Must be an http(s) URL" });
          const events = Array.isArray(h.events) && h.events.length ? h.events : ["*"];
          const bad = events.filter((e) => e !== "*" && !WEBHOOK_EVENTS.includes(e));
          if (bad.length) errors.push({ path: `webhooks.${i}.events`, message: `Unknown events: ${bad.join(", ")}` });
          const ex = prev.find((x) => x.url === h.url);
          return { id: ex?.id ?? ulid(), url: h.url, events, secret: ex?.secret ?? newWebhookSecret() };
        });
        if (errors.length) throw E.invalidParams(errors);
        await repo.setWebhooks(user.id, next);
        return json(200, okContent(next));
      }
    }
    if (p === "/api/me/webhooks/test" && m === "POST") {
      const hooks = await repo.getWebhooks(user.id);
      const res = await Promise.all(hooks.map((h) => webhooks.deliver(h, "webhook.test", { message: "Hello from Apizie" })));
      return json(200, okContent(res.map((r, i) => ({ url: hooks[i].url, ok: r.ok, status: r.status }))));
    }
    if (p === "/api/me/billing" && m === "GET") {
      return json(200, okContent({ plan: getPlan(plan), storedPlan: user.plan, planExpiresAt: user.planExpiresAt, plans: Object.values(PLANS), invoices: await repo.listItems("invoice", user.id), bank }));
    }
    if (p === "/api/me/invoices" && m === "POST") {
      const target = PLANS[body?.plan];
      const months = Math.min(12, Math.max(1, Number(body?.months) || 1));
      if (!target || target.id === "free") throw E.invalidParams([{ path: "plan", message: "Choose pro, ultra or max" }]);
      const open = (await repo.listItems("invoice", user.id)).filter((i) => i.status === "pending" || i.status === "awaiting_review");
      if (open.length >= 3) throw E.invalidParams([{ path: "plan", message: "You already have open invoices. Pay or cancel them first" }]);
      const unique = 1 + Math.floor(Math.random() * 999);
      const inv = { id: "INV-" + ulid().slice(-10), userId: user.id, email: user.email, plan: target.id, months, base: target.priceIdr * months, uniqueCode: unique, amount: target.priceIdr * months + unique, currency: "IDR", method: "bank_transfer", status: "pending", reference: null, createdAt: new Date().toISOString() };
      return json(201, okContent(await repo.put("invoice", inv, user.id)));
    }
    if ((mm = /^\/api\/me\/invoices\/([^/]+)\/(confirm|cancel)$/.exec(p)) && m === "POST") {
      const inv = await repo.getItem("invoice", mm[1]);
      if (!inv || inv.userId !== user.id) throw E.notFound("Invoice not found");
      if (inv.status !== "pending") throw E.invalidParams([{ path: "status", message: `Invoice is ${inv.status}` }]);
      if (mm[2] === "cancel") return json(200, okContent(await repo.patchItem("invoice", inv.id, { status: "cancelled" })));
      const reference = String(body?.reference ?? "").trim().slice(0, 200);
      if (!reference) throw E.invalidParams([{ path: "reference", message: "Enter the transfer reference / sender name" }]);
      return json(200, okContent(await repo.patchItem("invoice", inv.id, { status: "awaiting_review", reference, confirmedAt: new Date().toISOString() })));
    }
    if (p === "/api/me/run" && m === "POST") {
      // dashboard / scraper-page playground: run an endpoint with the session (billed to the account)
      const up = body?.upstreamKey ? { key: String(body.upstreamKey).slice(0, 4000) } : null;
      const r = await executor.run({ caller: userCaller(user, req), projectKey: String(body?.project ?? ""), endpointSlug: String(body?.endpoint ?? ""), params: isPlainObject(body?.params) ? body.params : {}, upstreamAuth: up });
      return json(r.status, r.body, r.headers);
    }
    throw E.notFound("Not found");
  }

  async function adminApi(ctx, p, m, q, body) {
    requireAdmin(ctx);
    if (m !== "GET") requireCsrf(ctx.req);
    let mm;
    if (p === "/api/admin/overview") {
      const [users, invoices, reports, days, requests] = await Promise.all([repo.listUsers(), repo.listItems("invoice"), repo.listItems("report"), repo.dailyUsage(null, 30), repo.globalRequests()]);
      const byPlan = {};
      for (const u of users) byPlan[repo.effectivePlan(u)] = (byPlan[repo.effectivePlan(u)] ?? 0) + 1;
      const revenue = invoices.filter((i) => i.status === "paid" && i.paidAt?.startsWith(monthKey())).reduce((n, i) => n + i.amount, 0);
      return json(200, okContent({ users: users.length, byPlan, pendingInvoices: invoices.filter((i) => i.status === "awaiting_review").length, openReports: reports.filter((r) => r.status === "open").length, revenueThisMonth: revenue, requests, days, catalog: catalog.totals() }));
    }
    if (p === "/api/admin/users" && m === "GET") {
      let users = await repo.listUsers();
      if (q.q) users = users.filter((u) => `${u.email} ${u.name}`.toLowerCase().includes(q.q.toLowerCase()));
      const usage = await Promise.all(users.map((u) => repo.getMonth(u.id)));
      return json(200, okContent(users.slice(0, 500).map((u, i) => ({ ...publicUser(u), effectivePlan: repo.effectivePlan(u), usedThisMonth: usage[i] }))));
    }
    if ((mm = /^\/api\/admin\/users\/([^/]+)$/.exec(p)) && m === "PATCH") {
      const patch = {};
      if (body?.plan && PLANS[body.plan]) {
        patch.plan = body.plan;
        patch.planExpiresAt = body.plan === "free" ? null : new Date(Date.now() + (Number(body.days) || 30) * 86400000).toISOString();
      }
      if (body?.role && ["user", "admin"].includes(body.role)) patch.role = body.role;
      if (body?.status && ["active", "suspended"].includes(body.status)) patch.status = body.status;
      const u = await repo.updateUser(mm[1], patch);
      if (!u) throw E.notFound("User not found");
      if (patch.plan) webhooks.emit(u.id, "plan.changed", { plan: u.plan, planExpiresAt: u.planExpiresAt });
      return json(200, okContent(publicUser(u)));
    }
    if (p === "/api/admin/invoices" && m === "GET") return json(200, okContent(await repo.listItems("invoice")));
    if ((mm = /^\/api\/admin\/invoices\/([^/]+)\/(approve|reject)$/.exec(p)) && m === "POST") {
      const inv = await repo.getItem("invoice", mm[1]);
      if (!inv) throw E.notFound("Invoice not found");
      if (!["pending", "awaiting_review"].includes(inv.status)) throw E.invalidParams([{ path: "status", message: `Invoice is ${inv.status}` }]);
      if (mm[2] === "reject") return json(200, okContent(await repo.patchItem("invoice", inv.id, { status: "rejected", note: String(body?.note ?? "").slice(0, 200) })));
      const u = await repo.getUser(inv.userId);
      const base = u.plan === inv.plan && u.planExpiresAt && Date.parse(u.planExpiresAt) > Date.now() ? Date.parse(u.planExpiresAt) : Date.now();
      const until = new Date(base + inv.months * 30 * 86400000).toISOString();
      await repo.updateUser(u.id, { plan: inv.plan, planExpiresAt: until });
      webhooks.emit(u.id, "plan.changed", { plan: inv.plan, planExpiresAt: until, invoice: inv.id });
      return json(200, okContent(await repo.patchItem("invoice", inv.id, { status: "paid", paidAt: new Date().toISOString() })));
    }
    if (p === "/api/admin/scrapers" && m === "GET") {
      const off = await repo.disabledScrapers();
      const st = await statsFor(catalog.scrapers);
      return json(200, okContent(catalog.scrapers.map((s) => ({ key: s.key, displayName: s.displayName, iconUrl: catalog.overrides[s.key] || s.iconUrl, sourceUrl: s.sourceUrl, status: s.status, enabled: !off.has(s.key), endpoints: s.endpoints.length, live: s.endpoints.filter((e) => e.status === "live").length, requests: st[s.id].requests, successRate: st[s.id].requests ? Math.round((st[s.id].success / st[s.id].requests) * 1000) / 10 : null }))));
    }
    if ((mm = /^\/api\/admin\/scrapers\/([^/]+)\/icon$/.exec(p)) && m === "POST") {
      const key = decodeURIComponent(mm[1]);
      if (!catalog.find(key)) throw E.notFound("Scraper not found");
      const raw = String(body?.url ?? "").trim();
      if (raw && !/^(https:\/\/|\/assets\/|data:image\/(png|svg\+xml|webp|jpeg);base64,)/.test(raw)) throw E.invalidParams([{ path: "url", message: "Use an https:// image URL or a data:image URL" }]);
      if (raw.length > 200_000) throw E.invalidParams([{ path: "url", message: "Image too large (max ~150 KB)" }]);
      await repo.setIconOverride(key, raw || null);
      return json(200, okContent({ key, iconUrl: raw || null }));
    }
    if ((mm = /^\/api\/admin\/scrapers\/([^/]+)$/.exec(p)) && m === "POST") {
      const key = decodeURIComponent(mm[1]);
      if (!catalog.find(key)) throw E.notFound("Scraper not found");
      await repo.setScraperEnabled(key, !!body?.enabled);
      return json(200, okContent({ key, enabled: !!body?.enabled }));
    }
    for (const kind of ["report", "showcase"]) {
      if (p === `/api/admin/${kind}s` && m === "GET") return json(200, okContent(await repo.listItems(kind)));
      if ((mm = new RegExp(`^/api/admin/${kind}s/([^/]+)$`).exec(p)) && m === "PATCH") {
        const allowed = kind === "report" ? ["open", "closed"] : ["pending", "approved", "rejected"];
        if (!allowed.includes(body?.status)) throw E.invalidParams([{ path: "status", message: allowed.join(" | ") }]);
        return json(200, okContent(await repo.patchItem(kind, mm[1], { status: body.status })));
      }
    }
    throw E.notFound("Not found");
  }

  async function pages(ctx, p, q) {
    const { user } = ctx;
    let mm;
    const totals = catalog.totals();
    const html = (s, status = 200, headers = {}) => ({ status, body: s, headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": user ? "private, no-store" : "public, max-age=0, s-maxage=60, stale-while-revalidate=600", ...headers } });
    const items = async () => catalog.list({ limit: 2000 }, await statsFor(catalog.scrapers), await repo.disabledScrapers()).items;

    if (p === "/") {
      const all = await items();
      const pick = (keys) => keys.map((k) => all.find((i) => i.key === k)).filter(Boolean);
      const global = pick(["business:github-api-github", "finance:stripe", "communication:twilio-api", "media:spotify", "communication:sendgrid", "business:slack", "business:trello", "open-data:nasa-asteroids-neows"]);
      return html(homePage({ user, totals, categories: catalog.categoryList(), top: all.filter((i) => i.origin !== "directory").slice(0, 8), global, apiUrl, publicUrl }));
    }
    if (p === "/scrapers" || p === "/playground") return html(scrapersPage({ user, totals, categories: catalog.categoryList(), items: await items(), q: q.q ?? "", cat: q.cat ?? "" }));
    if ((mm = /^\/category\/([a-z0-9-]+)$/.exec(p))) {
      const cat = catalog.categoryList().find((c) => c.slug === mm[1]);
      if (!cat) return html(notFoundPage({ user }), 404);
      return html(categoryPage({ user, category: cat, items: (await items()).filter((i) => i.category === cat.slug) }));
    }
    if ((mm = /^\/api\/([a-z0-9-]+)\/([a-z0-9-]+)\/openapi\.json$/.exec(p))) {
      const s = catalog.find(`${mm[1]}:${mm[2]}`);
      if (!s) return html(notFoundPage({ user }), 404);
      return json(200, buildOpenApi(catalog, { apiUrl, version: VERSION, only: [s] }), { "Cache-Control": "public, max-age=3600" });
    }
    if ((mm = /^\/api\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(p))) {
      const s = catalog.find(`${mm[1]}:${mm[2]}`);
      if (!s) return html(notFoundPage({ user }), 404);
      const d = catalog.detail(s.key, (await statsFor([s]))[s.id], await repo.disabledScrapers());
      return html(scraperPage({ user, s: d, category: catalog.categoryList({ withEmpty: true }).find((c) => c.slug === s.category), apiUrl, epSlug: q.endpoint }));
    }
    if (p === "/pricing") return html(pricingPage({ user }));
    if (p === "/docs" || (mm = /^\/docs\/([a-z0-9-]+)$/.exec(p))) {
      const slug = p === "/docs" ? "" : mm[1];
      const page = DOC_SLUGS.includes(slug) ? docsPage({ user, slug, apiUrl }) : null;
      return page ? html(page) : html(notFoundPage({ user }), 404);
    }
    if (p === "/mcp") return html(mcpPage({ user, apiUrl, totals }));
    if (p === "/showcase") return html(showcasePage({ user, items: (await repo.listItems("showcase")).filter((s) => s.status === "approved") }));
    if (p === "/report") return html(reportPage({ user, type: q.type, scraper: q.scraper }));
    if (p === "/status") return html(statusPage({ user, categories: catalog.categoryList(), totals, uptimeSec: Math.round(process.uptime()), requests: await repo.globalRequests() }));
    if (["/terms", "/privacy", "/cookies", "/aup", "/refund"].includes(p)) return html(legalPage({ user, slug: p.slice(1) }));
    if (p === "/login" || p === "/register") {
      if (user) return redirect(safeNext(q.next));
      return html(authPage({ mode: p.slice(1), providers: loginProviders(), next: safeNext(q.next), error: q.error ?? "", plan: q.plan ?? "" }));
    }
    if (p === "/dashboard" || (mm = /^\/dashboard\/([a-z]+)$/.exec(p))) {
      if (!user) return redirect(`/login?next=${encodeURIComponent(p + (q.plan ? `?plan=${q.plan}` : ""))}`);
      const section = p === "/dashboard" ? "" : mm[1];
      if (!["", "keys", "usage", "logs", "bulk", "webhooks", "billing", "settings"].includes(section)) return html(notFoundPage({ user }), 404);
      return html(dashboardPage({ user, section, plan: repo.effectivePlan(user), apiUrl, bank }));
    }
    if (p === "/admin" || (mm = /^\/admin\/([a-z]+)$/.exec(p))) {
      if (!user) return redirect(`/login?next=${encodeURIComponent(p)}`);
      if (!isAdmin(user)) return html(notFoundPage({ user }), 404);
      return html(adminPage({ user, section: p === "/admin" ? "" : mm[1] }));
    }
    return html(notFoundPage({ user }), 404);
  }

  function sitemap() {
    const urls = ["/", "/scrapers", "/pricing", "/docs", ...DOC_SLUGS.filter(Boolean).map((s) => `/docs/${s}`), "/mcp", "/showcase", "/status", ...catalog.categoryList().map((c) => `/category/${c.slug}`), ...catalog.scrapers.map((s) => `/api/${s.category}/${s.slug}`)];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${publicUrl}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
  }

  async function serveStatic(p) {
    const rel = normalize(p).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    const file = join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) throw E.notFound("Not found");
    try {
      const buf = await readFile(file);
      return { status: 200, body: buf, headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": production ? "public, max-age=3600" : "no-cache" } };
    } catch {
      throw E.notFound("Not found");
    }
  }

  // ---------- node:http glue ------------------------------------------------------
  async function handler(req, res) {
    const t0 = process.hrtime.bigint();
    const requestId = /^[A-Za-z0-9._-]{6,64}$/.test(req.headers["x-request-id"] ?? "") ? req.headers["x-request-id"] : ulid();
    let out;
    const url = normalizeUrl(req.url);
    const isApi = /^\/(v1|api\/(me|admin|public|scrapers|info|report|showcase)|mcp|auth\/(login|register|logout)|\.well-known|oauth\/(register|token|revoke))(\/|$)/.test(url.pathname) && !(req.method === "GET" && url.pathname === "/mcp" && !/event-stream/.test(req.headers.accept ?? ""));
    try {
      if (req.method === "OPTIONS") out = { status: 204, body: "", headers: {} };
      else {
        const sessionToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        const user = sessionToken ? await repo.getSessionUser(sessionToken) : null;
        if (user && isAdmin(user) && user.role !== "admin") user.role = "admin";
        const body = await readBody(req);
        out = await route({ req, url, body, user, sessionToken });
      }
    } catch (err) {
      if (err instanceof HttpError) {
        out = isApi || err.status !== 404 ? json(err.status, err.body, err.headers) : { status: 404, body: notFoundPage({ user: null }), headers: { "content-type": "text/html; charset=utf-8" } };
        if (!isApi && err.status === 404) out.status = 404;
      } else {
        logger?.error?.(err);
        out = json(500, errBody("Internal error"));
      }
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const headers = { "content-type": "application/json; charset=utf-8", ...(isApi ? corsHeaders() : securityHeaders()), ...out.headers, "x-request-id": requestId, "X-Response-Time": `${Math.round(ms)}` };
    const payload = typeof out.body === "string" || Buffer.isBuffer(out.body) ? out.body : JSON.stringify(out.body);
    if (serverless) await webhooks.drain();
    res.writeHead(out.status, headers);
    res.end(req.method === "HEAD" ? undefined : payload);
    if (logger?.info && !opts.quiet) logger.info(`${req.method} ${url.pathname} ${out.status} ${ms.toFixed(1)}ms`);
  }

  const server = createServer(handler);
  return { server, handler, repo, kv, catalog, limiter, executor, bulk, webhooks, apiUrl, publicUrl, serverless };
}

// ---------- helpers -------------------------------------------------------------
export function normalizeUrl(raw) {
  const url = new URL(raw ?? "/", "http://local");
  if (url.searchParams.has("__path") && /^\/api\/(apizie|zieapi)\/?$/.test(url.pathname)) {
    url.pathname = "/" + url.searchParams.get("__path").replace(/^\/+/, "");
    url.searchParams.delete("__path");
  }
  return url;
}
const json = (status, body, headers = {}) => ({ status, body, headers });
function upstreamAuthFrom(h) {
  const key = typeof h["x-upstream-key"] === "string" ? h["x-upstream-key"].trim() : "";
  const authorization = typeof h["x-upstream-authorization"] === "string" ? h["x-upstream-authorization"].trim() : "";
  return key || authorization ? { ...(key ? { key } : {}), ...(authorization ? { authorization } : {}) } : null;
}
const text = (s) => ({ status: 200, body: s, headers: { "content-type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=600" } });
const redirect = (to, headers = {}) => ({ status: 302, body: "", headers: { Location: to, ...headers } });
const isHttps = (req) => req.headers["x-forwarded-proto"] === "https" || !!req.socket?.encrypted;
const safeHost = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:" ? x.host : x.protocol.replace(/:$/, "") + " app";
  } catch {
    return "";
  }
};
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const topN = (obj, n) => Object.entries(obj ?? {}).map(([project, requests]) => ({ project, requests: Number(requests) })).sort((a, b) => b.requests - a.requests).slice(0, n);
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, avatar: u.avatar, role: u.role, plan: u.plan, planExpiresAt: u.planExpiresAt, status: u.status, createdAt: u.createdAt, hasPassword: !!u.passwordHash });
const publicKey = ({ hash, ...k }) => k;
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-api-key, api-key, authorization, idempotency-key, x-request-id, mcp-protocol-version, mcp-session-id, x-upstream-key, x-upstream-authorization",
    "Access-Control-Expose-Headers": "x-request-id, X-Response-Time, Retry-After, X-Cache, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Limit-Minute, X-RateLimit-Remaining-Minute, X-RateLimit-Limit-Month, X-RateLimit-Remaining-Month",
    "Access-Control-Max-Age": "86400",
  };
}
function securityHeaders() {
  return { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" };
}
async function readBody(req) {
  if (["GET", "HEAD", "DELETE", "OPTIONS"].includes(req.method)) return undefined;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, errBody("Payload too large"));
    chunks.push(c);
  }
  let raw = size ? Buffer.concat(chunks).toString("utf8") : null;
  if (!raw) {
    try {
      const pre = req.body;
      if (pre === undefined || pre === null || pre === "") return undefined;
      if (typeof pre === "object" && !Buffer.isBuffer(pre)) return pre;
      raw = Buffer.isBuffer(pre) ? pre.toString("utf8") : String(pre);
    } catch {
      return undefined;
    }
  }
  const type = String(req.headers["content-type"] ?? "");
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, errBody("Invalid JSON body", { errors: [{ path: "body", message: "Malformed JSON" }] }));
  }
}
