import { createHash, randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID (time-sortable, 26 chars). */
export function ulid(time = Date.now()) {
  let ts = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let r = "";
  for (let i = 0; i < 16; i++) r += CROCKFORD[rnd[i] % 32];
  return ts + r;
}

/** Deterministic ULID-shaped id from a string (stable across restarts). */
export function stableId(seed) {
  const h = createHash("sha256").update(seed).digest();
  let out = "01";
  for (let i = 0; i < 24; i++) out += CROCKFORD[h[i] % 32];
  return out;
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** JSON.stringify with sorted keys (stable cache keys / fingerprints). */
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
    .join(",")}}`;
}

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

/** Seconds until the 1st of next month, 00:00 UTC. */
export function secondsToMonthReset(d = new Date()) {
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((next - d.getTime()) / 1000));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
