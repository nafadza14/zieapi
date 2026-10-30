// Regression tests for the MCP end-to-end QA pass (October 2026). Each test reproduces a defect that was found
// through the real /mcp endpoint and fixed: catalog paging, endpoint discovery, schema accuracy, upstream error
// classification, oversized results and Streamable HTTP protocol details.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";

let mode = "ok";
const upstream = [];
let app, base, key, owner;
before(async () => {
  app = createApp({
    quiet: true,
    logger: null,
    kv: new MemoryKV(),
    env: {},
    apiUrl: "http://api.test",
    publicUrl: "http://zie.test",
    supabaseAuth: null,
    lookup: async (host) => {
      if (mode === "dns") throw Object.assign(new Error("ENOTFOUND " + host), { code: "ENOTFOUND" });
      return [{ address: "93.184.215.14", family: 4 }];
    },
    fetch: async (u) => {
      upstream.push(String(u));
      if (mode === "500") return new Response("down", { status: 500 });
      if (mode === "404") return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      if (mode === "big") return Response.json({ items: Array.from({ length: 4000 }, (_, i) => ({ i, pad: "x".repeat(120) })), versions: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`1.0.${i}`, { files: ["a".repeat(40)] }])) });
      return Response.json({ ok: true });
    },
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  let u = await app.repo.createUser({ email: "qa@example.test", name: "qa" });
  u = await app.repo.updateUser(u.id, { plan: "max", planExpiresAt: new Date(Date.now() + 864e5).toISOString() });
  owner = u.id;
  key = (await app.repo.createKey(u.id, { name: "qa", access: "read_write" })).secret;
});
after(() => new Promise((r) => app.server.close(r)));

let id = 0;
const post = (body, headers = {}) => fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-api-key": key, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const call = async (name, args = {}) => {
  const j = await (await post({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } })).json();
  return { isError: j.result.isError, body: j.result.structuredContent ?? JSON.parse(j.result.content[0].text), text: j.result.content[0].text };
};
const used = async () => (await call("get_usage")).body.month.used;
const freshParams = () => ({ ttl: 0 });

test("search_scrapers pages through the whole catalog with cursor (was stuck on page 1: 50.3% discoverable)", async () => {
  const keys = [];
  let cursor;
  do {
    const { body } = await call("search_scrapers", { limit: 50, ...(cursor ? { cursor } : {}) });
    keys.push(...body.items.map((i) => i.key));
    cursor = body.nextCursor;
  } while (cursor);
  assert.equal(keys.length, app.catalog.scrapers.length);
  assert.equal(new Set(keys).size, keys.length, "no duplicates across pages");
  const live = await call("search_scrapers", { status: "live", limit: 1 });
  assert.equal(live.body.total, app.catalog.scrapers.filter((s) => s.status === "live").length);
  assert.ok(!("iconUrl" in live.body.items[0]), "items are slim for agents");
});

test("get_scraper_schema without endpoint lists every operation of an API, paged (was impossible)", async () => {
  const sc = app.catalog.scrapers.filter((s) => s.lazy).sort((a, b) => b._count - a._count)[0];
  const slugs = [];
  let cursor;
  do {
    const { body, isError } = await call("get_scraper_schema", { scraper: sc.key, limit: 120, ...(cursor ? { cursor } : {}) });
    assert.equal(isError, false);
    assert.equal(body.scraper, sc.key);
    slugs.push(...body.endpoints.map((e) => e.slug));
    cursor = body.nextCursor;
  } while (cursor);
  assert.deepEqual(slugs, sc.endpoints.map((e) => e.slug));
  const bad = await call("get_scraper_schema", { scraper: "nope:nothing" });
  assert.equal(bad.isError, true);
  assert.match(bad.body.message, /search_scrapers/);
});

test("schema reports the real parameter location and upstream method of directory operations", async () => {
  let found = null;
  for (const s of app.catalog.scrapers) {
    if (!s.lazy) continue;
    const e = s.endpoints.find((x) => x.upstreamMethod === "DELETE" && x.fields.some((f) => f.src === "path") && x.fields.some((f) => f.src === "query"));
    if (e) { found = [s.key, e]; break; }
  }
  assert.ok(found, "fixture: a DELETE operation with path and query params");
  const { body } = await call("get_scraper_schema", { scraper: found[0], endpoint: found[1].slug });
  assert.equal(body.upstreamMethod, "DELETE");
  for (const f of found[1].fields) assert.equal(body.fields.find((x) => x.name === f.name).in, f.src, f.name);
  const list = await call("get_scraper_schema", { scraper: found[0], limit: 200 });
  assert.equal(list.body.endpoints.find((e) => e.slug === found[1].slug).upstreamMethod, "DELETE");
});

test("undeclared {path} placeholders become required path fields (259 operations were uncallable)", async () => {
  const sc = app.catalog.find("ecommerce:codat-sync-for-commerce");
  const ep = sc.endpoints.find((e) => e.slug === "get-configuration");
  const f = ep.fields.find((x) => x.name === "companyId");
  assert.ok(f && f.required && f.src === "path");
});

test("Google and Amadeus APIs are listed as needing the caller's key, not keyless", () => {
  const google = app.catalog.scrapers.filter((s) => /googleapis\.com/.test(s.provider ?? ""));
  const amadeus = app.catalog.scrapers.filter((s) => /amadeus\.com/.test(s.provider ?? ""));
  assert.ok(google.length > 0 && amadeus.length > 0);
  assert.ok([...google, ...amadeus].every((s) => s.status === "byok"));
});

test("upstream DNS failure, 5xx and handler crashes are 502 upstream_unavailable and not billed", async () => {
  const dirOp = (() => { for (const s of app.catalog.scrapers) if (s.lazy && s.status === "live") { const e = s.endpoints.find((x) => x.upstreamMethod === "GET" && !x.fields.some((f) => f.required)); if (e) return [s.key, e.slug]; } })();
  for (const m of ["dns", "500"]) {
    mode = m;
    const u0 = await used();
    const r = await call("run_scraper", { scraper: dirOp[0], endpoint: dirOp[1], params: freshParams() });
    assert.equal(r.isError, true, m);
    assert.equal(r.body.status, 502, m);
    assert.equal(r.body.code, "upstream_unavailable", m);
    assert.equal(await used(), u0, `${m} not billed`);
  }
  mode = "500";
  const native = await call("run_scraper", { scraper: "search-tools:npm", endpoint: "package", params: { name: "express", ...freshParams() } });
  assert.equal(native.body.status, 502, "native handler: upstream 5xx is 502 (was a billed 400)");
  mode = "ok"; // {"ok":true} is not the shape the Binance handler expects -> it throws a TypeError
  const crash = await call("run_scraper", { scraper: "finance:binance", endpoint: "tickers", params: freshParams() });
  assert.equal(crash.body.status, 502, "handler crash on unexpected upstream data is 502 (was 500 Internal error)");
  mode = "404";
  const nf = await call("run_scraper", { scraper: "search-tools:npm", endpoint: "package", params: { name: "no-such-pkg", ...freshParams() } });
  assert.equal(nf.body.code, "upstream_error", "provider 4xx is labelled upstream_error, not invalid_params");
  mode = "ok";
});

test("oversized tool results are shortened to valid JSON with a truncation note (was cut mid-JSON)", async () => {
  mode = "big";
  const dirOp = (() => { for (const s of app.catalog.scrapers) if (s.lazy && s.status === "live") { const e = s.endpoints.find((x) => x.upstreamMethod === "GET" && !x.fields.some((f) => f.required)); if (e) return [s.key, e.slug]; } })();
  const r = await call("run_scraper", { scraper: dirOp[0], endpoint: dirOp[1], params: freshParams() });
  mode = "ok";
  assert.equal(r.isError, false);
  assert.ok(r.text.length <= 120_000);
  const j = JSON.parse(r.text);
  assert.ok(j._truncated?.originalChars > 120_000);
  assert.ok(j.data.items.length > 0 && j.data.items.length < 4000);
  assert.ok(Object.keys(j.data.versions).length < 3000, "large maps are shortened too");
});

test("Streamable HTTP details: unsupported MCP-Protocol-Version -> 400, bad JSON -> -32700, big body -> 413", async () => {
  let r = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-protocol-version": "1999-01-01" });
  assert.equal(r.status, 400);
  r = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" });
  assert.equal(r.status, 200);
  r = await post("{oops");
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, -32700);
  r = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_scraper", arguments: { scraper: "x:y", endpoint: "z", params: { blob: "x".repeat(1_200_000) } } } });
  assert.equal(r.status, 413, "client gets a 413 response instead of a reset connection");
});

test("every call is attributed to its own key in the logs", async () => {
  const logs = await app.repo.getLogs(owner, { limit: 100 });
  assert.ok(logs.length > 0 && logs.every((l) => l.source === "mcp"));
});

test("a provider host the SSRF guard refuses (non-standard port) is a 502, never called and not billed", async () => {
  const u0 = await used();
  const n = upstream.length;
  const r = await call("run_scraper", { scraper: "cloud:climatekuul", endpoint: "airtravel-coordinates", params: freshParams() });
  assert.equal(r.body.status, 502);
  assert.match(r.body.message, /Port not allowed/);
  assert.equal(upstream.length, n, "guard stops the request before any upstream call");
  assert.equal(await used(), u0);
});
