import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp, normalizeUrl } from "../src/app.js";
import { MemoryKV, UpstashKV, SupabaseKV } from "../src/db/kv.js";

// Set ZIE_TEST_SUPABASE_URL + ZIE_TEST_SUPABASE_KEY to run the whole suite against a real Supabase (or a local Postgres shim).
const testKv = () => (process.env.ZIE_TEST_SUPABASE_URL ? new SupabaseKV({ url: process.env.ZIE_TEST_SUPABASE_URL, key: process.env.ZIE_TEST_SUPABASE_KEY }) : new MemoryKV());
import { verifySignature } from "../src/core/webhooks.js";
import devtools from "../src/scrapers/live/devtools.js";

const flaky = {
  category: "dev-tools",
  slug: "flaky",
  displayName: "Flaky",
  endpoints: [
    { slug: "boom", fields: [], handler: () => { throw new Error("kaboom"); } },
    { slug: "echo", bulkEnabled: true, fields: [{ name: "n", type: "integer", required: true }], handler: ({ n }) => { if (n === 13) throw Object.assign(new Error("unlucky"), { name: "ScraperError" }); return { n }; } },
    { slug: "gated", minPlan: "pro", fields: [], handler: () => ({ ok: true }) },
  ],
};

let app, base;
const deliveries = [];
const upstreamCalls = [];
before(async () => {
  app = createApp({
    logger: null,
    quiet: true,
    env: { ZIE_ADMIN_EMAILS: "boss@zieads.com", ZIE_UPSTREAM_URL: "https://upstream.test", ZIE_UPSTREAM_KEY: "up_secret", ZIE_KEYS: "ultra:zie_env_ultra_key_000000", DODO_PAYMENTS_API_KEY: "test_dodo", DODO_PAYMENTS_PRODUCT_ID: "pdt_test", DODO_PAYMENTS_ENVIRONMENT: "test_mode" },
    dodoFetch: async (url, init) => (init.method === "POST" ? Response.json({ session_id: "cks_x", checkout_url: "https://test.checkout.dodopayments.com/session/x" }) : Response.json({ payment_id: "pay_test", payment_status: "succeeded" })),
    apiUrl: "http://api.test",
    publicUrl: "http://zie.test",
    scrapers: [...devtools, flaky],
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    kv: testKv(),
    webhookFetch: async (url, init) => { deliveries.push({ url, init }); return new Response("ok"); },
    fetch: async (url, init) => {
      upstreamCalls.push({ url: String(url), init });
      if (String(url).startsWith("https://upstream.test/")) return Response.json({ project: "x", data: { forwarded: true }, timestamp: "t" });
      return new Response("nope", { status: 404 });
    },
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => new Promise((r) => app.server.close(r)));

/** Tiny browser-like client with a cookie jar. */
function client() {
  let jar = "";
  return async (path, { method = "GET", body, headers = {}, csrf = true } = {}) => {
    const h = { ...headers };
    if (jar) h.cookie = jar;
    if (csrf && method !== "GET") h["x-zie-csrf"] = "1";
    if (body !== undefined) h["content-type"] = "application/json";
    const res = await fetch(base + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    const sc = res.headers.get("set-cookie");
    if (sc) jar = sc.split(";")[0].endsWith("=") ? "" : sc.split(";")[0];
    const t = await res.text();
    let j;
    try { j = JSON.parse(t); } catch { j = t; }
    return { status: res.status, body: j, headers: res.headers };
  };
}
const key = (k) => ({ "x-api-key": k });

test("website pages render", async () => {
  const c = client();
  for (const p of ["/", "/scrapers", "/pricing", "/docs", "/docs/errors", "/mcp", "/showcase", "/report", "/status", "/terms", "/privacy", "/login", "/register", "/category/dev-tools", "/api/dev-tools/hash"]) {
    const r = await c(p);
    assert.equal(r.status, 200, p);
    assert.match(r.body, /<title>/, p);
  }
  assert.equal((await c("/nope")).status, 404);
  assert.equal((await c("/dashboard")).status, 302);
});

test("catalog merges the seed with live scrapers", async () => {
  const t = app.catalog.totals();
  assert.ok(t.scrapers > 250 && t.endpoints > 1000, JSON.stringify(t));
  const c = client();
  const list = await c("/api/scrapers/list?limit=3&live=true");
  assert.equal(list.body.message, "OK");
  assert.ok(list.body.content.items.every((i) => i.status === "live"));
  assert.ok(!app.catalog.find("ai:bypass-ai") && !app.catalog.categories.some((x) => x.slug === "bypass-tools"));
  const oa = await c("/category/dev-tools/openapi.json");
  assert.equal(oa.body.openapi, "3.1.0");
});

test("register → session → key → call API → logs/usage", async () => {
  const c = client();
  const noCsrf = await c("/auth/register", { method: "POST", body: { email: "a@x.io", password: "password1" }, csrf: false });
  assert.equal(noCsrf.status, 403);
  const reg = await c("/auth/register", { method: "POST", body: { name: "A", email: "a@x.io", password: "password1" } });
  assert.equal(reg.status, 200);
  assert.equal((await c("/auth/register", { method: "POST", body: { email: "a@x.io", password: "password1" } })).status, 409);
  const me = await c("/api/me");
  assert.equal(me.body.content.user.email, "a@x.io");
  const k = await c("/api/me/keys", { method: "POST", body: { name: "prod" } });
  assert.equal(k.status, 201);
  const secret = k.body.content.key;
  assert.match(secret, /^apz_/);

  const run = await fetch(`${base}/v1/dev-tools:hash/digest?text=halo`, { headers: key(secret) });
  const body = await run.json();
  assert.equal(run.status, 200);
  assert.equal(body.project, "dev-tools:hash");
  assert.equal(run.headers.get("x-ratelimit-remaining-month"), "999");

  const logs = await c("/api/me/logs");
  assert.equal(logs.body.content.items[0].project, "dev-tools:hash");
  const usage = await c("/api/me/usage");
  assert.equal(usage.body.content.quota.month.used, 1);
  assert.equal(usage.body.content.scrapersThisMonth["dev-tools:hash"], 1);
  assert.equal(usage.body.content.summary.total, 1);
  assert.equal(usage.body.content.perKey[0].requests, 1);

  // session playground run
  const pg = await c("/api/me/run", { method: "POST", body: { project: "dev-tools:uuid", endpoint: "v4", params: { count: 2 } } });
  assert.equal(pg.body.data.uuids.length, 2);

  // logout + login
  await c("/auth/logout", { method: "POST" });
  assert.equal((await c("/api/me")).status, 401);
  assert.equal((await c("/auth/login", { method: "POST", body: { email: "a@x.io", password: "wrong-pass" } })).status, 401);
  assert.equal((await c("/auth/login", { method: "POST", body: { email: "a@x.io", password: "password1" } })).status, 200);

  // disable key
  await c(`/api/me/keys/${k.body.content.record.id}`, { method: "PATCH", body: { status: "disabled" } });
  assert.equal((await fetch(`${base}/v1/dev-tools:uuid/v4`, { headers: key(secret) })).status, 401);
});

test("API errors: 401, 404, 405, 400, 500 refund, 501 planned → upstream adapter", async () => {
  const k = "zie_env_ultra_key_000000";
  assert.equal((await fetch(`${base}/v1/dev-tools:uuid/v4`)).status, 401);
  assert.equal((await fetch(`${base}/v1/nope:x/y`, { headers: key(k) })).status, 404);
  const r405 = await fetch(`${base}/v1/dev-tools:text/stats?text=a`, { headers: key(k) });
  assert.equal(r405.status, 405);
  assert.equal(r405.headers.get("allow"), "POST");
  const bad = await (await fetch(`${base}/v1/dev-tools:hash/digest`, { headers: key(k) })).json();
  assert.equal(bad.message, "Invalid params");
  const before = Number((await (await fetch(`${base}/v1/usage`, { headers: key(k) })).json()).content.month.used);
  assert.equal((await fetch(`${base}/v1/dev-tools:flaky/boom`, { headers: key(k) })).status, 500);
  const afterU = Number((await (await fetch(`${base}/v1/usage`, { headers: key(k) })).json()).content.month.used);
  assert.equal(afterU, before, "5xx must be refunded");
  // a catalog-only (seed) endpoint is forwarded to the upstream with the upstream key
  const seeded = app.catalog.scrapers.find((s) => s.endpoints.some((e) => e.status === "upstream"));
  const ep = seeded.endpoints.find((e) => e.status === "upstream" && !e.fields.some((f) => f.required) && !e.pathTemplate && e.method === "GET");
  if (ep) {
    const up = await fetch(`${base}/v1/${seeded.key}/${ep.slug}`, { headers: key(k) });
    assert.equal(up.status, 200);
    assert.deepEqual((await up.json()).data, { forwarded: true });
    const call = upstreamCalls.at(-1);
    assert.ok(call.url.startsWith(`https://upstream.test/v1/${seeded.key}/${ep.slug}`));
    assert.equal(call.init.headers["x-api-key"], "up_secret");
  }
});

test("plan gate, admin upgrade, invoices, bulk, webhooks", async () => {
  const c = client();
  await c("/auth/register", { method: "POST", body: { name: "U", email: "u@x.io", password: "password1" } });
  const { body: kb } = await c("/api/me/keys", { method: "POST", body: { name: "k" } });
  const k = kb.content.key;
  const gate = await (await fetch(`${base}/v1/dev-tools:flaky/gated`, { headers: key(k) })).json();
  assert.equal(gate.error.code, "plan_upgrade_required");

  const inv = await c("/api/me/invoices", { method: "POST", body: { plan: "ultra", months: 1 } });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.content.currency, "USD");
  assert.equal(inv.body.content.amount, 2900, "$29 in cents");
  assert.equal(inv.body.content.priceUsd, 29);
  assert.match(inv.body.content.checkoutUrl, /dodopayments\.com/);
  const yearly = await c("/api/me/invoices", { method: "POST", body: { plan: "pro", months: 12 } });
  assert.equal(yearly.body.content.amount, 9000, "12 months bills 10");
  assert.equal(yearly.body.content.priceUsd, 90);
  await c(`/api/me/invoices/${yearly.body.content.id}/cancel`, { method: "POST" });

  const admin = client();
  await admin("/auth/register", { method: "POST", body: { name: "Boss", email: "boss@zieads.com", password: "password1" } });
  assert.equal((await c("/api/admin/overview")).status, 403);
  const ov = await admin("/api/admin/overview");
  assert.equal(ov.status, 200);
  // back from checkout: the server asks Dodo (stand-in says paid) and activates the plan
  const ap = await c(`/api/me/invoices/${inv.body.content.id}/sync`, { method: "POST", body: {} });
  assert.equal(ap.body.content.status, "paid");
  assert.equal((await c("/api/me")).body.content.plan.id, "ultra");

  assert.equal((await fetch(`${base}/v1/dev-tools:flaky/gated`, { headers: key(k) })).status, 200);

  // webhooks (ultra has them)
  const wh = await c("/api/me/webhooks", { method: "PUT", body: { webhooks: [{ url: "https://hooks.test/x", events: ["bulk.completed", "webhook.test"] }] } });
  const secret = wh.body.content[0].secret;
  // bulk
  const sub = await fetch(`${base}/v1/dev-tools:flaky/echo/bulk`, { method: "POST", headers: { ...key(k), "content-type": "application/json", "idempotency-key": "abc" }, body: JSON.stringify({ items: [{ n: 1 }, { params: { n: 2 } }, { n: 13 }] }) });
  const job = await sub.json();
  assert.equal(sub.status, 202);
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.succeeded, 2);
  assert.equal(job.failed, 1);
  const again = await (await fetch(`${base}/v1/dev-tools:flaky/echo/bulk`, { method: "POST", headers: { ...key(k), "content-type": "application/json", "idempotency-key": "abc" }, body: JSON.stringify({ items: [{ n: 1 }, { params: { n: 2 } }, { n: 13 }] }) })).json();
  assert.equal(again.jobId, job.jobId);
  const poll = await (await fetch(`${base}/v1/bulk/${job.jobId}`, { headers: key(k) })).json();
  assert.equal(poll.items.length, 3);
  await app.webhooks.drain();
  const d = deliveries.find((x) => JSON.parse(x.init.body).event === "bulk.completed");
  assert.ok(d, "bulk.completed webhook delivered");
  assert.ok(verifySignature(secret, d.init.body, d.init.headers["x-apizie-signature"]));
});

test("MCP: initialize, tools/list, run_scraper", async () => {
  const k = "zie_env_ultra_key_000000";
  const rpc = (method, params) => fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
  assert.equal((await rpc("initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.name, "apizie");
  assert.equal((await rpc("tools/list")).result.tools.length, 8);
  const run = await rpc("tools/call", { name: "run_scraper", arguments: { scraper: "dev-tools:uuid", endpoint: "v4", params: { count: 1 } } });
  assert.equal(run.result.isError, false);
  const unauth = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(unauth.status, 401);
  const page = await fetch(`${base}/mcp`, { headers: { accept: "text/html" } });
  assert.match(await page.text(), /MCP/);
});

test("rate limit per minute → 429", async () => {
  const c = client();
  await c("/auth/register", { method: "POST", body: { name: "R", email: "r@x.io", password: "password1" } });
  const k = (await c("/api/me/keys", { method: "POST", body: {} })).body.content.key;
  const rs = await Promise.all(Array.from({ length: 101 }, () => fetch(`${base}/v1/dev-tools:uuid/v4`, { headers: key(k) })));
  const limited = rs.filter((r) => r.status === 429);
  assert.equal(limited.length, 1);
  const b = await limited[0].json();
  assert.equal(b.content.window, "minute");
  assert.ok(limited[0].headers.get("retry-after"));
});

test("helpers: normalizeUrl + UpstashKV wire format", async () => {
  assert.equal(normalizeUrl("/api/apizie?__path=v1/a:b/c&x=1").pathname, "/v1/a:b/c");
  const sent = [];
  const kv = new UpstashKV({ url: "https://kv.test", token: "t", fetchImpl: async (u, init) => { sent.push({ u, body: JSON.parse(init.body) }); return Response.json(u.endsWith("/pipeline") ? [{ result: 5 }, { result: 1 }] : { result: "v" }); } });
  assert.equal(await kv.get("k"), "v");
  assert.equal(await kv.incrby("c", 2, 60), 5);
  assert.deepEqual(sent[0].body, ["GET", "k"]);
  assert.deepEqual(sent[1].body, [["INCRBY", "c", "2"], ["EXPIRE", "c", "60", "NX"]]);
});

test("source logos: catalog has icons and admins can override them", async () => {
  const list = await (await fetch(`${base}/api/scrapers/list?limit=500&origin=native`)).json();
  const withIcon = list.content.items.filter((i) => i.iconUrl);
  assert.ok(withIcon.length > 200, `only ${withIcon.length} icons`);
  const bin = list.content.items.find((i) => i.key === "finance:binance");
  assert.match(bin.iconUrl, /^\/assets\/sources\/binance\.com\.(png|svg)$/);
  assert.equal(bin.sourceUrl, "https://binance.com");
  const icon = await fetch(base + bin.iconUrl);
  assert.equal(icon.status, 200);
  const admin = client();
  await admin("/auth/login", { method: "POST", body: { email: "boss@zieads.com", password: "password1" } });
  const bad = await admin("/api/admin/scrapers/finance:binance/icon", { method: "POST", body: { url: "javascript:alert(1)" } });
  assert.equal(bad.status, 400);
  await admin("/api/admin/scrapers/finance:binance/icon", { method: "POST", body: { url: "https://example.com/logo.png" } });
  const d = await (await fetch(`${base}/api/scrapers/finance:binance`)).json();
  assert.equal(d.content.iconUrl, "https://example.com/logo.png");
  await admin("/api/admin/scrapers/finance:binance/icon", { method: "POST", body: { url: "" } });
  const d2 = await (await fetch(`${base}/api/scrapers/finance:binance`)).json();
  assert.match(d2.content.iconUrl, /binance\.com/);
});

test("global APIs: BYOK through /v1, per-API OpenAPI spec and filters", async () => {
  const k = { "x-api-key": "zie_env_ultra_key_000000" };
  const need = await fetch(`${base}/v1/iot:adafruit/current-user`, { headers: k });
  assert.equal(need.status, 401);
  assert.equal((await need.json()).error.code, "upstream_key_required");
  const before = upstreamCalls.length;
  const withKey = await fetch(`${base}/v1/iot:adafruit/current-user`, { headers: { ...k, "x-upstream-key": "aio_test" } });
  assert.equal(withKey.status, 400); // mocked upstream answers 404 -> ScraperError
  const call = upstreamCalls.slice(before).find((c) => c.url.startsWith("https://io.adafruit.com"));
  assert.ok(call, "upstream was called");
  assert.equal(call.init.headers["x-aio-key"], "aio_test");
  const spec = await (await fetch(`${base}/api/iot/adafruit/openapi.json`)).json();
  assert.ok(Object.keys(spec.paths).length > 5);
  const nokey = await (await fetch(`${base}/api/scrapers/list?origin=directory&auth=none&limit=3`)).json();
  assert.ok(nokey.content.items.every((i) => !i.auth));
});

test("SEO + GEO: metadata, JSON-LD, robots, sitemap, markdown twins, icons", async () => {
  const home = await (await fetch(base + "/")).text();
  assert.match(home, /<link rel="canonical" href="http:\/\/zie\.test\/">/);
  assert.match(home, /<meta property="og:image" content="http:\/\/zie\.test\/assets\/og\/home\.png\?v=5">/);
  assert.match(home, /<meta name="twitter:card" content="summary_large_image">/);
  // First headline is server-rendered word by word; the other three rotate in from data-hero-rotate.
  assert.match(home, /<h1 class="hero-title"[^>]*>.*>One<\/span> <span[^>]*>API<\/span> <span[^>]*>key<\/span> <span class="w">for<\/span>/);
  const rotate = JSON.parse(/data-hero-rotate="([^"]+)"/.exec(home)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.equal(rotate.length, 4);
  assert.ok(rotate.some((h) => h.lines.flat().map((w) => w.t).join(" ") === "The API key for your AI agent"));
  assert.ok(rotate.every((h) => h.sub && !/Indonesia|BMKG|rupiah/i.test(h.sub)));
  // Global landing page: no Indonesia-only copy, and hero logos are keyless live APIs only.
  const visible = home.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.doesNotMatch(visible, /Indonesia|BMKG|Kemenag|sholat|Borobudur/i);
  const full = createApp({ logger: null, quiet: true, env: {}, kv: new MemoryKV() }); // the real live scrapers
  await new Promise((r) => full.server.listen(0, "127.0.0.1", r));
  const fullHome = await (await fetch(`http://127.0.0.1:${full.server.address().port}/`)).text();
  await new Promise((r) => full.server.close(r));
  assert.equal((fullHome.match(/class="brand-marquee/g) ?? []).length, 3);
  assert.match(fullHome, /class="brand-marquee rev"/);
  assert.doesNotMatch(fullHome.replace(/<script[\s\S]*?<\/script>/g, ""), /Indonesia|BMKG|Kemenag|sholat|Borobudur/i);
  const { HERO_BRANDS } = await import("../src/web/brands.js");
  for (const b of HERO_BRANDS) assert.equal(full.catalog.find(b.key)?.status, "live", `${b.name} is live`);
  const graphs = [...home.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const types = graphs.flatMap((g) => g["@graph"].map((n) => n["@type"]));
  for (const t of ["Organization", "WebSite", "SoftwareApplication", "FAQPage"]) assert.ok(types.includes(t), t);
  const desc = /<meta name="description" content="([^"]+)"/.exec(home)[1];
  assert.ok(desc.length <= 160, `description ${desc.length}`);

  const api = await (await fetch(base + "/api/dev-tools/uuid")).text();
  assert.match(api, /<title>.*API: \d+ Endpoints? as JSON \| Apizie<\/title>/);
  assert.match(api, /"@type":"WebAPI"/);
  assert.match(api, /About the .* API/);
  assert.match(api, /type="text\/markdown" href="http:\/\/zie\.test\/api\/dev-tools\/uuid\.md"/);

  const md = await fetch(base + "/api/dev-tools/uuid.md");
  assert.equal(md.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.match(await md.text(), /^# .* API\n\n> /);
  const acc = await fetch(base + "/docs/quickstart", { headers: { accept: "text/markdown" } });
  assert.match(await acc.text(), /^# Quickstart/);

  const robots = await (await fetch(base + "/robots.txt")).text();
  for (const bot of ["OAI-SearchBot", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended"]) assert.match(robots, new RegExp(`User-agent: ${bot}`));
  assert.match(robots, /Sitemap: http:\/\/zie\.test\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/dashboard/);
  assert.doesNotMatch(robots, /Disallow: \/mcp/);
  const smi = await (await fetch(base + "/sitemap.xml")).text();
  assert.match(smi, /<sitemapindex[^>]*>[\s\S]*<loc>http:\/\/zie\.test\/sitemap-pages\.xml<\/loc>[\s\S]*<loc>http:\/\/zie\.test\/sitemap-apis-1\.xml<\/loc>/);
  const sm = await (await fetch(base + "/sitemap-pages.xml")).text();
  assert.match(sm, /<loc>http:\/\/zie\.test\/mcp<\/loc><lastmod>\d{4}-\d\d-\d\d<\/lastmod>/);
  // every API page is listed exactly once across the child sitemaps, each under 50,000 URLs
  const parts = [...smi.matchAll(/sitemap-(apis-\d+)\.xml/g)].map((m) => m[1]);
  let apiUrls = 0;
  for (const part of parts) {
    const x = await (await fetch(`${base}/sitemap-${part}.xml`)).text();
    const n = (x.match(/<url>/g) ?? []).length;
    assert.ok(n > 0 && n <= 1000, part);
    apiUrls += n;
  }
  assert.equal(apiUrls, app.catalog.scrapers.length);
  assert.equal((await fetch(base + "/sitemap-apis-999.xml")).status, 404);

  for (const p of ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/assets/og/home.png"]) assert.equal((await fetch(base + p)).status, 200, p);
  const login = await (await fetch(base + "/login")).text();
  assert.match(login, /noindex/);
});

test("showcase: six example builds that only reference real endpoints", async () => {
  const { SHOWCASE_EXAMPLES } = await import("../src/web/showcase-examples.js");
  assert.equal(SHOWCASE_EXAMPLES.length, 6);
  const full = createApp({ logger: null, quiet: true, env: {}, kv: new MemoryKV() }).catalog; // the real live scrapers
  for (const x of SHOWCASE_EXAMPLES) {
    for (const [key, ep] of x.uses) {
      const s = full.find(key);
      assert.ok(s, `${x.slug}: ${key} is in the catalog`);
      assert.equal(s.status, "live", `${x.slug}: ${key} is live`);
      assert.ok(s.endpoints.some((e) => e.slug === ep), `${x.slug}: ${key}/${ep} exists`);
      assert.ok(x.code.includes(key) || x.slug === "research-agent", `${x.slug}: the code calls ${key}`);
    }
    assert.doesNotMatch(x.code + x.summary, /—/);
  }
  const page = await (await fetch(`${base}/showcase`)).text();
  assert.equal((page.match(/class="card sc-ex"/g) ?? []).length, 6);
  assert.match(page, /Made by the Apizie team/);
});
