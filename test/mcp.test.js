import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./helpers.js";

let t;
before(async () => (t = await boot()));
after(() => t.close());

const rpc = (method, params, { key = t.keys.free, id = 1, headers = {} } = {}) =>
  t.call("/mcp", { method: "POST", headers: { accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers }, body: { jsonrpc: "2.0", id, method, params } });

test("auth required", async () => {
  const r = await rpc("initialize", {}, { key: null });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, -32001);
});

test("initialize + tools/list exposes the 8 tools", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.equal(init.body.result.serverInfo.name, "zieapi");
  const note = await t.call("/mcp", { method: "POST", headers: { "x-api-key": t.keys.free }, body: { jsonrpc: "2.0", method: "notifications/initialized" } });
  assert.equal(note.status, 202);
  const list = await rpc("tools/list", {});
  assert.deepEqual(
    list.body.result.tools.map((x) => x.name).sort(),
    ["bulk_status", "bulk_submit", "get_account", "get_scraper_schema", "get_usage", "list_categories", "run_scraper", "search_scrapers"]
  );
});

test("search → schema → run", async () => {
  const s = await rpc("tools/call", { name: "search_scrapers", arguments: { query: "terbilang" } });
  assert.equal(s.body.result.structuredContent.items[0].slug, "terbilang");
  const sch = await rpc("tools/call", { name: "get_scraper_schema", arguments: { scraper: "indonesia:terbilang", endpoint: "convert" } });
  assert.equal(sch.body.result.structuredContent.method, "GET");
  const run = await rpc("tools/call", { name: "run_scraper", arguments: { scraper: "indonesia:terbilang", endpoint: "convert", params: { number: 2026 } } });
  assert.equal(run.body.result.isError, false);
  assert.equal(run.body.result.structuredContent.data.text, "dua ribu dua puluh enam");
});

test("tool errors reuse REST codes", async () => {
  const gate = await rpc("tools/call", { name: "run_scraper", arguments: { scraper: "web-tools:page", endpoint: "meta", params: { url: "https://example.com" } } });
  assert.equal(gate.body.result.isError, true);
  assert.equal(gate.body.result.structuredContent.status, 403);
  assert.equal(gate.body.result.structuredContent.code, "plan_upgrade_required");
  const bulk = await rpc("tools/call", { name: "bulk_submit", arguments: { scraper: "dev-tools:hash", endpoint: "digest", items: [{ text: "a" }] } });
  assert.equal(bulk.body.result.structuredContent.status, 403);
  const unknown = await rpc("tools/call", { name: "nope", arguments: {} });
  assert.equal(unknown.body.error.code, -32602);
  const nomethod = await rpc("foo/bar", {});
  assert.equal(nomethod.body.error.code, -32601);
});

test("account, usage, categories, bulk via MCP", async () => {
  const acct = await rpc("tools/call", { name: "get_account", arguments: {} }, { key: t.keys.ultra });
  assert.equal(acct.body.result.structuredContent.plan.id, "ultra");
  const use = await rpc("tools/call", { name: "get_usage", arguments: {} }, { key: t.keys.ultra });
  assert.ok("month" in use.body.result.structuredContent);
  const cats = await rpc("tools/call", { name: "list_categories", arguments: {} });
  assert.ok(cats.body.result.structuredContent.categories.length > 0);

  const sub = await rpc("tools/call", { name: "bulk_submit", arguments: { scraper: "dev-tools:hash", endpoint: "digest", items: [{ text: "a" }, { text: "b" }] } }, { key: t.keys.ultra });
  const jobId = sub.body.result.structuredContent.jobId;
  await new Promise((r) => setTimeout(r, 50));
  const st = await rpc("tools/call", { name: "bulk_status", arguments: { job_id: jobId } }, { key: t.keys.ultra });
  assert.equal(st.body.result.structuredContent.status, "COMPLETED");
  assert.equal(st.body.result.structuredContent.succeeded, 2);
});

test("GET /mcp is 405 (stateless server)", async () => {
  const r = await t.call("/mcp", { headers: { "x-api-key": t.keys.free } });
  assert.equal(r.status, 405);
});
