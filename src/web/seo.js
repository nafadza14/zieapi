// SEO + GEO helpers: one place for brand facts, request context (canonical URLs),
// JSON-LD builders and markdown twins of pages for AI assistants.
//
// Why: search engines rank on titles, descriptions, canonical URLs and structured data;
// AI answer engines (ChatGPT, Claude, Perplexity, Gemini) quote short, factual,
// self-contained passages and read llms.txt / markdown more reliably than JS-rendered UI.

import { AsyncLocalStorage } from "node:async_hooks";
import { PLANS, PLAN_COPY } from "../core/plans.js";

export const BRAND = {
  name: "Apizie",
  legalName: "Ziera Technology",
  tagline: "One API key for every public data source",
  description:
    "Apizie turns 3,700+ public APIs and data sources (Wikipedia, GitHub, Binance, arXiv, news and more) into clean JSON behind one API key, with an MCP server for Claude, ChatGPT and Cursor. Free 1,000 requests a month.",
  repo: "https://github.com/nafadza14/zieapi",
  email: "support@zieads.com",
  locale: "en_US",
  altLocale: "id_ID",
  twitter: null,
};

// ---------- request context ------------------------------------------------------
const als = new AsyncLocalStorage();
export const runWithSeo = (ctx, fn) => als.run(ctx, fn);
export const seoCtx = () => als.getStore() ?? { publicUrl: "", path: "/" };
export const absUrl = (p = "/") => {
  const { publicUrl } = seoCtx();
  if (/^https?:\/\//.test(p)) return p;
  return (publicUrl || "") + (p.startsWith("/") ? p : "/" + p);
};

/** Trim a description to ~155 characters on a word boundary. */
export function metaDescription(s, max = 158) {
  const t = String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/[\s,;:.-]+\S*$/, "") + "…";
}

// ---------- JSON-LD -------------------------------------------------------------
export function siteGraph() {
  const base = absUrl("/");
  const org = {
    "@type": "Organization",
    "@id": `${base}#org`,
    name: BRAND.name,
    alternateName: ["Apizie API", "apizie", "apizie.tech"],
    url: base,
    logo: { "@type": "ImageObject", url: absUrl("/assets/icon-512.png"), width: 512, height: 512 },
    legalName: BRAND.legalName,
    parentOrganization: { "@type": "Organization", name: BRAND.legalName, address: { "@type": "PostalAddress", streetAddress: "Ziera HQ, Somodaran, Kalasan", addressLocality: "Sleman", addressRegion: "DI Yogyakarta", postalCode: "55571", addressCountry: "ID" } },
    sameAs: [BRAND.repo],
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: BRAND.email, availableLanguage: ["English", "Indonesian"] },
  };
  const site = {
    "@type": "WebSite",
    "@id": `${base}#website`,
    url: base,
    name: BRAND.name,
    description: BRAND.description,
    publisher: { "@id": `${base}#org` },
    inLanguage: "en",
    potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: `${absUrl("/scrapers")}?q={search_term_string}` }, "query-input": "required name=search_term_string" },
  };
  const app = {
    "@type": "SoftwareApplication",
    "@id": `${base}#software`,
    name: BRAND.name,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "API gateway",
    operatingSystem: "Web",
    url: base,
    description: BRAND.description,
    publisher: { "@id": `${base}#org` },
    featureList: ["REST API with one JSON envelope", "MCP server (Streamable HTTP, OAuth 2.1)", "Bulk jobs", "Signed webhooks", "OpenAPI 3.1 and llms.txt", "3,300+ global APIs from official OpenAPI specs"],
    offers: Object.values(PLANS).map((p) => ({
      "@type": "Offer",
      name: `${PLAN_COPY[p.id]?.name ?? p.id} plan`,
      price: String(p.priceUsd ?? 0),
      priceCurrency: "USD",
      description: `${p.monthly.toLocaleString("en-US")} requests per month, ${p.perMinute.toLocaleString("en-US")} per minute`,
      url: absUrl("/pricing"),
    })),
  };
  return [org, site, app];
}

export function breadcrumb(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: absUrl(path) })),
  };
}

export function faqLd(list, id = "#faq") {
  return {
    "@type": "FAQPage",
    "@id": absUrl(seoCtx().path) + id,
    mainEntity: list.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}

export function webPageLd({ name, description, type = "WebPage", extra = {} }) {
  const url = absUrl(seoCtx().path);
  const base = absUrl("/");
  return { "@type": type, "@id": url, url, name, description, inLanguage: "en", isPartOf: { "@id": `${base}#website` }, publisher: { "@id": `${base}#org` }, dateModified: BUILD_DATE, ...extra };
}

export function apiLd(s, category) {
  const url = absUrl(`/api/${s.category}/${s.slug}`);
  const base = absUrl("/");
  return {
    "@type": "WebAPI",
    "@id": `${url}#api`,
    name: `${s.displayName} API`,
    description: s.description ?? `${s.displayName} as JSON through Apizie.`,
    url,
    documentation: absUrl(`/api/${s.category}/${s.slug}/openapi.json`),
    termsOfService: absUrl("/terms"),
    provider: { "@id": `${base}#org` },
    ...(s.iconUrl ? { image: absUrl(s.iconUrl) } : {}),
    keywords: [`${s.displayName} API`, `${s.displayName} JSON API`, category?.displayName, ...(s.tags ?? [])].filter(Boolean).join(", "),
    offers: { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD", description: "1,000 requests per month, no credit card" },
    ...(s.sourceUrl ? { isBasedOn: s.sourceUrl } : {}),
  };
}

export const ldScript = (nodes) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": nodes.filter(Boolean) }).replace(/</g, "\\u003c")}</script>`;

// The day this build started; used for sitemap lastmod and dateModified.
export const BUILD_DATE = new Date().toISOString();

// ---------- robots.txt -----------------------------------------------------------
// Search and answer engines are explicitly welcome: being quoted by AI assistants is
// how developers discover APIs now. Private areas stay out for everyone.
export const AI_AGENTS = [
  "Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "GPTBot", "Claude-SearchBot", "Claude-User", "ClaudeBot",
  "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot", "Applebot-Extended", "meta-externalagent", "DuckAssistBot", "CCBot",
];
const PRIVATE = ["/dashboard", "/admin", "/api/me", "/api/admin", "/oauth/", "/auth/", "/login", "/register", "/v1/"];

export function robotsTxt(publicUrl) {
  const block = (ua) => [`User-agent: ${ua}`, "Allow: /", ...PRIVATE.map((p) => `Disallow: ${p}`)].join("\n");
  return [
    "# Apizie: one API key for 3,700+ public data sources.",
    `# AI agents: start at ${publicUrl}/llms.txt (summary) or ${publicUrl}/llms-full.txt (full catalog).`,
    "# Every catalog and docs page also has a Markdown twin: append .md or send Accept: text/markdown.",
    "",
    block("*"),
    "",
    ...AI_AGENTS.map((a) => block(a) + "\n"),
    `Sitemap: ${publicUrl}/sitemap.xml`,
    "",
  ].join("\n");
}

// ---------- markdown twins ---------------------------------------------------------
/** Very small HTML → Markdown for our own server-rendered fragments (docs bodies). */
export function htmlToMd(html) {
  return String(html)
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, (_, c) => "\n```\n" + decode(c) + "\n```\n")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/g, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, "\n### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, "- $1\n")
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/g, (_, r) => "| " + r.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g, "$1 | ").trim() + "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, "[$2]($1)")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/g, "**$2**")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// ---------- answer-first facts for one API page (shared by HTML, Markdown and JSON-LD) ----------
const STATUS_TEXT = { live: "Live: works with just an Apizie key", byok: "Needs your own provider key (bring your own key)", upstream: "Served through the upstream gateway", planned: "Listed, not live yet" };
export function apiSummary(s, apiUrl) {
  const eps = s.endpoints ?? [];
  const live = eps.filter((e) => e.status === "live").length;
  const names = eps.slice(0, 4).map((e) => e.displayName).join(", ");
  return `${s.displayName} API on Apizie: ${s.endpointCount ?? eps.length} endpoint${(s.endpointCount ?? eps.length) === 1 ? "" : "s"}${names ? ` (${names}${eps.length > 4 ? ", …" : ""})` : ""} returned as clean JSON through one API key. ${s.status === "byok" ? "Send your own provider key in the x-upstream-key header." : live ? `${live} endpoint${live === 1 ? " is" : "s are"} live now.` : "Not live on this server yet."} Call it over REST at ${apiUrl}/v1/${s.key}/{endpoint} or from Claude, ChatGPT and Cursor through the Apizie MCP server. Free plan: 1,000 requests a month.`;
}
export function apiFaq(s, apiUrl) {
  const ep = (s.endpoints ?? [])[0];
  const example = ep ? `${apiUrl}/v1/${s.key}/${ep.slug}` : `${apiUrl}/v1/${s.key}/{endpoint}`;
  return [
    [`How do I call the ${s.displayName} API?`, `Create a free Apizie key, then send ${ep?.method ?? "GET"} ${example} with the header x-api-key. Every endpoint returns { project, data, timestamp }.`],
    [`Is the ${s.displayName} API free on Apizie?`, `Yes. The Free plan includes 1,000 requests a month at 100 requests a minute, no credit card. ${s.status === "byok" ? `${s.displayName} itself also needs your own key from ${s.provider ?? "the provider"}.` : ""}`.trim()],
    [`Can AI agents use the ${s.displayName} API?`, `Yes. Add the Apizie MCP server (${apiUrl}/mcp) to Claude, ChatGPT, Cursor or VS Code, then ask in plain language. The agent calls run_scraper with project key ${s.key}.`],
    [`What is the status of the ${s.displayName} API?`, STATUS_TEXT[s.status] ?? s.status],
  ];
}
