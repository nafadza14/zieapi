// Small TTL cache with insertion-order eviction. Replace with Redis in production.

export class TtlCache {
  constructor({ max = 5000, now = () => Date.now() } = {}) {
    this.max = max;
    this.now = now;
    this.map = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }
  set(key, value, ttlSec) {
    if (!ttlSec || ttlSec <= 0) return;
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, at: this.now(), exp: this.now() + ttlSec * 1000 });
  }
  clear() {
    this.map.clear();
  }
}

/**
 * Decide the TTL to honour for this call.
 * - endpointTtl: the endpoint's default cache TTL (seconds, 0/null = no cache)
 * - requested:   client `ttl` param (seconds) or undefined
 * - planMin:     plan.minCacheTtl (null = client has no cache control)
 * Returns { readTtl, writeTtl } — readTtl 0 means bypass the cache on read.
 */
export function effectiveTtl(endpointTtl, requested, planMin) {
  const base = Number(endpointTtl) || 0;
  if (requested === undefined || requested === null || planMin === null || planMin === undefined) {
    return { readTtl: base, writeTtl: base };
  }
  const r = Math.max(planMin, Math.min(Number(requested) || 0, base));
  return { readTtl: r, writeTtl: base };
}
