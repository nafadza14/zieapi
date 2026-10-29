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

// Values pasted into a dashboard often carry quotes, spaces or a trailing newline; names vary too
// (DODO_API_KEY, DODO_PAYMENTS_KEY, DODO_SECRET_KEY...). Both are tolerated so a working key is never ignored.
const clean = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  return s || null;
};
function pick(env, exact, matches) {
  for (const k of exact) if (clean(env[k])) return clean(env[k]);
  const k = Object.keys(env).find((name) => /DODO/i.test(name) && matches(name.toUpperCase()) && clean(env[name]));
  return k ? clean(env[k]) : null;
}

export function dodoConfig(env = {}) {
  const apiKey = pick(env, ["DODO_PAYMENTS_API_KEY", "DODO_API_KEY"], (k) => /(API_?KEY|SECRET_?KEY|_KEY$|_TOKEN$|_SECRET$)/.test(k) && !/WEBHOOK|PUBLISHABLE|PUBLIC|PRODUCT/.test(k));
  const webhookSecret = pick(env, ["DODO_PAYMENTS_WEBHOOK_SECRET", "DODO_PAYMENTS_WEBHOOK_KEY", "DODO_WEBHOOK_SECRET"], (k) => /WEBHOOK/.test(k));
  const productId = pick(env, ["DODO_PAYMENTS_PRODUCT_ID", "DODO_PRODUCT_ID"], (k) => /PRODUCT/.test(k));
  const modeRaw = pick(env, ["DODO_PAYMENTS_ENVIRONMENT", "DODO_PAYMENTS_ENV", "DODO_ENVIRONMENT", "DODO_MODE"], (k) => /ENV|MODE/.test(k));
  const mode = /test|sandbox/i.test(modeRaw ?? "") ? "test_mode" : "live_mode";
  const names = Object.keys(env).filter((k) => /DODO/i.test(k)).sort();
  // A product id is optional: without one, a "Pay What You Want" USD product is created on the first checkout.
  return { apiKey, webhookSecret, productId, mode, modeExplicit: !!modeRaw, base: BASE[mode], enabled: !!apiKey, names };
}

export class DodoError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createDodo(cfg, fetchImpl = globalThis.fetch, { kv = null } = {}) {
  let base = cfg.base;
  let mode = cfg.mode;
  let switched = false;
  async function call(method, path, body) {
    const res = await send(method, path, body);
    // A test key against the live API (or the other way round) answers 401. When the mode was not set
    // explicitly, try the other environment once and stay there.
    if (res.status === 401 && !cfg.modeExplicit && !switched) {
      switched = true;
      const otherMode = mode === "live_mode" ? "test_mode" : "live_mode";
      const other = await send(method, path, body, BASE[otherMode]);
      if (other.status !== 401) {
        base = BASE[otherMode];
        mode = otherMode;
        return read(other);
      }
    }
    return read(res);
  }
  async function send(method, path, body, at = base) {
    try {
      return await fetchImpl(at + path, {
        method,
        headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new DodoError("The payment provider could not be reached. Try again in a minute.", 502);
    }
  }
  async function read(res) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    // Never echo the provider's raw error to customers (it may describe our configuration).
    if (!res.ok) throw new DodoError(res.status === 401 ? "Card payments are misconfigured (invalid Dodo Payments API key)." : `The payment provider returned ${res.status}.`, 502);
    return data;
  }

  let productPromise = null;
  /** The product every checkout uses: DODO_PAYMENTS_PRODUCT_ID, or one created once and remembered. */
  function productId() {
    if (cfg.productId) return Promise.resolve(cfg.productId);
    productPromise ??= (async () => {
      const key = `dodo:product:${mode}`;
      const saved = kv ? await kv.get(key).catch(() => null) : null;
      if (saved) return String(saved);
      const p = await call("POST", "/products", {
        name: "Apizie credit",
        description: "Apizie plans and pay-as-you-go balance. The amount is set by the Apizie invoice.",
        tax_category: "saas",
        price: { type: "one_time_price", price: 100, currency: "USD", discount: 0, purchasing_power_parity: false, pay_what_you_want: true, suggested_price: null, tax_inclusive: false },
        metadata: { app: "apizie" },
      });
      if (!p?.product_id) throw new DodoError("The payment provider did not create the checkout product.", 502);
      if (kv) await kv.set(`dodo:product:${mode}`, p.product_id).catch(() => {});
      return p.product_id;
    })().catch((e) => {
      productPromise = null;
      throw e;
    });
    return productPromise;
  }

  return {
    enabled: cfg.enabled,
    get mode() {
      return mode;
    },
    productId,
    /** Hosted checkout for one invoice. Returns { sessionId, checkoutUrl }. */
    async createCheckout({ invoice, user, returnUrl, cancelUrl }) {
      const r = await call("POST", "/checkouts", {
        product_cart: [{ product_id: await productId(), quantity: 1, amount: invoice.amount }],
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
