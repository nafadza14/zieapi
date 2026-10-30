// Helpers shared by every scraper module. Browser-compatible on purpose (no node:* imports)
// so handlers can be smoke-tested inside a real browser as well as in Node.

import { ScraperError, NotConfiguredError, UpstreamError } from "../core/errors.js";

export { ScraperError, NotConfiguredError, UpstreamError };

export const UA = "apizie/2 (+https://github.com/nafadza14/zieapi)";

/** Build a URL, dropping undefined / null / "" params. Arrays become repeated keys. */
export function url(base, params = {}) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, String(x)));
    else u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** 5xx and 429 are the provider's problem, not the caller's: surface them as UpstreamError (502 / 429). */
function throwIfUpstreamDown(res, target) {
  if (res.status >= 500) throw new UpstreamError(`Upstream returned ${res.status}`, { upstreamStatus: res.status, context: { url: redactUrl(target) } });
  if (res.status === 429) throw new UpstreamError("Upstream rate-limited this request. Try again later.", { httpStatus: 429, upstreamStatus: 429, retryAfter: res.headers.get("retry-after") ?? "60", context: { url: redactUrl(target) } });
}

/**
 * The SEC's fair-access policy asks automated clients to name themselves and give a contact email in the
 * User-Agent, and to stay under 10 requests per second.
 */
export const SEC_UA = () => env("ZIE_SEC_USER_AGENT") || env("APIZIE_SEC_USER_AGENT") || "Apizie support@zieads.com";
const uaFor = (target) => {
  try {
    return /(^|\.)sec\.gov$/i.test(new URL(target).hostname) ? SEC_UA() : UA;
  } catch {
    return UA;
  }
};

// Per-instance pacing for sec.gov: at most 8 requests per second, under the SEC's 10/s fair-access limit.
const SEC_RPS = 8;
let secSlots = [];
async function secPace() {
  for (;;) {
    const now = Date.now();
    secSlots = secSlots.filter((t) => now - t < 1000);
    if (secSlots.length < SEC_RPS) {
      secSlots.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000 - (now - secSlots[0]) + 5));
  }
}

async function doFetch(ctx, target, init = {}) {
  let res;
  if (uaFor(target) !== UA) await secPace();
  try {
    res = await ctx.fetch(target, {
      ...init,
      signal: ctx.signal,
      headers: { "user-agent": uaFor(target), accept: "application/json, text/plain, */*", ...(init.headers ?? {}) },
    });
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "ZieTimeout") throw e;
    throw new UpstreamError("Upstream unreachable", { context: { url: redactUrl(target), reason: e?.message } });
  }
  return res;
}

/** GET/POST JSON. Throws ScraperError on non-2xx or invalid JSON. */
export async function getJson(ctx, target, init = {}) {
  const res = await doFetch(ctx, target, init);
  const text = await res.text();
  if (!res.ok) {
    throwIfUpstreamDown(res, target);
    throw new ScraperError(`Upstream returned ${res.status}`, { status: res.status, context: { url: redactUrl(target), body: text.slice(0, 300) } });
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new ScraperError("Upstream returned invalid JSON", { context: { url: redactUrl(target), body: text.slice(0, 300) } });
  }
}

/** POST a JSON body and parse JSON. */
export function postJson(ctx, target, body, init = {}) {
  return getJson(ctx, target, { ...init, method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
}

/** GET text (HTML, XML, CSV). Throws ScraperError on non-2xx. */
export async function getText(ctx, target, init = {}) {
  const res = await doFetch(ctx, target, { ...init, headers: { accept: "*/*", ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) {
    throwIfUpstreamDown(res, target);
    throw new ScraperError(`Upstream returned ${res.status}`, { status: res.status, context: { url: redactUrl(target) } });
  }
  return text;
}

/** Read a required env var (works in Node; in the browser returns undefined). */
export function env(name) {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}
export function requireEnv(name) {
  const v = env(name);
  if (!v) throw new NotConfiguredError(`This endpoint needs the ${name} environment variable on the server.`);
  return v;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
export function stripHtml(s) {
  const once = String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ");
  return decodeEntities(decodeEntities(once).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = re.exec(block);
  if (!m) return null;
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
}
function attr(block, name, attribute) {
  const re = new RegExp(`<${name}\\s[^>]*${attribute}=["']([^"']+)["']`, "i");
  return re.exec(block)?.[1] ?? null;
}

/** Parse RSS 2.0 or Atom into a normalised list. */
export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const channelTitle = stripHtml(tag(xml.split(/<item[\s>]|<entry[\s>]/i)[0], "title") ?? "");
  const items = blocks.map((b) => {
    const link = isAtom ? attr(b, "link", "href") ?? tag(b, "link") : tag(b, "link") ?? attr(b, "link", "href");
    const rawDesc = tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? tag(b, "content:encoded") ?? "";
    const image =
      attr(b, "media:content", "url") ?? attr(b, "media:thumbnail", "url") ?? attr(b, "enclosure", "url") ?? /<img[^>]+src=["']([^"']+)["']/i.exec(decodeEntities(rawDesc))?.[1] ?? null;
    const date = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    const iso = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : date ?? null;
    return {
      title: stripHtml(tag(b, "title")),
      link: link ? decodeEntities(link.trim()) : null,
      description: stripHtml(rawDesc).slice(0, 500) || null,
      publishedAt: iso,
      author: stripHtml(tag(b, "dc:creator") ?? tag(b, "author") ?? "") || null,
      categories: [...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((m) => stripHtml(m[1])).filter(Boolean),
      image: image ? decodeEntities(image) : null,
    };
  });
  return { title: channelTitle || null, count: items.length, items };
}

/** Fetch + parse a feed, trimming to `limit`. */
export async function feed(ctx, target, limit = 20) {
  const xml = await getText(ctx, target, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
  const f = parseFeed(xml);
  return { ...f, items: f.items.slice(0, limit), count: Math.min(f.items.length, limit), source: target };
}

export const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

function redactUrl(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/key|token|secret|sig/i.test(k)) x.searchParams.set(k, "REDACTED");
    return x.toString();
  } catch {
    return String(u);
  }
}

/** Shorthand field builders. */
export const f = {
  str: (name, opts = {}) => ({ name, type: "string", required: false, ...opts }),
  req: (name, opts = {}) => ({ name, type: "string", required: true, ...opts }),
  int: (name, opts = {}) => ({ name, type: "integer", required: false, ...opts }),
  num: (name, opts = {}) => ({ name, type: "number", required: false, ...opts }),
  bool: (name, opts = {}) => ({ name, type: "boolean", required: false, ...opts }),
  enm: (name, values, opts = {}) => ({ name, type: "string", required: false, enum: values, ...opts }),
};
