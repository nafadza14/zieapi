// Per-owner rate limiting (fixed 60s window) + monthly quota (resets 1st UTC).
// 5xx responses are refunded; 4xx are billed.

import { HttpError } from "./envelope.js";
import { getPlan } from "./plans.js";
import { monthKey, secondsToMonthReset } from "./util.js";

export class Limiter {
  constructor(repo, { now = () => Date.now(), onUsage = null, onPayg = null } = {}) {
    Object.assign(this, { repo, now, onUsage, onPayg });
  }

  headers(plan, minuteUsed, monthUsed, extra = {}) {
    const p = getPlan(plan);
    return {
      "X-RateLimit-Limit": String(p.perMinute),
      "X-RateLimit-Remaining": String(Math.max(0, p.perMinute - minuteUsed)),
      "X-RateLimit-Limit-Minute": String(p.perMinute),
      "X-RateLimit-Remaining-Minute": String(Math.max(0, p.perMinute - minuteUsed)),
      "X-RateLimit-Limit-Month": String(p.monthly),
      "X-RateLimit-Remaining-Month": String(Math.max(0, p.monthly - monthUsed)),
      ...extra,
    };
  }

  /** Reserve n requests for `owner` on `plan`. Throws HttpError(429). */
  async reserve(owner, plan, n = 1) {
    const p = getPlan(plan);
    const now = this.now();
    const month = monthKey(new Date(now));
    const window = Math.floor(now / 60000);

    let monthUsed = await this.repo.incrMonth(owner, n, month);
    let payg = 0;
    if (monthUsed > p.monthly) {
      monthUsed = await this.repo.incrMonth(owner, -n, month);
      // Over the plan quota: the pay-as-you-go balance covers it when the owner opted in.
      const balance = await this.repo.tryPaygDebit(owner, n);
      if (balance === null) {
        const used = monthUsed;
        const retryAfterSec = secondsToMonthReset(new Date(now));
        throw new HttpError(
          429,
          { content: { limit: p.monthly, used, window: "month", retryAfterSec }, message: `Monthly quota exceeded: ${p.monthly} requests/month (used ${used}). Upgrade your plan, top up your balance, or wait for the reset on the 1st (UTC).`, errors: [] },
          this.headers(plan, 0, used, { "Retry-After": String(retryAfterSec) })
        );
      }
      payg = n;
      try {
        this.onPayg?.(owner, balance);
      } catch {}
    }
    const minuteUsed = await this.repo.incrMinute(owner, n, window);
    if (minuteUsed > p.perMinute) {
      await this.repo.incrMinute(owner, -n, window);
      if (payg) await this.repo.refundPayg(owner, payg);
      else await this.repo.incrMonth(owner, -n, month);
      const used = minuteUsed - n;
      const retryAfterSec = Math.max(1, 60 - Math.floor((now / 1000) % 60));
      throw new HttpError(
        429,
        { content: { limit: p.perMinute, used, window: "minute", retryAfterSec }, message: `Rate limit exceeded: ${p.perMinute} requests/minute (used ${used}). Upgrade your plan or wait ~${retryAfterSec}s.`, errors: [] },
        this.headers(plan, used, monthUsed - (payg ? 0 : n), { "Retry-After": String(retryAfterSec) })
      );
    }
    if (!payg) {
      try {
        this.onUsage?.(owner, plan, monthUsed - n, monthUsed);
      } catch {}
    }
    let refunded = 0;
    const self = this;
    return {
      minuteUsed,
      monthUsed,
      payg,
      headers() {
        return self.headers(plan, minuteUsed - refunded, payg ? monthUsed : monthUsed - refunded, payg ? { "X-Billing": "payg" } : {});
      },
      async refund(k = n) {
        k = Math.min(k, n - refunded);
        if (k <= 0) return;
        refunded += k;
        await self.repo.incrMinute(owner, -k, window);
        if (payg) await self.repo.refundPayg(owner, k);
        else await self.repo.incrMonth(owner, -k, month);
      },
    };
  }

  async snapshot(owner, plan) {
    const p = getPlan(plan);
    const now = this.now();
    const used = await this.repo.getMonth(owner, monthKey(new Date(now)));
    const minute = await this.repo.getMinute(owner, Math.floor(now / 60000));
    return {
      plan,
      month: { limit: p.monthly, used, remaining: Math.max(0, p.monthly - used), resetsInSec: secondsToMonthReset(new Date(now)) },
      minute: { limit: p.perMinute, used: minute, remaining: Math.max(0, p.perMinute - minute) },
    };
  }
}
