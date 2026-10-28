// Dodo Payments (merchant of record) for card, Apple Pay and Google Pay payments of Apizie invoices.
// Docs: https://docs.dodopayments.com/developer-resources/checkout-session
//       https://docs.dodopayments.com/developer-resources/webhooks (Standard Webhooks signatures)
//
// One "Pay What You Want" product (USD, minimum $1) carries every invoice; the invoice amount is set per checkout
// with product_cart[].amount. The API key and webhook secret come from the environment, never from code:
//   DODO_PAYMENTS_API_KEY, DODO_PAYMENTS_WEBHOOK_SECRET, DODO_PAYMENTS_PRODUCT_ID, DODO_PAYMENTS_ENVIRONMENT=live_mode|test_mode

import { createHmac, timingSafeEqual } from "node:crypto";

const BASE = { live_mode: "https://live.dodopayments.com", test_mode: "https://test.dodopayments.com" };
const TOLERANCE_S = 5 * 60;

export function dodoConfig(env = {}) {
  const apiKey = env.DODO_PAYMENTS_API_KEY ?? env.DODO_API_KEY ?? null;
  const webhookSecret = env.DODO_PAYMENTS_WEBHOOK_SECRET ?? env.DODO_PAYMENTS_WEBHOOK_KEY ?? env.DODO_WEBHOOK_SECRET ?? null;
  const productId = env.DODO_PAYMENTS_PRODUCT_ID ?? null;
  const mode = /^test/i.test(env.DODO_PAYMENTS_ENVIRONMENT ?? "") ? "test_mode" : "live_mode";
  return { apiKey, webhookSecret, productId, mode, base: BASE[mode], enabled: !!(apiKey && productId) };
}

export class DodoError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createDodo(cfg, fetchImpl = globalThis.fetch) {
  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(cfg.base + path, {
        method,
        headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new DodoError("The payment provider could not be reached. Try again in a minute.", 502);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    // Never echo the provider's raw error to customers (it may describe our configuration).
    if (!res.ok) throw new DodoError(res.status === 401 ? "Card payments are misconfigured (invalid Dodo Payments API key)." : `The payment provider returned ${res.status}.`, 502);
    return data;
  }

  return {
    enabled: cfg.enabled,
    mode: cfg.mode,
    /** Hosted checkout for one invoice. Returns { sessionId, checkoutUrl }. */
    async createCheckout({ invoice, user, returnUrl, cancelUrl }) {
      const r = await call("POST", "/checkouts", {
        product_cart: [{ product_id: cfg.productId, quantity: 1, amount: invoice.amount }],
        customer: { email: user.email, name: (user.name || user.email).slice(0, 100) },
        return_url: returnUrl,
        ...(cancelUrl ? { cancel_url: cancelUrl } : {}),
        metadata: { invoice_id: invoice.id, user_id: user.id, app: "apizie" },
      });
      if (!r?.session_id || !r?.checkout_url) throw new DodoError("The payment provider did not return a checkout page.", 502);
      return { sessionId: r.session_id, checkoutUrl: r.checkout_url };
    },
    /** { paymentId, paymentStatus } of a checkout session (both null until the customer pays). */
    async getCheckout(sessionId) {
      const r = await call("GET", `/checkouts/${encodeURIComponent(sessionId)}`);
      return { paymentId: r?.payment_id ?? null, paymentStatus: r?.payment_status ?? null };
    },
    /** Payment details, to check amount, currency and metadata before fulfilling. */
    async getPayment(paymentId) {
      return call("GET", `/payments/${encodeURIComponent(paymentId)}`);
    },
  };
}

/**
 * Standard Webhooks verification: HMAC-SHA256 over "<webhook-id>.<webhook-timestamp>.<raw body>" with the
 * base64 secret after "whsec_", compared against every "v1,<base64>" entry in webhook-signature.
 */
export function verifyDodoWebhook({ secret, headers, rawBody, now = Date.now() }) {
  if (!secret) return { ok: false, reason: "webhook secret not configured" };
  const id = headers["webhook-id"];
  const ts = headers["webhook-timestamp"];
  const sig = headers["webhook-signature"];
  if (!id || !ts || !sig || typeof rawBody !== "string") return { ok: false, reason: "missing signature headers" };
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > TOLERANCE_S) return { ok: false, reason: "timestamp outside tolerance" };
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  for (const part of String(sig).split(" ")) {
    const [v, b64] = part.split(",");
    if (v !== "v1" || !b64) continue;
    const got = Buffer.from(b64, "base64");
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true, id };
  }
  return { ok: false, reason: "signature mismatch" };
}

/** Helper for tests and local tools: sign a payload the way Dodo does. */
export function signDodoWebhook({ secret, id, timestamp, rawBody }) {
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
}
