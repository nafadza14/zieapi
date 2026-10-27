// Authentication: API keys (for /v1 + /mcp), cookie sessions (website/dashboard),
// email+password (scrypt) and OAuth (GitHub, Google, Discord).

import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { E } from "../core/envelope.js";
import { ipAllowed } from "../dashboard/account.js";

export const SESSION_COOKIE = "apz_session";

// ---------- passwords --------------------------------------------------------
const scryptAsync = (pw, salt, len) => new Promise((res, rej) => scrypt(pw, salt, len, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export async function verifyPassword(pw, stored) {
  if (!stored?.startsWith("scrypt$")) return false;
  const [, salt, hash] = stored.split("$");
  const key = await scryptAsync(pw, Buffer.from(salt, "base64url"), 32);
  const want = Buffer.from(hash, "base64url");
  return key.length === want.length && timingSafeEqual(key, want);
}

// ---------- cookies ----------------------------------------------------------
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function cookie(name, value, { maxAge, secure, httpOnly = true, path = "/" } = {}) {
  return [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, httpOnly ? "HttpOnly" : "", "SameSite=Lax", secure ? "Secure" : "", maxAge !== undefined ? `Max-Age=${maxAge}` : ""].filter(Boolean).join("; ");
}

// ---------- API keys ---------------------------------------------------------
export function extractKey(headers) {
  const direct = headers["x-api-key"] ?? headers["api-key"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const m = /^Bearer\s+(.+)$/i.exec(String(headers.authorization ?? "").trim());
  return m ? m[1].trim() : null;
}

export function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf) return xf.split(",")[0].trim();
  const real = req.headers["x-real-ip"] ?? req.headers["cf-connecting-ip"];
  if (typeof real === "string" && real) return real;
  return (req.socket?.remoteAddress ?? "").replace(/^::ffff:/, "");
}

/** Resolve an API-key caller: { owner, plan, keyId, keyPreview, ip, user } or throw 401/403. */
export async function apiKeyCaller(repo, req, oauth = null) {
  const raw = extractKey(req.headers);
  if (!raw) throw E.unauthorized("API key required (x-api-key, Authorization: Bearer, or api-key header)");
  if (raw.startsWith("zoa_")) {
    // OAuth access token issued to an MCP client (see src/auth/oauth.js)
    const rec = oauth ? await repo._hot(`oat:${createHash("sha256").update(raw).digest("hex")}`, () => oauth.resolveAccessToken(raw)) : null;
    if (!rec) throw E.unauthorized("Invalid or expired access token");
    const user = await repo.authUser(rec.userId);
    if (!user || user.status !== "active") throw E.unauthorized("Account disabled");
    return { owner: user.id, plan: repo.effectivePlan(user), keyId: `oauth_${rec.clientId}`, keyPreview: `MCP · ${rec.clientName}`.slice(0, 40), keyName: `MCP · ${rec.clientName}`.slice(0, 40), ip: clientIp(req), user, oauth: true, requestId: req.zieRequestId };
  }
  const key = await repo.authKey(raw);
  if (!key) throw E.unauthorized("Invalid API key");
  if (key.status !== "active") throw E.unauthorized(key.status === "revoked" ? "API key revoked" : "API key disabled");
  const ip = clientIp(req);
  if (!ipAllowed(ip, key.ipAllowlist)) throw E.forbidden(`IP ${ip} is not allowed for this key`);
  let user = null;
  let plan = key.plan ?? "free";
  if (key.userId) {
    user = await repo.authUser(key.userId);
    if (!user || user.status !== "active") throw E.unauthorized("Account disabled");
    plan = repo.effectivePlan(user);
    repo.touchKey(key).catch(() => {});
  }
  return { owner: key.userId ?? `key_${key.id}`, plan, keyId: key.id, keyPreview: key.preview, keyName: key.name, ip, user, requestId: req.zieRequestId };
}

// ---------- OAuth ------------------------------------------------------------
export const PROVIDERS = {
  github: {
    label: "GitHub",
    env: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    async profile(fetchImpl, token) {
      const h = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "apizie" };
      const u = await (await fetchImpl("https://api.github.com/user", { headers: h })).json();
      let email = u.email;
      if (!email) {
        const emails = await (await fetchImpl("https://api.github.com/user/emails", { headers: h })).json();
        email = (Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified) : null)?.email ?? null;
      }
      return { id: String(u.id), email, name: u.name || u.login, avatar: u.avatar_url };
    },
  },
  google: {
    label: "Google",
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    async profile(fetchImpl, token) {
      const u = await (await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token}` } })).json();
      return { id: String(u.sub), email: u.email_verified === false ? null : u.email, name: u.name, avatar: u.picture };
    },
  },
  discord: {
    label: "Discord",
    env: ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"],
    authorize: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    scope: "identify email",
    async profile(fetchImpl, token) {
      const u = await (await fetchImpl("https://discord.com/api/users/@me", { headers: { authorization: `Bearer ${token}` } })).json();
      return { id: String(u.id), email: u.verified ? u.email : null, name: u.global_name || u.username, avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null };
    },
  },
};

export function enabledProviders(env = process.env) {
  return Object.entries(PROVIDERS)
    .filter(([, p]) => p.env.every((k) => env[k]))
    .map(([id, p]) => ({ id, label: p.label }));
}

export function authorizeUrl(id, { redirectUri, state, env = process.env }) {
  const p = PROVIDERS[id];
  const u = new URL(p.authorize);
  u.searchParams.set("client_id", env[p.env[0]]);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", p.scope);
  u.searchParams.set("state", state);
  if (id === "google") u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export async function exchangeCode(id, { code, redirectUri, fetchImpl = globalThis.fetch, env = process.env }) {
  const p = PROVIDERS[id];
  const body = new URLSearchParams({ client_id: env[p.env[0]], client_secret: env[p.env[1]], code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  const res = await fetchImpl(p.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`OAuth token exchange failed (${id}): ${j.error_description ?? j.error ?? res.status}`);
  return p.profile(fetchImpl, j.access_token);
}
