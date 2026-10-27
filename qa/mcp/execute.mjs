// EXEC-001/002/003/008: run every operation in the catalog through MCP run_scraper.
// Upstream is a recording stub (no real network): this verifies the gateway path (MCP -> validation -> executor ->
// adapter -> upstream request -> envelope), not live upstream data. Live upstream checks are in live.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { boot, connect, parse, pct, ROOT } from "./lib.mjs";

const env = await boot({ fetchMode: "stub" });
const cat = env.app.catalog;
const ops = JSON.parse(readFileSync(new URL("./ops.json", import.meta.url)));
const R = { live: {}, planned: {}, byok: {}, validation: {}, hostPinning: {} };

// one fresh max-plan user per 5,000 calls keeps us under the 15,000/min plan rate limit
let client, used = 0, n = 0;
async function cl() {
  if (!client || used >= 5000) {
    if (client) await client.close();
    const { key } = await env.mkUser(`qa-exec-${n++}@example.test`);
    client = await connect(env.base, key);
    used = 0;
  }
  used++;
  return client;
}
const { validateParams } = await import(`${ROOT}/src/core/validate.js`);
const ok1 = (f, v) => validateParams([f], { [f.name]: v }).errors.length === 0;
const sample = (f) => {
  for (const v of [f.example, f.default, ...(f.enum ?? [])]) if (v !== undefined && v !== "" && ok1(f, v)) return v;
  switch (f.type) {
    case "integer": case "number": return Math.max(f.min ?? 1, 1) <= (f.max ?? Infinity) ? Math.max(f.min ?? 1, 1) : f.max;
    case "boolean": return true;
    case "array": return ["test"];
    case "object": return {};
    default: return "test".padEnd(f.min ?? 0, "x");
  }
};
const dirBase = new Map();
function baseOf(sc) {
  if (!sc.lazy) return null;
  if (!dirBase.has(sc.key)) {
    const idx = JSON.parse(readFileSync(`${ROOT}/src/catalog/openapi/index.json`, "utf8")).apis;
    for (const e of idx) {
      const raw = JSON.parse(readFileSync(`${ROOT}/src/catalog/openapi/apis/${e.f}.json`, "utf8"));
      dirBase.set(e.k, raw.base);
    }
  }
  return dirBase.get(sc.key) ?? dirBase.get(sc.key.replace(/-\d+$/, ""));
}

const classes = {}, failures = [], latency = [];
let liveCount = 0, upstreamPerCall = { zero: 0, one: 0, more: 0 }, pinned = 0, pinFail = [];
const perClass = {};
const bump = (k, info) => { classes[k] = (classes[k] ?? 0) + 1; if (info) { const a = (perClass[k] ??= []); if (a.length < 15) a.push(info); } };

try {
  // ---- live operations: sequential so each call's upstream requests can be attributed exactly ----
  for (const [key, slug] of ops) {
    const sc = cat.find(key);
    const ep = sc.endpoints.find((e) => e.slug === slug);
    if (ep.status !== "live") continue;
    liveCount++;
    const params = {};
    for (const f of ep.fields) if (f.required) params[f.name] = sample(f);
    const before = env.upstreamCalls.length;
    const a = performance.now();
    const res = await (await cl()).callTool({ name: "run_scraper", arguments: { scraper: key, endpoint: slug, params } });
    latency.push(performance.now() - a);
    const calls = env.upstreamCalls.slice(before);
    calls.length === 0 ? upstreamPerCall.zero++ : calls.length === 1 ? upstreamPerCall.one++ : (upstreamPerCall.more++, (perClass.multiCall ??= []).push({ key, slug, calls: calls.map((c) => c.url.slice(0, 100)) }));
    const body = parse(res);
    const urlsOk = calls.every((c) => { try { const u = new URL(c.url); return /^https?:$/.test(u.protocol) && !/undefined|NaN|\[object/.test(c.url); } catch { return false; } });
    if (sc.lazy && calls.length) {
      const b = baseOf(sc);
      if (b && calls.every((c) => c.url.startsWith(b))) pinned++;
      else pinFail.push({ key, slug, base: b, url: calls[0]?.url });
    }
    if (!res.isError && body?.data !== undefined && calls.length >= 1 && urlsOk) bump("ok");
    else if (res.isError && calls.length >= 1 && urlsOk) bump("upstream_called_stub_payload_rejected", { key, slug, status: body?.status, msg: String(body?.message ?? "").slice(0, 100) });
    else if (res.isError && calls.length === 0 && body?.code === "invalid_params") {
      // one-of constraints ("provide id or bundleId") are enforced by the handler: retry with every documented example
      const p2 = { ...params };
      for (const f of ep.fields) if (f.example !== undefined && p2[f.name] === undefined) p2[f.name] = f.example;
      if (ep.fields.some((f) => f.name === "token")) p2.token = "qa-token";
      for (const f of ep.fields) if (f.pattern && f.name === "address") p2.address = "qa@example.test";
      const b4 = env.upstreamCalls.length;
      const r2 = await (await cl()).callTool({ name: "run_scraper", arguments: { scraper: key, endpoint: slug, params: p2 } });
      if (env.upstreamCalls.length > b4) bump("ok_with_documented_examples", { key, slug, firstError: body.message });
      else bump("generated_input_rejected", { key, slug, msg: parse(r2).message, errors: body.errors?.slice(0, 2) });
    }
    else if (!res.isError && calls.length === 0) bump("ok_no_upstream_call", { key, slug });
    else if (res.isError && calls.length === 0 && body?.status === 502 && /cannot be called through Apizie/.test(body.message)) bump("blocked_gateway_policy", { key, slug, msg: body.message });
    else if (res.isError && calls.length === 0 && body?.status === 503 && /environment variable/.test(body.message)) bump("blocked_server_not_configured", { key, slug, msg: body.message });
    else bump("fail", { key, slug, isError: res.isError, calls: calls.length, urlsOk, status: body?.status, msg: String(body?.message ?? res.content?.[0]?.text ?? "").slice(0, 160) });
  }
  R.live = { operations: liveCount, classes, upstreamRequestsPerCall: upstreamPerCall, latencyMs: { p50: pct(latency, 50), p95: pct(latency, 95), p99: pct(latency, 99) }, samples: perClass };
  R.hostPinning = { directoryCallsPinnedToSpecBase: pinned, violations: pinFail.length, sample: pinFail.slice(0, 5) };

  // ---- EXEC-002: input validation on every live operation that has required / enum / typed fields ----
  const v = { missingRequired: [0, 0], badEnum: [0, 0], badType: [0, 0], upstreamCalledOnInvalid: 0, sample: [] };
  const check = async (key, slug, params, slot) => {
    const before = env.upstreamCalls.length;
    const res = await (await cl()).callTool({ name: "run_scraper", arguments: { scraper: key, endpoint: slug, params } });
    const b = parse(res);
    v[slot][0]++;
    if (res.isError && b.code === "invalid_params" && b.errors?.length) v[slot][1]++;
    else if (v.sample.length < 10) v.sample.push({ key, slug, slot, got: b?.code ?? "success" });
    if (env.upstreamCalls.length !== before) v.upstreamCalledOnInvalid++;
  };
  for (const [key, slug] of ops) {
    const ep = cat.find(key).endpoints.find((e) => e.slug === slug);
    if (ep.status !== "live") continue;
    const base = {};
    for (const f of ep.fields) if (f.required) base[f.name] = sample(f);
    const req = ep.fields.find((f) => f.required && f.default === undefined);
    if (req) { const p = { ...base }; delete p[req.name]; await check(key, slug, p, "missingRequired"); }
    const en = ep.fields.find((f) => f.enum?.length && f.type === "string");
    if (en) await check(key, slug, { ...base, [en.name]: "__not_an_enum_value__" }, "badEnum");
    const num = ep.fields.find((f) => f.type === "integer" || f.type === "number");
    if (num) await check(key, slug, { ...base, [num.name]: "not-a-number" }, "badType");
  }
  R.validation = v;

  // ---- planned and byok operations (no credentials): must fail cleanly without calling upstream ----
  const before = env.upstreamCalls.length;
  const pl = { total: 0, clean501: 0, other: [] }, by = { total: 0, cleanKeyRequired: 0, other: [] };
  const rest = ops.filter(([k, s]) => cat.find(k).endpoints.find((e) => e.slug === s).status !== "live");
  for (const [key, slug] of rest) {
    const ep = cat.find(key).endpoints.find((e) => e.slug === slug);
    const params = {};
    for (const f of ep.fields) if (f.required) params[f.name] = sample(f);
    const res = await (await cl()).callTool({ name: "run_scraper", arguments: { scraper: key, endpoint: slug, params } });
    const b = parse(res);
    if (ep.status === "planned") { pl.total++; res.isError && b.status === 501 ? pl.clean501++ : pl.other.length < 5 && pl.other.push({ key, slug, b }); }
    else { by.total++; res.isError && b.status === 401 && b.code === "upstream_key_required" && /x-upstream-key|upstream_key/i.test(b.message) ? by.cleanKeyRequired++ : by.other.length < 8 && by.other.push({ key, slug, status: b.status, code: b.code, msg: String(b.message).slice(0, 120) }); }
  }
  R.planned = pl;
  R.byok = { ...by, upstreamCallsMade: env.upstreamCalls.length - before };
  await client.close();
} finally {
  await env.close();
}
writeFileSync(new URL("./execute.out.json", import.meta.url), JSON.stringify(R, null, 2));
console.log(JSON.stringify({ live: { ...R.live, samples: undefined }, hostPinning: R.hostPinning, validation: R.validation, planned: { ...R.planned, other: R.planned.other.slice(0, 2) }, byok: R.byok }, null, 1));
