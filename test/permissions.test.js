// Key permissions (Option A): new keys read-only, existing keys keep full access, per-key category limits,
// refused calls are never billed, and MCP connections carry what the user allowed on the consent screen.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";
import { accessOf } from "../src/core/catalog.js";

const upstream = [];
const deliveries = [];
const app = createApp({
  quiet: true, logger: null, kv: new MemoryKV(), env: {}, supabaseAuth: null, apiUrl: "http://api.test", publicUrl: "http://p.test",
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  fetch: async (u, init) => (upstream.push({ url: String(u), method: init?.method }), Response.json(String(u).includes("worldbank") ? [{ total: 1 }, [{ date: "2024", value: 1, indicator: { id: "X" }, country: { value: "US" } }]] : { ok: true })),
  webhookFetch: async (url, init) => (deliveries.push(JSON.parse(init.body)), new Response("ok")),
});
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
after(() => new Promise((r) => app.server.close(r)));
const base = `http://127.0.0.1:${app.server.address().port}`;
const user = await app.repo.createUser({ email: "perm@example.test", name: "P" });
await app.repo.updateUser(user.id, { plan: "pro", planExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), financePlan: "fin_starter", financeExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString() });
const cookie = `apz_session=${(await app.repo.createSession(user.id)).token}`;
const me = (path, body, method) => fetch(base + path, { method: method ?? (body ? "POST" : "GET"), headers: { cookie, "content-type": "application/json", "x-zie-csrf": "1" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
const WRITE = "/v1/security:6-dot-authentiqio-appspot/key-register";
const READ = "/v1/finance:worldbank/indicator?country=US";
const callWith = (key, path, method = "POST") => fetch(base + path, { method: path.includes("worldbank") ? "GET" : method, headers: { "x-api-key": key, "content-type": "application/json" }, body: path.includes("worldbank") ? undefined : "{}" });
const used = async () => (await me("/api/me/usage")).json.content?.month?.used ?? (await app.limiter.snapshot(user.id, "pro")).month.used;

test("read or write is decided by the provider's method, with read-named POSTs kept as reads", () => {
  assert.equal(accessOf(undefined), "read", "Apizie's own sources only read");
  assert.equal(accessOf("GET"), "read");
  assert.equal(accessOf("POST", { slug: "describe-instances" }), "read");
  assert.equal(accessOf("POST", { slug: "create-bucket" }), "write");
  assert.equal(accessOf("DELETE", { slug: "list-old" }), "write", "DELETE always writes");
  const ep = app.catalog.resolve("security:6-dot-authentiqio-appspot", "key-register").endpoint;
  assert.equal(ep.access, "write");
});

test("a new key is read-only: write endpoints are refused before quota, logged, and announced", async () => {
  await app.repo.setWebhooks(user.id, [{ id: "h", url: "https://hooks.example.test/a", events: ["key.blocked"], enabled: true, secret: "s", createdAt: new Date().toISOString() }]);
  const k = (await me("/api/me/keys", { name: "agent" })).json.content;
  assert.equal(k.record.access, "read");
  assert.equal(k.record.legacyAccess, false);
  assert.equal((await callWith(k.key, READ)).status, 200, "reads work");
  const before = await used();
  const n = upstream.length;
  const r = await callWith(k.key, WRITE);
  const body = await r.json();
  assert.equal(r.status, 403);
  assert.equal(body.error.code, "key_read_only");
  assert.equal(upstream.length, n, "the provider is never called");
  assert.equal(await used(), before, "refused calls are not billed");
  await app.webhooks.drain();
  assert.ok(deliveries.some((d) => d.event === "key.blocked" && d.data.reason === "key_read_only"));
  const logs = (await me("/api/me/logs?range=24h")).json.content;
  const rows = logs.items ?? logs.rows ?? logs.logs ?? [];
  assert.ok(rows.some((l) => l.code === "key_read_only" && l.access === "write"));

  // the owner allows writes for this key on purpose
  assert.equal((await me(`/api/me/keys/${k.record.id}`, { access: "read_write" }, "PATCH")).json.content.access, "read_write");
  await new Promise((r) => setTimeout(r, 20));
  app.repo._unhot?.(`key:${(await app.repo.getKeyById(k.record.id)).hash}`);
  const ok = await callWith(k.key, WRITE);
  assert.notEqual(ok.status, 403);
  const list = (await me("/api/me/keys")).json.content.items;
  assert.ok(list.find((x) => x.id === k.record.id).lastWriteAt, "the dashboard knows this key writes");
});

test("keys made before permissions keep full access and are flagged so the dashboard can suggest read-only", async () => {
  const { rec } = await app.repo.createKey(user.id, { name: "old" });
  await app.repo.updateKey(rec.id, { access: undefined });
  const item = (await me("/api/me/keys")).json.content.items.find((x) => x.id === rec.id);
  assert.equal(item.access, "read_write");
  assert.equal(item.legacyAccess, true);
  assert.equal(item.lastWriteAt, null);
  assert.equal((await me(`/api/me/keys/${rec.id}`, { access: "admin" }, "PATCH")).status, 400);
});

test("a key limited to categories cannot reach others", async () => {
  const k = (await me("/api/me/keys", { name: "official-only", categories: ["official"] })).json.content;
  assert.deepEqual(k.record.categories, ["official"]);
  const r = await callWith(k.key, READ);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error.code, "key_scope");
  assert.equal((await me("/api/me/keys", { name: "bad", categories: ["nope"] })).status, 400);
  // MCP search only shows what the key may use
  const mcp = await fetch(`${base}/mcp`, { method: "POST", headers: { "x-api-key": k.key, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_scrapers", arguments: { limit: 50 } } }) });
  const out = (await mcp.json()).result.structuredContent;
  assert.ok(out.items.length > 0);
  assert.ok(out.items.every((i) => i.key.startsWith("official:")));
});
