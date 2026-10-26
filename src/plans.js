// Plan table. Numbers default to the structure observed on zapi.ink/pricing
// (E02) but are plain config — change them freely for your own product.
//
// minCacheTtl:
//   null → client cannot control cache (`ttl` param ignored)
//   N    → client may lower cache TTL down to N seconds
//   0    → client may bypass the cache entirely ("always fresh")

export const PLANS = {
  free: { id: "free", rank: 0, priceIdr: 0, monthly: 600, perMinute: 100, minCacheTtl: null, bulk: false, bulkCap: 0, webhooks: false, logDays: 7 },
  pro: { id: "pro", rank: 1, priceIdr: 49000, monthly: 25000, perMinute: 2000, minCacheTtl: 30, bulk: false, bulkCap: 0, webhooks: true, logDays: 30 },
  ultra: { id: "ultra", rank: 2, priceIdr: 129000, monthly: 200000, perMinute: 5000, minCacheTtl: 0, bulk: true, bulkCap: 500, webhooks: true, logDays: 90 },
  max: { id: "max", rank: 3, priceIdr: 399000, monthly: 1000000, perMinute: 15000, minCacheTtl: 0, bulk: true, bulkCap: 2000, webhooks: true, logDays: 90 },
};

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
