// GitHub sign-in: direct GitHub OAuth App flow, GitHub through Supabase Auth, and the /admin/setup check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";
import { setupReport } from "../src/dashboard/setup.js";

async function start(opts) {
  const app = createApp({ logger: null, quiet: true, apiUrl: "http://api.test", publicUrl: "http://zie.test", scrapers: [], kv: new MemoryKV(), ...opts });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, get: (p, headers = {}) => fetch(base + p, { redirect: "manual", headers }), close: () => new Promise((r) => app.server.close(r)) };
}

test("GitHub OAuth App: button, authorize, callback, private email, existing account linked", async () => {
  const calls = [];
  const { get, close } = await start({
    env: { GITHUB_CLIENT_ID: "gh-id", GITHUB_CLIENT_SECRET: "gh-secret" },
    supabaseAuth: null,
    oauthFetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === "https://github.com/login/oauth/access_token") {
        const b = new URLSearchParams(String(init.body));
        if (b.get("code") !== "good") return Response.json({ error: "bad_verification_code", error_description: "The code is incorrect" });
        assert.equal(b.get("client_secret"), "gh-secret");
        assert.equal(b.get("redirect_uri"), "http://zie.test/auth/github/callback");
        return Response.json({ access_token: "gho_x", token_type: "bearer" });
      }
      if (String(url) === "https://api.github.com/user") return Response.json({ id: 42, login: "octo", name: null, email: null, avatar_url: "https://avatars.test/42" });
      if (String(url) === "https://api.github.com/user/emails") return Response.json([{ email: "old@x.test", primary: false, verified: false }, { email: "octo@x.test", primary: true, verified: true }]);
      return new Response("{}", { status: 404 });
    },
  });
  try {
    assert.match(await (await get("/login")).text(), /Continue with GitHub/);
    assert.match(await (await get("/register")).text(), /Continue with GitHub/);

    const s = await get("/auth/github?next=/dashboard/keys");
    assert.equal(s.status, 302);
    const to = new URL(s.headers.get("location"));
    assert.equal(to.origin + to.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(to.searchParams.get("client_id"), "gh-id");
    assert.equal(to.searchParams.get("scope"), "read:user user:email");
    assert.ok(!to.toString().includes("gh-secret"), "secret never leaves the server");
    const cookie = s.headers.get("set-cookie").split(";")[0];
    const state = to.searchParams.get("state");

    const forged = await get(`/auth/github/callback?code=good&state=nope`, { cookie });
    assert.match(decodeURIComponent(forged.headers.get("location")), /expired/);
    const bad = await get(`/auth/github/callback?code=bad&state=${state}`, { cookie });
    assert.match(decodeURIComponent(bad.headers.get("location")), /GitHub sign-in failed/);

    const ok = await get(`/auth/github/callback?code=good&state=${state}`, { cookie });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get("location"), "/dashboard/keys");
    const session = ok.headers.get("set-cookie").split(";")[0];
    const me = (await (await get("/api/me", { cookie: session })).json()).content.user;
    assert.equal(me.email, "octo@x.test");
    assert.equal(me.name, "octo");
    assert.equal(me.avatar, "https://avatars.test/42");

    // second sign-in finds the same account by GitHub id
    const s2 = await get("/auth/github");
    const st2 = new URL(s2.headers.get("location")).searchParams.get("state");
    const ok2 = await get(`/auth/github/callback?code=good&state=${st2}`, { cookie: s2.headers.get("set-cookie").split(";")[0] });
    const me2 = (await (await get("/api/me", { cookie: ok2.headers.get("set-cookie").split(";")[0] })).json()).content.user;
    assert.equal(me2.id, me.id);
  } finally {
    await close();
  }
});

test("GitHub through Supabase Auth when listed in SUPABASE_AUTH_PROVIDERS", async () => {
  const { get, close } = await start({
    env: {},
    supabaseAuth: { url: "https://proj.supabase.test", key: "sb_publishable_x", providers: ["google", "github"] },
    oauthFetch: async (url) => (String(url).includes("grant_type=pkce") ? Response.json({ error: "invalid_grant" }, { status: 400 }) : new Response("{}")),
  });
  try {
    const login = await (await get("/login")).text();
    assert.match(login, /Continue with Google/);
    assert.match(login, /Continue with GitHub/);
    const s = await get("/auth/github");
    const to = new URL(s.headers.get("location"));
    assert.equal(to.searchParams.get("provider"), "github");
    const fail = await get("/auth/supabase/callback?code=x", { cookie: s.headers.get("set-cookie").split(";")[0] });
    assert.match(decodeURIComponent(fail.headers.get("location")), /GitHub sign-in failed/);
  } finally {
    await close();
  }
});

test("no GitHub button when nothing is configured; setup explains how", async () => {
  const { get, close } = await start({ env: {}, supabaseAuth: null });
  try {
    assert.doesNotMatch(await (await get("/login")).text(), /Continue with GitHub/);
    assert.match(decodeURIComponent((await get("/auth/github")).headers.get("location")), /GitHub sign-in is not configured/);
  } finally {
    await close();
  }
  const base = { kv: null, storage: { backend: "SupabaseKV" }, publicUrl: "https://apizie.vercel.app", stableSecret: "x", bankConfigured: true };
  const kv = { batch: async () => ["PONG"] };
  const r1 = await setupReport({ ...base, kv, env: {}, sbAuth: null, fetchImpl: fetch });
  const gh1 = r1.checks.find((c) => c.id === "github");
  assert.equal(gh1.status, "warn");
  assert.match(gh1.fix, /https:\/\/apizie\.vercel\.app\/auth\/github\/callback/);
  const r2 = await setupReport({ ...base, kv, env: { GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b" }, sbAuth: null, fetchImpl: fetch });
  assert.equal(r2.checks.find((c) => c.id === "github").status, "ok");
  const sbFetch = async () => Response.json({ external: { google: true, github: false } });
  const r3 = await setupReport({ ...base, kv, env: {}, sbAuth: { url: "https://p", key: "k", providers: ["google", "github"] }, fetchImpl: sbFetch });
  assert.equal(r3.checks.find((c) => c.id === "github").status, "fail");
});
