// Storage round trips on the hot path. On Vercel each one is an HTTPS call to the database, so these counts are
// what decides how fast an API or MCP call feels. Guards the October 2026 latency work.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";

let app, base, key, user, trips = 0, deferred = [];
const mem = new MemoryKV();
const kv = new Proxy(mem, {
  get(t, p) {
    const v = t[p];
    if (typeof v !== "function" || p === "constructor" || String(p).startsWith("_")) return v;
    return (...a) => {
      // The bookkeeping batch (it always starts with the global request counter) runs after the response.
      const bookkeeping = p === "batch" && a[0]?.[0]?.[1] === "g:requests";
      if (!bookkeeping) trips++;
      return v.apply(t, a);
    };
  },
});
before(async () => {
  app = createApp({
    quiet: true, logger: null, kv, env: {}, apiUrl: "http://api.test", publicUrl: "http://zie.test", supabaseAuth: null,
    background: (p) => { deferred.push(p); }, // like Vercel waitUntil: finishes after the response
    fetch: async () => Response.json({ query: { searchinfo: { totalhits: 1 }, search: [{ title: "Eiffel Tower", pageid: 1, snippet: "x" }] } }),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  user = await app.repo.createUser({ email: "perf@example.test", name: "perf" });
  key = (await app.repo.createKey(user.id, { name: "perf" })).secret;
});
after(() => new Promise((r) => app.server.close(r)));

const H = () => ({ "x-api-key": key, "content-type": "application/json" });
const settle = async () => { await Promise.all(deferred.splice(0)); await new Promise((r) => setTimeout(r, 20)); };
async function count(fn) { await settle(); trips = 0; const res = await fn(); const n = trips; await settle(); return { n, res }; }
const mcp = (body) => fetch(`${base}/mcp`, { method: "POST", headers: H(), body: JSON.stringify(body) }).then((r) => r.json());
const run = (q) => fetch(`${base}/v1/search-tools:wikipedia/search?query=${q}`, { headers: H() });

test("warm API call: one round trip for quota + cache read, bookkeeping after the response", async () => {
  await run("warmup");
  await run("warmup2"); // first calls fill the key/user cache and record lastUsedAt
  const miss = await count(() => run("Paris"));
  assert.equal(miss.res.status, 200);
  assert.ok(miss.n <= 2, `cache miss used ${miss.n} round trips on the critical path`); // cache read and quota run in parallel
  const hit = await count(() => run("Paris"));
  assert.equal(hit.res.headers.get("x-cache"), "HIT");
  assert.ok(hit.n <= 1, `cache hit used ${hit.n} round trips`);
});

test("MCP discovery tools need no storage round trip once the key is cached", async () => {
  await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  for (const body of [
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_scrapers", arguments: { query: "weather" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_scraper_schema", arguments: { scraper: "search-tools:wikipedia" } } },
  ]) {
    const { n, res } = await count(() => mcp(body));
    assert.ok(!res.error && !res.result?.isError, JSON.stringify(res).slice(0, 120));
    assert.equal(n, 0, `${body.method} ${body.params?.name ?? ""} used ${n} round trips`);
  }
});

test("bookkeeping still lands: usage, logs and cache are written", async () => {
  await settle();
  const logs = await app.repo.getLogs(user.id, { limit: 50 });
  assert.ok(logs.some((l) => l.endpoint === "search" && l.cache === "HIT"));
  assert.ok([...mem.data.keys()].some((k) => k.startsWith("cache:search-tools:wikipedia/search")), "cache entry written through the bookkeeping batch");
  assert.ok((await app.repo.getMonth(user.id)) >= 3, "usage counted");
});

test("revoking a key or disabling a source takes effect at once on this instance", async () => {
  const { secret, rec } = await app.repo.createKey(user.id, { name: "tmp" });
  assert.equal((await fetch(`${base}/v1/search-tools:wikipedia/search?query=x`, { headers: { "x-api-key": secret } })).status, 200);
  await app.repo.updateKey(rec.id, { status: "revoked" });
  assert.equal((await fetch(`${base}/v1/search-tools:wikipedia/search?query=x`, { headers: { "x-api-key": secret } })).status, 401);
  await app.repo.setScraperEnabled("search-tools:wikipedia", false);
  assert.equal((await run("y")).status, 503);
  await app.repo.setScraperEnabled("search-tools:wikipedia", true);
  assert.equal((await run("y")).status, 200);
});

test("monthly quota refusal does not leave the minute counter incremented", async () => {
  const u = await app.repo.createUser({ email: "quota@example.test", name: "q" });
  const k = (await app.repo.createKey(u.id, { name: "q" })).secret;
  await app.repo.incrMonth(u.id, 1000);
  const r = await fetch(`${base}/v1/search-tools:wikipedia/search?query=z`, { headers: { "x-api-key": k } });
  assert.equal(r.status, 429);
  assert.equal(await app.repo.getMinute(u.id, Math.floor(Date.now() / 60000)), 0);
});
