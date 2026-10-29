// The brand domain: production never shows *.vercel.app in links, callbacks, SEO files or code samples,
// and old vercel.app page links move to the same page on apizie.tech.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";

const apps = [];
after(() => Promise.all(apps.map((a) => new Promise((r) => a.server.close(r)))));
async function start(env) {
  const app = createApp({ quiet: true, logger: null, kv: new MemoryKV(), env, supabaseAuth: null });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  apps.push(app);
  return `http://127.0.0.1:${app.server.address().port}`;
}
const get = (base, path, host, extra = {}) => fetch(base + path, { headers: { "x-forwarded-host": host, ...extra }, redirect: "manual" });

test("production on Vercel answers as apizie.tech even when env vars still name the vercel.app host", async () => {
  const base = await start({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "zieapi.vercel.app", APIZIE_API_URL: "https://zieapi.vercel.app", APIZIE_PUBLIC_URL: "https://zieapi.vercel.app/" });
  for (const path of ["/", "/llms.txt", "/llms-full.txt", "/sitemap.xml", "/robots.txt", "/openapi.json", "/pricing", "/mcp", "/docs", "/scrapers"]) {
    const body = await (await get(base, path, "apizie.tech")).text();
    assert.ok(!/vercel\.app/.test(body), `${path} mentions vercel.app`);
  }
  const home = await (await get(base, "/", "apizie.tech")).text();
  assert.match(home, /<link rel="canonical" href="https:\/\/apizie\.tech\/"/);
  assert.match(home, /<meta property="og:image" content="https:\/\/apizie\.tech\/assets\/og\/home\.png\?v=4"/);
  assert.match(await (await get(base, "/robots.txt", "apizie.tech")).text(), /Sitemap: https:\/\/apizie\.tech\/sitemap\.xml/);
  const catalogPage = await (await get(base, "/api/finance/indodax", "apizie.tech")).text();
  assert.ok(catalogPage.includes("https://apizie.tech/v1/finance:indodax/"), "code samples use the brand domain");
});

test("old vercel.app page links redirect to the same page on apizie.tech; API, MCP and callbacks keep working there", async () => {
  const base = await start({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "zieapi.vercel.app" });
  const r = await get(base, "/dashboard?tab=keys", "zieapi.vercel.app");
  assert.equal(r.status, 308);
  assert.equal(r.headers.get("location"), "https://apizie.tech/dashboard?tab=keys");
  assert.equal((await get(base, "/scrapers", "zieapi.vercel.app", { "x-forwarded-host": "zieapi.vercel.app" })).status, 308);
  for (const path of ["/v1/finance:indodax/ticker", "/api/scrapers/list", "/mcp", "/auth/supabase/callback", "/.well-known/oauth-protected-resource", "/webhooks/dodo"]) {
    assert.notEqual((await get(base, path, "zieapi.vercel.app")).status, 308, path);
  }
  assert.equal((await get(base, "/pricing", "apizie.tech")).status, 200);
});

test("preview deployments and local runs keep their own host", async () => {
  const preview = await start({ VERCEL_ENV: "preview", VERCEL_URL: "zieapi-git-dev.vercel.app" });
  assert.equal((await get(preview, "/pricing", "zieapi-git-dev.vercel.app")).status, 200);
  assert.match(await (await get(preview, "/robots.txt", "zieapi-git-dev.vercel.app")).text(), /https:\/\/zieapi-git-dev\.vercel\.app\/sitemap\.xml/);
  const local = await start({});
  assert.equal((await get(local, "/pricing", "localhost")).status, 200);
});
