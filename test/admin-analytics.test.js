// Super-admin monitoring API: access control, platform totals, top customers, source health, revenue and live feed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";

let app, base, adminCookie, userCookie, cust;
let n = 0;
before(async () => {
  app = createApp({
    quiet: true, logger: null, kv: new MemoryKV(), env: {}, supabaseAuth: null, apiUrl: "http://api.test", publicUrl: "http://zie.test",
    fetch: async () => (++n % 4 === 0 ? new Response("down", { status: 503 }) : Response.json({ query: { searchinfo: { totalhits: 0 }, search: [] } })),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const admin = await app.repo.createUser({ email: "boss@example.test", name: "Boss", role: "admin" });
  cust = await app.repo.createUser({ email: "cust@example.test", name: "Cust" });
  cust = await app.repo.updateUser(cust.id, { plan: "pro", planExpiresAt: new Date(Date.now() + 864e5 * 10).toISOString() });
  adminCookie = `apz_session=${(await app.repo.createSession(admin.id)).token}`;
  userCookie = `apz_session=${(await app.repo.createSession(cust.id)).token}`;
  const key = (await app.repo.createKey(cust.id, { name: "k" })).secret;
  for (let i = 0; i < 8; i++) await fetch(`${base}/v1/search-tools:wikipedia/search?query=a${i}`, { headers: { "x-api-key": key } });
  await app.repo.put("invoice", { id: "INV-1", userId: cust.id, email: cust.email, type: "plan", plan: "pro", months: 1, amount: 165000, status: "paid", createdAt: new Date().toISOString(), paidAt: new Date().toISOString() }, cust.id);
  await app.repo.put("invoice", { id: "INV-2", userId: cust.id, email: cust.email, type: "plan", plan: "pro", months: 1, amount: 165000, status: "awaiting_review", createdAt: new Date().toISOString() }, cust.id);
});
after(() => new Promise((r) => app.server.close(r)));

const get = (p, cookie) => fetch(base + p, { headers: { cookie } });

test("only admins can read platform analytics and the live feed", async () => {
  assert.equal((await get("/api/admin/analytics", userCookie)).status, 403);
  assert.equal((await get("/api/admin/live", userCookie)).status, 403);
  assert.equal((await get("/api/admin/analytics")).status, 401);
});

test("analytics: traffic, customers, revenue, attention and source health", async () => {
  const r = await get("/api/admin/analytics?range=7d&tz=420", adminCookie);
  assert.equal(r.status, 200);
  const o = (await r.json()).content;
  assert.equal(o.traffic.total, 8);
  assert.equal(o.traffic.activeCustomers, 1);
  assert.ok(o.traffic.series.length >= 7);
  assert.equal(o.customers.total, 2);
  assert.equal(o.customers.paying, 1);
  assert.equal(o.customers.byPlan.pro, 1);
  assert.equal(o.customers.top[0].email, "cust@example.test");
  assert.equal(o.customers.top[0].requests, 8);
  assert.equal(o.revenue.inRange, 165000);
  assert.equal(o.revenue.mrrUsd, 9);
  assert.equal(o.attention.invoicesToReview, 1);
  const wiki = o.sources.top.find((s) => s.project === "search-tools:wikipedia");
  assert.equal(wiki.requests, 8);
  assert.equal(wiki.serverErrors, 2, "every 4th upstream call failed with 503");
  assert.equal(o.system.catalog.scrapers, app.catalog.scrapers.length);
});

test("live feed lists the latest calls across customers with their email", async () => {
  const o = (await (await get("/api/admin/live?limit=20", adminCookie)).json()).content;
  assert.equal(o.items.length, 8);
  assert.equal(o.items[0].email, "cust@example.test");
  const errs = (await (await get("/api/admin/live?status=error", adminCookie)).json()).content.items;
  assert.ok(errs.length === 2 && errs.every((x) => x.status >= 500));
});

test("admin pages render for every monitoring section", async () => {
  for (const s of ["", "/traffic", "/live", "/health", "/revenue", "/users"]) {
    const r = await get(`/admin${s}`, adminCookie);
    assert.equal(r.status, 200, s);
    const html = await r.text();
    assert.match(html, /Super admin/);
    assert.match(html, /"logDays":90/, "admins get every range");
  }
});
