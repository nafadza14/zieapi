// Domain repository on top of the KV layer: users, sessions, API keys, usage,
// request logs, webhooks, bulk jobs, invoices, reports, showcase, scraper toggles.

import { randomBytes } from "node:crypto";
import { sha256, ulid, stableId, monthKey, dayKey } from "../core/util.js";
import { PLANS } from "../core/plans.js";

const J = (s) => (s ? JSON.parse(s) : null);
const S = (o) => JSON.stringify(o);
export const KEY_PREFIX = "zie_";
const SESSION_DAYS = 30;

export class Repo {
  constructor(kv) {
    this.kv = kv;
    this.envKeys = new Map(); // hash -> key record (from ZIE_KEYS), not persisted
  }

  // ---------- users ----------------------------------------------------------
  async createUser({ email, name, avatar = null, passwordHash = null, role = "user" }) {
    const id = ulid();
    const u = { id, email: email?.toLowerCase() ?? null, name: name ?? email?.split("@")[0] ?? "user", avatar, passwordHash, role, plan: "free", planExpiresAt: null, status: "active", createdAt: new Date().toISOString(), providers: {} };
    await this.kv.set(`user:${id}`, S(u));
    if (u.email) await this.kv.set(`user_email:${u.email}`, id);
    await this.kv.sadd("users", id);
    return u;
  }
  async getUser(id) {
    return id ? J(await this.kv.get(`user:${id}`)) : null;
  }
  async getUserByEmail(email) {
    if (!email) return null;
    return this.getUser(await this.kv.get(`user_email:${email.toLowerCase()}`));
  }
  async getUserByProvider(provider, pid) {
    return this.getUser(await this.kv.get(`user_oauth:${provider}:${pid}`));
  }
  async linkProvider(userId, provider, pid) {
    await this.kv.set(`user_oauth:${provider}:${pid}`, userId);
    return this.updateUser(userId, (u) => ({ providers: { ...(u.providers ?? {}), [provider]: String(pid) } }));
  }
  async updateUser(id, patch) {
    const u = await this.getUser(id);
    if (!u) return null;
    const next = { ...u, ...(typeof patch === "function" ? patch(u) : patch) };
    await this.kv.set(`user:${id}`, S(next));
    return next;
  }
  async listUsers() {
    const ids = await this.kv.smembers("users");
    const raw = await this.kv.mget(ids.map((i) => `user:${i}`));
    return raw.map(J).filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  /** Plan currently in force (paid plans fall back to free after expiry). */
  effectivePlan(u) {
    if (!u) return "free";
    if (u.plan !== "free" && u.planExpiresAt && Date.parse(u.planExpiresAt) < Date.now()) return "free";
    return PLANS[u.plan] ? u.plan : "free";
  }

  // ---------- sessions -------------------------------------------------------
  async createSession(userId) {
    const token = randomBytes(32).toString("base64url");
    await this.kv.set(`sess:${sha256(token)}`, S({ userId, createdAt: Date.now() }), { ex: SESSION_DAYS * 86400 });
    return { token, maxAge: SESSION_DAYS * 86400 };
  }
  async getSessionUser(token) {
    if (!token) return null;
    const s = J(await this.kv.get(`sess:${sha256(token)}`));
    if (!s) return null;
    const u = await this.getUser(s.userId);
    return u?.status === "active" ? u : null;
  }
  async deleteSession(token) {
    if (token) await this.kv.del(`sess:${sha256(token)}`);
  }

  // ---------- api keys -------------------------------------------------------
  async createKey(userId, { name = "default", ipAllowlist = [] } = {}) {
    const secret = KEY_PREFIX + randomBytes(24).toString("base64url");
    const rec = { id: ulid(), userId, name, hash: sha256(secret), preview: `${secret.slice(0, 8)}…${secret.slice(-4)}`, status: "active", ipAllowlist, createdAt: new Date().toISOString(), lastUsedAt: null };
    await this.kv.set(`key:${rec.hash}`, S(rec));
    await this.kv.set(`key_id:${rec.id}`, rec.hash);
    await this.kv.sadd(`user_keys:${userId}`, rec.id);
    return { secret, rec };
  }
  seedEnvKeys(spec) {
    if (!spec) return;
    for (const part of String(spec).split(",").map((s) => s.trim()).filter(Boolean)) {
      const i = part.indexOf(":");
      const [plan, secret] = i > 0 ? [part.slice(0, i), part.slice(i + 1)] : ["free", part];
      if (!PLANS[plan]) throw new Error(`ZIE_KEYS: unknown plan "${plan}"`);
      if (!secret.startsWith(KEY_PREFIX) || secret.length < 16) throw new Error(`ZIE_KEYS: keys must start with ${KEY_PREFIX} and be ≥16 chars`);
      const hash = sha256(secret);
      this.envKeys.set(hash, { id: stableId(hash), userId: null, plan, name: `env-${plan}`, hash, preview: `${secret.slice(0, 8)}…${secret.slice(-4)}`, status: "active", ipAllowlist: [], createdAt: null });
    }
  }
  async getKeyBySecret(secret) {
    const hash = sha256(secret);
    return this.envKeys.get(hash) ?? J(await this.kv.get(`key:${hash}`));
  }
  async getKeyById(id) {
    const hash = await this.kv.get(`key_id:${id}`);
    return hash ? J(await this.kv.get(`key:${hash}`)) : null;
  }
  async listKeys(userId) {
    const ids = await this.kv.smembers(`user_keys:${userId}`);
    const keys = await Promise.all(ids.map((i) => this.getKeyById(i)));
    return keys.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async updateKey(id, patch) {
    const k = await this.getKeyById(id);
    if (!k) return null;
    const next = { ...k, ...patch };
    await this.kv.set(`key:${k.hash}`, S(next));
    return next;
  }
  async deleteKey(id) {
    const k = await this.getKeyById(id);
    if (!k) return false;
    await this.kv.del(`key:${k.hash}`);
    await this.kv.del(`key_id:${id}`);
    await this.kv.srem(`user_keys:${k.userId}`, id);
    return true;
  }
  async touchKey(k) {
    if (!k.userId) return;
    const last = k.lastUsedAt ? Date.parse(k.lastUsedAt) : 0;
    if (Date.now() - last > 60_000) await this.updateKey(k.id, { lastUsedAt: new Date().toISOString() });
  }

  // ---------- usage & rate limits -------------------------------------------
  async incrMinute(owner, n, window) {
    return this.kv.incrby(`rl:${owner}:${window}`, n, 120);
  }
  async incrMonth(owner, n, month = monthKey()) {
    return this.kv.incrby(`use:${owner}:${month}`, n);
  }
  async getMonth(owner, month = monthKey()) {
    return Number(await this.kv.get(`use:${owner}:${month}`)) || 0;
  }
  async getMinute(owner, window) {
    return Number(await this.kv.get(`rl:${owner}:${window}`)) || 0;
  }
  async incrDay(owner, n, day = dayKey()) {
    await this.kv.incrby(`useday:${owner}:${day}`, n, 100 * 86400);
    await this.kv.incrby(`g:day:${day}`, n, 100 * 86400);
  }
  async dailyUsage(owner, days = 30) {
    const list = [];
    for (let i = days - 1; i >= 0; i--) list.push(dayKey(new Date(Date.now() - i * 86400000)));
    const vals = await this.kv.mget(list.map((d) => (owner ? `useday:${owner}:${d}` : `g:day:${d}`)));
    return list.map((d, i) => ({ date: d, requests: Number(vals[i]) || 0 }));
  }
  async incrScraperUse(owner, project, n = 1, month = monthKey()) {
    await this.kv.hincrby(`usescr:${owner}:${month}`, project, n);
  }
  async scraperUse(owner, month = monthKey()) {
    return this.kv.hgetall(`usescr:${owner}:${month}`);
  }

  // ---------- request logs ---------------------------------------------------
  async addLog(owner, entry) {
    await this.kv.lpush(`logs:${owner}`, S(entry), 2000);
  }
  async getLogs(owner, { limit = 50, offset = 0 } = {}) {
    return (await this.kv.lrange(`logs:${owner}`, offset, offset + limit - 1)).map(J);
  }

  // ---------- per-scraper public stats --------------------------------------
  async recordStat(scraperId, ok) {
    await this.kv.incrby(`stat:${scraperId}:req`, 1);
    if (ok) await this.kv.incrby(`stat:${scraperId}:ok`, 1);
    await this.kv.incrby("g:requests", 1);
  }
  async getStats(ids) {
    const vals = await this.kv.mget(ids.flatMap((i) => [`stat:${i}:req`, `stat:${i}:ok`]));
    const out = {};
    ids.forEach((id, i) => (out[id] = { requests: Number(vals[2 * i]) || 0, success: Number(vals[2 * i + 1]) || 0 }));
    return out;
  }

  // ---------- webhooks -------------------------------------------------------
  async getWebhooks(owner) {
    return J(await this.kv.get(`hooks:${owner}`)) ?? [];
  }
  async setWebhooks(owner, list) {
    await this.kv.set(`hooks:${owner}`, S(list));
  }

  // ---------- bulk jobs & idempotency ---------------------------------------
  async saveJob(job) {
    await this.kv.set(`job:${job.jobId}`, S(job), { ex: 7 * 86400 });
    await this.kv.lpush(`jobs:${job.owner}`, job.jobId, 200);
  }
  async getJob(id) {
    return J(await this.kv.get(`job:${id}`));
  }
  async listJobs(owner, limit = 50) {
    const ids = await this.kv.lrange(`jobs:${owner}`, 0, limit - 1);
    const raw = await this.kv.mget(ids.map((i) => `job:${i}`));
    return raw.map(J).filter(Boolean);
  }
  async getIdem(owner, key) {
    return J(await this.kv.get(`idem:${owner}:${sha256(key)}`));
  }
  async setIdem(owner, key, val) {
    await this.kv.set(`idem:${owner}:${sha256(key)}`, S(val), { ex: 86400 });
  }

  // ---------- generic collections (invoices, reports, showcase) -------------
  async put(kind, obj, ownerId = null) {
    await this.kv.set(`${kind}:${obj.id}`, S(obj));
    await this.kv.sadd(`${kind}s`, obj.id);
    if (ownerId) await this.kv.sadd(`${kind}s:${ownerId}`, obj.id);
    return obj;
  }
  async getItem(kind, id) {
    return J(await this.kv.get(`${kind}:${id}`));
  }
  async listItems(kind, ownerId = null) {
    const ids = await this.kv.smembers(ownerId ? `${kind}s:${ownerId}` : `${kind}s`);
    const raw = await this.kv.mget(ids.map((i) => `${kind}:${i}`));
    return raw.map(J).filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async patchItem(kind, id, patch) {
    const o = await this.getItem(kind, id);
    if (!o) return null;
    const next = { ...o, ...patch };
    await this.kv.set(`${kind}:${id}`, S(next));
    return next;
  }

  // ---------- scraper toggles -------------------------------------------------
  async disabledScrapers() {
    return new Set(await this.kv.smembers("scr_off"));
  }
  async setScraperEnabled(key, enabled) {
    if (enabled) await this.kv.srem("scr_off", key);
    else await this.kv.sadd("scr_off", key);
  }

  // ---------- global ----------------------------------------------------------
  async globalRequests() {
    return Number(await this.kv.get("g:requests")) || 0;
  }
}

export const newId = ulid;
