// Card payments through Dodo Payments: checkout creation, signed webhooks, return-page check and safety rules.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";
import { verifyDodoWebhook, signDodoWebhook } from "../src/billing/dodo.js";

const SECRET = "whsec_" + randomBytes(24).toString("base64");
const env = { DODO_PAYMENTS_API_KEY: "test_key_not_real", DODO_PAYMENTS_PRODUCT_ID: "pdt_pwyw", DODO_PAYMENTS_WEBHOOK_SECRET: SECRET, DODO_PAYMENTS_ENVIRONMENT: "test_mode" };
const calls = [];
let checkoutState = { payment_id: null, payment_status: null };
const dodoFetch = async (url, init) => {
  calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
  if (init.method === "POST" && /\/checkouts$/.test(url)) return Response.json({ session_id: `cks_${calls.length}`, checkout_url: `https://test.checkout.dodopayments.com/session/cks_${calls.length}` });
  if (init.method === "GET" && /\/checkouts\//.test(url)) return Response.json(checkoutState);
  return new Response("not found", { status: 404 });
};

let app, base, cookie, user;
before(async () => {
  app = createApp({ quiet: true, logger: null, kv: new MemoryKV(), env, supabaseAuth: null, apiUrl: "http://api.test", publicUrl: "https://apizie.test", dodoFetch });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  user = await app.repo.createUser({ email: "buyer@example.test", name: "Buyer" });
  cookie = `apz_session=${(await app.repo.createSession(user.id)).token}`;
});
after(() => new Promise((r) => app.server.close(r)));

const me = (path, body) => fetch(base + path, { method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json", "x-zie-csrf": "1" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
function hook(payload, { secret = SECRET, id = "msg_" + randomBytes(6).toString("hex"), ts = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(payload);
  return fetch(`${base}/webhooks/dodo`, { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": signDodoWebhook({ secret, id, timestamp: ts, rawBody: raw }) }, body: raw });
}

test("Standard Webhooks signature: valid, tampered, wrong secret, stale", () => {
  const raw = '{"type":"payment.succeeded"}';
  const ts = Math.floor(Date.now() / 1000);
  const headers = { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": "v0,xxx " + signDodoWebhook({ secret: SECRET, id: "msg_1", timestamp: ts, rawBody: raw }) };
  assert.equal(verifyDodoWebhook({ secret: SECRET, headers, rawBody: raw }).ok, true);
  assert.equal(verifyDodoWebhook({ secret: SECRET, headers, rawBody: raw.replace("succeeded", "failed") }).ok, false);
  assert.equal(verifyDodoWebhook({ secret: "whsec_" + randomBytes(24).toString("base64"), headers, rawBody: raw }).ok, false);
  assert.equal(verifyDodoWebhook({ secret: SECRET, headers, rawBody: raw, now: (ts + 3600) * 1000 }).ok, false);
  assert.equal(verifyDodoWebhook({ secret: null, headers, rawBody: raw }).ok, false);
});

test("card invoice opens a Dodo checkout with the invoice amount in US cents; the key is sent only to Dodo", async () => {
  const billing = (await me("/api/me/billing")).json.content;
  assert.equal(billing.cardEnabled, true);
  const r = await me("/api/me/invoices", { type: "plan", plan: "pro", months: 12, method: "card" });
  assert.equal(r.status, 201);
  const inv = r.json.content;
  assert.equal(inv.currency, "USD");
  assert.equal(inv.amount, 9000, "12 months are billed as 10 x $9");
  assert.match(inv.checkoutUrl, /^https:\/\/test\.checkout\.dodopayments\.com\//);
  const c = calls.at(-1);
  assert.equal(c.url, "https://test.dodopayments.com/checkouts");
  assert.equal(c.init.headers.authorization, "Bearer test_key_not_real");
  assert.deepEqual(c.body.product_cart, [{ product_id: "pdt_pwyw", quantity: 1, amount: 9000 }]);
  assert.equal(c.body.metadata.invoice_id, inv.id);
  assert.equal(c.body.customer.email, "buyer@example.test");
  assert.equal(c.body.return_url, `https://apizie.test/dashboard/billing?invoice=${inv.id}&checkout=done`);
  assert.ok(!JSON.stringify(r.json).includes("test_key_not_real"));
  // card invoices cannot be "confirmed" by hand like bank transfers
  assert.equal((await me(`/api/me/invoices/${inv.id}/confirm`, { reference: "x" })).status, 400);
});

test("webhook: bad signature is refused; a matching payment activates the plan once", async () => {
  const inv = (await me("/api/me/invoices", { type: "plan", plan: "ultra", months: 1, method: "card" })).json.content;
  const event = { business_id: "bus_1", type: "payment.succeeded", timestamp: new Date().toISOString(), data: { payment_id: "pay_1", total_amount: 2900, currency: "USD", status: "succeeded", metadata: { invoice_id: inv.id, user_id: user.id } } };
  assert.equal((await hook(event, { secret: "whsec_" + randomBytes(24).toString("base64") })).status, 401);
  assert.equal((await app.repo.getItem("invoice", inv.id)).status, "pending");

  const id = "msg_once";
  assert.equal((await hook(event, { id })).status, 200);
  const paid = await app.repo.getItem("invoice", inv.id);
  assert.equal(paid.status, "paid");
  assert.equal(paid.paidVia, "dodo");
  assert.equal(paid.paymentId, "pay_1");
  const u = await app.repo.getUser(user.id);
  assert.equal(u.plan, "ultra");
  const until = u.planExpiresAt;
  // replays (same webhook id) and a second delivery (new id) change nothing
  assert.equal((await (await hook(event, { id })).json()).content.duplicate, true);
  await hook(event);
  assert.equal((await app.repo.getUser(user.id)).planExpiresAt, until);
});

test("webhook: wrong amount, currency or customer never activates anything", async () => {
  const inv = (await me("/api/me/invoices", { type: "plan", plan: "max", months: 1, method: "card" })).json.content;
  const base = { type: "payment.succeeded", data: { payment_id: "pay_x", total_amount: 9900, currency: "USD", metadata: { invoice_id: inv.id, user_id: user.id } } };
  await hook({ ...base, data: { ...base.data, total_amount: 100 } });
  await hook({ ...base, data: { ...base.data, currency: "EUR" } });
  await hook({ ...base, data: { ...base.data, metadata: { invoice_id: inv.id, user_id: "someone-else" } } });
  const after = await app.repo.getItem("invoice", inv.id);
  assert.equal(after.status, "pending");
  assert.equal(after.lastPaymentStatus, "mismatch");
  assert.notEqual((await app.repo.getUser(user.id)).plan, "max");
});

test("return page: the server asks Dodo and credits a card top-up even before the webhook", async () => {
  const inv = (await me("/api/me/invoices", { type: "topup", usd: 25, method: "card" })).json.content;
  assert.equal(inv.amount, 2500, "top-up billed in US cents");
  checkoutState = { payment_id: null, payment_status: null };
  assert.equal((await me(`/api/me/invoices/${inv.id}/sync`, {})).json.content.status, "pending");
  const before = await app.repo.getBalance(user.id);
  checkoutState = { payment_id: "pay_t", payment_status: "succeeded" };
  assert.equal((await me(`/api/me/invoices/${inv.id}/sync`, {})).json.content.status, "paid");
  assert.equal((await app.repo.getBalance(user.id)) - before, 25_000_000, "$25 credited (in micro-dollars)");
  // the late webhook is a no-op
  await hook({ type: "payment.succeeded", data: { payment_id: "pay_t", total_amount: inv.amount, currency: "USD", metadata: { invoice_id: inv.id, user_id: user.id } } });
  assert.equal((await app.repo.getBalance(user.id)) - before, 25_000_000);
});

test("without Dodo settings checkout is unavailable and there is no bank-transfer fallback", async () => {
  const plain = createApp({ quiet: true, logger: null, kv: new MemoryKV(), env: {}, supabaseAuth: null, apiUrl: "http://api.test", publicUrl: "http://p.test", dodoFetch: async () => { throw new Error("must not be called"); } });
  await new Promise((r) => plain.server.listen(0, "127.0.0.1", r));
  try {
    const b2 = `http://127.0.0.1:${plain.server.address().port}`;
    const u = await plain.repo.createUser({ email: "x@example.test", name: "x" });
    const ck = `apz_session=${(await plain.repo.createSession(u.id)).token}`;
    const call = (p, body) => fetch(b2 + p, { method: body ? "POST" : "GET", headers: { cookie: ck, "content-type": "application/json", "x-zie-csrf": "1" }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await (await call("/api/me/billing")).json()).content.cardEnabled, false);
    assert.equal((await call("/api/me/invoices", { type: "plan", plan: "pro", months: 1, method: "card" })).status, 503);
    assert.equal((await call("/api/me/invoices", { type: "plan", plan: "pro", months: 1 })).status, 503);
    assert.equal((await plain.repo.listItems("invoice", u.id)).length, 0);
    assert.equal((await fetch(`${b2}/webhooks/dodo`, { method: "POST", body: "{}" })).status, 401, "unsigned webhooks are refused when no secret is set");
  } finally {
    await new Promise((r) => plain.server.close(r));
  }
});

test("card top-up in dollars: $10 buys 25,000 requests, credited at the same per-request price", async () => {
  const inv = (await me("/api/me/invoices", { type: "topup", usd: 10, method: "card" })).json.content;
  assert.equal(inv.amount, 1000);
  assert.equal(inv.requests, 25000);
  assert.equal(inv.creditMicros, 10_000_000);
  assert.equal(calls.at(-1).body.product_cart[0].amount, 1000);
  assert.equal((await me("/api/me/invoices", { type: "topup", usd: 1, method: "card" })).status, 400, "minimum $5");
  const billing = (await me("/api/me/billing")).json.content;
  assert.deepEqual(billing.payg.topupsUsd.map((t) => t.usd), [5, 10, 25, 50]);
});

test("abandoned checkouts never block a new one; clicking the same option again reuses its checkout", async () => {
  checkoutState = { payment_id: null, payment_status: null };
  const a = (await me("/api/me/invoices", { type: "topup", usd: 7, method: "card" })).json.content;
  const again = (await me("/api/me/invoices", { type: "topup", usd: 7, method: "card" })).json.content;
  assert.equal(again.id, a.id, "same top-up reuses the waiting invoice");
  for (const usd of [11, 12, 13, 14, 15, 16, 17]) assert.equal((await me("/api/me/invoices", { type: "topup", usd, method: "card" })).status, 201, `$${usd}`);
  const open = (await app.repo.listItems("invoice", user.id)).filter((i) => i.status === "pending");
  assert.ok(open.length <= 5);
  const closed = await app.repo.getItem("invoice", a.id);
  assert.equal(closed.status, "cancelled");
  // a late payment for a closed checkout is still credited
  const before = await app.repo.getBalance(user.id);
  await hook({ type: "payment.succeeded", data: { payment_id: "pay_late", total_amount: closed.amount, currency: "USD", metadata: { invoice_id: closed.id, user_id: user.id } } });
  assert.equal((await app.repo.getBalance(user.id)) - before, 7_000_000);
});

test("a lower plan cannot be bought while a higher one is still running", async () => {
  await app.repo.updateUser(user.id, { plan: "max", planExpiresAt: new Date(Date.now() + 10 * 864e5).toISOString() });
  const r = await me("/api/me/invoices", { type: "plan", plan: "pro", months: 1, method: "card" });
  assert.equal(r.status, 400);
  assert.match(r.json.errors[0].message, /lower plan after it ends/);
  assert.equal((await me("/api/me/invoices", { type: "plan", plan: "max", months: 1, method: "card" })).status, 201, "renewing the same plan still works");
});

test("config tolerates other variable names and pasted quotes; no product id means one is created once", async () => {
  const { dodoConfig, createDodo } = await import("../src/billing/dodo.js");
  const cfg = dodoConfig({ DODO_SECRET_KEY: '  "sk_live_abc"\n', DODO_WEBHOOK: "whsec_x", DODO_MODE: "Test" });
  assert.equal(cfg.apiKey, "sk_live_abc");
  assert.equal(cfg.webhookSecret, "whsec_x");
  assert.equal(cfg.mode, "test_mode");
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.productId, null);
  assert.deepEqual(cfg.names, ["DODO_MODE", "DODO_SECRET_KEY", "DODO_WEBHOOK"]);

  const kv = new MemoryKV();
  const seen = [];
  const f = async (url, init) => {
    seen.push(`${init.method} ${url}`);
    if (url.endsWith("/products")) return Response.json({ product_id: "pdt_auto" });
    return Response.json({ session_id: "cks_1", checkout_url: "https://test.checkout.dodopayments.com/x" });
  };
  const d = createDodo(cfg, f, { kv });
  const inv = { id: "INV-1", amount: 900 };
  const usr = { id: "u", email: "a@b.test", name: "A" };
  await d.createCheckout({ invoice: inv, user: usr, returnUrl: "https://x/r" });
  await d.createCheckout({ invoice: inv, user: usr, returnUrl: "https://x/r" });
  assert.equal(seen.filter((s) => s.endsWith("/products")).length, 1, "product created once");
  assert.equal(await kv.get("dodo:product:test_mode"), "pdt_auto");
  // a fresh instance (another serverless function) reuses the saved product
  const d2 = createDodo(cfg, f, { kv });
  assert.equal(await d2.productId(), "pdt_auto");
});

test("a key used against the wrong environment switches once when the mode was not set", async () => {
  const { dodoConfig, createDodo } = await import("../src/billing/dodo.js");
  const hits = [];
  const f = async (url, init) => {
    hits.push(url);
    if (url.startsWith("https://live.")) return new Response("unauthorized", { status: 401 });
    return Response.json({ session_id: "cks_t", checkout_url: "https://test.checkout.dodopayments.com/t" });
  };
  const d = createDodo(dodoConfig({ DODO_PAYMENTS_API_KEY: "k", DODO_PAYMENTS_PRODUCT_ID: "pdt" }), f);
  const r = await d.createCheckout({ invoice: { id: "I", amount: 500 }, user: { id: "u", email: "a@b.test" }, returnUrl: "https://x" });
  assert.equal(r.sessionId, "cks_t");
  assert.equal(d.mode, "test_mode");
  // explicit live_mode never silently switches
  const d3 = createDodo(dodoConfig({ DODO_PAYMENTS_API_KEY: "k", DODO_PAYMENTS_PRODUCT_ID: "pdt", DODO_PAYMENTS_ENVIRONMENT: "live_mode" }), f);
  await assert.rejects(d3.createCheckout({ invoice: { id: "I", amount: 500 }, user: { id: "u", email: "a@b.test" }, returnUrl: "https://x" }), /invalid Dodo Payments API key/);
});
