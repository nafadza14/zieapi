// Google sign-in through Supabase Auth (PKCE flow, no SDK).
//
//   /auth/google -> https://<project>.supabase.co/auth/v1/authorize?provider=google&code_challenge=...
//   Google -> Supabase -> /auth/supabase/callback?code=...
//   server: POST /auth/v1/token?grant_type=pkce {auth_code, code_verifier} -> Supabase user
//
// Only the publishable key is needed for this; it is public by design.

import { createHash, randomBytes } from "node:crypto";
import { supabaseUrl } from "../db/kv.js";

// Defaults for the Apizie Supabase project (public values). Override with env.
export const SUPABASE_DEFAULTS = {
  projectId: "hfscpcwrntvdslxwddjy",
  publishableKey: "sb_publishable_uHZn89sA8wCHmyIh5vYqZA_SYXo1BZ8",
};

export function supabaseAuthConfig(env = process.env) {
  if (env.ZIE_SUPABASE_AUTH === "off") return null;
  const url = supabaseUrl(env) ?? `https://${SUPABASE_DEFAULTS.projectId}.supabase.co`;
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_DEFAULTS.publishableKey;
  const providers = String(env.SUPABASE_AUTH_PROVIDERS ?? "google").split(",").map((s) => s.trim()).filter(Boolean);
  return { url, key, providers };
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function supabaseAuthorizeUrl(cfg, { provider, redirectTo, challenge }) {
  const u = new URL(cfg.url + "/auth/v1/authorize");
  u.searchParams.set("provider", provider);
  u.searchParams.set("redirect_to", redirectTo);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "s256");
  if (provider === "google") u.searchParams.set("prompt", "select_account");
  return u.toString();
}

/** Exchange the auth code; returns a normalised profile. Throws on failure. */
export async function supabaseExchange(cfg, { code, verifier, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(cfg.url + "/auth/v1/token?grant_type=pkce", {
    method: "POST",
    headers: { apikey: cfg.key, "content-type": "application/json" },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.user) throw new Error(`Supabase token exchange failed: ${j.error_description ?? j.msg ?? j.message ?? res.status}`);
  const u = j.user;
  const meta = u.user_metadata ?? {};
  // Revoke the Supabase session right away: Apizie keeps its own session cookie.
  if (j.access_token) fetchImpl(cfg.url + "/auth/v1/logout", { method: "POST", headers: { apikey: cfg.key, authorization: `Bearer ${j.access_token}` } }).catch(() => {});
  return {
    id: String(u.id),
    email: u.email ?? meta.email ?? null,
    emailVerified: !!(u.email_confirmed_at ?? meta.email_verified),
    name: meta.full_name ?? meta.name ?? (u.email ? u.email.split("@")[0] : "User"),
    avatar: meta.avatar_url ?? meta.picture ?? null,
    provider: u.app_metadata?.provider ?? "google",
  };
}
