// Minimal persistence layer. In-memory maps with optional JSON-file snapshot.
// Swap this class for a Postgres/Redis implementation in production — the rest
// of the code only uses the methods below.

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { monthKey } from "./util.js";

export class Store {
  constructor({ file = null } = {}) {
    this.file = file;
    this.keys = new Map(); // hash -> ApiKey
    this.usage = new Map(); // `${keyId}:${month}` -> count
    this.stats = new Map(); // `${scraperId}` -> {requests, success}
    this.webhooks = new Map(); // keyId -> [{id,url,secret,events}]
    this.jobs = new Map(); // jobId -> Job (not persisted)
    this.idem = new Map(); // `${keyId}:${idemKey}` -> {fingerprint, jobId}
    this._timer = null;
    if (file && existsSync(file)) this._load();
  }

  // --- api keys -----------------------------------------------------------
  addKey(rec) {
    this.keys.set(rec.hash, rec);
    this._dirty();
    return rec;
  }
  keyByHash(hash) {
    return this.keys.get(hash) ?? null;
  }
  keyById(id) {
    for (const k of this.keys.values()) if (k.id === id) return k;
    return null;
  }
  listKeys() {
    return [...this.keys.values()];
  }
  updateKey(id, patch) {
    const k = this.keyById(id);
    if (!k) return null;
    Object.assign(k, patch);
    this._dirty();
    return k;
  }

  // --- monthly usage ledger ----------------------------------------------
  getUsage(keyId, month = monthKey()) {
    return this.usage.get(`${keyId}:${month}`) ?? 0;
  }
  addUsage(keyId, n = 1, month = monthKey()) {
    const k = `${keyId}:${month}`;
    const v = Math.max(0, (this.usage.get(k) ?? 0) + n);
    this.usage.set(k, v);
    this._dirty();
    return v;
  }

  // --- per-scraper public stats ------------------------------------------
  recordStat(scraperId, success) {
    const s = this.stats.get(scraperId) ?? { requests: 0, success: 0 };
    s.requests++;
    if (success) s.success++;
    this.stats.set(scraperId, s);
    this._dirty();
  }
  getStat(scraperId) {
    return this.stats.get(scraperId) ?? { requests: 0, success: 0 };
  }

  // --- webhooks ------------------------------------------------------------
  setWebhooks(keyId, list) {
    this.webhooks.set(keyId, list);
    this._dirty();
  }
  getWebhooks(keyId) {
    return this.webhooks.get(keyId) ?? [];
  }

  // --- persistence ---------------------------------------------------------
  _dirty() {
    if (!this.file || this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 250);
    this._timer.unref?.();
  }
  flush() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const snap = {
      keys: [...this.keys.values()],
      usage: Object.fromEntries(this.usage),
      stats: Object.fromEntries(this.stats),
      webhooks: Object.fromEntries(this.webhooks),
    };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snap, null, 2));
    renameSync(tmp, this.file);
  }
  _load() {
    const snap = JSON.parse(readFileSync(this.file, "utf8"));
    for (const k of snap.keys ?? []) this.keys.set(k.hash, k);
    for (const [k, v] of Object.entries(snap.usage ?? {})) this.usage.set(k, v);
    for (const [k, v] of Object.entries(snap.stats ?? {})) this.stats.set(k, v);
    for (const [k, v] of Object.entries(snap.webhooks ?? {})) this.webhooks.set(k, v);
  }
}
