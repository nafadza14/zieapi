// CAT-001..006: enumerate the full catalog, every source's operations and every operation's schema through MCP only,
// then compare with the canonical in-process catalog. Also MCP-001/002 protocol checks and latency samples.
import { writeFileSync } from "node:fs";
import { boot, connect, parse, pct } from "./lib.mjs";

const env = await boot();
const { key } = await env.mkUser("qa-disc@example.test");
const R = { protocol: {}, discovery: {}, schemas: {}, latencyMs: {} };
const t = async (fn) => { const a = performance.now(); const v = await fn(); return [v, performance.now() - a]; };
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); };

try {
  // ---- MCP-001 / MCP-002 via the official SDK client ----
  const inits = [];
  for (let i = 0; i < 20; i++) { const [c, ms] = await t(() => connect(env.base, key)); inits.push(ms); await c.close(); }
  R.latencyMs.initialize = { n: 20, p50: pct(inits, 50), p95: pct(inits, 95) };
  const c = await connect(env.base, key);
  R.protocol.serverInfo = c.getServerVersion();
  R.protocol.capabilities = c.getServerCapabilities();
  const tools = (await c.listTools()).tools;
  R.protocol.tools = tools.map((x) => x.name);
  const { default: Ajv } = await import("ajv");
  const ajv = new Ajv({ strict: false });
  R.protocol.toolSchemasCompile = tools.every((x) => x.inputSchema?.type === "object" && ajv.compile(x.inputSchema) && typeof x.description === "string" && /^[a-z_]+$/.test(x.name));
  await c.ping();
  R.protocol.ping = "ok";

  // ---- CAT-001/002/004/005: full source discovery with cursor ----
  const canon = env.app.catalog.scrapers;
  const canonKeys = new Set(canon.map((s) => s.key));
  const seen = [];
  let cursor, pages = 0;
  const [, discMs] = await t(async () => {
    do {
      const r = parse(await c.callTool({ name: "search_scrapers", arguments: { limit: 50, ...(cursor ? { cursor } : {}) } }));
      r.items.forEach((i) => seen.push(i));
      cursor = r.nextCursor;
      pages++;
      if (pages > 200) throw new Error("runaway pagination");
    } while (cursor);
  });
  const seenKeys = new Set(seen.map((i) => i.key));
  R.discovery.sources = { expected: canonKeys.size, discovered: seenKeys.size, duplicates: seen.length - seenKeys.size, missing: [...canonKeys].filter((k) => !seenKeys.has(k)).slice(0, 10), unexpected: [...seenKeys].filter((k) => !canonKeys.has(k)).slice(0, 10), pages };
  R.latencyMs.fullSourceDiscovery = +discMs.toFixed(0);
  const byStatus = {};
  for (const i of seen) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
  R.discovery.byStatus = byStatus;
  // status filter consistency
  const liveTotal = parse(await c.callTool({ name: "search_scrapers", arguments: { status: "live", limit: 1 } })).total;
  R.discovery.statusFilterLiveMatches = liveTotal === byStatus.live;
  // query-scoped paging (no duplicates, total respected)
  const q = []; cursor = undefined;
  do { const r = parse(await c.callTool({ name: "search_scrapers", arguments: { query: "api", limit: 50, ...(cursor ? { cursor } : {}) } })); q.push(...r.items.map((i) => i.key)); cursor = r.nextCursor; R.discovery.queryTotal = r.total; } while (cursor);
  R.discovery.queryPagingConsistent = q.length === R.discovery.queryTotal && new Set(q).size === q.length;

  // ---- operations per source ----
  let opExpected = 0, opDiscovered = 0, opMismatch = [];
  const ops = [];
  const listLat = [];
  await pool([...canonKeys], 8, async (k) => {
    const sc = env.app.catalog.find(k);
    const expected = sc.endpoints.map((e) => e.slug);
    opExpected += expected.length;
    const got = [];
    let cur;
    do {
      const [res, ms] = await t(() => c.callTool({ name: "get_scraper_schema", arguments: { scraper: k, limit: 200, ...(cur ? { cursor: cur } : {}) } }));
      listLat.push(ms);
      const r = parse(res);
      if (res.isError || r.scraper !== k) { opMismatch.push({ k, err: res.content[0].text.slice(0, 120) }); return; }
      got.push(...r.endpoints.map((e) => e.slug));
      cur = r.nextCursor;
    } while (cur);
    opDiscovered += new Set(got).size;
    const same = got.length === expected.length && expected.every((s, i) => s === got[i]);
    if (!same) opMismatch.push({ k, expected: expected.length, got: got.length });
    for (const slug of got) ops.push([k, slug]);
  });
  R.discovery.operations = { expected: opExpected, discovered: opDiscovered, mismatchedSources: opMismatch.length, sample: opMismatch.slice(0, 5) };
  R.latencyMs.endpointListing = { n: listLat.length, p50: pct(listLat, 50), p95: pct(listLat, 95), p99: pct(listLat, 99) };

  // ---- CAT-003: every operation's schema ----
  const TYPES = new Set(["string", "integer", "number", "boolean", "array", "object"]);
  let ok = 0, bad = [], idMismatch = 0;
  const schLat = [];
  const [, schAll] = await t(() => pool(ops, 16, async ([k, slug]) => {
    const [res, ms] = await t(() => c.callTool({ name: "get_scraper_schema", arguments: { scraper: k, endpoint: slug } }));
    schLat.push(ms);
    if (res.isError) { bad.push({ k, slug, why: "error " + res.content[0].text.slice(0, 80) }); return; }
    const r = parse(res);
    if (r.scraper !== k || r.endpoint !== slug) { idMismatch++; return; }
    const probs = [];
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(r.method)) probs.push("method");
    if (!Array.isArray(r.fields)) probs.push("fields");
    if (!["live", "planned", "upstream", "byok"].includes(r.status)) probs.push("status " + r.status);
    for (const f of r.fields ?? []) {
      if (!f.name) probs.push("field name");
      if (!TYPES.has(f.type)) probs.push(`type ${f.name}:${f.type}`);
      if (!["path", "query", "body", "header"].includes(f.in)) probs.push(`in ${f.name}:${f.in}`);
      if (f.enum && !Array.isArray(f.enum)) probs.push(`enum ${f.name}`);
    }
    const sc = env.app.catalog.find(k);
    if (sc.auth && !r.auth) probs.push("auth missing");
    const pathNames = (r.path.match(/\{([^}]+)\}/g) ?? []).map((x) => x.slice(1, -1));
    for (const pn of pathNames) if (!r.fields.some((f) => f.name === pn)) probs.push("path param undocumented " + pn);
    if (probs.length) bad.push({ k, slug, probs: [...new Set(probs)].slice(0, 4) }); else ok++;
  }));
  R.schemas = { checked: ops.length, valid: ok, invalid: bad.length, identityMismatches: idMismatch, sampleInvalid: bad.slice(0, 15) };
  const kinds = {};
  for (const b of bad) for (const p of b.probs ?? [b.why]) { const kk = p.split(" ")[0]; kinds[kk] = (kinds[kk] ?? 0) + 1; }
  R.schemas.problemKinds = kinds;
  R.latencyMs.schemaRetrieval = { n: schLat.length, p50: pct(schLat, 50), p95: pct(schLat, 95), p99: pct(schLat, 99), totalSec: +(schAll / 1000).toFixed(1) };
  R.memoryMB = +(process.memoryUsage().rss / 1048576).toFixed(0);
  await c.close();
  writeFileSync(new URL("./ops.json", import.meta.url), JSON.stringify(ops));
} finally {
  await env.close();
}
console.log(JSON.stringify(R, null, 2));
