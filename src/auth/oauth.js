// OAuth 2.1 authorization server for the MCP endpoint, so MCP clients that only
// speak OAuth (Claude.ai / Claude Desktop custom connectors, ChatGPT connectors,
// Cursor, VS Code, ...) can connect without the user pasting an API key.
//
// Mirrors what zapi.ink exposes (E38): protected-resource metadata, authorization
// server metadata, dynamic client registration, PKCE (S256), authorization_code +
// refresh_token grants, revocation. Also accepts URL-formatted client IDs
// (Client ID Metadata Documents).
//
// Storage (all through the KV layer, so Supabase / Upstash / memory all work):
//   oac:<client_id>                 registered client
//   oacode:<code>                   authorization code (10 min)
//   oat:<sha256(access)>            access token (1 h)
//   oar:<sha256(refresh)>           refresh token (30 d, rotated on use)
//   oagrants:<user>                 set of client ids the user approved
//   oatoks:<user>:<client>          set of token hashes issued for that grant

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "../core/envelope.js";
import { assertPublicUrl } from "../scrapers/ssrf.js";

export const ACCESS_TTL = 3600;
export const REFRESH_TTL = 30 * 86400;
const CODE_TTL = 600;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const b64sha = (s) => createHash("sha256").update(s).digest("base64url");
const rand = (n = 32) => randomBytes(n).toString("base64url");

export class OAuthError extends HttpError {
  constructor(status, error, description) {
    super(status, { error, error_description: description });
  }
}

export function isLoopback(u) {
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

/** A redirect URI a client may register. */
export function redirectAllowed(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return isLoopback(u);
  // native-app custom schemes (cursor://, vscode://, ...)
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !["javascript:", "data:", "file:", "vbscript:", "about:", "blob:"].includes(u.protocol);
}

/** Does `given` match one of the registered redirect URIs? Loopback ports may differ (RFC 8252 §7.3). */
export function redirectMatches(registered, given) {
  let g;
  try {
    g = new URL(given);
  } catch {
    return false;
  }
  return registered.some((r) => {
    if (r === given) return true;
    try {
      const x = new URL(r);
      return isLoopback(x) && isLoopback(g) && x.hostname === g.hostname && x.pathname === g.pathname && x.search === g.search;
    } catch {
      return false;
    }
  });
}

export function createOAuth({ repo, apiUrl, publicUrl, fetchImpl = globalThis.fetch, lookup = null }) {
  const kv = repo.kv;
  const issuer = apiUrl;
  const resource = `${apiUrl}/mcp`;
  const getJson = async (k) => {
    const v = await kv.get(k);
    return v ? JSON.parse(v) : null;
  };

  const metadata = {
    protectedResource: () => ({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ["mcp", "offline_access"],
      bearer_methods_supported: ["header"],
      resource_name: "Apizie MCP",
      resource_documentation: `${publicUrl}/mcp`,
    }),
    authorizationServer: () => ({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      scopes_supported: ["mcp", "offline_access"],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
      service_documentation: `${publicUrl}/mcp`,
    }),
  };

  // ---------- clients -----------------------------------------------------------
  async function register(body) {
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10) throw new OAuthError(400, "invalid_redirect_uri", "redirect_uris must list 1-10 URIs");
    const bad = uris.find((u) => !redirectAllowed(u));
    if (bad) throw new OAuthError(400, "invalid_redirect_uri", `Redirect URI not allowed: ${bad}`);
    const method = body?.token_endpoint_auth_method ?? "none";
    if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) throw new OAuthError(400, "invalid_client_metadata", "Unsupported token_endpoint_auth_method");
    const grants = Array.isArray(body?.grant_types) ? body.grant_types : ["authorization_code", "refresh_token"];
    if (grants.some((g) => !["authorization_code", "refresh_token"].includes(g))) throw new OAuthError(400, "invalid_client_metadata", "Unsupported grant_types");
    const client = {
      client_id: "zmc_" + rand(18),
      client_name: String(body?.client_name ?? "MCP client").slice(0, 80),
      client_uri: typeof body?.client_uri === "string" && /^https:\/\//.test(body.client_uri) ? body.client_uri.slice(0, 300) : undefined,
      redirect_uris: uris,
      grant_types: grants,
      response_types: ["code"],
      token_endpoint_auth_method: method,
      scope: "mcp offline_access",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    let secret;
    if (method !== "none") {
      secret = "zms_" + rand(32);
      client.secretHash = sha(secret);
    }
    await kv.set(`oac:${client.client_id}`, JSON.stringify(client));
    const { secretHash, ...pub } = client;
    return { ...pub, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}) };
  }

  async function getClient(clientId) {
    if (!clientId) return null;
    if (/^https:\/\//.test(clientId)) return metadataDocumentClient(clientId);
    return getJson(`oac:${clientId}`);
  }

  // Client ID Metadata Document: the client_id is an https URL serving its own metadata.
  async function metadataDocumentClient(url) {
    const cached = await getJson(`oacm:${sha(url)}`);
    if (cached) return cached;
    try {
      await assertPublicUrl(url, lookup ?? undefined);
      const res = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const doc = await res.json();
      if (doc.client_id !== url || !Array.isArray(doc.redirect_uris) || !doc.redirect_uris.every(redirectAllowed)) return null;
      const client = { client_id: url, client_name: String(doc.client_name ?? new URL(url).host).slice(0, 80), redirect_uris: doc.redirect_uris.map(String), token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] };
      await kv.set(`oacm:${sha(url)}`, JSON.stringify(client), { ex: 3600 });
      return client;
    } catch {
      return null;
    }
  }

  function clientAuth(client, req, body) {
    if (!client) throw new OAuthError(401, "invalid_client", "Unknown client");
    if (client.token_endpoint_auth_method === "none") return;
    let secret = body?.client_secret;
    const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization ?? ""));
    if (basic) {
      const [, s] = Buffer.from(basic[1], "base64").toString().split(":");
      secret = decodeURIComponent(s ?? "");
    }
    const a = Buffer.from(sha(String(secret ?? "")));
    const b = Buffer.from(client.secretHash ?? "");
    if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) throw new OAuthError(401, "invalid_client", "Client authentication failed");
  }

  // ---------- authorize ---------------------------------------------------------
  /** Validate an /oauth/authorize request. Returns {client, params} or {fatal} (shown, never redirected). */
  async function validateAuthorize(q) {
    const client = await getClient(q.client_id);
    if (!client) return { fatal: "Unknown client_id. The app must register first (dynamic client registration)." };
    if (!q.redirect_uri || !redirectMatches(client.redirect_uris, q.redirect_uri)) return { fatal: "redirect_uri does not match what this app registered." };
    const err = (error, desc) => ({ client, redirect: errorRedirect(q.redirect_uri, error, desc, q.state) });
    if (q.response_type !== "code") return err("unsupported_response_type", "Only response_type=code is supported");
    if (!q.code_challenge || (q.code_challenge_method ?? "plain") !== "S256") return err("invalid_request", "PKCE with code_challenge_method=S256 is required");
    if (q.resource && q.resource.replace(/\/+$/, "") !== resource && q.resource.replace(/\/+$/, "") !== issuer) return err("invalid_target", `Unknown resource ${q.resource}`);
    const scope = String(q.scope ?? "mcp").split(/\s+/).filter((s) => ["mcp", "offline_access"].includes(s)).join(" ") || "mcp";
    return { client, params: { client_id: client.client_id, redirect_uri: q.redirect_uri, code_challenge: q.code_challenge, state: q.state ?? null, scope, resource } };
  }

  function errorRedirect(redirectUri, error, description, state) {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    if (description) u.searchParams.set("error_description", description);
    if (state) u.searchParams.set("state", state);
    u.searchParams.set("iss", issuer);
    return u.toString();
  }

  async function approve(user, params) {
    const code = "zac_" + rand(24);
    await kv.set(`oacode:${code}`, JSON.stringify({ ...params, userId: user.id, at: Date.now() }), { ex: CODE_TTL });
    await kv.sadd(`oagrants:${user.id}`, params.client_id);
    const u = new URL(params.redirect_uri);
    u.searchParams.set("code", code);
    if (params.state) u.searchParams.set("state", params.state);
    u.searchParams.set("iss", issuer);
    return u.toString();
  }

  function deny(params) {
    return errorRedirect(params.redirect_uri, "access_denied", "The user denied the request", params.state);
  }

  // ---------- tokens --------------------------------------------------------------
  async function issue(userId, client, scope) {
    const access = "zoa_" + rand(32);
    const refresh = "zor_" + rand(32);
    const rec = { userId, clientId: client.client_id, clientName: client.client_name, scope, at: Date.now() };
    const ah = sha(access);
    const rh = sha(refresh);
    await kv.set(`oat:${ah}`, JSON.stringify(rec), { ex: ACCESS_TTL });
    await kv.set(`oar:${rh}`, JSON.stringify(rec), { ex: REFRESH_TTL });
    await kv.sadd(`oatoks:${userId}:${client.client_id}`, `oat:${ah}`);
    await kv.sadd(`oatoks:${userId}:${client.client_id}`, `oar:${rh}`);
    await kv.sadd(`oagrants:${userId}`, client.client_id);
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope };
  }

  async function token(req, body) {
    const grant = body?.grant_type;
    let clientId = body?.client_id;
    const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization ?? ""));
    if (!clientId && basic) clientId = decodeURIComponent(Buffer.from(basic[1], "base64").toString().split(":")[0]);
    const client = await getClient(clientId);
    clientAuth(client, req, body);

    if (grant === "authorization_code") {
      const rec = await getJson(`oacode:${body.code}`);
      if (rec) await kv.del(`oacode:${body.code}`); // single use
      if (!rec || rec.client_id !== client.client_id) throw new OAuthError(400, "invalid_grant", "Invalid or expired code");
      if (body.redirect_uri && body.redirect_uri !== rec.redirect_uri) throw new OAuthError(400, "invalid_grant", "redirect_uri mismatch");
      if (!body.code_verifier || b64sha(String(body.code_verifier)) !== rec.code_challenge) throw new OAuthError(400, "invalid_grant", "PKCE verification failed");
      const user = await repo.getUser(rec.userId);
      if (!user || user.status !== "active") throw new OAuthError(400, "invalid_grant", "Account disabled");
      return issue(user.id, client, rec.scope);
    }
    if (grant === "refresh_token") {
      const key = `oar:${sha(String(body.refresh_token ?? ""))}`;
      const rec = await getJson(key);
      if (!rec || rec.clientId !== client.client_id) throw new OAuthError(400, "invalid_grant", "Invalid refresh token");
      await kv.del(key); // rotate
      const user = await repo.getUser(rec.userId);
      if (!user || user.status !== "active") throw new OAuthError(400, "invalid_grant", "Account disabled");
      return issue(user.id, client, rec.scope);
    }
    throw new OAuthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token");
  }

  async function revoke(req, body) {
    const t = String(body?.token ?? "");
    for (const k of [`oat:${sha(t)}`, `oar:${sha(t)}`]) await kv.del(k);
    return {};
  }

  /** Resolve a bearer access token to {userId, clientId, clientName, scope} or null. */
  async function resolveAccessToken(raw) {
    if (!raw?.startsWith("zoa_")) return null;
    return getJson(`oat:${sha(raw)}`);
  }

  async function listGrants(userId) {
    const ids = await kv.smembers(`oagrants:${userId}`);
    const out = [];
    for (const id of ids) {
      const c = await getClient(id);
      const toks = await kv.smembers(`oatoks:${userId}:${id}`);
      out.push({ clientId: id, name: c?.client_name ?? id, redirect: c?.redirect_uris?.[0] ?? null, tokens: toks.length });
    }
    return out;
  }

  async function revokeGrant(userId, clientId) {
    const toks = await kv.smembers(`oatoks:${userId}:${clientId}`);
    for (const k of toks) await kv.del(k);
    await kv.del(`oatoks:${userId}:${clientId}`);
    await kv.srem(`oagrants:${userId}`, clientId);
  }

  const wwwAuthenticate = (extra = "") => `Bearer realm="apizie", resource_metadata="${apiUrl}/.well-known/oauth-protected-resource/mcp", scope="mcp"${extra}`;

  return { metadata, register, getClient, validateAuthorize, approve, deny, token, revoke, resolveAccessToken, listGrants, revokeGrant, wwwAuthenticate, issuer, resource };
}

/** Body for an OAuth error HttpError (RFC 6749 shape), used by the router. */
export function oauthErrorBody(e) {
  if (e instanceof OAuthError) return e.body;
  if (e instanceof HttpError) return { error: "invalid_request", error_description: e.body?.message ?? "Bad request" };
  return { error: "server_error", error_description: "Internal error" };
}

