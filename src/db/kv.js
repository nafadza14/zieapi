// Tiny Redis-like key/value layer with three backends:
//   SupabaseKV – Supabase Postgres via PostgREST RPC (supabase/migrations/0001_apizie.sql);
//                set SUPABASE_URL (or SUPABASE_PROJECT_ID) + SUPABASE_SECRET_KEY
//   UpstashKV  – Upstash Redis REST (set UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)
//   MemoryKV   – in-process (optionally snapshotted to a JSON file) for local dev / single server
// Every backend also takes batch([...commands]) so a request's bookkeeping costs one round trip.
// Commands: GET, SET k v [ex], DEL, INCRBY k n [ex], EXPIRE, HINCRBY k f n, HMINCR k {f:n} [ex],
// HGETALL, LPUSH k v [cap], LRANGE k a b, SADD, SREM, SMEMBERS, MGET [keys], PING.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class MemoryKV {
  constructor({ file = null } = {}) {
    this.file = file;
    this.data = new Map(); // key -> {t:'s'|'h'|'l'|'z', v, exp}
    this._timer = null;
    if (file && existsSync(file)) {
      try {
        const snap = JSON.parse(readFileSync(file, "utf8"));
        for (const [k, e] of Object.entries(snap)) {
          if (e.t === "z") e.v = new Set(e.v);
          this.data.set(k, e);
        }
      } catch {}
    }
  }
  _get(k) {
    const e = this.data.get(k);
    if (!e) return null;
    if (e.exp && e.exp <= Date.now()) {
      this.data.delete(k);
      return null;
    }
    return e;
  }
  _put(k, t, v, ex) {
    const prev = this._get(k);
    this.data.set(k, { t, v, exp: ex ? Date.now() + ex * 1000 : prev?.exp ?? null });
    this._dirty();
  }
  async get(k) {
    const e = this._get(k);
    return e && e.t === "s" ? e.v : null;
  }
  async set(k, v, { ex } = {}) {
    this.data.set(k, { t: "s", v: String(v), exp: ex ? Date.now() + ex * 1000 : null });
    this._dirty();
  }
  async del(k) {
    this.data.delete(k);
    this._dirty();
  }
  async incrby(k, n = 1, ex) {
    const e = this._get(k);
    const v = (e ? Number(e.v) : 0) + n;
    this.data.set(k, { t: "s", v: String(v), exp: e?.exp ?? (ex ? Date.now() + ex * 1000 : null) });
    this._dirty();
    return v;
  }
  async expire(k, s) {
    const e = this._get(k);
    if (e) e.exp = Date.now() + s * 1000;
  }
  async hincrby(k, field, n = 1) {
    const e = this._get(k) ?? { t: "h", v: {} };
    e.v[field] = (Number(e.v[field]) || 0) + n;
    this._put(k, "h", e.v);
    return e.v[field];
  }
  async hmincr(k, fields, ex) {
    const e = this._get(k);
    const v = e?.t === "h" ? e.v : {};
    for (const [f, n] of Object.entries(fields)) v[f] = (Number(v[f]) || 0) + Number(n);
    this.data.set(k, { t: "h", v, exp: e?.exp ?? (ex ? Date.now() + ex * 1000 : null) });
    this._dirty();
  }
  async hgetall(k) {
    const e = this._get(k);
    return e && e.t === "h" ? { ...e.v } : {};
  }
  async lpush(k, v, cap = 1000) {
    const e = this._get(k) ?? { t: "l", v: [] };
    e.v.unshift(String(v));
    if (e.v.length > cap) e.v.length = cap;
    this._put(k, "l", e.v);
  }
  async lrange(k, start, stop) {
    const e = this._get(k);
    if (!e || e.t !== "l") return [];
    return e.v.slice(start, stop === -1 ? undefined : stop + 1);
  }
  async sadd(k, m) {
    const e = this._get(k) ?? { t: "z", v: new Set() };
    e.v.add(String(m));
    this._put(k, "z", e.v);
  }
  async srem(k, m) {
    const e = this._get(k);
    if (e?.t === "z") {
      e.v.delete(String(m));
      this._dirty();
    }
  }
  async smembers(k) {
    const e = this._get(k);
    return e?.t === "z" ? [...e.v] : [];
  }
  async mget(keys) {
    return Promise.all(keys.map((k) => this.get(k)));
  }
  async batch(cmds) {
    return Promise.all(cmds.map((c) => runOn(this, c)));
  }
  _dirty() {
    if (!this.file || this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 300);
    this._timer.unref?.();
  }
  flush() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const out = {};
    for (const [k, e] of this.data) {
      if (e.exp && e.exp <= Date.now()) continue;
      if (k.startsWith("rl:") || k.startsWith("cache:")) continue;
      out[k] = e.t === "z" ? { ...e, v: [...e.v] } : e;
    }
    writeFileSync(this.file + ".tmp", JSON.stringify(out));
    renameSync(this.file + ".tmp", this.file);
  }
}

/** Run one batch command through the single-call methods (MemoryKV, and the fallback for others). */
function runOn(kv, [op, k, a, b]) {
  switch (String(op).toUpperCase()) {
    case "GET": return kv.get(k);
    case "SET": return kv.set(k, a, { ex: b });
    case "DEL": return kv.del(k);
    case "INCRBY": return kv.incrby(k, a, b);
    case "EXPIRE": return kv.expire(k, a);
    case "HINCRBY": return kv.hincrby(k, a, b);
    case "HMINCR": return kv.hmincr(k, a, b);
    case "HGETALL": return kv.hgetall(k);
    case "LPUSH": return kv.lpush(k, a, b);
    case "LRANGE": return kv.lrange(k, a, b);
    case "SADD": return kv.sadd(k, a);
    case "SREM": return kv.srem(k, a);
    case "SMEMBERS": return kv.smembers(k);
    case "MGET": return kv.mget(k);
    case "PING": return "PONG";
    default: throw new Error(`kv: unknown command ${op}`);
  }
}

const num = (a) => (typeof a === "number" ? String(a) : a);

export class UpstashKV {
  constructor({ url, token, fetchImpl = globalThis.fetch }) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.fetch = fetchImpl;
  }
  async cmd(...args) {
    const res = await this.fetch(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args.map(num)),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(`Upstash: ${j.error ?? res.status}`);
    return j.result;
  }
  async pipeline(cmds) {
    if (!cmds.length) return [];
    const res = await this.fetch(this.url + "/pipeline", {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(cmds.map((c) => c.map(num))),
    });
    const j = await res.json();
    if (!Array.isArray(j)) throw new Error(`Upstash: ${j?.error ?? res.status}`);
    return j.map((x) => x.result);
  }
  get(k) {
    return this.cmd("GET", k);
  }
  set(k, v, { ex } = {}) {
    return ex ? this.cmd("SET", k, String(v), "EX", ex) : this.cmd("SET", k, String(v));
  }
  del(k) {
    return this.cmd("DEL", k);
  }
  async incrby(k, n = 1, ex) {
    if (!ex) return Number(await this.cmd("INCRBY", k, n));
    const [v] = await this.pipeline([["INCRBY", k, n], ["EXPIRE", k, ex, "NX"]]);
    return Number(v);
  }
  expire(k, s) {
    return this.cmd("EXPIRE", k, s);
  }
  async hincrby(k, field, n = 1) {
    return Number(await this.cmd("HINCRBY", k, field, n));
  }
  async hmincr(k, fields, ex) {
    await this.batch([["HMINCR", k, fields, ex]]);
  }
  async hgetall(k) {
    return pairsToObject((await this.cmd("HGETALL", k)) ?? []);
  }
  async lpush(k, v, cap = 1000) {
    await this.pipeline([["LPUSH", k, String(v)], ["LTRIM", k, 0, cap - 1]]);
  }
  async lrange(k, a, b) {
    return (await this.cmd("LRANGE", k, a, b)) ?? [];
  }
  sadd(k, m) {
    return this.cmd("SADD", k, String(m));
  }
  srem(k, m) {
    return this.cmd("SREM", k, String(m));
  }
  async smembers(k) {
    return (await this.cmd("SMEMBERS", k)) ?? [];
  }
  async mget(keys) {
    if (!keys.length) return [];
    return (await this.cmd("MGET", ...keys)) ?? [];
  }
  /** Expand our command set into Redis commands, run them as one pipeline, map results back. */
  async batch(cmds) {
    const plan = [];
    const spans = [];
    for (const [op0, k, a, b] of cmds) {
      const op = String(op0).toUpperCase();
      const start = plan.length;
      if (op === "SET") plan.push(b ? ["SET", k, String(a), "EX", b] : ["SET", k, String(a)]);
      else if (op === "INCRBY") plan.push(["INCRBY", k, a], ...(b ? [["EXPIRE", k, b, "NX"]] : []));
      else if (op === "HMINCR") {
        const entries = Object.entries(a ?? {});
        plan.push(...entries.map(([f, n]) => ["HINCRBY", k, f, n]), ...(b ? [["EXPIRE", k, b, "NX"]] : []));
        if (!entries.length) plan.push(["PING"]);
      } else if (op === "LPUSH") plan.push(["LPUSH", k, String(a)], ["LTRIM", k, 0, (b ?? 1000) - 1]);
      else if (op === "MGET") plan.push(k.length ? ["MGET", ...k] : ["PING"]);
      else if (op === "SADD" || op === "SREM") plan.push([op, k, String(a)]);
      else plan.push([op, k, a, b].filter((x) => x !== undefined));
      spans.push({ op, start, k });
    }
    const out = await this.pipeline(plan);
    return spans.map(({ op, start, k }) => {
      const r = out[start];
      if (op === "HGETALL") return pairsToObject(r ?? []);
      if (op === "INCRBY" || op === "HINCRBY") return Number(r);
      if (op === "MGET") return k.length ? r ?? [] : [];
      return r;
    });
  }
  flush() {}
}

function pairsToObject(arr) {
  const o = {};
  for (let i = 0; i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]);
  return o;
}

export class SupabaseKV {
  constructor({ url, key, fetchImpl = globalThis.fetch }) {
    this.url = url.replace(/\/+$/, "") + "/rest/v1/rpc/apizie_kv";
    this.key = key;
    this.fetch = fetchImpl;
    // New-style keys (sb_secret_...) go in the apikey header only; legacy JWT keys also as Bearer.
    this.headers = { apikey: key, "content-type": "application/json", ...(key.startsWith("sb_") ? {} : { authorization: `Bearer ${key}` }) };
  }
  async pipeline(cmds) {
    if (!cmds.length) return [];
    const res = await this.fetch(this.url, { method: "POST", headers: this.headers, body: JSON.stringify({ cmds }) });
    const j = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(j)) throw new Error(`Supabase KV: ${j?.message ?? j?.hint ?? res.status}`);
    return j;
  }
  async cmd(...args) {
    return (await this.pipeline([args]))[0];
  }
  batch(cmds) {
    return this.pipeline(cmds.map((c) => c.filter((x) => x !== undefined)));
  }
  get(k) {
    return this.cmd("GET", k);
  }
  set(k, v, { ex } = {}) {
    return ex ? this.cmd("SET", k, String(v), ex) : this.cmd("SET", k, String(v));
  }
  del(k) {
    return this.cmd("DEL", k);
  }
  async incrby(k, n = 1, ex) {
    return Number(await (ex ? this.cmd("INCRBY", k, n, ex) : this.cmd("INCRBY", k, n)));
  }
  expire(k, s) {
    return this.cmd("EXPIRE", k, s);
  }
  async hincrby(k, field, n = 1) {
    return Number(await this.cmd("HINCRBY", k, field, n));
  }
  hmincr(k, fields, ex) {
    return ex ? this.cmd("HMINCR", k, fields, ex) : this.cmd("HMINCR", k, fields);
  }
  async hgetall(k) {
    const o = (await this.cmd("HGETALL", k)) ?? {};
    for (const f of Object.keys(o)) o[f] = Number(o[f]);
    return o;
  }
  lpush(k, v, cap = 1000) {
    return this.cmd("LPUSH", k, String(v), cap);
  }
  async lrange(k, a, b) {
    return (await this.cmd("LRANGE", k, a, b)) ?? [];
  }
  sadd(k, m) {
    return this.cmd("SADD", k, String(m));
  }
  srem(k, m) {
    return this.cmd("SREM", k, String(m));
  }
  async smembers(k) {
    return (await this.cmd("SMEMBERS", k)) ?? [];
  }
  async mget(keys) {
    if (!keys.length) return [];
    return (await this.cmd("MGET", keys)) ?? [];
  }
  flush() {}
}

export function supabaseUrl(env = process.env) {
  if (env.SUPABASE_URL) return env.SUPABASE_URL.replace(/\/+$/, "");
  if (env.NEXT_PUBLIC_SUPABASE_URL) return env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
  if (env.SUPABASE_PROJECT_ID) return `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;
  return null;
}

export function kvFromEnv(env = process.env, { file } = {}) {
  const sbUrl = supabaseUrl(env);
  const sbKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (sbUrl && sbKey) return new SupabaseKV({ url: sbUrl, key: sbKey });
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashKV({ url, token });
  return new MemoryKV({ file });
}
