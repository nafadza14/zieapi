// SSRF guard for endpoints that fetch a user-supplied URL.
// assertPublicUrl() validates scheme/credentials/port and rejects any host that is (or resolves to)
// a private, loopback, link-local, CGNAT, ULA, multicast or otherwise non-public address.

import { ScraperError } from "./kit.js";

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

function parseV4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((x) => x <= 255) ? o : null;
}

/** Parse IPv6 text into 8 16-bit groups (handles "::" and a trailing dotted IPv4). */
function parseV6(s) {
  let v = s.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!v.includes(":")) return null;
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(v);
  if (tail) {
    const o = parseV4(tail[1]);
    if (!o) return null;
    v = v.slice(0, -tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function privateV4([a, b, c]) {
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF / TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast + reserved + broadcast
  );
}

/** True for any address that must not be reachable from a user-supplied URL. Unparseable → true. */
export function isPrivateIp(ip) {
  const s = String(ip ?? "").trim();
  const v4 = parseV4(s);
  if (v4) return privateV4(v4);
  const g = parseV6(s);
  if (!g) return true;
  const embedded = () => [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return privateV4(embedded()); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return true; // deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return privateV4(embedded()); // NAT64
  if (g[0] === 0x2002) return privateV4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only
  return false;
}

const isIpLiteral = (h) => !!parseV4(h) || h.includes(":");

async function defaultLookup(host, opts) {
  const dns = await import("node:dns/promises");
  return dns.lookup(host, opts);
}

/**
 * Validate a user-supplied URL and return it as a URL object.
 * `lookup(host, { all: true })` → [{ address, family }] (defaults to node:dns/promises).
 */
export async function assertPublicUrl(raw, lookup) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new ScraperError("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ScraperError("Only http(s) URLs are allowed");
  if (u.username || u.password) throw new ScraperError("Credentials in URL are not allowed");
  if (!ALLOWED_PORTS.has(u.port)) throw new ScraperError("Port not allowed (use 80, 443, 8080 or 8443)");
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) throw new ScraperError("Invalid URL host");
  if (host === "localhost" || host.endsWith(".localhost")) throw new ScraperError("Host resolves to a private address");
  let addrs;
  if (isIpLiteral(host)) addrs = [{ address: host }];
  else {
    try {
      const r = await (lookup ?? defaultLookup)(host, { all: true });
      addrs = Array.isArray(r) ? r : r ? [r] : [];
    } catch {
      addrs = [];
    }
  }
  if (!addrs.length) throw new ScraperError("Host could not be resolved");
  if (addrs.some((a) => isPrivateIp(typeof a === "string" ? a : a.address))) throw new ScraperError("Host resolves to a private address");
  return u;
}
