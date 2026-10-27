// Live upstream execution through MCP for every read-only operation whose upstream host this sandbox can reach.
// Pass 1 (stub) maps each live GET operation to its upstream host; pass 2 calls the real upstream.
import { writeFileSync } from "node:fs";
import { boot, connect, parse, pct, ROOT } from "./lib.mjs";
const { validateParams } = await import(`${ROOT}/src/core/validate.js`);

const REACHABLE = new Set(["registry.npmjs.org", "api.github.com", "pypi.org", "crates.io"]);
const ok1 = (f, v) => validateParams([f], { [f.name]: v }).errors.length === 0;
const sample = (f) => { for (const v of [f.example, f.default, ...(f.enum ?? [])]) if (v !== undefined && v !== "" && ok1(f, v)) return v; return { integer: 1, number: 1, boolean: true, array: ["test"], object: {} }[f.type] ?? "test"; };
const paramsFor = (ep) => { const p = {}; for (const f of ep.fields) if (f.required || f.example !== undefined) p[f.name] = sample(f); return p; };

// pass 1: host map
const s = await boot({ fetchMode: "stub" });
const { key: k1 } = await s.mkUser("live-map@x.test");
const c1 = await connect(s.base, k1);
const picks = [];
let ghDir = 0;
for (const sc of s.app.catalog.scrapers) {
  if (sc.status !== "live") continue;
  for (const ep of sc.endpoints) {
    if (ep.status !== "live" || (ep.upstreamMethod ?? ep.method) !== "GET") continue;
    if (sc.lazy && !/github|npm|pypi|crates/.test(sc.key)) continue; // directory: only candidates on reachable hosts
    const before = s.upstreamCalls.length;
    await c1.callTool({ name: "run_scraper", arguments: { scraper: sc.key, endpoint: ep.slug, params: paramsFor(ep) } });
    const hosts = s.upstreamCalls.slice(before).map((c) => new URL(c.url).host);
    if (hosts.length && hosts.every((h) => REACHABLE.has(h))) {
      if (sc.lazy && hosts[0] === "api.github.com") { if (ghDir >= 10) continue; ghDir++; } // GitHub allows 60 unauthenticated calls/hour
      picks.push([sc.key, ep.slug, hosts[0]]);
    }
  }
}
await c1.close(); await s.close();

// pass 2: real upstream
const r = await boot({ fetchMode: "real" });
const { key } = await r.mkUser("live@x.test");
const c = await connect(r.base, key);
const results = [], lat = [];
for (const [k, slug, host] of picks) {
  const ep = r.app.catalog.find(k).endpoints.find((e) => e.slug === slug);
  const a = performance.now();
  const res = await c.callTool({ name: "run_scraper", arguments: { scraper: k, endpoint: slug, params: paramsFor(ep) } });
  lat.push(performance.now() - a);
  const b = parse(res);
  const data = b?.data;
  results.push({ key: k, slug, host, ok: !res.isError, status: res.isError ? b.status : 200, nonEmpty: !res.isError && data !== null && data !== undefined && (typeof data !== "object" || Object.keys(data).length > 0), msg: res.isError ? String(b.message).slice(0, 120) : undefined, sample: !res.isError ? String(JSON.stringify(data) ?? JSON.stringify(Object.keys(b ?? {}))).slice(0, 120) : undefined });
}
// a second identical call must be served from cache (no new upstream request)
let cacheHit = null;
const first = picks.find((p) => p[2] === "registry.npmjs.org");
if (first) {
  const ep = r.app.catalog.find(first[0]).endpoints.find((e) => e.slug === first[1]);
  const before = r.upstreamCalls.length;
  await c.callTool({ name: "run_scraper", arguments: { scraper: first[0], endpoint: first[1], params: paramsFor(ep) } });
  cacheHit = r.upstreamCalls.length === before;
}
const usage = parse(await c.callTool({ name: "get_usage", arguments: {} }));
await c.close(); await r.close();
const summary = { operations: results.length, passed: results.filter((x) => x.ok && x.nonEmpty).length, failed: results.filter((x) => !x.ok).length, okButEmpty: results.filter((x) => x.ok && !x.nonEmpty).length, byHost: {}, latencyMs: { p50: pct(lat, 50), p95: pct(lat, 95), max: pct(lat, 100) }, cacheHitOnRepeat: cacheHit, usageAfter: usage, failures: results.filter((x) => !x.ok), samples: results.filter((x) => x.ok).slice(0, 6) };
for (const x of results) { const h = (summary.byHost[x.host] ??= { total: 0, ok: 0 }); h.total++; if (x.ok) h.ok++; }
writeFileSync(new URL("./live.out.json", import.meta.url), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 1));
process.exit(0);
