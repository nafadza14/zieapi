// Data alerts: watch an official source, baseline on create, alert once on change, cron runs due checks.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";
import { WATCH_TYPES, parseWatch } from "../src/core/watches.js";

let filings = [{ acc: "0000320193-25-000079", form: "10-K", date: "2025-10-31" }];
const upstream = async (u) => {
  u = String(u);
  if (u.includes("company_tickers.json")) return Response.json({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } });
  if (u.includes("submissions/CIK0000320193.json"))
    return Response.json({ name: "Apple Inc.", filings: { recent: { accessionNumber: filings.map((f) => f.acc), form: filings.map((f) => f.form), filingDate: filings.map((f) => f.date), primaryDocument: filings.map(() => "doc.htm"), primaryDocDescription: filings.map((f) => f.form) } } });
  return new Response("nope", { status: 404 });
};
const deliveries = [];
const app = createApp({ quiet: true, logger: null, kv: new MemoryKV(), env: { CRON_SECRET: "cron_s3cret" }, supabaseAuth: null, apiUrl: "http://api.test", publicUrl: "http://p.test", fetch: upstream, webhookFetch: async (url, init) => (deliveries.push({ url, body: JSON.parse(init.body) }), new Response("ok")), lookup: async () => [{ address: "93.184.216.34", family: 4 }] });
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
after(() => new Promise((r) => app.server.close(r)));
const base = `http://127.0.0.1:${app.server.address().port}`;
const user = await app.repo.createUser({ email: "watch@example.test", name: "W" });
const cookie = `apz_session=${(await app.repo.createSession(user.id)).token}`;
const me = (path, body, method) => fetch(base + path, { method: method ?? (body ? "POST" : "GET"), headers: { cookie, "content-type": "application/json", "x-zie-csrf": "1" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));

test("alert types validate their settings", () => {
  assert.throws(() => parseWatch({ type: "nope" }), /Unknown alert type/);
  assert.throws(() => parseWatch({ type: "sec-filings", params: {} }), /required/);
  assert.deepEqual(parseWatch({ type: "fred-series", params: { series: " CPIAUCSL " } }), { type: "fred-series", params: { series: "CPIAUCSL" } });
  assert.equal(Object.keys(WATCH_TYPES).length, 5);
});

test("alerts are part of Apizie Finance: general plans have none; Finance Starter can create, baseline, then alert once per change", async () => {
  assert.equal((await me("/api/me/alerts")).json.content.limit, 0);
  assert.equal((await me("/api/me/alerts", { type: "sec-filings", params: { company: "AAPL" } })).status, 403);
  // a paid general plan does not include alerts
  await app.repo.updateUser(user.id, { plan: "pro", planExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString() });
  const refused = await me("/api/me/alerts", { type: "sec-filings", params: { company: "AAPL" } });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error.code, "finance_plan_required");
  await app.repo.updateUser(user.id, { financePlan: "fin_starter", financeExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString() });
  assert.equal((await me("/api/me/alerts")).json.content.limit, 5);
  await app.repo.setWebhooks(user.id, [{ id: "h1", url: "https://hooks.example.test/x", events: ["data.changed"], enabled: true, secret: "whsec_test", createdAt: new Date().toISOString() }]);

  const created = await me("/api/me/alerts", { type: "sec-filings", params: { company: "AAPL" } });
  assert.equal(created.status, 201);
  const w = created.json.content;
  assert.equal(w.name, "New SEC filings: AAPL");
  assert.match(w.lastSummary, /Apple Inc\. filed 10-K on 2025-10-31/);
  assert.equal(w.lastSource.provider, "SEC EDGAR");
  assert.equal(w.fingerprint, undefined, "internal state is not exposed");

  // nothing new: no alert
  await app.repo.patchItem("watch", w.id, { lastCheckedAt: new Date(0).toISOString() });
  let r = await me(`/api/me/alerts/${w.id}/check`, {});
  assert.equal(r.json.content.changed, false);
  assert.equal((await me(`/api/me/alerts/${w.id}/check`, {})).status, 400, "rate limited to once a minute");

  // a new 8-K: one data.changed webhook and one notification, with the citation
  filings = [{ acc: "0000320193-25-000090", form: "8-K", date: "2025-11-03" }, ...filings];
  await app.repo.patchItem("watch", w.id, { lastCheckedAt: new Date(0).toISOString() });
  r = await me(`/api/me/alerts/${w.id}/check`, {});
  assert.equal(r.json.content.changed, true);
  await app.webhooks.drain();
  const hook = deliveries.find((d) => d.body.event === "data.changed");
  assert.ok(hook, "data.changed delivered");
  assert.match(hook.body.data.summary, /filed 8-K on 2025-11-03/);
  assert.equal(hook.body.data.source.provider, "SEC EDGAR");
  const notes = (await me("/api/me/notifications")).json.content.items;
  assert.ok(notes.some((n) => /filed 8-K/.test(n.text)));
  // alert checks are part of the plan, not billed
  assert.equal((await me("/api/me/usage")).json.content.month?.used ?? 0, 0);

  assert.equal((await me(`/api/me/alerts/${w.id}`, { enabled: false }, "PATCH")).json.content.enabled, false);
  assert.equal((await me(`/api/me/alerts/${w.id}`, null, "DELETE")).status, 200);
  assert.equal((await me("/api/me/alerts")).json.content.items.length, 0);
});

test("cron endpoint needs the secret, then checks due alerts", async () => {
  assert.equal((await fetch(`${base}/api/cron/watches`)).status, 401);
  assert.equal((await fetch(`${base}/api/cron/watches`, { headers: { authorization: "Bearer wrong" } })).status, 401);
  await me("/api/me/alerts", { type: "sec-filings", params: { company: "AAPL", form: "10-K" } });
  const all = await app.repo.listItems("watch");
  for (const w of all) await app.repo.patchItem("watch", w.id, { lastCheckedAt: new Date(0).toISOString() });
  const r = await (await fetch(`${base}/api/cron/watches`, { headers: { authorization: "Bearer cron_s3cret" } })).json();
  assert.equal(r.content.checked, 1);
  assert.equal(r.content.errors, 0);
  // when the Finance plan lapses, alerts are kept but no longer checked
  await app.repo.updateUser(user.id, { financeExpiresAt: new Date(Date.now() - 1000).toISOString() });
  const w = (await app.repo.listItems("watch"))[0];
  const res = await app.watcher.check(w);
  assert.equal(res.reason, "finance_plan_required");
  assert.equal((await app.repo.listItems("watch")).length, 1);
});
