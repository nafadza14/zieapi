// Phase 5: a scripted agent that only uses MCP tools (no source-specific client code) against the real upstreams.
// Decisions are made from catalog metadata returned by the tools, and every reported value comes from tool output.
import { boot, connect, parse } from "./lib.mjs";

const env = await boot({ fetchMode: "real" });
const { key } = await env.mkUser("agent@example.test");
const c = await connect(env.base, key);
const tool = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { ok: !r.isError, body: parse(r) }; };
const trace = [];
const log = (step, detail) => trace.push({ step, ...detail });

// ---------------- Scenario A: 50 dental clinics in Jakarta ----------------
const A = { request: "50 dental clinics in Jakarta with name, address, rating, review count, website, phone; dedupe; sort by rating" };
const queries = ["dentist", "dental", "clinic", "places", "maps", "openstreetmap", "geocoding", "reviews"];
const candidates = new Map();
for (const q of queries) {
  let cursor; do {
    const { body } = await tool("search_scrapers", { query: q, limit: 50, ...(cursor ? { cursor } : {}) });
    body.items.forEach((i) => candidates.set(i.key, i)); cursor = body.nextCursor;
  } while (cursor);
}
log("discover", { queries, candidatesFound: candidates.size });
// keep sources whose metadata says they search places/businesses
const relevant = [...candidates.values()].filter((i) => /place|map|geocod|openstreetmap|business listing|review/i.test(`${i.displayName} ${i.description} ${(i.tags ?? []).join(" ")}`) && i.category === "places" || /google-maps|nominatim/.test(i.key));
log("filter", { relevant: relevant.map((i) => `${i.key} [${i.status}]`) });
const inspected = [];
for (const i of relevant) {
  const { body } = await tool("get_scraper_schema", { scraper: i.key });
  for (const e of body.endpoints ?? []) if (/search|place|review|nearby|lookup/i.test(`${e.slug} ${e.displayName}`)) inspected.push({ scraper: i.key, status: e.status, endpoint: e.slug, method: e.method, sourceStatus: i.status });
}
log("inspect", { endpointsConsidered: inspected.length, sample: inspected.slice(0, 10) });
const callable = inspected.filter((x) => x.status === "live");
const reviewsSource = inspected.find((x) => /review/i.test(x.scraper + x.endpoint));
log("capability", { callableSearchEndpoints: callable.map((x) => `${x.scraper}/${x.endpoint}`), ratingsSource: reviewsSource ? `${reviewsSource.scraper}/${reviewsSource.endpoint} is ${reviewsSource.status}` : "none in catalog" });
// prefer an OSM place search: read its schema and only send documented params
const pick = callable.find((x) => x.scraper === "places:nominatim" && /search/.test(x.endpoint)) ?? callable[0];
const records = [];
let execution = null;
if (pick) {
  const { body: sch } = await tool("get_scraper_schema", { scraper: pick.scraper, endpoint: pick.endpoint });
  const names = sch.fields.map((f) => f.name);
  const params = {};
  const qf = sch.fields.find((f) => /^(q|query)$/.test(f.name)) ?? sch.fields.find((f) => f.required && f.type === "string");
  if (qf) params[qf.name] = "dentist Jakarta";
  const lf = sch.fields.find((f) => /^(limit|count|max)$/.test(f.name));
  if (lf) params[lf.name] = Math.min(50, lf.max ?? 50);
  log("schema", { endpoint: `${pick.scraper}/${pick.endpoint}`, fields: names, params });
  const r = await tool("run_scraper", { scraper: pick.scraper, endpoint: pick.endpoint, params });
  execution = r.ok ? { ok: true } : { ok: false, status: r.body.status, code: r.body.code, message: r.body.message };
  log("execute", execution);
  if (r.ok) for (const p of [].concat(r.body.data?.results ?? r.body.data ?? [])) records.push({ name: p.name ?? p.display_name ?? null, address: p.address ?? p.display_name ?? null, rating: null, reviewCount: null, website: p.extratags?.website ?? null, phone: p.extratags?.phone ?? null, id: p.osm_id ?? p.place_id });
}
const seen = new Set();
const unique = records.filter((r) => { const k = r.id ?? `${(r.name ?? "").toLowerCase()}|${(r.address ?? "").toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
A.result = {
  status: unique.length >= 50 ? "COMPLETE" : execution?.ok ? "PARTIAL" : "BLOCKED",
  collected: unique.length, duplicatesRemoved: records.length - unique.length,
  missingFields: { rating: unique.length, reviewCount: unique.length },
  reasons: [
    reviewsSource ? `Ratings and review counts need ${reviewsSource.scraper}, which the catalog marks '${reviewsSource.status}' (not callable).` : "No catalog source returns ratings or review counts.",
    execution && !execution.ok ? `Place search ${pick.scraper}/${pick.endpoint} failed: ${execution.status} ${execution.message}` : null,
  ].filter(Boolean),
  fabricated: false,
};

// ---------------- Scenario B: two sources, concurrent, real upstream ----------------
const B = {};
const t0 = performance.now();
const [npm, pypi, crates] = await Promise.all([
  tool("run_scraper", { scraper: "search-tools:npm", endpoint: "package", params: { name: "zod" } }),
  tool("run_scraper", { scraper: "dev-tools:pypi", endpoint: "package", params: { name: "pydantic" } }),
  tool("run_scraper", { scraper: "dev-tools:crates-io", endpoint: "crate", params: { name: "serde" } }),
]);
B.concurrentMs = Math.round(performance.now() - t0);
B.results = [["npm zod", npm], ["pypi pydantic", pypi], ["crates serde", crates]].map(([n, r]) => ({ n, ok: r.ok, version: r.ok ? (r.body.data?.version ?? r.body.data?.info?.version ?? r.body.data?.crate?.max_version ?? r.body.data?.crate?.newest_version) : r.body.message }));

// ---------------- Scenario C: next page without repeats ----------------
const { body: npmSchema } = await tool("get_scraper_schema", { scraper: "search-tools:npm", endpoint: "search" });
const pageField = npmSchema.fields.find((f) => /^(page|offset|from|cursor)$/.test(f.name));
const sizeField = npmSchema.fields.find((f) => /^(limit|size|per_page)$/.test(f.name));
const qField = npmSchema.fields.find((f) => /^(q|query|text)$/.test(f.name));
const p1 = await tool("run_scraper", { scraper: "search-tools:npm", endpoint: "search", params: { [qField.name]: "mcp server", ...(sizeField ? { [sizeField.name]: 10 } : {}), ...(pageField ? { [pageField.name]: pageField.name === "page" ? 1 : 0 } : {}) } });
const p2 = await tool("run_scraper", { scraper: "search-tools:npm", endpoint: "search", params: { [qField.name]: "mcp server", ...(sizeField ? { [sizeField.name]: 10 } : {}), ...(pageField ? { [pageField.name]: pageField.name === "page" ? 2 : 10 } : {}) } });
const n1 = (p1.body.data?.results ?? []).map((x) => x.name), n2 = (p2.body.data?.results ?? []).map((x) => x.name);
const C = { fields: npmSchema.fields.map((f) => f.name), p1err: p1.ok ? null : p1.body.message, pagingField: pageField?.name ?? null, page1: n1.length, page2: n2.length, overlap: n1.filter((x) => n2.includes(x)).length, ok: p1.ok && p2.ok && n1.length > 0 && n2.length > 0 && n1.filter((x) => n2.includes(x)).length === 0 };

// ---------------- Scenario D: explain a missing capability ----------------
const { body: none } = await tool("search_scrapers", { query: "dental appointment booking" });
const D = { query: "dental appointment booking", total: none.total, explanation: none.total === 0 ? "No catalog source matches; the agent reports the gap instead of guessing." : "unexpected match" };

await c.close(); await env.close();
console.log(JSON.stringify({ scenarioA: A, trace, scenarioB: B, scenarioC: C, scenarioD: D }, null, 1));
process.exit(0);
