// Plan table. Every price is in US dollars and paid by card through Dodo Payments.
// Research behind the numbers: docs/PRICING.md.
//
// minCacheTtl:
//   null → client cannot control cache (`ttl` param ignored)
//   N    → client may lower cache TTL down to N seconds
//   0    → client may bypass the cache entirely ("always fresh")

export const PLANS = {
  free: { id: "free", rank: 0, priceUsd: 0, monthly: 1000, perMinute: 100, minCacheTtl: null, bulk: false, bulkCap: 0, webhooks: false, logDays: 7, maxKeys: 3 },
  pro: { id: "pro", rank: 1, priceUsd: 9, monthly: 25000, perMinute: 2000, minCacheTtl: 30, bulk: false, bulkCap: 0, webhooks: true, logDays: 30, maxKeys: 10 },
  ultra: { id: "ultra", rank: 2, priceUsd: 29, monthly: 200000, perMinute: 5000, minCacheTtl: 0, bulk: true, bulkCap: 500, webhooks: true, logDays: 90, maxKeys: 25 },
  max: { id: "max", rank: 3, priceUsd: 99, monthly: 1000000, perMinute: 15000, minCacheTtl: 0, bulk: true, bulkCap: 2000, webhooks: true, logDays: 90, maxKeys: 50 },
};

// Yearly billing: pay for 10 months, get 12.
export const ANNUAL_PAID_MONTHS = 10;
export const billedMonths = (months) => (months >= 12 ? Math.round((months / 12) * ANNUAL_PAID_MONTHS) : months);

export const usd = (n) => "$" + (Number.isInteger(n) ? String(n) : Number(n).toFixed(2));
export const perThousandUsd = (p) => (p.priceUsd ? usd(Math.round((p.priceUsd / p.monthly) * 100000) / 100) : null);

export const PLAN_COPY = {
  free: { name: "Free", tagline: "For trying things out and side projects.", cta: "Start free", features: ["1,000 requests / month", "100 requests / minute", "Every live endpoint", "MCP server for AI agents", "7-day request logs", "Community support"] },
  pro: { name: "Pro", tagline: "For apps with real users.", cta: "Upgrade to Pro", features: ["25,000 requests / month", "2,000 requests / minute", "Cache control down to 30s", "Quota webhooks + signed alerts", "Per-key IP allowlist", "30-day request logs", "Email support"] },
  ultra: { name: "Ultra", tagline: "For data pipelines and teams.", cta: "Upgrade to Ultra", popular: true, features: ["200,000 requests / month", "5,000 requests / minute", "Always-fresh data (ttl=0)", "Bulk jobs (500 items)", "Everything in Pro", "90-day request logs", "Logo on the showcase strip"] },
  max: { name: "Max", tagline: "For heavy production workloads.", cta: "Upgrade to Max", features: ["1,000,000 requests / month", "15,000 requests / minute", "Bulk jobs (2,000 items)", "Everything in Ultra", "Priority support", "Early access to new sources"] },
};

// Pay-as-you-go: requests above the plan quota cost $0.40 per 1,000 (priced above Pro's rate so the
// plans stay the better deal). Balances are kept in micro-dollars: $0.0004 per request = 400 micros.
export const MICROS = 1_000_000;
export const PAYG = {
  usdPer1k: 0.4,
  priceMicros: 400,
  topupsUsd: [5, 10, 25, 50],
  minTopupUsd: 5,
  maxTopupUsd: 5000,
  lowBalanceUsd: 5,
};
export const requestsForUsd = (usd) => Math.floor((usd * MICROS) / PAYG.priceMicros);
// Balances written before October 2026 were kept in tenths of a rupiah (66 per request); same requests, new unit.
export const LEGACY_TENTHS_PER_REQUEST = 66;
export const microsFromLegacyTenths = (t) => Math.round((Number(t) || 0) * (PAYG.priceMicros / LEGACY_TENTHS_PER_REQUEST));

export function getPlan(id) {
  return PLANS[id] ?? PLANS.free;
}

/** true when `planId` satisfies `required` (null/undefined = no gate). */
export function planAllows(planId, required) {
  if (!required) return true;
  return getPlan(planId).rank >= getPlan(required).rank;
}

/** Highest of two plan ids (null-safe). */
export function maxPlan(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return getPlan(a).rank >= getPlan(b).rank ? a : b;
}
