// Turns a paid invoice into what the customer bought (plan time or pay-as-you-go balance), once.
// Used by Dodo Payments (webhook or return-page check) and by the admin "approve" action for older bank invoices.
import { PAYG, MICROS, planName, isFinancePlan } from "../core/plans.js";
const fmtUsd = (n) => "$" + Number(n).toFixed(2);

export function createFulfiller({ repo, kv, webhooks, notify, affPercent }) {
  return async function fulfill(inv, opts = {}) {
    // One winner per invoice even if the webhook and the return page arrive at the same moment.
    const lockKey = `lock:fulfill:${inv.id}`;
    if ((await kv.incrby(lockKey, 1, 3600)) !== 1) return { invoice: await repo.getItem("invoice", inv.id), already: true };
    try {
      return await apply(inv, opts);
    } catch (e) {
      await kv.del(lockKey).catch(() => {}); // let the next webhook retry or admin action try again
      throw e;
    }
  };

  async function apply(inv, { via, paymentId = null }) {
    const fresh = await repo.getItem("invoice", inv.id);
    if (!fresh || fresh.status === "paid") return { invoice: fresh, already: true };
    const u = await repo.getUser(inv.userId);
    if (!u) throw Object.assign(new Error("Customer account no longer exists"), { status: 404 });
    // Everything in US dollars. Card invoices: amount in cents. Older bank-transfer invoices (rupiah) carry priceUsd/requests.
    const paidCents = inv.currency === "USD" ? inv.amount ?? 0 : Math.round((inv.priceUsd ?? ((inv.requests ?? 0) * PAYG.usdPer1k) / 1000) * 100);
    if (inv.type === "topup") {
      const credit = inv.creditMicros ?? (inv.requests ?? 0) * PAYG.priceMicros;
      await repo.creditBalance(u.id, credit);
      notify(u.id, "balance", "Balance topped up", `${fmtUsd(credit / MICROS)} was added to your pay-as-you-go balance.`);
    } else if (isFinancePlan(inv.plan)) {
      // Apizie Finance add-on: its own plan and expiry, independent of the general plan.
      const base = u.financePlan === inv.plan && u.financeExpiresAt && Date.parse(u.financeExpiresAt) > Date.now() ? Date.parse(u.financeExpiresAt) : Date.now();
      const until = new Date(base + inv.months * 30 * 86400000).toISOString();
      await repo.updateUser(u.id, { financePlan: inv.plan, financeExpiresAt: until });
      webhooks.emit(u.id, "plan.changed", { product: "finance", plan: inv.plan, planExpiresAt: until, invoice: inv.id });
      notify(u.id, null, `Apizie ${planName(inv.plan)} is active`, `Active until ${until.slice(0, 10)}.`);
    } else {
      const base = u.plan === inv.plan && u.planExpiresAt && Date.parse(u.planExpiresAt) > Date.now() ? Date.parse(u.planExpiresAt) : Date.now();
      const until = new Date(base + inv.months * 30 * 86400000).toISOString();
      await repo.updateUser(u.id, { plan: inv.plan, planExpiresAt: until });
      webhooks.emit(u.id, "plan.changed", { plan: inv.plan, planExpiresAt: until, invoice: inv.id });
      notify(u.id, null, `${planName(inv.plan)} plan is active`, `Active until ${until.slice(0, 10)}.`);
    }
    if (u.referredBy && affPercent > 0 && paidCents > 0) {
      const micros = Math.round((paidCents * 10_000 * affPercent) / 100);
      await repo.addAffEarning(u.referredBy, { invoiceId: inv.id, amountMicros: micros, from: u.id });
      notify(u.referredBy, "affiliate", "Affiliate commission earned", `${fmtUsd(micros / MICROS)} from a referral's payment.`);
    }
    webhooks.emit(u.id, "invoice.paid", { invoice: inv.id, type: inv.type ?? "plan", amount: inv.amount, currency: inv.currency ?? "IDR" }); // amount in cents for USD invoices
    const invoice = await repo.patchItem("invoice", inv.id, { status: "paid", paidAt: new Date().toISOString(), paidVia: via, ...(paymentId ? { paymentId } : {}) });
    return { invoice, already: false };
  }
}
