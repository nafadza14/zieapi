// Signed webhook delivery. Contract modelled on E14:
//   POST <url>  body {id,event,data,deliveredAt}
//   X-Zie-Signature: sha256=<hex HMAC-SHA256(secret, rawBody)>

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { ulid, sleep } from "./util.js";
import { getPlan } from "./plans.js";

export const WEBHOOK_EVENTS = [
  "bulk.completed",
  "bulk.failed",
  "key.created",
  "key.disabled",
  "quota.warning",
  "quota.exceeded",
  "request.error",
  "webhook.test",
];

export function signPayload(secret, rawBody) {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(secret, rawBody, header) {
  if (!secret || !header) return false;
  const given = Buffer.from(String(header).replace(/^sha256=/, "").toLowerCase());
  const expected = Buffer.from(signPayload(secret, rawBody).slice(7));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const newWebhookSecret = () => "whsec_" + randomBytes(24).toString("base64url");

export class WebhookDispatcher {
  constructor(store, { fetchImpl = globalThis.fetch, retries = 3, backoffMs = 500, logger = null } = {}) {
    Object.assign(this, { store, fetchImpl, retries, backoffMs, logger });
    this.pending = new Set();
  }

  emit(keyId, event, data) {
    if (!keyId) return;
    const key = this.store.keyById(keyId);
    if (!key || !getPlan(key.plan).webhooks) return;
    for (const hook of this.store.getWebhooks(keyId)) {
      if (!hook.events?.includes(event) && !hook.events?.includes("*")) continue;
      const p = this.deliver(hook, event, data).finally(() => this.pending.delete(p));
      this.pending.add(p);
    }
  }

  async deliver(hook, event, data) {
    const payload = { id: ulid(), event, data, deliveredAt: new Date().toISOString() };
    const raw = JSON.stringify(payload);
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchImpl(hook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "zieapi-webhooks/1",
            "x-zie-event": event,
            "x-zie-delivery": payload.id,
            "x-zie-signature": signPayload(hook.secret, raw),
          },
          body: raw,
        });
        if (res.ok) return { ok: true, status: res.status, payload };
        if (res.status < 500 && res.status !== 429) return { ok: false, status: res.status, payload };
      } catch (e) {
        this.logger?.warn?.(`webhook ${hook.id} attempt ${attempt} failed: ${e.message}`);
      }
      if (attempt < this.retries) await sleep(this.backoffMs * 2 ** attempt);
    }
    return { ok: false, status: 0, payload };
  }

  /** Await in-flight deliveries (tests / graceful shutdown). */
  async drain() {
    await Promise.allSettled([...this.pending]);
  }
}
