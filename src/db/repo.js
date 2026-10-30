// Domain repository on top of the KV layer: users, sessions, API keys, usage,
// request logs, webhooks, bulk jobs, invoices, reports, showcase, scraper toggles.

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { sha256, ulid, stableId, monthKey, dayKey } from "../core/util.js";
import { PLANS, FINANCE_PLANS, PAYG, FINANCE_PAYG, microsFromLegacyTenths, activeFinancePlan } from "../core/plans.js";

const J = (s) => (s ? JSON.parse(s) : null);
const S = (o) => JSON.stringify(o);
export const KEY_PREFIX = "apz_";
export const LEGACY_KEY_PREFIXES = ["zie_"]; // keys issued before the Apizie rebrand keep working
const SESSION_DAYS = 30;
const LOG_CAP = 5000;
export const DEFAULT_PREFS = { quotaWarning: true, quotaExceeded: true, balance: true, affiliate: true, dataAlerts: true, product: false, payg: false, lowBalanceAlert: true };

export class Repo {
  constructor(kv, { vaultSecret = null, hotCacheMs = 15_000 } = {}) {
    this.kv = kv;
    this.envKeys = new Map(); // hash -> key record (from APIZIE_KEYS), not persisted
    // Per-instance cache for the records every API/MCP call reads (key, owner, disabled list). Each saves a storage
    // round trip; changes made on this instance invalidate at once, other instances see them within hotCacheMs.
    this.hotCacheMs = hotCacheMs;
    this.hot = new Map();
    this.setVault(vaultSecret);
  }
  async _hot(k, load) {
    const now = Date.now();
    const e = this.hot.get(k);
    if (e && e.exp > now) return e.v;
    const v = await load();
    if (this.hotCacheMs > 0) {
      if (this.hot.size > 5000) this.hot.delete(this.hot.keys().next().value);
      this.hot.set(k, { v, exp: now + this.hotCacheMs });
    }
    return v;
  }
  _unhot(k) {
    this.hot.delete(k);
  }
  /** getKeyBySecret / getUser through the hot cache: for authenticating API and MCP calls only. */
  authKey(secret) {
    const hash = sha256(secret);
    return this.envKeys.get(hash) ?? this._hot(`key:${hash}`, async () => J(await this.kv.get(`key:${hash}`)));
  }
  authUser(id) {
    return id ? this._hot(`user:${id}`, () => this.getUser(id)) : null;
  }
  /** Key used to encrypt API key secrets so their owner can reveal them later. */
  setVault(secret) {
    this.vault = secret ? createHash("sha256").update("apizie-key-vault:" + secret).digest() : null;
  }
  seal(text) {
    if (!this.vault) return null;
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.vault, iv);
    const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
    return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
  }
  unseal(sealed) {
    if (!this.vault || !sealed) return null;
    try {
      const [iv, tag, body] = sealed.split(".").map((x) => Buffer.from(x, "base64url"));
      const d = createDecipheriv("aes-256-gcm", this.vault, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(body), d.final()]).toString("utf8");
    } catch {
      return null;
    }
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
    this._unhot(`user:${id}`);
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
  /** Apizie Finance plan in force, or null (none or expired). */
  financePlanOf(u) {
    return activeFinancePlan(u);
  }

  // ---------- sessions -------------------------------------------------------
  async createSession(userId, meta = {}) {
    const token = randomBytes(32).toString("base64url");
    const id = sha256(token);
    const rec = { id, userId, createdAt: Date.now(), lastSeenAt: Date.now(), ua: String(meta.ua ?? "").slice(0, 200), ip: meta.ip ?? null };
    await this.kv.set(`sess:${id}`, S(rec), { ex: SESSION_DAYS * 86400 });
    await this.kv.sadd(`user_sess:${userId}`, id);
    return { token, id, maxAge: SESSION_DAYS * 86400 };
  }
  async getSession(token) {
    return token ? J(await this.kv.get(`sess:${sha256(token)}`)) : null;
  }
  async getSessionUser(token) {
    const s = await this.getSession(token);
    if (!s) return null;
    const u = await this.getUser(s.userId);
    if (u?.status !== "active") return null;
    if (Date.now() - (s.lastSeenAt ?? 0) > 5 * 60_000) {
      s.lastSeenAt = Date.now();
      this.kv.set(`sess:${s.id ?? sha256(token)}`, S(s), { ex: SESSION_DAYS * 86400 }).catch(() => {});
    }
    return u;
  }
  async deleteSession(token) {
    if (token) await this.deleteSessionById(sha256(token));
  }
  async deleteSessionById(id, userId = null) {
    const s = J(await this.kv.get(`sess:${id}`));
    if (userId && s && s.userId !== userId) return false;
    await this.kv.del(`sess:${id}`);
    if (s) await this.kv.srem(`user_sess:${s.userId}`, id);
    return true;
  }
  async listSessions(userId) {
    const ids = await this.kv.smembers(`user_sess:${userId}`);
    const raw = await this.kv.mget(ids.map((i) => `sess:${i}`));
    const out = [];
    for (const [i, r] of raw.entries()) {
      const s = J(r);
      if (s) out.push({ id: ids[i], ...s });
      else await this.kv.srem(`user_sess:${userId}`, ids[i]);
    }
    return out.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  // ---------- api keys -------------------------------------------------------
  /**
   * New keys are read-only unless write access is asked for. `scope.categories` limits a key to some categories
   * (empty = all). Keys created before permissions existed have no `access` and keep full access.
   */
  async createKey(userId, { name = "default", ipAllowlist = [], access = "read", scope = null } = {}) {
    const secret = KEY_PREFIX + randomBytes(24).toString("base64url");
    const rec = { id: ulid(), userId, name, hash: sha256(secret), preview: `${secret.slice(0, 8)}…${secret.slice(-4)}`, sealed: this.seal(secret), status: "active", ipAllowlist, access: access === "read_write" ? "read_write" : "read", scope: scope?.categories?.length ? { categories: [...new Set(scope.categories)].slice(0, 50) } : null, createdAt: new Date().toISOString(), lastUsedAt: null };
    await this.kv.set(`key:${rec.hash}`, S(rec));
    await this.kv.set(`key_id:${rec.id}`, rec.hash);
    await this.kv.sadd(`user_keys:${userId}`, rec.id);
    return { secret, rec };
  }
  seedEnvKeys(spec) {
    if (!spec) return;
    for (const part of String(spec).split(",").map((s) => s.trim()).filter(Boolean)) {
      const i = part.indexOf(":");
      // "plan:secret", or "plan+fin_growth:secret" for a server key that also has Apizie Finance.
      const [planSpec, secret] = i > 0 ? [part.slice(0, i), part.slice(i + 1)] : ["free", part];
      const [plan, financePlan = null] = planSpec.split("+");
      if (!PLANS[plan]) throw new Error(`APIZIE_KEYS: unknown plan "${plan}"`);
      if (financePlan && !FINANCE_PLANS[financePlan]) throw new Error(`APIZIE_KEYS: unknown Finance plan "${financePlan}"`);
      if (![KEY_PREFIX, ...LEGACY_KEY_PREFIXES].some((x) => secret.startsWith(x)) || secret.length < 16) throw new Error(`APIZIE_KEYS: keys must start with ${KEY_PREFIX} and be ≥16 chars`);
      const hash = sha256(secret);
      this.envKeys.set(hash, { id: stableId(hash), userId: null, plan, financePlan, name: `env-${plan}`, hash, preview: `${secret.slice(0, 8)}…${secret.slice(-4)}`, status: "active", ipAllowlist: [], createdAt: null });
    }
  }
  async lastWriteAt(keyIds) {
    if (!keyIds.length) return {};
    const vals = await this.kv.mget(keyIds.map((id) => `kwrite:${id}`));
    return Object.fromEntries(keyIds.map((id, i) => [id, vals[i] || null]));
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
    this._unhot(`key:${k.hash}`);
    return next;
  }
  async deleteKey(id) {
    const k = await this.getKeyById(id);
    if (!k) return false;
    await this.kv.del(`key:${k.hash}`);
    this._unhot(`key:${k.hash}`);
    await this.kv.del(`key_id:${id}`);
    await this.kv.srem(`user_keys:${k.userId}`, id);
    return true;
  }
  revealKey(rec) {
    return this.unseal(rec?.sealed);
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
  /** Month and minute counters in one storage round trip: [monthUsed, minuteUsed]. */
  async incrUsage(owner, n, month, window) {
    const [m, w] = await this.kv.batch([["INCRBY", `use:${owner}:${month}`, n], ["INCRBY", `rl:${owner}:${window}`, n, 120]]);
    return [Number(m), Number(w)];
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
    await this.kv.lpush(`logs:${owner}`, S(entry), LOG_CAP);
  }
  logCommand(owner, entry) {
    return ["LPUSH", `logs:${owner}`, S(entry), LOG_CAP];
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
  async removeItem(kind, id, ownerId = null) {
    await this.kv.del(`${kind}:${id}`);
    await this.kv.srem(`${kind}s`, id);
    if (ownerId) await this.kv.srem(`${kind}s:${ownerId}`, id);
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
    return this._hot("scr_off", async () => new Set(await this.kv.smembers("scr_off")));
  }
  async setScraperEnabled(key, enabled) {
    if (enabled) await this.kv.srem("scr_off", key);
    else await this.kv.sadd("scr_off", key);
    this._unhot("scr_off");
  }

  // ---------- admin logo overrides -----------------------------------------
  async iconOverrides() {
    try {
      return JSON.parse((await this.kv.get("scr_icons")) ?? "{}");
    } catch {
      return {};
    }
  }
  async setIconOverride(key, url) {
    const all = await this.iconOverrides();
    if (url) all[key] = url;
    else delete all[key];
    await this.kv.set("scr_icons", JSON.stringify(all));
    return all;
  }

  // ---------- preferences & notifications ------------------------------------
  async getPrefs(userId) {
    return { ...DEFAULT_PREFS, ...(J(await this.kv.get(`prefs:${userId}`)) ?? {}) };
  }
  async setPrefs(userId, patch) {
    const next = { ...(await this.getPrefs(userId)) };
    for (const k of Object.keys(DEFAULT_PREFS)) if (typeof patch?.[k] === "boolean") next[k] = patch[k];
    await this.kv.set(`prefs:${userId}`, S(next));
    return next;
  }
  async addNotification(userId, n) {
    const rec = { id: ulid(), at: new Date().toISOString(), read: false, ...n };
    await this.kv.batch([["LPUSH", `notif:${userId}`, S(rec), 100], ["INCRBY", `notif_unread:${userId}`, 1]]);
    return rec;
  }
  async listNotifications(userId, limit = 30) {
    const [list, unread] = await this.kv.batch([["LRANGE", `notif:${userId}`, 0, limit - 1], ["GET", `notif_unread:${userId}`]]);
    return { items: (list ?? []).map(J), unread: Math.max(0, Number(unread) || 0) };
  }
  async markNotificationsRead(userId) {
    await this.kv.set(`notif_unread:${userId}`, "0");
  }

  // ---------- pay-as-you-go balance (micro-dollars) ------------------------------
  /** Moves a counter written in an older unit to its new key, once, converting the amount. */
  async _migrateLegacy(oldKey, newKey, convert = microsFromLegacyTenths) {
    const old = Number(await this.kv.get(oldKey)) || 0;
    if (!old) return;
    const taken = await this.kv.incrby(oldKey, -old); // only one caller sees the full amount disappear
    if (taken !== 0) {
      await this.kv.incrby(oldKey, old);
      return;
    }
    await this.kv.incrby(newKey, Math.round(convert(old)));
  }
  async getBalance(userId) {
    await this._migrateLegacy(`bal:${userId}`, `balu:${userId}`);
    return Number(await this.kv.get(`balu:${userId}`)) || 0;
  }
  async creditBalance(userId, micros) {
    return this.kv.incrby(`balu:${userId}`, Math.round(micros));
  }
  /**
   * Debit n requests from the balance when the owner opted in. Returns the new balance, or null when not allowed.
   * General requests cost PAYG.priceMicros each; Apizie Finance requests cost FINANCE_PAYG.priceMicros and are
   * counted separately (`paygf:`) so statements can price them.
   */
  async tryPaygDebit(owner, n, { finance = false } = {}) {
    if (!owner || owner.startsWith("key_")) return null;
    const prefs = await this.getPrefs(owner);
    if (!prefs.payg) return null;
    await this._migrateLegacy(`bal:${owner}`, `balu:${owner}`);
    const cost = n * (finance ? FINANCE_PAYG.priceMicros : PAYG.priceMicros);
    const after = await this.kv.incrby(`balu:${owner}`, -cost);
    if (after < 0) {
      await this.kv.incrby(`balu:${owner}`, cost);
      return null;
    }
    await this.kv.incrby(`${finance ? "paygf" : "payg"}:${owner}:${dayKey()}`, n, 120 * 86400);
    return after;
  }
  async refundPayg(owner, n, { finance = false } = {}) {
    await this.kv.batch([["INCRBY", `balu:${owner}`, n * (finance ? FINANCE_PAYG.priceMicros : PAYG.priceMicros)], ["INCRBY", `${finance ? "paygf" : "payg"}:${owner}:${dayKey()}`, -n]]);
  }
  async paygUsage(userId, days = 90) {
    const list = [];
    for (let i = 0; i < days; i++) list.push(dayKey(new Date(Date.now() - i * 86400000)));
    const [vals, fin] = await Promise.all([this.kv.mget(list.map((d) => `payg:${userId}:${d}`)), this.kv.mget(list.map((d) => `paygf:${userId}:${d}`))]);
    return list.map((d, i) => ({ date: d, requests: Number(vals[i]) || 0, financeRequests: Number(fin[i]) || 0 })).filter((x) => x.requests > 0 || x.financeRequests > 0);
  }

  // ---------- webhook deliveries ---------------------------------------------------
  async addDelivery(owner, d) {
    await this.kv.lpush(`whdel:${owner}`, S(d), 100);
  }
  async listDeliveries(owner, limit = 100) {
    return (await this.kv.lrange(`whdel:${owner}`, 0, limit - 1)).map(J);
  }

  // ---------- affiliate --------------------------------------------------------------
  async ensureAffCode(user) {
    if (user.affCode) return user.affCode;
    let code;
    for (let i = 0; i < 5; i++) {
      code = randomBytes(5).toString("base64url").replace(/[-_]/g, "x").slice(0, 7).toLowerCase();
      if (!(await this.kv.get(`aff_code:${code}`))) break;
    }
    await this.kv.set(`aff_code:${code}`, user.id);
    await this.updateUser(user.id, { affCode: code });
    return code;
  }
  async userIdByAffCode(code) {
    return /^[a-z0-9]{4,12}$/.test(String(code ?? "")) ? this.kv.get(`aff_code:${code}`) : null;
  }
  async recordAffClick(userId) {
    await this.kv.incrby(`aff_clicks:${userId}`, 1);
  }
  async addReferral(refUserId, userId) {
    await this.kv.sadd(`aff_refs:${refUserId}`, userId);
  }
  /** Record commission for a paid invoice. Amount in micro-dollars. */
  async addAffEarning(refUserId, entry) {
    await this.kv.batch([["LPUSH", `aff_earn:${refUserId}`, S({ id: ulid(), at: new Date().toISOString(), ...entry }), 500], ["INCRBY", `aff_availu:${refUserId}`, Math.round(entry.amountMicros)], ["INCRBY", `aff_totalu:${refUserId}`, Math.round(entry.amountMicros)]]);
  }
  async affiliateStats(userId) {
    await this._migrateLegacy(`aff_avail:${userId}`, `aff_availu:${userId}`);
    await this._migrateLegacy(`aff_total:${userId}`, `aff_totalu:${userId}`);
    const [clicks, refs, earn, avail, total] = await this.kv.batch([["GET", `aff_clicks:${userId}`], ["SMEMBERS", `aff_refs:${userId}`], ["LRANGE", `aff_earn:${userId}`, 0, 99], ["GET", `aff_availu:${userId}`], ["GET", `aff_totalu:${userId}`]]);
    const earnings = (earn ?? []).map(J).map((e) => (e.amountMicros === undefined && e.amountTenths !== undefined ? { ...e, amountMicros: microsFromLegacyTenths(e.amountTenths) } : e));
    return { clicks: Number(clicks) || 0, referrals: refs ?? [], earnings, availableMicros: Number(avail) || 0, totalMicros: Number(total) || 0 };
  }
  /** Move available affiliate earnings into the PAYG balance. Returns the amount moved (micro-dollars). */
  async moveAffToBalance(userId) {
    await this._migrateLegacy(`aff_avail:${userId}`, `aff_availu:${userId}`);
    const avail = Number(await this.kv.get(`aff_availu:${userId}`)) || 0;
    if (avail <= 0) return 0;
    const left = await this.kv.incrby(`aff_availu:${userId}`, -avail);
    if (left < 0) {
      await this.kv.incrby(`aff_availu:${userId}`, avail);
      return 0;
    }
    await this.creditBalance(userId, avail);
    return avail;
  }
  /** Put an amount (micro-dollars) back into available affiliate earnings, e.g. a rejected payout. */
  async creditAffiliate(userId, micros) {
    await this.kv.incrby(`aff_availu:${userId}`, Math.round(micros));
  }
  async takeAffForPayout(userId, micros) {
    const left = await this.kv.incrby(`aff_availu:${userId}`, -micros);
    if (left < 0) {
      await this.kv.incrby(`aff_availu:${userId}`, micros);
      return false;
    }
    return true;
  }

  // ---------- account deletion ----------------------------------------------------
  async deleteUser(userId) {
    const u = await this.getUser(userId);
    if (!u) return false;
    for (const k of await this.listKeys(userId)) await this.deleteKey(k.id);
    for (const s of await this.listSessions(userId)) await this.deleteSessionById(s.id);
    const cmds = [
      ["DEL", `user:${userId}`], ["SREM", "users", userId], ["DEL", `logs:${userId}`], ["DEL", `hooks:${userId}`], ["DEL", `whdel:${userId}`],
      ["DEL", `prefs:${userId}`], ["DEL", `notif:${userId}`], ["DEL", `notif_unread:${userId}`], ["DEL", `user_keys:${userId}`], ["DEL", `user_sess:${userId}`],
    ];
    if (u.email) cmds.push(["DEL", `user_email:${u.email}`]);
    for (const [prov, pid] of Object.entries(u.providers ?? {})) cmds.push(["DEL", `user_oauth:${prov}:${pid}`]);
    if (u.affCode) cmds.push(["DEL", `aff_code:${u.affCode}`]);
    await this.kv.batch(cmds);
    this._unhot(`user:${userId}`);
    return true;
  }

  // ---------- global ----------------------------------------------------------
  async globalRequests() {
    return Number(await this.kv.get("g:requests")) || 0;
  }
}

export const newId = ulid;
