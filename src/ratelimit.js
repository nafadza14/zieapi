// Per-key rate limiting: fixed 60s window + monthly quota (resets 1st, UTC).
// Rule from E02: 5xx responses are refunded, 4xx are counted.

import { HttpError } from "./envelope.js";
import { getPlan } from "./plans.js";
import { monthKey, secondsToMonthReset } from "./util.js";

export class RateLimiter {
  constructor(store, { now = () => Date.now(), onUsage = null } = {}) {
    this.store = store;
    this.now = now;
    this.onUsage = onUsage; // (keyRec, before, after, plan) => void
    this.minute = new Map(); // keyId -> {window, count}
  }

  _minuteBucket(keyId) {
    const w = Math.floor(this.now() / 60000);
    let b = this.minute.get(keyId);
    if (!b || b.window !== w) {
      b = { window: w, count: 0 };
      this.minute.set(keyId, b);
    }
    return b;
  }

  /**
   * Reserve `n` requests. Returns a ticket with headers + refund().
   * Throws HttpError(429) when either window is exhausted.
   */
  reserve(keyRec, n = 1) {
    const plan = getPlan(keyRec.plan);
    const month = monthKey(new Date(this.now()));
    const used = this.store.getUsage(keyRec.id, month);
    const bucket = this._minuteBucket(keyRec.id);

    if (used + n > plan.monthly) {
      const retryAfterSec = secondsToMonthReset(new Date(this.now()));
      throw new HttpError(
        429,
        {
          content: { limit: plan.monthly, used, window: "month", retryAfterSec },
          message: `Monthly quota exceeded — ${plan.monthly} requests/month (used ${used}). Upgrade plan or wait for the reset on the 1st (UTC).`,
          errors: [],
        },
        this._headers(plan, bucket.count, used, { "Retry-After": String(retryAfterSec) })
      );
    }
    if (bucket.count + n > plan.perMinute) {
      const retryAfterSec = Math.max(1, 60 - Math.floor((this.now() / 1000) % 60));
      throw new HttpError(
        429,
        {
          content: { limit: plan.perMinute, used: bucket.count, window: "minute", retryAfterSec },
          message: `Rate limit exceeded — ${plan.perMinute} requests/minute (used ${bucket.count}). Upgrade plan or wait ~${retryAfterSec}s.`,
          errors: [],
        },
        this._headers(plan, bucket.count, used, { "Retry-After": String(retryAfterSec) })
      );
    }

    bucket.count += n;
    const newUsed = this.store.addUsage(keyRec.id, n, month);
    try {
      this.onUsage?.(keyRec, used, newUsed, plan);
    } catch {}
    let refunded = false;
    return {
      headers: () => this._headers(plan, bucket.count, this.store.getUsage(keyRec.id, month)),
      refund: (k = n) => {
        if (refunded) return;
        refunded = true;
        bucket.count = Math.max(0, bucket.count - k);
        this.store.addUsage(keyRec.id, -k, month);
      },
      used: newUsed,
    };
  }

  _headers(plan, minuteUsed, monthUsed, extra = {}) {
    return {
      "X-RateLimit-Limit": String(plan.perMinute),
      "X-RateLimit-Remaining": String(Math.max(0, plan.perMinute - minuteUsed)),
      "X-RateLimit-Limit-Minute": String(plan.perMinute),
      "X-RateLimit-Remaining-Minute": String(Math.max(0, plan.perMinute - minuteUsed)),
      "X-RateLimit-Limit-Month": String(plan.monthly),
      "X-RateLimit-Remaining-Month": String(Math.max(0, plan.monthly - monthUsed)),
      ...extra,
    };
  }

  snapshot(keyRec) {
    const plan = getPlan(keyRec.plan);
    const b = this._minuteBucket(keyRec.id);
    const used = this.store.getUsage(keyRec.id, monthKey(new Date(this.now())));
    return {
      month: { limit: plan.monthly, used, remaining: Math.max(0, plan.monthly - used), resetsInSec: secondsToMonthReset(new Date(this.now())) },
      minute: { limit: plan.perMinute, used: b.count, remaining: Math.max(0, plan.perMinute - b.count) },
    };
  }
}
