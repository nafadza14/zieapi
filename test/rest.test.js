import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./helpers.js";

let t;
before(async () => {
  const fakeFetch = async (url) => {
    if (String(url).includes("frankfurter")) {
      if (String(url).includes("base=XXX")) return new Response("nope", { status: 422 });
      return Response.json({ base: "USD", date: "2026-10-23", rates: { IDR: 16000 } });
    }
    throw new Error("unexpected fetch " + url);
  };
  t = await boot({ fetch: fakeFetch });
});
after(() => t.close());

test("success envelope {project,data,timestamp} + headers", async () => {
  const r = await t.call("/v1/dev-tools:hash/digest?text=halo", { key: t.keys.free });
  assert.equal(r.status, 200);
  assert.equal(r.body.project, "dev-tools:hash");
  assert.match(r.body.data.digest, /^[0-9a-f]{64}$/);
  assert.ok(!Number.isNaN(Date.parse(r.body.timestamp)));
  assert.ok(r.headers.get("x-request-id"));
  assert.ok(r.headers.get("x-response-time"));
  assert.equal(r.headers.get("x-ratelimit-limit"), "100");
  assert.equal(r.headers.get("x-ratelimit-remaining-month"), "599");
});

test("three auth header styles are accepted", async () => {
  for (const h of [{ "x-api-key": t.keys.free }, { "api-key": t.keys.free }, { authorization: `Bearer ${t.keys.free}` }]) {
    const r = await t.call("/v1/dev-tools:uuid/v4", { headers: h });
    assert.equal(r.status, 200, JSON.stringify(h));
  }
});

test("401 missing / invalid key uses {content,message,errors}", async () => {
  const a = await t.call("/v1/dev-tools:uuid/v4");
  assert.equal(a.status, 401);
  assert.deepEqual(Object.keys(a.body).sort(), ["content", "errors", "message"]);
  const b = await t.call("/v1/dev-tools:uuid/v4", { key: "zie_nope" });
  assert.deepEqual(b.body, { content: null, message: "Invalid API key", errors: [] });
});

test("400 invalid params lists paths", async () => {
  const r = await t.call("/v1/dev-tools:hash/digest?algorithm=crc", { key: t.keys.free });
  assert.equal(r.status, 400);
  assert.equal(r.body.message, "Invalid params");
  const paths = r.body.errors.map((e) => e.path).sort();
  assert.deepEqual(paths, ["algorithm", "text"]);
});

test("404 unknown project / endpoint", async () => {
  assert.equal((await t.call("/v1/nope:x/y", { key: t.keys.free })).status, 404);
  assert.equal((await t.call("/v1/dev-tools:hash/nope", { key: t.keys.free })).status, 404);
  assert.equal((await t.call("/v1/no-colon/y", { key: t.keys.free })).status, 404);
});

test("405 wrong verb returns content.expected + Allow", async () => {
  const r = await t.call("/v1/dev-tools:text/stats?text=hi", { key: t.keys.free });
  assert.equal(r.status, 405);
  assert.equal(r.body.content.expected, "POST");
  assert.equal(r.headers.get("allow"), "POST");
});

test("POST endpoint takes JSON body", async () => {
  const r = await t.call("/v1/dev-tools:text/stats", { method: "POST", key: t.keys.free, body: { text: "Halo dunia. Apa kabar?" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.words, 4);
  assert.equal(r.body.data.sentences, 2);
});

test("path template params", async () => {
  const r = await t.call("/v1/dev-tools:text/slugify/" + encodeURIComponent("Halo Dunia Ñandú!"), { key: t.keys.free });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.slug, "halo-dunia-nandu");
});

test("403 plan gate shape", async () => {
  const r = await t.call("/v1/web-tools:page/meta?url=https://example.com", { key: t.keys.free });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "plan_upgrade_required");
  assert.equal(r.body.required_plan, "pro");
  assert.equal(r.body.upgrade_url, "http://zie.test/pricing");
});

test("indonesia:terbilang", async () => {
  const r = await t.call("/v1/indonesia:terbilang/convert?number=1250000&currency=true", { key: t.keys.free });
  assert.equal(r.body.data.text, "satu juta dua ratus lima puluh ribu rupiah");
  assert.equal(r.body.data.formatted, "Rp1.250.000");
  const r2 = await t.call("/v1/indonesia:terbilang/convert?number=111", { key: t.keys.free });
  assert.equal(r2.body.data.text, "seratus sebelas");
});

test("upstream scraper + exec error shape", async () => {
  const ok = await t.call("/v1/finance:fx/convert?amount=2&from=USD&to=IDR", { key: t.keys.free });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.result, 32000);
  const bad = await t.call("/v1/finance:fx/latest?base=XXX", { key: t.keys.free });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.project, "finance:fx");
  assert.equal(bad.body.error, "Upstream returned 422");
  assert.ok(bad.body.timestamp);
});

test("cache: MISS then HIT; ttl=0 bypass only on ultra+", async () => {
  const q = "/v1/indonesia:terbilang/format-rupiah?number=" + Date.now();
  assert.equal((await t.call(q, { key: t.keys.free })).headers.get("x-cache"), "MISS");
  assert.equal((await t.call(q, { key: t.keys.free })).headers.get("x-cache"), "HIT");
  assert.equal((await t.call(q + "&ttl=0", { key: t.keys.free })).headers.get("x-cache"), "HIT"); // free: no cache control
  assert.equal((await t.call(q + "&ttl=0", { key: t.keys.ultra })).headers.get("x-cache"), "BYPASS");
});

test("catalog endpoints mirror the public shapes", async () => {
  const cats = await t.call("/api/public/categories");
  assert.equal(cats.status, 200);
  assert.ok(Array.isArray(cats.body.content));
  assert.deepEqual(Object.keys(cats.body.content[0]).sort(), ["color", "description", "displayName", "iconUrl", "slug"]);

  const list = await t.call("/api/scrapers/list?limit=2");
  assert.equal(list.body.message, "OK");
  assert.equal(list.body.content.items.length, 2);
  assert.equal(list.body.content.nextCursor, "2");
  assert.match(list.headers.get("cache-control"), /stale-while-revalidate=300/);
  const item = list.body.content.items[0];
  for (const k of ["id", "slug", "category", "displayName", "endpointCount", "totalRequests", "maxCacheTtl", "minPlan", "hasBulk", "hasGatedEndpoint"]) assert.ok(k in item, k);
  assert.match(item.id, /^[0-9A-Z]{26}$/);

  const search = await t.call("/api/scrapers/list?q=rupiah&cat=indonesia");
  assert.equal(search.body.content.total, 1);

  const detail = await t.call("/api/scrapers/dev-tools:text");
  const ep = detail.body.content.endpoints.find((e) => e.slug === "slugify");
  assert.equal(ep.pathTemplate, ":text");
  assert.deepEqual(ep.paramsSchema, { text: "string" });

  const schema = await t.call("/api/public/scrapers/text/endpoints/slugify/schema");
  assert.equal(schema.body.content.fields[0].in, "path");

  const stats = await t.call("/api/public/scrapers/hash/stats");
  assert.ok(stats.body.content.requests >= 1);
});

test("openapi + llms.txt are generated from the catalog", async () => {
  const o = await t.call("/openapi.json");
  assert.equal(o.body.openapi, "3.1.0");
  assert.ok(o.body.paths["/v1/dev-tools:text/slugify/{text}"].get);
  assert.equal(o.body.components.securitySchemes.ApiKeyAuth.name, "x-api-key");
  const l = await t.call("/llms.txt");
  assert.match(l.body, /GET \/v1\/indonesia:terbilang\/convert/);
});

test("/v1/me and /v1/usage work with an API key", async () => {
  const me = await t.call("/v1/me", { key: t.keys.pro });
  assert.equal(me.body.content.plan.id, "pro");
  assert.equal(me.body.content.key.hash, undefined);
  const u = await t.call("/v1/usage", { key: t.keys.pro });
  assert.equal(u.body.content.month.limit, 25000);
});

test("CORS preflight", async () => {
  const r = await t.call("/v1/dev-tools:uuid/v4", { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.match(r.headers.get("access-control-allow-headers"), /x-api-key/);
});

test("admin can mint, patch and disable keys", async () => {
  const no = await t.call("/admin/keys", { method: "POST", body: { plan: "pro" } });
  assert.equal(no.status, 401);
  const r = await t.call("/admin/keys", { method: "POST", headers: { authorization: "Bearer admin-secret" }, body: { plan: "pro", name: "x" } });
  assert.equal(r.status, 201);
  assert.match(r.body.content.key, /^zie_/);
  const id = r.body.content.record.id;
  const k = r.body.content.key;
  assert.equal((await t.call("/v1/me", { key: k })).status, 200);
  await t.call(`/admin/keys/${id}`, { method: "PATCH", headers: { authorization: "Bearer admin-secret" }, body: { status: "disabled" } });
  assert.equal((await t.call("/v1/me", { key: k })).status, 401);
});
