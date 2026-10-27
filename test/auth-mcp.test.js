// Google sign-in via Supabase Auth, OAuth 2.1 for MCP clients, and the Supabase KV adapter.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../src/app.js";
import { MemoryKV, SupabaseKV, kvFromEnv } from "../src/db/kv.js";
import { redirectAllowed, redirectMatches } from "../src/auth/oauth.js";
import devtools from "../src/scrapers/live/devtools.js";

let app, base;
const sbCalls = [];
before(async () => {
  app = createApp({
    logger: null,
    quiet: true,
    env: { ZIE_ADMIN_EMAILS: "boss@zieads.com" },
    apiUrl: "http://api.test",
    publicUrl: "http://zie.test",
    scrapers: devtools,
    kv: new MemoryKV(),
    supabaseAuth: { url: "https://proj.supabase.test", key: "sb_publishable_x", providers: ["google"] },
    oauthFetch: async (url, init) => {
      sbCalls.push({ url: String(url), init });
      if (String(url).includes("/auth/v1/token?grant_type=pkce")) {
        const b = JSON.parse(init.body);
        if (b.auth_code !== "good-code") return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({ access_token: "sb-at", user: { id: "uuid-1", email: "ghil@example.com", email_confirmed_at: "2026-10-26", user_metadata: { full_name: "Ghil", avatar_url: "https://x/a.png" }, app_metadata: { provider: "google" } } });
      }
      return new Response("{}");
    },
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => new Promise((r) => app.server.close(r)));

const get = (p, headers = {}) => fetch(base + p, { redirect: "manual", headers });

test("Google sign-in through Supabase Auth (PKCE)", async () => {
  const login = await (await get("/login")).text();
  assert.match(login, /Continue with Google/);
  const start = await get("/auth/google?next=/dashboard/keys");
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get("location"));
  assert.equal(to.origin + to.pathname, "https://proj.supabase.test/auth/v1/authorize");
  assert.equal(to.searchParams.get("provider"), "google");
  assert.equal(to.searchParams.get("code_challenge_method"), "s256");
  assert.equal(to.searchParams.get("redirect_to"), "http://zie.test/auth/supabase/callback");
  const cookie = start.headers.get("set-cookie").split(";")[0];

  const bad = await get("/auth/supabase/callback?code=bad", { cookie });
  assert.match(bad.headers.get("location"), /^\/login\?error=/);
  const noCookie = await get("/auth/supabase/callback?code=good-code");
  assert.match(noCookie.headers.get("location"), /expired/i);

  const cb = await get("/auth/supabase/callback?code=good-code", { cookie });
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get("location"), "/dashboard/keys");
  const session = cb.headers.get("set-cookie").split(";")[0];
  // the PKCE verifier we sent must hash to the challenge in the authorize URL
  const ex = sbCalls.find((c) => c.url.includes("grant_type=pkce") && JSON.parse(c.init.body).auth_code === "good-code");
  const verifier = JSON.parse(ex.init.body).code_verifier;
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), to.searchParams.get("code_challenge"));
  assert.equal(ex.init.headers.apikey, "sb_publishable_x");
  const me = await (await get("/api/me", { cookie: session })).json();
  assert.equal(me.content.user.email, "ghil@example.com");
  assert.equal(me.content.user.avatar, "https://x/a.png");

  const err = await get("/auth/supabase/callback?error=access_denied&error_description=User+cancelled", { cookie });
  assert.match(decodeURIComponent(err.headers.get("location")), /User cancelled/);
});

test("Supabase Site URL fallback (/?code=...) still completes the sign-in", async () => {
  const start = await get("/auth/google?next=/dashboard");
  const cookie = start.headers.get("set-cookie").split(";")[0];
  const landed = await get("/?code=good-code", { cookie });
  assert.equal(landed.status, 302);
  assert.equal(landed.headers.get("location"), "/auth/supabase/callback?code=good-code");
  const cb = await get(landed.headers.get("location"), { cookie });
  assert.equal(cb.headers.get("location"), "/dashboard");
  const plain = await get("/?code=whatever");
  assert.notEqual(plain.status, 302, "without the sign-in cookie the home page renders normally");
});

test("public URL with a path is reduced to its origin; a doubled callback path still signs in", async () => {
  const a2 = createApp({ logger: null, quiet: true, env: { ZIE_PUBLIC_URL: "https://x.example/auth/supabase/callback" }, kv: new MemoryKV(), scrapers: [], supabaseAuth: { url: "https://proj.supabase.test", key: "k", providers: ["google"] } });
  assert.equal(a2.publicUrl, "https://x.example");
  const start = await get("/auth/google?next=/dashboard");
  const cookie = start.headers.get("set-cookie").split(";")[0];
  const doubled = await get("/auth/supabase/callback/auth/supabase/callback?code=good-code", { cookie });
  assert.equal(doubled.headers.get("location"), "/auth/supabase/callback?code=good-code");
  const cb = await get(doubled.headers.get("location"), { cookie });
  assert.equal(cb.headers.get("location"), "/dashboard");
});

test("OAuth discovery metadata for MCP clients", async () => {
  const pr = await (await get("/.well-known/oauth-protected-resource/mcp")).json();
  assert.equal(pr.resource, "http://api.test/mcp");
  assert.deepEqual(pr.authorization_servers, ["http://api.test"]);
  const as = await (await get("/.well-known/oauth-authorization-server")).json();
  assert.equal(as.registration_endpoint, "http://api.test/oauth/register");
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  const unauth = await fetch(base + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get("www-authenticate"), /resource_metadata="http:\/\/api\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
});

test("OAuth: register, consent, code + PKCE, token, MCP call, refresh, revoke", async () => {
  // a signed-in user
  const reg = await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json", "x-zie-csrf": "1" }, body: JSON.stringify({ name: "U", email: "u@oauth.io", password: "password1" }) });
  const session = reg.headers.get("set-cookie").split(";")[0];

  const bad = await fetch(base + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }) });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_redirect_uri");
  const client = await (await fetch(base + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }) })).json();
  assert.match(client.client_id, /^zmc_/);

  const verifier = "v".repeat(50);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const qs = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: challenge, code_challenge_method: "S256", state: "st8", scope: "mcp", resource: "http://api.test/mcp" });

  const anon = await get("/oauth/authorize?" + qs);
  assert.match(anon.headers.get("location"), /^\/login\?next=%2Foauth%2Fauthorize/);
  const wrongUri = await get("/oauth/authorize?" + new URLSearchParams({ ...Object.fromEntries(qs), redirect_uri: "https://evil.example/cb" }), { cookie: session });
  assert.equal(wrongUri.status, 400);
  const noPkce = await get("/oauth/authorize?" + new URLSearchParams({ ...Object.fromEntries(qs), code_challenge_method: "plain" }), { cookie: session });
  assert.match(noPkce.headers.get("location"), /^https:\/\/claude\.ai\/.*error=invalid_request/);

  const page = await (await get("/oauth/authorize?" + qs, { cookie: session })).text();
  assert.match(page, /Connect Claude\?/);
  const tx = /name="tx" value="([^"]+)"/.exec(page)[1];
  const form = (decision, c = session) => fetch(base + "/oauth/authorize", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: c }, body: new URLSearchParams({ tx, decision }) });
  const denied = await form("deny");
  assert.match(denied.headers.get("location"), /error=access_denied&.*state=st8/);
  const forged = await fetch(base + "/oauth/authorize", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: session }, body: new URLSearchParams({ tx: tx + "x", decision: "approve" }) });
  assert.equal(forged.status, 400);
  const ok = await form("approve");
  const loc = new URL(ok.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, "https://claude.ai/api/mcp/auth_callback");
  assert.equal(loc.searchParams.get("state"), "st8");
  assert.equal(loc.searchParams.get("iss"), "http://api.test");
  const code = loc.searchParams.get("code");

  const tok = (params) => fetch(base + "/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  assert.equal((await tok({ grant_type: "authorization_code", code, client_id: client.client_id, code_verifier: "wrong", redirect_uri: "https://claude.ai/api/mcp/auth_callback" })).status, 400);
  // code is single-use, so get a fresh one
  const loc2 = new URL((await form("approve")).headers.get("location"));
  const t = await (await tok({ grant_type: "authorization_code", code: loc2.searchParams.get("code"), client_id: client.client_id, code_verifier: verifier, redirect_uri: "https://claude.ai/api/mcp/auth_callback" })).json();
  assert.match(t.access_token, /^zoa_/);
  assert.equal(t.token_type, "Bearer");

  const mcp = (token, body) => fetch(base + "/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
  const init = await (await mcp(t.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })).json();
  assert.equal(init.result.serverInfo.name, "apizie");
  const call = await (await mcp(t.access_token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run_scraper", arguments: { scraper: "dev-tools:uuid", endpoint: "v4" } } })).json();
  assert.equal(call.result.isError, false);
  const logs = await (await get("/api/me/logs", { cookie: session })).json();
  assert.equal(logs.content.items[0].source, "mcp");
  assert.match(logs.content.items[0].key, /^MCP · Claude/);

  const r = await (await tok({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id })).json();
  assert.match(r.access_token, /^zoa_/);
  const apps = await (await get("/api/me/apps", { cookie: session })).json();
  assert.equal(apps.content[0].name, "Claude");
  await fetch(base + `/api/me/apps/${client.client_id}`, { method: "DELETE", headers: { cookie: session, "x-zie-csrf": "1" } });
  assert.equal((await mcp(r.access_token, { jsonrpc: "2.0", id: 3, method: "tools/list" })).status, 401);
});

test("redirect URI rules", () => {
  assert.ok(redirectAllowed("https://claude.ai/api/mcp/auth_callback"));
  assert.ok(redirectAllowed("http://localhost:6274/oauth/callback"));
  assert.ok(redirectAllowed("http://127.0.0.1:33418/"));
  assert.ok(redirectAllowed("cursor://anysphere.cursor-mcp/oauth/callback"));
  assert.ok(!redirectAllowed("http://evil.example/cb"));
  assert.ok(!redirectAllowed("javascript:alert(1)"));
  assert.ok(!redirectAllowed("https://x.io/cb#frag"));
  assert.ok(redirectMatches(["http://127.0.0.1:1234/cb"], "http://127.0.0.1:5555/cb"));
  assert.ok(!redirectMatches(["https://a.io/cb"], "https://a.io/cb2"));
});

test("SupabaseKV wire format and env selection", async () => {
  const sent = [];
  const kv = new SupabaseKV({ url: "https://p.supabase.co/", key: "sb_secret_abc", fetchImpl: async (u, init) => { sent.push({ u, init }); return Response.json(JSON.parse(init.body).cmds.map(() => 7)); } });
  assert.equal(await kv.incrby("c", 2, 60), 7);
  assert.equal(sent[0].u, "https://p.supabase.co/rest/v1/rpc/apizie_kv");
  assert.equal(sent[0].init.headers.apikey, "sb_secret_abc");
  assert.equal(sent[0].init.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(sent[0].init.body), { cmds: [["INCRBY", "c", 2, 60]] });
  assert.ok(kvFromEnv({ SUPABASE_PROJECT_ID: "abc", SUPABASE_SECRET_KEY: "sb_secret_x" }) instanceof SupabaseKV);
  assert.ok(kvFromEnv({ SUPABASE_PROJECT_ID: "abc" }) instanceof MemoryKV, "publishable key alone never stores data");
  const err = new SupabaseKV({ url: "https://p", key: "k", fetchImpl: async () => Response.json({ message: "permission denied" }, { status: 401 }) });
  await assert.rejects(err.get("x"), /permission denied/);
});
