import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp, normalizeUrl } from "../src/app.js";
import { MemoryKV, UpstashKV } from "../src/db/kv.js";
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
    env: { ZIE_ADMIN_EMAILS: "boss@zieads.com", ZIE_UPSTREAM_URL: "https://upstream.test", ZIE_UPSTREAM_KEY: "up_secret", ZIE_KEYS: "ultra:zie_env_ultra_key_000000" },
    apiUrl: "http://api.test",
    publicUrl: "http://zie.test",
    scrapers: [...devtools, flaky],
    kv: new MemoryKV(),
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
  assert.match(secret, /^zie_/);

  const run = await fetch(`${base}/v1/dev-tools:hash/digest?text=halo`, { headers: key(secret) });
  const body = await run.json();
  assert.equal(run.status, 200);
  assert.equal(body.project, "dev-tools:hash");
  assert.equal(run.headers.get("x-ratelimit-remaining-month"), "599");

  const logs = await c("/api/me/logs");
  assert.equal(logs.body.content.items[0].project, "dev-tools:hash");
  const usage = await c("/api/me/usage");
  assert.equal(usage.body.content.month.used, 1);
  assert.equal(usage.body.content.scrapers[0].project, "dev-tools:hash");

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
  assert.ok(inv.body.content.amount > 129000 && inv.body.content.amount < 130000);
  const conf = await c(`/api/me/invoices/${inv.body.content.id}/confirm`, { method: "POST", body: { reference: "BCA a.n. U" } });
  assert.equal(conf.body.content.status, "awaiting_review");

  const admin = client();
  await admin("/auth/register", { method: "POST", body: { name: "Boss", email: "boss@zieads.com", password: "password1" } });
  assert.equal((await c("/api/admin/overview")).status, 403);
  const ov = await admin("/api/admin/overview");
  assert.equal(ov.status, 200);
  assert.ok(ov.body.content.pendingInvoices >= 1);
  const ap = await admin(`/api/admin/invoices/${inv.body.content.id}/approve`, { method: "POST" });
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
  assert.ok(verifySignature(secret, d.init.body, d.init.headers["x-zie-signature"]));
});

test("MCP: initialize, tools/list, run_scraper", async () => {
  const k = "zie_env_ultra_key_000000";
  const rpc = (method, params) => fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
  assert.equal((await rpc("initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.name, "zieapi");
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
  assert.equal(normalizeUrl("/api/zieapi?__path=v1/a:b/c&x=1").pathname, "/v1/a:b/c");
  const sent = [];
  const kv = new UpstashKV({ url: "https://kv.test", token: "t", fetchImpl: async (u, init) => { sent.push({ u, body: JSON.parse(init.body) }); return Response.json(u.endsWith("/pipeline") ? [{ result: 5 }, { result: 1 }] : { result: "v" }); } });
  assert.equal(await kv.get("k"), "v");
  assert.equal(await kv.incrby("c", 2, 60), 5);
  assert.deepEqual(sent[0].body, ["GET", "k"]);
  assert.deepEqual(sent[1].body, [["INCRBY", "c", "2"], ["EXPIRE", "c", "60", "NX"]]);
});
