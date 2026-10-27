// Signed webhook delivery: POST {id,event,data,deliveredAt}, header
// X-Apizie-Signature: sha256=<hex HMAC-SHA256(secret, rawBody)>.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { ulid, sleep } from "./util.js";
import { getPlan } from "./plans.js";
import { assertPublicUrl } from "../scrapers/ssrf.js";

export const WEBHOOK_EVENTS = ["bulk.completed", "bulk.failed", "key.created", "key.revoked", "key.disabled", "quota.warning", "quota.exceeded", "balance.low", "invoice.paid", "request.error", "plan.changed", "webhook.test"];

export const signPayload = (secret, raw) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
export function verifySignature(secret, raw, header) {
  if (!secret || !header) return false;
  const a = Buffer.from(String(header).replace(/^sha256=/, "").toLowerCase());
  const b = Buffer.from(signPayload(secret, raw).slice(7));
  return a.length === b.length && timingSafeEqual(a, b);
}
export const newWebhookSecret = () => "whsec_" + randomBytes(24).toString("base64url");

export class WebhookDispatcher {
  constructor(repo, { fetchImpl = globalThis.fetch, retries = 2, backoffMs = 400, logger = null, planOf, lookup = null, allowPrivate = false } = {}) {
    Object.assign(this, { repo, fetchImpl, retries, backoffMs, logger, planOf, lookup, allowPrivate });
    this.pending = new Set();
  }

  /** Throws when a customer URL points at a private or unresolvable host. */
  async checkTarget(url) {
    if (!this.allowPrivate) await assertPublicUrl(url, this.lookup);
  }

  /** Fire-and-forget (awaited by drain() / serverless handler before responding). */
  emit(owner, event, data) {
    if (!owner) return;
    const p = (async () => {
      const plan = this.planOf ? await this.planOf(owner) : "free";
      if (!getPlan(plan).webhooks) return;
      const hooks = await this.repo.getWebhooks(owner);
      await Promise.all(hooks.filter((h) => h.enabled !== false && (h.events?.includes(event) || h.events?.includes("*"))).map((h) => this.deliver(h, event, data, { owner })));
    })().catch((e) => this.logger?.warn?.("webhook emit failed: " + e.message));
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
  }

  /** POST one event; retries 5xx/network errors. With `owner`, the attempt is kept for the dashboard. */
  async deliver(hook, event, data, { owner = null, payload: given = null } = {}) {
    const payload = given ?? { id: ulid(), event, data, deliveredAt: new Date().toISOString() };
    const raw = JSON.stringify(payload);
    const t0 = Date.now();
    let result = { ok: false, status: 0, error: null };
    let attempts = 0;
    // Customer-supplied URLs must not reach our own network (metadata service, localhost, LAN).
    let blocked = null;
    if (!this.allowPrivate) {
      try {
        await assertPublicUrl(hook.url, this.lookup);
      } catch (e) {
        blocked = e.message;
        result = { ok: false, status: 0, error: `Not delivered: ${e.message}` };
      }
    }
    for (let attempt = 0; !blocked && attempt <= this.retries; attempt++) {
      attempts++;
      try {
        const res = await this.fetchImpl(hook.url, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "apizie-webhooks/2", "x-apizie-event": payload.event, "x-apizie-delivery": payload.id, "x-apizie-signature": signPayload(hook.secret, raw) },
          body: raw,
          redirect: "manual",
          signal: AbortSignal.timeout?.(8000),
        });
        result = { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
        if (res.ok || (res.status < 500 && res.status !== 429)) break;
      } catch (e) {
        result = { ok: false, status: 0, error: e.message };
        this.logger?.warn?.(`webhook ${hook.id} attempt ${attempt}: ${e.message}`);
      }
      if (attempt < this.retries) await sleep(this.backoffMs * 2 ** attempt);
    }
    if (owner) {
      await this.repo
        .addDelivery(owner, { id: ulid(), deliveryId: payload.id, hookId: hook.id, url: hook.url, event: payload.event, ok: result.ok, status: result.status, error: result.error, attempts, ms: Date.now() - t0, at: new Date().toISOString(), payload: raw.length <= 8000 ? payload : { ...payload, data: "[truncated]" } })
        .catch(() => {});
    }
    return { ...result, payload };
  }

  async drain() {
    await Promise.allSettled([...this.pending]);
  }
}
