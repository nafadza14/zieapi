// Public page metadata extractor with SSRF protection.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ScraperError } from "../executor.js";

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

export function isPrivateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

export async function assertPublicUrl(raw, lookup = dnsLookup) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new ScraperError("Invalid URL");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new ScraperError("Only http(s) URLs are allowed");
  if (u.username || u.password) throw new ScraperError("Credentials in URL are not allowed");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new ScraperError("Port not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new ScraperError("Host could not be resolved");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new ScraperError("Host resolves to a private address");
  return u;
}

function pickMeta(html) {
  const meta = {};
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content !== undefined && !(key in meta)) meta[key] = decode(content);
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const canonical = /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
  const lang = /<html[^>]*\slang=["']([^"']+)["']/i.exec(html)?.[1];
  return { title: title ? decode(title.trim()) : null, meta, canonical: canonical ?? null, lang: lang ?? null };
}

const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

async function readCapped(res) {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, MAX_BYTES);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    chunks.push(value);
    if (size >= MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, MAX_BYTES));
}

export default [
  {
    category: "web-tools",
    slug: "page",
    displayName: "Page Inspector",
    description: "Ambil judul, meta tag, OpenGraph dan canonical dari halaman web publik.",
    tags: ["meta", "opengraph", "seo", "preview", "web"],
    endpoints: [
      {
        slug: "meta",
        displayName: "Page Metadata",
        method: "GET",
        cacheTtl: 900,
        minPlan: "pro",
        bulkEnabled: true,
        timeoutMs: 15000,
        fields: [{ name: "url", type: "string", required: true, max: 2048, example: "https://example.com", description: "Public http(s) URL" }],
        exampleResponse: { url: "https://example.com/", status: 200, title: "Example Domain", meta: {}, canonical: null, lang: "en" },
        handler: async ({ url }, ctx) => {
          let current = url;
          for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const u = await assertPublicUrl(current, ctx.lookup ?? dnsLookup);
            let res;
            try {
              res = await ctx.fetch(u.toString(), { redirect: "manual", signal: ctx.signal, headers: { "user-agent": "zieapi-bot/1 (+https://github.com/nafadza14/zieapi)", accept: "text/html" } });
            } catch (e) {
              throw new ScraperError("Fetch failed", { context: { reason: e.message } });
            }
            if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
              current = new URL(res.headers.get("location"), u).toString();
              continue;
            }
            const type = res.headers.get("content-type") ?? "";
            if (!type.includes("html")) throw new ScraperError(`Not an HTML page (${type || "unknown type"})`, { context: { status: res.status } });
            const html = await readCapped(res);
            return { url: u.toString(), status: res.status, ...pickMeta(html) };
          }
          throw new ScraperError("Too many redirects");
        },
      },
    ],
  },
];
