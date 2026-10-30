// Apizie Finance: a premium add-on next to the general plans. The six official sources and official:* need an
// active Finance plan, use their own quota and overage price, and are bought through the same Dodo checkout.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";
import { FINANCE_PLANS, PLANS, activeFinancePlan } from "../src/core/plans.js";
import { isFinanceKey } from "../src/core/sources.js";

const upstream = [];
const app = createApp({
  quiet: true,
  logger: null,
  kv: new MemoryKV(),
  env: { DODO_PAYMENTS_API_KEY: "test_dodo", DODO_PAYMENTS_PRODUCT_ID: "pdt_test", DODO_PAYMENTS_ENVIRONMENT: "test_mode" },
  supabaseAuth: null,
  apiUrl: "http://api.test",
  publicUrl: "http://p.test",
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  fetch: async (u) => (upstream.push(String(u)), Response.json([{ page: 1, total: 1 }, [{ date: "2024", value: 2.9, indicator: { id: "NY.GDP.MKTP.KD.ZG" }, country: { value: "United States" } }]])),
  dodoFetch: async (url, init) => (init.method === "POST" ? Response.json({ session_id: "cks_" + Math.random().toString(36).slice(2), checkout_url: "https://test.checkout.dodopayments.com/session/x" }) : Response.json({ payment_id: "pay_test", payment_status: "succeeded" })),
});
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
after(() => new Promise((r) => app.server.close(r)));
const base = `http://127.0.0.1:${app.server.address().port}`;
const user = await app.repo.createUser({ email: "fin@example.test", name: "F" });
const cookie = `apz_session=${(await app.repo.createSession(user.id)).token}`;
const me = (path, body, method) => fetch(base + path, { method: method ?? (body ? "POST" : "GET"), headers: { cookie, "content-type": "application/json", "x-zie-csrf": "1" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
const key = (await app.repo.createKey(user.id, { name: "fin" })).secret;
const call = (path) => fetch(base + path, { headers: { "x-api-key": key } });
const FIN = "/v1/finance:worldbank/indicator?country=US";
const usage = async () => (await (await call("/v1/usage")).json()).content;
const days = (n) => new Date(Date.now() + n * 864e5).toISOString();

test("two price schemes: general plans as before, Finance as a premium add-on", () => {
  assert.deepEqual(Object.values(PLANS).map((p) => p.priceUsd), [0, 9, 29, 99]);
  assert.deepEqual(Object.values(FINANCE_PLANS).map((p) => [p.id, p.priceUsd, p.monthly]), [["fin_starter", 49, 100000], ["fin_growth", 199, 1000000], ["fin_business", 499, 5000000]]);
  for (const k of ["finance:sec-edgar", "finance:fred", "finance:ecb", "finance:us-treasury", "finance:gleif", "finance:worldbank", "official:company", "official:macro"]) assert.ok(isFinanceKey(k), k);
  assert.equal(isFinanceKey("finance:coingecko"), false, "other finance APIs stay general");
  assert.equal(activeFinancePlan({ financePlan: "fin_growth", financeExpiresAt: days(-1) }), null, "expired");
  assert.equal(activeFinancePlan({ financePlan: "fin_growth", financeExpiresAt: days(1) }), "fin_growth");
});

test("without Finance the six sources are refused before quota, and never billed", async () => {
  const before = (await usage()).month.used;
  const n = upstream.length;
  const r = await call(FIN);
  const body = await r.json();
  assert.equal(r.status, 403);
  assert.equal(body.error.code, "finance_plan_required");
  assert.match(body.upgrade_url, /\/finance#pricing$/);
  assert.equal(upstream.length, n, "the source is never called");
  assert.equal((await usage()).month.used, before, "not billed");
  assert.equal((await usage()).finance, null);
  // catalog and MCP search label Finance sources
  const item = (await (await fetch(`${base}/api/scrapers/list?q=worldbank&limit=50`)).json()).content.items.find((i) => i.key === "finance:worldbank");
  assert.equal(item?.premium, "finance");
  const mcp = await (await fetch(`${base}/mcp`, { method: "POST", headers: { "x-api-key": key, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_scraper", arguments: { scraper: "official:macro", endpoint: "country", params: { country: "US" } } } }) })).json();
  assert.equal(mcp.result.isError, true);
  assert.match(JSON.stringify(mcp.result.structuredContent), /finance_plan_required|Apizie Finance/);
});

test("buying Finance through checkout keeps the general plan and opens the Finance quota", async () => {
  await app.repo.updateUser(user.id, { plan: "pro", planExpiresAt: days(30) });
  const inv = (await me("/api/me/invoices", { type: "plan", plan: "fin_growth", months: 1 })).json.content;
  assert.equal(inv.amount, 19900, "$199 in cents");
  assert.equal(inv.plan, "fin_growth");
  const paid = (await me(`/api/me/invoices/${inv.id}/sync`, {})).json.content;
  assert.equal(paid.status, "paid");
  const u = await app.repo.getUser(user.id);
  assert.equal(u.plan, "pro", "general plan untouched");
  assert.equal(u.financePlan, "fin_growth");
  const bill = (await me("/api/me/billing")).json.content;
  assert.equal(bill.finance.plan.id, "fin_growth");
  assert.equal(bill.finance.plans.length, 3);
  assert.match(bill.transactions.find((t) => t.id === inv.id).item, /Finance Growth plan/);

  app.repo._unhot?.(`key:${(await app.repo.authKey(key))?.hash}`);
  const generalBefore = (await usage()).month.used;
  const r = await call(FIN);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-ratelimit-limit-month"), "1000000", "Finance quota headers");
  const body = await r.json();
  assert.equal(body.source.official, true);
  const u2 = await usage();
  assert.equal(u2.finance.month.used, 1);
  assert.equal(u2.finance.month.limit, 1000000);
  assert.equal(u2.month.used, generalBefore + 1 - 1, "the usage call itself is free; the Finance call did not touch the general quota");
});

test("Finance overage uses the Finance price from the same balance; general overage keeps $0.40", async () => {
  await app.repo.updateUser(user.id, { financePlan: "fin_starter", financeExpiresAt: days(30) });
  await app.repo.incrMonth(`fin:${user.id}`, FINANCE_PLANS.fin_starter.monthly - (await app.repo.getMonth(`fin:${user.id}`)));
  // over the Finance quota without pay-as-you-go: 429 naming the Finance quota
  const over = await call(FIN.replace("US", "FR"));
  assert.equal(over.status, 429);
  assert.match((await over.json()).message, /Apizie Finance monthly quota exceeded/);
  await app.repo.setPrefs(user.id, { payg: true });
  await app.repo.creditBalance(user.id, 10_000_000);
  const b0 = await app.repo.getBalance(user.id);
  const r = await call(FIN.replace("US", "DE"));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-billing"), "payg");
  assert.equal(b0 - (await app.repo.getBalance(user.id)), 1000, "$1.00 per 1,000 Finance requests");
  const tx = (await me("/api/me/billing")).json.content.transactions;
  assert.ok(tx.some((t) => /Apizie Finance requests over quota/.test(t.item)));
  // a general request over the general quota still costs $0.40 per 1,000
  await app.repo.incrMonth(user.id, PLANS.pro.monthly);
  const b1 = await app.repo.getBalance(user.id);
  assert.equal((await call("/v1/finance:coingecko/simple-price?ids=bitcoin&vsCurrencies=usd")).headers.get("x-billing"), "payg");
  assert.equal(b1 - (await app.repo.getBalance(user.id)), 400);
});

test("an expired Finance plan closes access again; bulk on Finance needs Growth", async () => {
  await app.repo.updateUser(user.id, { financePlan: "fin_starter", financeExpiresAt: days(30), plan: "ultra", planExpiresAt: days(30) });
  const bulk = await fetch(`${base}/v1/finance:worldbank/indicator/bulk`, { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ items: [{ country: "US" }] }) });
  assert.equal(bulk.status, 403);
  assert.match(JSON.stringify(await bulk.json()), /Finance Growth or Business/);
  await app.repo.updateUser(user.id, { financeExpiresAt: days(-1) });
  const r = await call(FIN);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error.code, "finance_plan_required");
});

test("admins grant and remove Finance; the change shows in user views", async () => {
  const admin = await app.repo.createUser({ email: "boss@example.test", name: "B", role: "admin" });
  const ac = `apz_session=${(await app.repo.createSession(admin.id)).token}`;
  const patch = (b) => fetch(`${base}/api/admin/users/${user.id}`, { method: "PATCH", headers: { cookie: ac, "content-type": "application/json", "x-zie-csrf": "1" }, body: JSON.stringify(b) }).then((r) => r.json());
  const granted = await patch({ financePlan: "fin_business", financeDays: 7 });
  assert.equal(granted.content.financePlan, "fin_business");
  assert.ok(Date.parse(granted.content.financeExpiresAt) > Date.now() + 6 * 864e5);
  assert.equal((await patch({ financePlan: "none" })).content.financePlan, null);
});
