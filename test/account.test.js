// Dashboard account API: everything the /dashboard sections call, end to end over HTTP.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV, SupabaseKV } from "../src/db/kv.js";
import { ipMatches, ipAllowed } from "../src/dashboard/account.js";
import { summarize, rollupFields } from "../src/core/analytics.js";
import { monthKey } from "../src/core/util.js";
import devtools from "../src/scrapers/live/devtools.js";

const testKv = () => (process.env.ZIE_TEST_SUPABASE_URL ? new SupabaseKV({ url: process.env.ZIE_TEST_SUPABASE_URL, key: process.env.ZIE_TEST_SUPABASE_KEY }) : new MemoryKV());

const hookCalls = [];
let hookStatus = 200;
let app, base;
before(async () => {
  app = createApp({
    logger: null,
    quiet: true,
    env: { ZIE_ADMIN_EMAILS: "owner@apizie.test", ZIE_SESSION_SECRET: "test-secret-that-is-long-enough-1234567890", ZIE_BANK_INFO: "BCA 123 a.n. Test", ZIE_SUPPORT_EMAIL: "help@apizie.test" },
    apiUrl: "http://api.test",
    publicUrl: "http://apz.test",
    scrapers: devtools,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    kv: testKv(),
    webhookFetch: async (url, init) => {
      hookCalls.push({ url, init });
      return new Response("ok", { status: hookStatus });
    },
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => new Promise((r) => app.server.close(r)));

/** Browser-like client that keeps every cookie it is given. */
function client(ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0") {
  const jar = new Map();
  return async (path, { method = "GET", body, headers = {}, raw = false } = {}) => {
    const h = { "user-agent": ua, ...headers };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (method !== "GET") h["x-zie-csrf"] = "1";
    if (body !== undefined) h["content-type"] = "application/json";
    const res = await fetch(base + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      const v = pair.slice(i + 1);
      if (v) jar.set(pair.slice(0, i), v);
      else jar.delete(pair.slice(0, i));
    }
    const t = await res.text();
    if (raw) return { status: res.status, text: t, headers: res.headers };
    let j;
    try {
      j = JSON.parse(t);
    } catch {
      j = t;
    }
    return { status: res.status, body: j, c: j?.content, headers: res.headers };
  };
}
const call = (secret, path = "/v1/dev-tools:hash/digest?text=halo", headers = {}) => fetch(base + path, { headers: { "x-api-key": secret, ...headers } });
async function signUp(c, email, name = "Tester") {
  const r = await c("/auth/register", { method: "POST", body: { name, email, password: "password1" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (await c("/api/me")).c.user;
}

let admin;
test("setup checks report what is missing", async () => {
  admin = client();
  await signUp(admin, "owner@apizie.test", "Owner");
  const r = await admin("/api/admin/setup");
  assert.equal(r.status, 200);
  const byId = Object.fromEntries(r.c.checks.map((x) => [x.id, x]));
  assert.equal(byId.secret.status, "ok");
  assert.equal(byId.bank.status, "ok");
  if (process.env.ZIE_TEST_SUPABASE_URL) {
    assert.equal(byId.storage.status, "ok", byId.storage.detail);
  } else {
    assert.equal(byId.storage.status, "fail", "memory storage is never production ready");
    assert.equal(r.c.ready, false);
    assert.ok(byId.storage.fix.includes("0001_apizie.sql"));
  }
});

test("dashboard pages render for every section and reject unknown ones", async () => {
  const c = client();
  await signUp(c, "pages@x.io");
  for (const s of ["", "/usage", "/logs", "/keys", "/bulk", "/webhooks", "/billing", "/affiliate", "/showcase", "/settings", "/support"]) {
    const r = await c(`/dashboard${s}`, { raw: true });
    assert.equal(r.status, 200, s);
    assert.match(r.text, /dash-user\.js/);
    assert.match(r.text, /dash\.css/);
  }
  assert.equal((await c("/dashboard/nope", { raw: true })).status, 404);
  assert.equal((await c("/admin", { raw: true })).status, 404, "admin pages stay hidden from customers");
  for (const s of ["", "/setup", "/users", "/invoices", "/payouts", "/scrapers", "/reports", "/showcase"]) {
    const r = await admin(`/admin${s}`, { raw: true });
    assert.equal(r.status, 200, s);
    assert.match(r.text, /dash-admin\.js/);
  }
});

test("keys: create, reveal, limit, revoke for good, IP allowlist gate", async () => {
  const c = client();
  await signUp(c, "keys@x.io");
  const made = [];
  for (const name of ["prod", "staging", "dev"]) made.push((await c("/api/me/keys", { method: "POST", body: { name } })).c);
  const over = await c("/api/me/keys", { method: "POST", body: { name: "fourth" } });
  assert.equal(over.status, 400, "free plan allows 3 active keys");

  const rev = await c(`/api/me/keys/${made[0].record.id}/reveal`, { method: "POST" });
  assert.equal(rev.c.key, made[0].key, "keys can be revealed again");
  assert.equal((await call(made[0].key)).status, 200);

  const gate = await c(`/api/me/keys/${made[0].record.id}`, { method: "PATCH", body: { ipAllowlist: "203.0.113.0/24" } });
  assert.equal(gate.status, 403, "allowlists need Pro");

  await c(`/api/me/keys/${made[0].record.id}/revoke`, { method: "POST" });
  const r401 = await call(made[0].key);
  assert.equal(r401.status, 401);
  assert.match((await r401.json()).message, /revoked/);
  assert.equal((await c(`/api/me/keys/${made[0].record.id}`, { method: "PATCH", body: { status: "active" } })).status, 400, "revoked is permanent");
  assert.equal((await c(`/api/me/keys/${made[0].record.id}/reveal`, { method: "POST" })).status, 409);

  const list = (await c("/api/me/keys")).c;
  assert.equal(list.active, 2);
  assert.equal(list.max, 3);
  assert.equal(list.items.find((k) => k.id === made[1].record.id).spark.length, 30);
  assert.equal((await c("/api/me/keys", { method: "POST", body: { name: "again" } })).status, 201, "a slot frees up after revoking");

  const del = await c(`/api/me/keys/${made[0].record.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const other = client();
  await signUp(other, "other@x.io");
  assert.equal((await other(`/api/me/keys/${made[1].record.id}/reveal`, { method: "POST" })).status, 404, "keys are private to their owner");
});

test("IP rules: exact, IPv4 CIDR, IPv6 and mapped addresses", () => {
  assert.ok(ipMatches("198.51.100.7", "198.51.100.0/24"));
  assert.ok(!ipMatches("198.51.101.7", "198.51.100.0/24"));
  assert.ok(ipMatches("::ffff:10.0.0.5", "10.0.0.0/8"));
  assert.ok(ipMatches("2001:db8::1", "2001:db8::1"));
  assert.ok(ipMatches("8.8.8.8", "0.0.0.0/0"));
  assert.ok(ipAllowed("1.2.3.4", []));
  assert.ok(!ipAllowed("1.2.3.4", ["5.6.7.8", "10.0.0.0/8"]));
});

test("usage analytics: overview, ranges, per-key filter, logs, CSV export", async () => {
  const c = client();
  await signUp(c, "stats@x.io");
  const a = (await c("/api/me/keys", { method: "POST", body: { name: "alpha" } })).c;
  const b = (await c("/api/me/keys", { method: "POST", body: { name: "beta" } })).c;
  for (let i = 0; i < 3; i++) assert.equal((await call(a.key)).status, 200);
  assert.equal((await call(b.key, "/v1/dev-tools:hash/digest")).status, 400, "missing param is a billed 4xx");
  assert.equal((await call(b.key, "/v1/dev-tools:nope/x")).status, 404);

  const ov = (await c("/api/me/overview?range=24h&tz=420")).c;
  assert.equal(ov.summary.total, 5);
  assert.equal(ov.summary.errors, 2);
  assert.equal(ov.summary.successRate, 60);
  assert.equal(ov.today, 5);
  assert.equal(ov.errors24h, 2);
  assert.equal(ov.summary.series.length, 25, "24 full hours plus the current one, empty hours included");
  assert.equal(ov.summary.heatmap.flat().reduce((n, v) => n + v, 0), 5);
  assert.deepEqual(ov.summary.statuses.map((s) => s.status).sort(), [400, 404]);
  assert.equal(ov.summary.endpoints[0].name, "dev-tools:hash/digest");
  assert.ok(ov.summary.p95Ms !== null);
  assert.equal(ov.recent.length, 5);
  assert.equal(ov.activeKeys, 2);
  assert.equal(ov.system.state, "operational");

  const onlyA = (await c(`/api/me/overview?range=7d&key=${a.record.id}`)).c;
  assert.equal(onlyA.summary.total, 3);
  assert.equal(onlyA.summary.errors, 0);

  assert.equal((await c("/api/me/usage?range=30d")).status, 403, "30 days needs Pro");
  const usage = (await c("/api/me/usage?range=7d")).c;
  assert.equal(usage.perKey.find((k) => k.name === "alpha").requests, 3);
  assert.equal(usage.perKey.find((k) => k.name === "beta").errors, 2);
  assert.equal(usage.last24h.total, 5);
  assert.equal(usage.quota.month.used, 4, "an unknown API (404) is logged but never reaches the quota");

  const logs = (await c("/api/me/logs?range=24h&status=error&page=1&size=10")).c;
  assert.equal(logs.total, 2);
  assert.equal(logs.counts.requests, 5);
  assert.ok(logs.items.every((l) => l.status >= 400 && l.id && l.keyName === "beta"));
  assert.equal((await c("/api/me/logs?q=404")).c.total, 1);
  assert.equal((await c(`/api/me/logs?q=${logs.items[0].id}`)).c.total, 1, "search by request ID");
  assert.equal((await c(`/api/me/logs?key=${a.record.id}`)).c.total, 3);
  const p1 = (await c("/api/me/logs?size=5&page=1")).c;
  assert.equal(p1.items.length, 5);
  assert.equal((await c("/api/me/logs?size=5&page=2")).c.items.length, 0);

  const csv = await c("/api/me/logs/export?range=24h", { raw: true });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.headers.get("content-disposition"), /attachment; filename="apizie-logs-24h-/);
  const lines = csv.text.trim().split("\n");
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^id,at,method,project,endpoint,status/);

  const sup = (await c("/api/me/support")).c;
  assert.equal(sup.errors.length, 2);
  assert.equal(sup.contacts.email, "help@apizie.test");
});

test("analytics math: summarize respects key filter, timezone and p95 buckets", () => {
  const t0 = Date.UTC(2026, 9, 26, 17); // 17:00 UTC Monday = 00:00 Tuesday in UTC+7
  const f = {};
  const add = (e) => {
    for (const [k, v] of Object.entries(rollupFields(e))) f[k] = (f[k] ?? 0) + v;
  };
  for (let i = 0; i < 19; i++) add({ status: 200, ms: 40, project: "p", endpoint: "e", keyId: "k1" });
  add({ status: 502, ms: 2500, project: "p", endpoint: "e", keyId: "k2" });
  const s = summarize([{ t: t0, f }], { from: t0 - 3600_000, to: t0 + 3600_000, tzOffsetMin: 420, granularity: "hour" });
  assert.equal(s.total, 20);
  assert.equal(s.serverErrors, 1);
  assert.equal(s.p95Ms, 50);
  assert.equal(s.heatmap[1][0], 20, "lands on Tuesday 00:00 local");
  assert.deepEqual(Object.keys(s.keys).sort(), ["k1", "k2"]);
  const k2 = summarize([{ t: t0, f }], { keyId: "k2", from: t0 - 3600_000, to: t0 + 3600_000 });
  assert.equal(k2.total, 1);
  assert.equal(k2.p95Ms, 3000);
});

test("billing: top-up invoice with VAT, admin approval credits balance, pay-as-you-go past quota", async () => {
  const c = client();
  const u = await signUp(c, "payg@x.io");
  const bill = (await c("/api/me/billing")).c;
  assert.equal(bill.vatPercent, 11);
  assert.equal(bill.bankConfigured, true);
  assert.deepEqual(bill.payg.topups.map((t) => t.amount), [50000, 100000, 250000, 1000000]);
  assert.equal((await c("/api/me/invoices", { method: "POST", body: { type: "topup", amount: 5000 } })).status, 400, "minimum top-up");

  const inv = (await c("/api/me/invoices", { method: "POST", body: { type: "topup", amount: 50000 } })).c;
  assert.equal(inv.type, "topup");
  assert.equal(inv.subtotal, 50000);
  assert.equal(inv.vat, 5500);
  assert.equal(inv.amount, 55500 + inv.uniqueCode);
  assert.equal((await c(`/api/me/invoices/${inv.id}/confirm`, { method: "POST", body: {} })).status, 400, "reference required");
  assert.equal((await c(`/api/me/invoices/${inv.id}/confirm`, { method: "POST", body: { reference: "BCA a.n. Payg" } })).c.status, "awaiting_review");
  assert.equal((await admin(`/api/admin/invoices/${inv.id}/approve`, { method: "POST" })).c.status, "paid");
  const after = (await c("/api/me/billing")).c;
  assert.equal(after.balance, 50000);
  assert.equal(after.balanceRequests, Math.floor(500000 / 22));
  assert.equal(after.transactions.find((t) => t.id === inv.id).status, "paid");
  const notes = (await c("/api/me/notifications")).c;
  assert.ok(notes.items.some((n) => /topped up/i.test(n.title)));
  assert.ok(notes.unread >= 1);
  await c("/api/me/notifications/read", { method: "POST" });
  assert.equal((await c("/api/me/notifications")).c.unread, 0);

  // Use up the free quota, then the balance takes over once the user opts in.
  const k = (await c("/api/me/keys", { method: "POST", body: { name: "k" } })).c.key;
  await app.kv.set(`use:${u.id}:${monthKey()}`, "600");
  assert.equal((await call(k)).status, 429, "off by default");
  await c("/api/me/prefs", { method: "PATCH", body: { payg: true } });
  const r = await call(k);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-billing"), "payg");
  assert.equal((await c("/api/me/billing")).c.balance, 50000 - 2.2);
  assert.equal((await call(k, "/v1/dev-tools:flaky/boom")).status, 404);
  const tx = (await c("/api/me/billing")).c.transactions;
  assert.ok(tx.some((t) => t.kind === "usage" && t.total < 0));
});

test("plan invoices activate the plan and pay the referrer's commission", async () => {
  const ref = client();
  await signUp(ref, "ref@x.io", "Ref");
  const aff = (await ref("/api/me/affiliate")).c;
  assert.match(aff.link, /\?ref=[a-z0-9]+$/);
  assert.equal(aff.percent, 10);

  const visitor = client();
  const landing = await visitor(`/?ref=${aff.code}`, { raw: true });
  assert.equal(landing.status, 200);
  await signUp(visitor, "buyer@x.io", "Buyer");
  const s1 = (await ref("/api/me/affiliate")).c;
  assert.equal(s1.clicks, 1);
  assert.equal(s1.signups, 1);

  const inv = (await visitor("/api/me/invoices", { method: "POST", body: { plan: "pro", months: 1 } })).c;
  await visitor(`/api/me/invoices/${inv.id}/confirm`, { method: "POST", body: { reference: "x" } });
  await admin(`/api/admin/invoices/${inv.id}/approve`, { method: "POST" });
  assert.equal((await visitor("/api/me")).c.plan.id, "pro");
  const s2 = (await ref("/api/me/affiliate")).c;
  assert.equal(s2.earned, inv.subtotal * 0.1);
  assert.equal(s2.available, inv.subtotal * 0.1);
  assert.equal(s2.paying, 1);
  assert.equal((await ref("/api/me/affiliate/payout", { method: "POST", body: { account: "BCA 1 a.n. Ref" } })).status, 400, "below the payout minimum");
  const moved = (await ref("/api/me/affiliate/move", { method: "POST" })).c;
  assert.equal(moved.moved, inv.subtotal * 0.1);
  assert.equal(moved.balance, inv.subtotal * 0.1);
  assert.equal((await ref("/api/me/affiliate")).c.available, 0);

  // Pro unlocks the IP allowlist, 30-day range and webhooks for the buyer.
  const key = (await visitor("/api/me/keys", { method: "POST", body: { name: "srv" } })).c;
  const allow = await visitor(`/api/me/keys/${key.record.id}`, { method: "PATCH", body: { ipAllowlist: "203.0.113.0/24\n2001:db8::1" } });
  assert.equal(allow.status, 200);
  assert.equal((await call(key.key)).status, 403, "127.0.0.1 is not on the list");
  await visitor(`/api/me/keys/${key.record.id}`, { method: "PATCH", body: { ipAllowlist: "127.0.0.0/8" } });
  assert.equal((await call(key.key)).status, 200);
  assert.equal((await visitor(`/api/me/keys/${key.record.id}`, { method: "PATCH", body: { ipAllowlist: "999.1.1.1" } })).status, 400);
  assert.equal((await visitor("/api/me/usage?range=30d")).status, 200);
  assert.equal((await visitor("/api/me/usage?range=90d")).status, 403);
});

test("webhooks: add, test, deliveries, redeliver, disable, rotate, delete", async () => {
  const c = client();
  await signUp(c, "hooks@x.io");
  assert.equal((await c("/api/me/webhooks")).c.enabled, false);
  assert.equal((await c("/api/me/webhooks", { method: "POST", body: { url: "https://h.test/a" } })).status, 403);
  const uid = (await c("/api/me")).c.user.id;
  await admin(`/api/admin/users/${uid}`, { method: "PATCH", body: { plan: "pro", days: 30 } });

  assert.equal((await c("/api/me/webhooks", { method: "POST", body: { url: "ftp://nope" } })).status, 400);
  for (const url of ["http://127.0.0.1/hook", "http://169.254.169.254/latest/meta-data", "http://localhost:8080/x", "http://[::1]/x"]) {
    const r = await c("/api/me/webhooks", { method: "POST", body: { url } });
    assert.equal(r.status, 400, url);
    assert.match(r.body.errors[0].message, /private/);
  }
  assert.equal((await c("/api/me/webhooks", { method: "POST", body: { url: "https://h.test/a", events: ["made.up"] } })).status, 400);
  const hook = (await c("/api/me/webhooks", { method: "POST", body: { url: "https://h.test/a", description: "prod", events: ["key.revoked", "webhook.test"] } })).c;
  assert.match(hook.secret, /^whsec_/);

  const t = (await c("/api/me/webhooks/test", { method: "POST", body: {} })).c;
  assert.deepEqual(t.map((x) => x.ok), [true]);
  hookStatus = 500;
  const bad = (await c("/api/me/webhooks/test", { method: "POST", body: { hookId: hook.id } })).c;
  assert.equal(bad[0].ok, false);
  assert.equal(bad[0].status, 500);
  hookStatus = 200;

  let view = (await c("/api/me/webhooks")).c;
  assert.equal(view.hooks[0].secretPreview.startsWith("whsec_"), true);
  assert.equal(view.hooks[0].secret, undefined, "secrets never come back");
  assert.equal(view.deliveries.length, 2);
  const failed = view.deliveries.find((d) => !d.ok);
  assert.equal(failed.payload.event, "webhook.test");
  const re = (await c(`/api/me/webhooks/deliveries/${failed.id}/redeliver`, { method: "POST" })).c;
  assert.equal(re.ok, true);

  // key.revoked is pushed to the endpoint
  const k = (await c("/api/me/keys", { method: "POST", body: { name: "x" } })).c;
  hookCalls.length = 0;
  await c(`/api/me/keys/${k.record.id}/revoke`, { method: "POST" });
  await app.webhooks.drain();
  assert.ok(hookCalls.some((h) => JSON.parse(h.init.body).event === "key.revoked"));

  await c(`/api/me/webhooks/${hook.id}`, { method: "PATCH", body: { enabled: false } });
  hookCalls.length = 0;
  const k2 = (await c("/api/me/keys", { method: "POST", body: { name: "y" } })).c;
  await c(`/api/me/keys/${k2.record.id}/revoke`, { method: "POST" });
  await app.webhooks.drain();
  assert.equal(hookCalls.length, 0, "disabled endpoints get nothing");

  const rot = (await c(`/api/me/webhooks/${hook.id}/rotate`, { method: "POST" })).c;
  assert.notEqual(rot.secret, hook.secret);
  await c(`/api/me/webhooks/${hook.id}`, { method: "DELETE" });
  view = (await c("/api/me/webhooks")).c;
  assert.equal(view.hooks.length, 0);
});

test("settings: profile, password signs out other sessions, prefs, sessions, delete account", async () => {
  const laptop = client("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15");
  const user = await signUp(laptop, "me@x.io", "Me");
  const phone = client("Mozilla/5.0 (Linux; Android 14) Chrome/130.0");
  assert.equal((await phone("/auth/login", { method: "POST", body: { email: "me@x.io", password: "password1" } })).status, 200);

  const sessions = (await laptop("/api/me/sessions")).c;
  assert.equal(sessions.length, 2);
  assert.ok(sessions.some((s) => s.current && s.device === "macOS · Safari"));
  const other = sessions.find((s) => !s.current);
  assert.equal(other.device, "Android · Chrome");
  assert.equal((await laptop(`/api/me/sessions/${sessions.find((s) => s.current).id}`, { method: "DELETE" })).status, 400);
  assert.equal((await laptop(`/api/me/sessions/${other.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await phone("/api/me")).status, 401, "signed out remotely");

  assert.equal((await laptop("/api/me", { method: "PATCH", body: { name: "  " } })).status, 400);
  assert.equal((await laptop("/api/me", { method: "PATCH", body: { name: "New Name", avatar: "data:image/png;base64,iVBORw0KGgo=" } })).c.user.name, "New Name");
  assert.equal((await laptop("/api/me", { method: "PATCH", body: { avatar: "javascript:alert(1)" } })).status, 400);

  await phone("/auth/login", { method: "POST", body: { email: "me@x.io", password: "password1" } });
  assert.equal((await laptop("/api/me", { method: "PATCH", body: { currentPassword: "wrong-one", newPassword: "password2" } })).status, 400);
  const pw = (await laptop("/api/me", { method: "PATCH", body: { currentPassword: "password1", newPassword: "password2" } })).c;
  assert.equal(pw.signedOutOthers, true);
  assert.equal((await phone("/api/me")).status, 401);
  assert.equal((await laptop("/api/me")).status, 200, "this device stays signed in");

  const prefs = (await laptop("/api/me/prefs", { method: "PATCH", body: { product: true, quotaWarning: false, bogus: true } })).c;
  assert.equal(prefs.product, true);
  assert.equal(prefs.quotaWarning, false);
  assert.equal(prefs.bogus, undefined);

  assert.equal((await laptop("/api/me/delete", { method: "POST", body: { confirm: "delete" } })).status, 400);
  assert.equal((await laptop("/api/me/delete", { method: "POST", body: { confirm: "DELETE" } })).status, 200);
  assert.equal((await laptop("/api/me")).status, 401);
  assert.equal((await laptop("/auth/login", { method: "POST", body: { email: "me@x.io", password: "password2" } })).status, 401);
  assert.equal(await app.repo.getUser(user.id), null);
});

test("bulk from the dashboard and showcase withdraw", async () => {
  const c = client();
  await signUp(c, "bulk@x.io");
  const st = (await c("/api/me/bulk")).c;
  assert.equal(st.enabled, false);
  assert.equal((await c("/api/me/bulk", { method: "POST", body: { project: "dev-tools:hash", endpoint: "digest", items: [{ text: "a" }] } })).status, 403);
  const uid = (await c("/api/me")).c.user.id;
  await admin(`/api/admin/users/${uid}`, { method: "PATCH", body: { plan: "ultra", days: 30 } });
  const job = await c("/api/me/bulk", { method: "POST", body: { project: "dev-tools:hash", endpoint: "digest", items: [{ text: "a" }, { text: "b" }] } });
  assert.equal(job.status, 201, JSON.stringify(job.body));
  assert.equal(job.c.succeeded, 2);
  const again = (await c("/api/me/bulk")).c;
  assert.equal(again.stats.jobs30d, 1);
  assert.equal(again.stats.items30d, 2);
  assert.equal((await c(`/api/me/bulk/${job.c.jobId}`)).c.items.length, 2);

  assert.equal((await c("/api/showcase", { method: "POST", body: { name: "Thing", url: "https://thing.test", description: "It does a thing" } })).status, 200);
  const mine = (await c("/api/me/showcase")).c;
  assert.equal(mine.length, 1);
  await c(`/api/me/showcase/${mine[0].id}`, { method: "DELETE" });
  assert.equal((await c("/api/me/showcase")).c[0].status, "withdrawn");
});

test("admin: users, invoices list, payouts, scrapers toggle", async () => {
  const users = (await admin("/api/admin/users?q=x.io")).c;
  assert.ok(users.length > 3);
  assert.ok(users.every((u) => u.email.includes("x.io") && typeof u.usedThisMonth === "number"));
  const inv = (await admin("/api/admin/invoices")).c;
  assert.ok(inv.some((i) => i.type === "topup" && i.status === "paid"));
  assert.ok(Array.isArray((await admin("/api/admin/payouts")).c));
  const src = (await admin("/api/admin/scrapers")).c;
  const one = src[0];
  await admin(`/api/admin/scrapers/${encodeURIComponent(one.key)}`, { method: "POST", body: { enabled: false } });
  assert.equal((await admin("/api/admin/scrapers")).c.find((s) => s.key === one.key).enabled, false);
  await admin(`/api/admin/scrapers/${encodeURIComponent(one.key)}`, { method: "POST", body: { enabled: true } });
  const ov = (await admin("/api/admin/overview")).c;
  assert.ok(ov.users >= 5);
  assert.ok(ov.revenueThisMonth > 0);
});
