// Tiny Redis-like key/value layer with two backends:
//   MemoryKV  – in-process (optionally snapshotted to a JSON file) for local dev / single server
//   UpstashKV – Upstash Redis REST (works on Vercel; set UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)
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

export function kvFromEnv(env = process.env, { file } = {}) {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashKV({ url, token });
  return new MemoryKV({ file });
}
