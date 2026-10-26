import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { boot } from "./helpers.js";
import { normalizeUrl } from "../src/app.js";

const ULTRA = "zie_vercel_ultra_key_0123456789";
const FREE = "zie_vercel_free_key_0123456789";
let t;
before(async () => (t = await boot({ serverless: true, keys: `ultra:${ULTRA}, free:${FREE}` })));
after(() => t.close());

test("normalizeUrl understands the Vercel rewrite", () => {
  const u = normalizeUrl("/api/zieapi?__path=v1/indonesia:terbilang/convert&number=5");
  assert.equal(u.pathname, "/v1/indonesia:terbilang/convert");
  assert.equal(u.searchParams.get("number"), "5");
  assert.equal(u.searchParams.has("__path"), false);
  assert.equal(normalizeUrl("/v1/x:y/z?a=1").pathname, "/v1/x:y/z");
  assert.equal(normalizeUrl("/api/zieapi?__path=").pathname, "/");
  assert.equal(normalizeUrl("/api/scrapers/list").pathname, "/api/scrapers/list");
});

test("rewritten URL routes correctly end-to-end", async () => {
  const r = await t.call("/api/zieapi?__path=v1/indonesia:terbilang/convert&number=5", { key: FREE });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.text, "lima");
  const cat = await t.call("/api/zieapi?__path=api/scrapers/list&limit=1");
  assert.equal(cat.body.content.items.length, 1);
});

test("ZIE_KEYS seeds stable keys", async () => {
  const me = await t.call("/v1/me", { key: ULTRA });
  assert.equal(me.body.content.plan.id, "ultra");
  assert.match(me.body.content.key.id, /^01[0-9A-Z]{24}$/);
});

test("serverless bulk finishes inside the request", async () => {
  const r = await t.call("/v1/dev-tools:hash/digest/bulk", { method: "POST", key: ULTRA, body: { items: [{ text: "a" }, { text: "b" }] } });
  assert.equal(r.status, 202);
  assert.equal(r.body.status, "COMPLETED");
  assert.equal(r.body.items.length, 2);
});

test("playground HTML at / for browsers and /playground", async () => {
  const html = await t.call("/", { headers: { accept: "text/html,application/xhtml+xml" } });
  assert.match(html.body, /<title>zieapi playground<\/title>/);
  const pg = await t.call("/playground");
  assert.equal(pg.status, 200);
  const api = await t.call("/");
  assert.equal(api.body.content.name, "zieapi");
});

test("pre-parsed req.body (Vercel helpers) is accepted", async () => {
  const req = new PassThrough();
  req.method = "POST";
  req.url = "/api/zieapi?__path=v1/dev-tools:text/stats";
  req.headers = { "x-api-key": FREE, "content-type": "application/json" };
  req.socket = { remoteAddress: "127.0.0.1" };
  req.body = { text: "satu dua tiga" };
  req.end();
  const res = await new Promise((resolve) => {
    const out = { headers: {}, status: 0, body: "" };
    t.app.handler(req, {
      writeHead(s, h) { out.status = s; out.headers = h; },
      end(b) { out.body = b; resolve(out); },
    });
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).data.words, 3);
});

test("bad ZIE_KEYS fail fast", async () => {
  const { createApp } = await import("../src/app.js");
  assert.throws(() => createApp({ logger: null, keys: "gold:zie_aaaaaaaaaaaaaaaa" }), /unknown plan/);
  assert.throws(() => createApp({ logger: null, keys: "free:abc" }), /must start with zie_/);
});
