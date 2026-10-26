// Tiny Redis-like key/value layer with three backends:
//   SupabaseKV – Supabase Postgres via PostgREST RPC (supabase/migrations/0001_zieapi.sql);
//                set SUPABASE_URL (or SUPABASE_PROJECT_ID) + SUPABASE_SECRET_KEY
//   UpstashKV  – Upstash Redis REST (set UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)
//   MemoryKV   – in-process (optionally snapshotted to a JSON file) for local dev / single server
// All methods are async so the rest of the app is backend-agnostic.

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
      body: JSON.stringify(args.map((a) => (typeof a === "number" ? String(a) : a))),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(`Upstash: ${j.error ?? res.status}`);
    return j.result;
  }
  async pipeline(cmds) {
    const res = await this.fetch(this.url + "/pipeline", {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(cmds.map((c) => c.map((a) => (typeof a === "number" ? String(a) : a)))),
    });
    const j = await res.json();
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
  async hgetall(k) {
    const arr = (await this.cmd("HGETALL", k)) ?? [];
    const o = {};
    for (let i = 0; i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]);
    return o;
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
  flush() {}
}

export class SupabaseKV {
  constructor({ url, key, fetchImpl = globalThis.fetch }) {
    this.url = url.replace(/\/+$/, "") + "/rest/v1/rpc/zie_kv";
    this.key = key;
    this.fetch = fetchImpl;
    // New-style keys (sb_secret_...) go in the apikey header only; legacy JWT keys also as Bearer.
    this.headers = { apikey: key, "content-type": "application/json", ...(key.startsWith("sb_") ? {} : { authorization: `Bearer ${key}` }) };
  }
  async pipeline(cmds) {
    const res = await this.fetch(this.url, { method: "POST", headers: this.headers, body: JSON.stringify({ cmds }) });
    const j = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(j)) throw new Error(`Supabase KV: ${j?.message ?? j?.hint ?? res.status}`);
    return j;
  }
  async cmd(...args) {
    return (await this.pipeline([args]))[0];
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
