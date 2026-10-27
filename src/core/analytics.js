// Per-request usage rollups for the dashboard. One hash per owner per UTC hour
// (`ah:<owner>:<YYYY-MM-DDTHH>`) holds every counter the dashboard needs, so any range
// from 24 hours to 90 days is answered exactly, in the viewer's own timezone.
//
// Field names: req ok err e5 ms lb<i> st|<status> ep|<project>/<endpoint> ct|<category> sr|<source>
// and the same set again behind `K|<keyId>|` so every chart can be filtered by API key.

export const LAT_BUCKETS = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, 30000];
const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const ROLLUP_TTL = 100 * 86400;
export const RANGES = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY, "90d": 90 * DAY };

export const hourKey = (t) => new Date(t).toISOString().slice(0, 13);
const bucketOf = (ms) => {
  const i = LAT_BUCKETS.findIndex((b) => ms <= b);
  return i === -1 ? LAT_BUCKETS.length : i;
};

/** Counter increments for one request (all fields, plus the per-key copies). */
export function rollupFields(e) {
  const err = e.status >= 400 ? 1 : 0;
  const base = {
    req: 1,
    ok: err ? 0 : 1,
    err,
    e5: e.status >= 500 ? 1 : 0,
    ms: Math.max(0, Math.round(e.ms ?? 0)),
    [`lb${bucketOf(e.ms ?? 0)}`]: 1,
    [`st|${e.status}`]: 1,
    [`ep|${e.project}/${e.endpoint}`]: 1,
    ...(e.category ? { [`ct|${e.category}`]: 1 } : {}),
    [`sr|${e.source ?? "rest"}`]: 1,
  };
  const out = { ...base };
  if (e.keyId) for (const [f, n] of Object.entries(base)) out[`K|${e.keyId}|${f}`] = n;
  for (const f of Object.keys(out)) if (out[f] === 0) delete out[f];
  return out;
}

/** Platform-wide counters for the admin dashboard: the same fields without per-key copies, plus who called (ow|)
 * and which sources failed (pe| any error, p5| server errors). */
export function globalFields(owner, e) {
  const f = rollupFields({ ...e, keyId: null });
  if (owner) f[`ow|${owner}`] = 1;
  if (e.status >= 400) f[`pe|${e.project}`] = 1;
  if (e.status >= 500) f[`p5|${e.project}`] = 1;
  return f;
}
export const GLOBAL_LOG = "glog";
export const GLOBAL_LOG_CAP = 500;

export function recordCommands(owner, e, now = Date.now()) {
  const hk = hourKey(now);
  return [
    ["HMINCR", `ah:${owner}:${hk}`, rollupFields(e), ROLLUP_TTL],
    ["HMINCR", `ah:_g:${hk}`, globalFields(owner, e), ROLLUP_TTL],
    ["LPUSH", GLOBAL_LOG, JSON.stringify({ at: e.at, owner, project: e.project, endpoint: e.endpoint, status: e.status, ms: e.ms, source: e.source, cache: e.cache, code: e.code, error: e.error ? String(e.error).slice(0, 160) : null }), GLOBAL_LOG_CAP],
  ];
}

/** Read the hourly hashes covering [from, to]. Returns [{ t, f }] with t = start of the UTC hour. */
export async function loadHours(kv, owner, from, to) {
  const start = Math.floor(from / HOUR) * HOUR;
  const ts = [];
  for (let t = start; t <= to; t += HOUR) ts.push(t);
  if (!ts.length) return [];
  const res = await kv.batch(ts.map((t) => ["HGETALL", `ah:${owner}:${hourKey(t)}`]));
  return ts.map((t, i) => ({ t, f: res[i] ?? {} }));
}

const view = (f, keyId) => {
  if (!keyId) return f;
  const p = `K|${keyId}|`;
  const o = {};
  for (const [k, v] of Object.entries(f)) if (k.startsWith(p)) o[k.slice(p.length)] = v;
  return o;
};

function p95(lb, total) {
  if (!total) return null;
  const target = Math.ceil(total * 0.95);
  let acc = 0;
  for (let i = 0; i <= LAT_BUCKETS.length; i++) {
    acc += lb[i] ?? 0;
    if (acc >= target) return LAT_BUCKETS[i] ?? null;
  }
  return null;
}

const top = (map, n = 10) => Object.entries(map).map(([name, v]) => ({ name, requests: v })).sort((a, b) => b.requests - a.requests).slice(0, n);

/**
 * Aggregate hourly rows into everything the dashboard shows.
 * tzOffsetMin: viewer's offset from UTC in minutes (UTC+7 = 420).
 */
export function summarize(hours, { keyId = null, from, to, tzOffsetMin = 0, granularity = "day" }) {
  const tz = tzOffsetMin * 60_000;
  const tot = { req: 0, ok: 0, err: 0, e5: 0, ms: 0 };
  const lb = [];
  const ep = {};
  const ct = {};
  const st = {};
  const sr = {};
  const keys = {};
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  const series = new Map();

  // Pre-fill the series so empty hours/days still draw.
  if (granularity === "hour") for (let t = Math.floor(from / HOUR) * HOUR; t <= to; t += HOUR) series.set(t, { t, requests: 0, errors: 0 });
  else {
    const first = Date.parse(new Date(from + tz).toISOString().slice(0, 10));
    const last = Date.parse(new Date(to + tz).toISOString().slice(0, 10));
    for (let d = first; d <= last; d += DAY) {
      const day = new Date(d).toISOString().slice(0, 10);
      series.set(day, { t: day, requests: 0, errors: 0 });
    }
  }

  for (const { t, f: raw } of hours) {
    if (t + HOUR <= from || t > to) continue;
    if (!keyId) for (const [k, v] of Object.entries(raw)) {
      const m = /^K\|([^|]+)\|(req|err)$/.exec(k);
      if (m) (keys[m[1]] ??= { requests: 0, errors: 0 })[m[2] === "req" ? "requests" : "errors"] += v;
    }
    const f = view(raw, keyId);
    if (!f.req) continue;
    for (const k of Object.keys(tot)) tot[k] += f[k] ?? 0;
    for (const [k, v] of Object.entries(f)) {
      if (k.startsWith("lb")) lb[Number(k.slice(2))] = (lb[Number(k.slice(2))] ?? 0) + v;
      else if (k.startsWith("ep|")) ep[k.slice(3)] = (ep[k.slice(3)] ?? 0) + v;
      else if (k.startsWith("ct|")) ct[k.slice(3)] = (ct[k.slice(3)] ?? 0) + v;
      else if (k.startsWith("st|")) st[k.slice(3)] = (st[k.slice(3)] ?? 0) + v;
      else if (k.startsWith("sr|")) sr[k.slice(3)] = (sr[k.slice(3)] ?? 0) + v;
    }
    const local = new Date(t + tz);
    heat[(local.getUTCDay() + 6) % 7][local.getUTCHours()] += f.req;
    const sk = granularity === "hour" ? t : local.toISOString().slice(0, 10);
    const pt = series.get(sk);
    if (pt) {
      pt.requests += f.req;
      pt.errors += f.err ?? 0;
    }
  }

  return {
    total: tot.req,
    success: tot.ok,
    errors: tot.err,
    serverErrors: tot.e5,
    successRate: tot.req ? Math.round((tot.ok / tot.req) * 10000) / 100 : null,
    avgMs: tot.req ? Math.round(tot.ms / tot.req) : null,
    p95Ms: p95(lb, tot.req),
    series: [...series.values()],
    granularity,
    heatmap: heat,
    endpoints: top(ep),
    categories: top(ct),
    statuses: Object.entries(st).filter(([s]) => Number(s) >= 400).map(([status, count]) => ({ status: Number(status), count })).sort((a, b) => b.count - a.count),
    sources: top(sr),
    keys,
  };
}

/** System status from the global rollup of the last hour. */
export async function systemStatus(kv, now = Date.now()) {
  const [a, b] = await kv.batch([["HGETALL", `ah:_g:${hourKey(now)}`], ["HGETALL", `ah:_g:${hourKey(now - HOUR)}`]]);
  const req = (a?.req ?? 0) + (b?.req ?? 0);
  const e5 = (a?.e5 ?? 0) + (b?.e5 ?? 0);
  const rate = req ? e5 / req : 0;
  return { requests: req, serverErrors: e5, state: req >= 20 && rate > 0.1 ? "degraded" : "operational" };
}
