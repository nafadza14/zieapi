// Plan table (IDR). Structure mirrors the plans observed on zapi.ink/pricing (REA report E02);
// edit freely for your own product.
//
// minCacheTtl:
//   null → client cannot control cache (`ttl` param ignored)
//   N    → client may lower cache TTL down to N seconds
//   0    → client may bypass the cache entirely ("always fresh")

export const PLANS = {
  free: { id: "free", rank: 0, priceIdr: 0, monthly: 600, perMinute: 100, minCacheTtl: null, bulk: false, bulkCap: 0, webhooks: false, logDays: 7, maxKeys: 3 },
  pro: { id: "pro", rank: 1, priceIdr: 49000, monthly: 25000, perMinute: 2000, minCacheTtl: 30, bulk: false, bulkCap: 0, webhooks: true, logDays: 30, maxKeys: 10 },
  ultra: { id: "ultra", rank: 2, priceIdr: 129000, monthly: 200000, perMinute: 5000, minCacheTtl: 0, bulk: true, bulkCap: 500, webhooks: true, logDays: 90, maxKeys: 25 },
  max: { id: "max", rank: 3, priceIdr: 399000, monthly: 1000000, perMinute: 15000, minCacheTtl: 0, bulk: true, bulkCap: 2000, webhooks: true, logDays: 90, maxKeys: 50 },
};

export const PLAN_COPY = {
  free: { name: "Free", tagline: "For trying things out and side projects.", cta: "Start free", features: ["600 requests / month", "100 requests / minute", "Every live endpoint", "MCP server for AI agents", "7-day request logs", "Community support"] },
  pro: { name: "Pro", tagline: "For apps with real users.", cta: "Upgrade to Pro", features: ["25,000 requests / month", "2,000 requests / minute", "Cache control down to 30s", "Quota webhooks + signed alerts", "Per-key IP allowlist", "30-day request logs", "Email support"] },
  ultra: { name: "Ultra", tagline: "For data pipelines and teams.", cta: "Upgrade to Ultra", popular: true, features: ["200,000 requests / month", "5,000 requests / minute", "Always-fresh data (ttl=0)", "Bulk jobs (500 items)", "Everything in Pro", "90-day request logs", "Logo on the showcase strip"] },
  max: { name: "Max", tagline: "For heavy production workloads.", cta: "Upgrade to Max", features: ["1,000,000 requests / month", "15,000 requests / minute", "Bulk jobs (2,000 items)", "Everything in Ultra", "Priority support", "Early access to new sources"] },
};

// Pay-as-you-go balance. Amounts are kept in tenths of a rupiah so Rp2.2 per request stays an integer.
export const PAYG = {
  priceTenths: 22,
  topups: [50000, 100000, 250000, 1000000],
  minTopup: 20000,
  lowBalance: 20000,
};
export const requestsForRupiah = (rp) => Math.floor((rp * 10) / PAYG.priceTenths);

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
