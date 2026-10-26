import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { boot } from "./helpers.js";
import defaultScrapers from "../src/scrapers/index.js";
import { createApiKey } from "../src/auth.js";
import { signPayload, verifySignature } from "../src/webhooks.js";
import { monthKey } from "../src/util.js";

const flaky = {
  category: "dev-tools",
  slug: "flaky",
  displayName: "Flaky",
  endpoints: [
    { slug: "boom", method: "GET", fields: [], handler: () => { throw new Error("kaboom"); } },
    { slug: "slow", method: "GET", fields: [], timeoutMs: 50, handler: () => new Promise((r) => setTimeout(r, 500)) },
    {
      slug: "echo",
      method: "GET",
      bulkEnabled: true,
      fields: [{ name: "n", type: "integer", required: true }],
      handler: ({ n }) => {
        if (n === 13) throw new Error("unlucky");
        return { n };
      },
    },
  ],
};

let t;
const deliveries = [];
before(async () => {
  t = await boot({
    scrapers: [...defaultScrapers, flaky],
    webhookBackoffMs: 1,
    webhookFetch: async (url, init) => {
      deliveries.push({ url, headers: init.headers, body: init.body });
      return new Response("ok");
    },
  });
});
after(() => t.close());

const usageOf = (key) => {
  const rec = t.app.store.listKeys().find((k) => k.hash === createHash("sha256").update(key).digest("hex"));
  return t.app.store.getUsage(rec.id);
};

test("5xx is refunded, 4xx is billed", async () => {
  const k = createApiKey(t.app.store, { plan: "free" }).key;
  assert.equal((await t.call("/v1/dev-tools:flaky/boom", { key: k })).status, 500);
  assert.equal(usageOf(k), 0);
  const slow = await t.call("/v1/dev-tools:flaky/slow", { key: k });
  assert.equal(slow.status, 504);
  assert.equal(usageOf(k), 0);
  assert.equal((await t.call("/v1/dev-tools:hash/digest", { key: k })).status, 400);
  assert.equal(usageOf(k), 1);
});

test("per-minute limit → 429 with content.{limit,used,window,retryAfterSec} + Retry-After", async () => {
  const k = createApiKey(t.app.store, { plan: "free" }).key;
  const calls = await Promise.all(Array.from({ length: 101 }, () => t.call("/v1/dev-tools:uuid/v4", { key: k })));
  const limited = calls.filter((c) => c.status === 429);
  assert.equal(limited.length, 1);
  const r = limited[0];
  assert.equal(r.body.content.window, "minute");
  assert.equal(r.body.content.limit, 100);
  assert.ok(r.body.content.retryAfterSec >= 1);
  assert.equal(r.headers.get("retry-after"), String(r.body.content.retryAfterSec));
  assert.equal(r.headers.get("x-ratelimit-remaining-minute"), "0");
});

test("monthly quota → 429 window=month", async () => {
  const { key, record } = createApiKey(t.app.store, { plan: "free" });
  t.app.store.addUsage(record.id, 600, monthKey());
  const r = await t.call("/v1/dev-tools:uuid/v4", { key });
  assert.equal(r.status, 429);
  assert.equal(r.body.content.window, "month");
  assert.equal(r.headers.get("x-ratelimit-remaining-month"), "0");
});

test("bulk: plan gate, not-enabled, cap, submit+poll, idempotency", async () => {
  const free = await t.call("/v1/dev-tools:flaky/echo/bulk", { method: "POST", key: t.keys.free, body: { items: [{ n: 1 }] } });
  assert.equal(free.status, 403);
  assert.equal(free.body.error.code, "plan_upgrade_required");

  const notEnabled = await t.call("/v1/dev-tools:uuid/v4/bulk", { method: "POST", key: t.keys.ultra, body: { items: [{}] } });
  assert.equal(notEnabled.body.error.code, "bulk_not_enabled");

  const cap = await t.call("/v1/dev-tools:flaky/echo/bulk", { method: "POST", key: t.keys.ultra, body: { items: Array.from({ length: 501 }, (_, i) => ({ n: i })) } });
  assert.equal(cap.status, 400);
  assert.equal(cap.body.error.code, "bulk_cap_exceeded");
  assert.equal(cap.body.cap, 500);
  assert.equal(cap.body.submitted, 501);

  const items = [{ n: 1 }, { params: { n: 2 } }, { n: 13 }];
  const sub = await t.call("/v1/dev-tools:flaky/echo/bulk", { method: "POST", key: t.keys.ultra, headers: { "idempotency-key": "abc" }, body: { items } });
  assert.equal(sub.status, 202);
  assert.ok(sub.body.jobId);
  assert.equal(sub.body.total, 3);
  assert.equal(sub.body.pollUrl, `http://api.test/v1/bulk/${sub.body.jobId}`);

  const again = await t.call("/v1/dev-tools:flaky/echo/bulk", { method: "POST", key: t.keys.ultra, headers: { "idempotency-key": "abc" }, body: { items } });
  assert.equal(again.body.jobId, sub.body.jobId);
  const conflict = await t.call("/v1/dev-tools:flaky/echo/bulk", { method: "POST", key: t.keys.ultra, headers: { "idempotency-key": "abc" }, body: { items: [{ n: 9 }] } });
  assert.equal(conflict.status, 422);
  assert.equal(conflict.body.error.code, "idempotency_key_reuse");

  let job;
  for (let i = 0; i < 50; i++) {
    job = (await t.call(`/v1/bulk/${sub.body.jobId}`, { key: t.keys.ultra })).body;
    if (["COMPLETED", "FAILED"].includes(job.status)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.succeeded, 2);
  assert.equal(job.failed, 1);
  assert.deepEqual(job.items.map((i) => i.status), ["SUCCEEDED", "SUCCEEDED", "FAILED"]);
  assert.equal(job.items[1].data.n, 2);

  // another key cannot read it
  assert.equal((await t.call(`/v1/bulk/${sub.body.jobId}`, { key: t.keys.max })).status, 404);
});

test("webhooks: plan gated, signed delivery, test endpoint", async () => {
  assert.equal((await t.call("/v1/webhooks", { key: t.keys.free })).status, 403);
  const put = await t.call("/v1/webhooks", { method: "PUT", key: t.keys.pro, body: { webhooks: [{ url: "https://hooks.example/zie", events: ["webhook.test", "request.error"] }] } });
  assert.equal(put.status, 200);
  const secret = put.body.content[0].secret;
  assert.match(secret, /^whsec_/);

  const bad = await t.call("/v1/webhooks", { method: "PUT", key: t.keys.pro, body: { webhooks: [{ url: "ftp://x", events: ["nope"] }] } });
  assert.equal(bad.status, 400);

  deliveries.length = 0;
  const r = await t.call("/v1/webhooks/test", { method: "POST", key: t.keys.pro });
  assert.equal(r.body.content[0].ok, true);
  const d = deliveries[0];
  assert.equal(d.url, "https://hooks.example/zie");
  assert.equal(d.headers["x-zie-event"], "webhook.test");
  assert.ok(verifySignature(secret, d.body, d.headers["x-zie-signature"]));
  assert.ok(!verifySignature(secret, d.body + " ", d.headers["x-zie-signature"]));
  assert.equal(JSON.parse(d.body).event, "webhook.test");
  assert.equal(signPayload("s", "x").length, 7 + 64);
});
