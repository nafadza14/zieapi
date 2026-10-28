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
  const inv = (await me("/api/me/invoices", { type: "topup", amount: 80000, method: "card" })).json.content;
  assert.equal(inv.amount, Math.round((Math.floor(800000 / 66) * 0.4 * 100) / 1000), "top-up priced at $0.40 per 1,000 requests");
  checkoutState = { payment_id: null, payment_status: null };
  assert.equal((await me(`/api/me/invoices/${inv.id}/sync`, {})).json.content.status, "pending");
  const before = await app.repo.getBalance(user.id);
  checkoutState = { payment_id: "pay_t", payment_status: "succeeded" };
  assert.equal((await me(`/api/me/invoices/${inv.id}/sync`, {})).json.content.status, "paid");
  assert.equal((await app.repo.getBalance(user.id)) - before, 800000, "Rp80.000 credited (in tenths)");
  // the late webhook is a no-op
  await hook({ type: "payment.succeeded", data: { payment_id: "pay_t", total_amount: inv.amount, currency: "USD", metadata: { invoice_id: inv.id, user_id: user.id } } });
  assert.equal((await app.repo.getBalance(user.id)) - before, 800000);
});

test("without Dodo settings card payment is off and bank transfer still works", async () => {
  const plain = createApp({ quiet: true, logger: null, kv: new MemoryKV(), env: {}, supabaseAuth: null, apiUrl: "http://api.test", publicUrl: "http://p.test", dodoFetch: async () => { throw new Error("must not be called"); } });
  await new Promise((r) => plain.server.listen(0, "127.0.0.1", r));
  try {
    const b2 = `http://127.0.0.1:${plain.server.address().port}`;
    const u = await plain.repo.createUser({ email: "x@example.test", name: "x" });
    const ck = `apz_session=${(await plain.repo.createSession(u.id)).token}`;
    const call = (p, body) => fetch(b2 + p, { method: body ? "POST" : "GET", headers: { cookie: ck, "content-type": "application/json", "x-zie-csrf": "1" }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await (await call("/api/me/billing")).json()).content.cardEnabled, false);
    assert.equal((await call("/api/me/invoices", { type: "plan", plan: "pro", months: 1, method: "card" })).status, 400);
    const bank = await (await call("/api/me/invoices", { type: "plan", plan: "pro", months: 1 })).json();
    assert.equal(bank.content.method, "bank_transfer");
    assert.equal((await fetch(`${b2}/webhooks/dodo`, { method: "POST", body: "{}" })).status, 401, "unsigned webhooks are refused when no secret is set");
  } finally {
    await new Promise((r) => plain.server.close(r));
  }
});
