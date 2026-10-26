import { randomBytes } from "node:crypto";
import { E } from "./envelope.js";
import { sha256, ulid } from "./util.js";
import { PLANS } from "./plans.js";

export const KEY_PREFIX = "zie_";

/** Create a new API key. Returns the plaintext ONCE plus the stored record. */
export function createApiKey(store, { name = "default", plan = "free", owner = null, ipAllowlist = [] } = {}) {
  if (!PLANS[plan]) throw new Error(`Unknown plan "${plan}"`);
  const secret = KEY_PREFIX + randomBytes(24).toString("base64url");
  const rec = {
    id: ulid(),
    name,
    owner,
    plan,
    hash: sha256(secret),
    preview: `${secret.slice(0, 8)}…${secret.slice(-4)}`,
    status: "active",
    ipAllowlist,
    createdAt: new Date().toISOString(),
  };
  store.addKey(rec);
  return { key: secret, record: rec };
}

/** Extract a key from x-api-key | api-key | Authorization: Bearer (E03). */
export function extractKey(headers) {
  const direct = headers["x-api-key"] ?? headers["api-key"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const auth = headers.authorization;
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  return null;
}

/** Resolve + authorise the calling key. Throws HttpError on failure. */
export function authenticate(store, req) {
  const raw = extractKey(req.headers);
  if (!raw) throw E.unauthorized("API key required (x-api-key, Authorization: Bearer, or api-key header)");
  const rec = store.keyByHash(sha256(raw));
  if (!rec) throw E.unauthorized("Invalid API key");
  if (rec.status !== "active") throw E.unauthorized("API key disabled");
  if (rec.ipAllowlist?.length) {
    const ip = clientIp(req);
    if (!rec.ipAllowlist.includes(ip)) throw E.forbidden(`IP ${ip} is not allowed for this key`);
  }
  return rec;
}

export function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf) return xf.split(",")[0].trim();
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf;
  return (req.socket?.remoteAddress ?? "").replace(/^::ffff:/, "");
}

export const redactKey = (s) => (typeof s === "string" && s.length > 8 ? `${s.slice(0, 6)}••••` : "••••");
