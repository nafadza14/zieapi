import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler, envKeyName, UpstreamAuthRequired } from "../src/core/connector.js";
import { Catalog } from "../src/core/catalog.js";
import { Executor } from "../src/core/executor.js";
import { MemoryKV } from "../src/db/kv.js";
import { Repo } from "../src/db/repo.js";
import { Limiter } from "../src/core/limits.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const privateLookup = async () => [{ address: "10.0.0.5", family: 4 }];

function recorder(reply = () => Response.json({ ok: true })) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return reply(String(url), init);
  };
  return { calls, fetch };
}

const op = { method: "GET", path: "/items/{id}", fields: [{ name: "id", src: "path" }, { name: "q", src: "query" }, { name: "X-Trace", src: "header" }], body: 0 };

test("connector: keyless GET builds path, query and headers", async () => {
  const { calls, fetch } = recorder();
  const h = makeHandler({ key: "open-data:demo", name: "Demo", base: "https://api.demo-a.test/v1", auth: null }, op);
  const out = await h({ id: "a b", q: "hello", "X-Trace": "t1" }, { fetch, lookup: publicLookup });
  assert.deepEqual(out, { ok: true });
  assert.equal(calls[0].url, "https://api.demo-a.test/v1/items/a%20b?q=hello");
  assert.equal(calls[0].init.headers["x-trace"], "t1");
  assert.equal(calls[0].init.redirect, "manual");
});

test("connector: keyed API asks for upstream key, then sends it where the spec says", async () => {
  const api = { key: "finance:demo-key", name: "DemoKey", base: "https://api.demo-b.test", auth: { t: "key", in: "header", name: "X-Api-Key" } };
  const { calls, fetch } = recorder();
  const h = makeHandler(api, op);
  await assert.rejects(h({ id: "1" }, { fetch, lookup: publicLookup }), (e) => e instanceof UpstreamAuthRequired && e.status === 401 && e.body.error.code === "upstream_key_required");
  await h({ id: "1" }, { fetch, lookup: publicLookup, upstreamAuth: { key: "k123" } });
  assert.equal(calls[0].init.headers["x-api-key"], "k123");

  const q = makeHandler({ ...api, base: "https://api.demo-c.test", auth: { t: "key", in: "query", name: "apikey" } }, op);
  await q({ id: "1" }, { fetch, lookup: publicLookup, upstreamAuth: { key: "k9" } });
  assert.match(calls[1].url, /\?apikey=k9$/);

  const b = makeHandler({ ...api, base: "https://api.demo-d.test", auth: { t: "bearer" } }, op);
  await b({ id: "1" }, { fetch, lookup: publicLookup, upstreamAuth: { key: "tok" } });
  assert.equal(calls[2].init.headers.authorization, "Bearer tok");

  const basic = makeHandler({ ...api, base: "https://api.demo-e.test", auth: { t: "basic" } }, op);
  await basic({ id: "1" }, { fetch, lookup: publicLookup, upstreamAuth: { key: "u:p" } });
  assert.equal(calls[3].init.headers.authorization, "Basic " + btoa("u:p"));
});

test("connector: server env key is used when caller sends none", async () => {
  const api = { key: "finance:env-demo", name: "EnvDemo", base: "https://api.demo-f.test", auth: { t: "key", in: "header", name: "X-Key" } };
  assert.equal(envKeyName(api.key), "ZIE_UPSTREAM_KEY_FINANCE_ENV_DEMO");
  process.env.ZIE_UPSTREAM_KEY_FINANCE_ENV_DEMO = "from-env";
  try {
    const { calls, fetch } = recorder();
    await makeHandler(api, op)({ id: "1" }, { fetch, lookup: publicLookup });
    assert.equal(calls[0].init.headers["x-key"], "from-env");
  } finally {
    delete process.env.ZIE_UPSTREAM_KEY_FINANCE_ENV_DEMO;
  }
});

test("connector: refuses upstream hosts that resolve to private addresses", async () => {
  const { calls, fetch } = recorder();
  const h = makeHandler({ key: "x:y", name: "Private", base: "https://intranet.demo-g.test", auth: null }, op);
  await assert.rejects(h({ id: "1" }, { fetch, lookup: privateLookup }), /private/i);
  assert.equal(calls.length, 0);
});

test("connector: redirects are re-checked and 5xx maps to 502", async () => {
  let n = 0;
  const { calls, fetch } = recorder((url) => (n++ === 0 ? new Response(null, { status: 302, headers: { location: "http://evil.demo-h2.test/x" } }) : Response.json({ ok: 1 })));
  const lookup = async (host) => (String(host).includes("evil") ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]);
  const h = makeHandler({ key: "x:z", name: "Redir", base: "https://api.demo-h.test", auth: null }, op);
  await assert.rejects(h({ id: "1" }, { fetch, lookup }), /private/i);
  assert.equal(calls.length, 1);

  const bad = makeHandler({ key: "x:w", name: "Down", base: "https://api.demo-i.test", auth: null }, op);
  await assert.rejects(bad({ id: "1" }, { fetch: async () => new Response("err", { status: 503 }), lookup: publicLookup }), (e) => e.status === 502);
});

test("directory: thousands of global APIs load lazily into the catalog", () => {
  const c = new Catalog({ live: [], seed: false });
  const t = c.totals();
  assert.ok(t.directoryApis > 1000, `directory has ${t.directoryApis}`);
  assert.ok(t.endpoints > 30000);
  const list = c.list({ origin: "directory", auth: "none", limit: 5 });
  assert.equal(list.items.length, 5);
  assert.ok(list.items.every((i) => !i.auth && i.origin === "directory"));
  const s = c.scrapers.find((x) => x.origin === "directory");
  assert.ok(s.endpoints.length > 0 && typeof s.endpoints[0].handler === "function");
});

test("executor: responses fetched with a caller's key are never shared through the cache", async () => {
  const kv = new MemoryKV();
  const repo = new Repo(kv);
  const catalog = new Catalog({ seed: false, directory: false, live: [{ category: "dev-tools", slug: "byok-demo", displayName: "BYOK", endpoints: [{ slug: "who", cacheTtl: 60, fields: [], handler: (_p, ctx) => ({ who: ctx.upstreamAuth?.key ?? "anon" }) }] }] });
  const ex = new Executor({ catalog, repo, limiter: new Limiter(repo), publicUrl: "http://zie.test" });
  const run = (owner, key) => ex.run({ caller: { owner, plan: "max" }, projectKey: "dev-tools:byok-demo", endpointSlug: "who", method: "GET", upstreamAuth: key ? { key } : null });
  assert.equal((await run("u1", "alice")).body.data.who, "alice");
  assert.equal((await run("u2", "bob")).body.data.who, "bob");
  const anon = await run("u3", null);
  assert.equal(anon.body.data.who, "anon");
  const again = await run("u1", "alice");
  assert.equal(again.headers["X-Cache"], "HIT");
});
