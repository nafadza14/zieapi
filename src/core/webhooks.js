// Signed webhook delivery: POST {id,event,data,deliveredAt}, header
// X-Apizie-Signature: sha256=<hex HMAC-SHA256(secret, rawBody)>.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { ulid, sleep } from "./util.js";
import { getPlan } from "./plans.js";

export const WEBHOOK_EVENTS = ["bulk.completed", "bulk.failed", "key.created", "key.disabled", "quota.warning", "quota.exceeded", "request.error", "plan.changed", "webhook.test"];

export const signPayload = (secret, raw) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
export function verifySignature(secret, raw, header) {
  if (!secret || !header) return false;
  const a = Buffer.from(String(header).replace(/^sha256=/, "").toLowerCase());
  const b = Buffer.from(signPayload(secret, raw).slice(7));
  return a.length === b.length && timingSafeEqual(a, b);
}
export const newWebhookSecret = () => "whsec_" + randomBytes(24).toString("base64url");

export class WebhookDispatcher {
  constructor(repo, { fetchImpl = globalThis.fetch, retries = 2, backoffMs = 400, logger = null, planOf } = {}) {
    Object.assign(this, { repo, fetchImpl, retries, backoffMs, logger, planOf });
    this.pending = new Set();
  }

  /** Fire-and-forget (awaited by drain() / serverless handler before responding). */
  emit(owner, event, data) {
    if (!owner) return;
    const p = (async () => {
      const plan = this.planOf ? await this.planOf(owner) : "free";
      if (!getPlan(plan).webhooks) return;
      const hooks = await this.repo.getWebhooks(owner);
      await Promise.all(hooks.filter((h) => h.events?.includes(event) || h.events?.includes("*")).map((h) => this.deliver(h, event, data)));
    })().catch((e) => this.logger?.warn?.("webhook emit failed: " + e.message));
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
  }

  async deliver(hook, event, data) {
    const payload = { id: ulid(), event, data, deliveredAt: new Date().toISOString() };
    const raw = JSON.stringify(payload);
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchImpl(hook.url, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "apizie-webhooks/2", "x-apizie-event": event, "x-apizie-delivery": payload.id, "x-apizie-signature": signPayload(hook.secret, raw) },
          body: raw,
          signal: AbortSignal.timeout?.(8000),
        });
        if (res.ok) return { ok: true, status: res.status, payload };
        if (res.status < 500 && res.status !== 429) return { ok: false, status: res.status, payload };
      } catch (e) {
        this.logger?.warn?.(`webhook ${hook.id} attempt ${attempt}: ${e.message}`);
      }
      if (attempt < this.retries) await sleep(this.backoffMs * 2 ** attempt);
    }
    return { ok: false, status: 0, payload };
  }

  async drain() {
    await Promise.allSettled([...this.pending]);
  }
}
