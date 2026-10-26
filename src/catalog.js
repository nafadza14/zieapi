// Scraper catalog: registry of scrapers → endpoints, plus the public catalog
// read model (shapes match E12/E19–E22).

import { stableId } from "./util.js";
import { maxPlan } from "./plans.js";

export const DEFAULT_CATEGORIES = [
  { slug: "dev-tools", displayName: "Dev Tools", color: "#38bdf8", description: "Utilities for developers — hashing, ids, text helpers." },
  { slug: "indonesia", displayName: "Indonesia", color: "#ef4444", description: "Indonesian public data sources." },
  { slug: "finance", displayName: "Finance", color: "#22c55e", description: "Markets, prices and economic data." },
  { slug: "web-tools", displayName: "Web Tools", color: "#a78bfa", description: "Fetch and inspect public web pages." },
  { slug: "social-media", displayName: "Social Media", color: "#f472b6", description: "Public profiles and posts." },
  { slug: "news", displayName: "News", color: "#f59e0b", description: "Headlines and articles." },
  { slug: "research", displayName: "Research", color: "#14b8a6", description: "Papers, reviews and datasets." },
];

export class Catalog {
  constructor({ categories = DEFAULT_CATEGORIES, publicUrl = "" } = {}) {
    this.categories = categories.map((c) => ({ iconUrl: null, ...c }));
    this.scrapers = []; // registration order
    this.publicUrl = publicUrl;
  }

  register(def) {
    if (!def?.category || !def?.slug) throw new Error("scraper needs category + slug");
    if (!this.categories.some((c) => c.slug === def.category)) throw new Error(`Unknown category "${def.category}"`);
    const key = `${def.category}:${def.slug}`;
    if (this.scrapers.some((s) => s.key === key)) throw new Error(`Duplicate scraper ${key}`);
    const scraper = {
      id: stableId(key),
      key,
      category: def.category,
      slug: def.slug,
      displayName: def.displayName ?? def.slug,
      description: def.description ?? null,
      tags: def.tags ?? [],
      iconUrl: def.iconUrl ?? null,
      enabled: def.enabled !== false,
      minPlan: def.minPlan ?? null,
      indonesian: !!def.indonesian,
      createdAt: def.createdAt ?? null,
      updatedAt: def.updatedAt ?? null,
      endpoints: (def.endpoints ?? []).map((ep) => ({
        id: stableId(`${key}/${ep.slug}`),
        slug: ep.slug,
        displayName: ep.displayName ?? ep.slug,
        description: ep.description ?? null,
        method: (ep.method ?? "GET").toUpperCase(),
        fields: ep.fields ?? [],
        cacheTtl: ep.cacheTtl ?? 0,
        pathTemplate: ep.pathTemplate ?? null,
        exampleResponse: ep.exampleResponse ?? null,
        enabled: ep.enabled !== false,
        minPlan: ep.minPlan ?? null,
        bulkEnabled: !!ep.bulkEnabled,
        stream: !!ep.stream,
        timeoutMs: ep.timeoutMs ?? 30000,
        handler: ep.handler,
      })),
    };
    for (const ep of scraper.endpoints) {
      if (typeof ep.handler !== "function") throw new Error(`${key}/${ep.slug} has no handler`);
    }
    this.scrapers.push(scraper);
    return scraper;
  }

  /** Accepts "category:slug" or bare "slug". */
  find(ref) {
    if (!ref) return null;
    if (ref.includes(":")) return this.scrapers.find((s) => s.key === ref) ?? null;
    return this.scrapers.find((s) => s.slug === ref) ?? null;
  }

  resolve(projectKey, endpointSlug) {
    const scraper = this.find(projectKey);
    if (!scraper || !projectKey.includes(":")) return { scraper: null, endpoint: null };
    return { scraper, endpoint: scraper.endpoints.find((e) => e.slug === endpointSlug) ?? null };
  }

  // ---- public read model --------------------------------------------------
  listItem(s, stats) {
    return {
      id: s.id,
      slug: s.slug,
      category: s.category,
      displayName: s.displayName,
      description: s.description,
      tags: s.tags,
      iconUrl: s.iconUrl,
      endpointCount: s.endpoints.length,
      totalRequests: stats(s.id).requests,
      maxCacheTtl: Math.max(0, ...s.endpoints.map((e) => e.cacheTtl || 0)),
      minPlan: s.minPlan,
      hasBulk: s.endpoints.some((e) => e.bulkEnabled),
      hasGatedEndpoint: s.endpoints.some((e) => !!e.minPlan),
    };
  }

  list({ q, cat, cursor, limit, sort = "popular", bulk, indonesian } = {}, stats = () => ({ requests: 0 })) {
    let rows = this.scrapers.filter((s) => s.enabled);
    if (cat) rows = rows.filter((s) => s.category === cat);
    if (bulk === "true" || bulk === true) rows = rows.filter((s) => s.endpoints.some((e) => e.bulkEnabled));
    if (indonesian === "true" || indonesian === true) rows = rows.filter((s) => s.indonesian || s.category === "indonesia");
    if (q) {
      const needle = String(q).toLowerCase();
      rows = rows.filter((s) =>
        [s.slug, s.displayName, s.description ?? "", ...s.tags, ...s.endpoints.flatMap((e) => [e.slug, e.displayName ?? "", e.description ?? ""])]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      );
    }
    const items = rows.map((s) => this.listItem(s, stats));
    if (sort === "name") items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    else if (sort === "endpoints") items.sort((a, b) => b.endpointCount - a.endpointCount);
    else items.sort((a, b) => b.totalRequests - a.totalRequests || a.displayName.localeCompare(b.displayName));
    const lim = Math.min(100, Math.max(1, Number(limit) || 20));
    const off = Math.max(0, Number(cursor) || 0);
    const page = items.slice(off, off + lim);
    const next = off + lim < items.length ? String(off + lim) : null;
    return { items: page, nextCursor: next, total: items.length };
  }

  detail(ref, stats) {
    const s = this.find(ref);
    if (!s) return null;
    return {
      id: s.id,
      slug: s.slug,
      category: s.category,
      displayName: s.displayName,
      description: s.description,
      tags: s.tags,
      iconUrl: s.iconUrl,
      iconUrlPng: null,
      enabled: s.enabled,
      minPlan: s.minPlan,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      endpoints: s.endpoints.map((e) => ({
        id: e.id,
        slug: e.slug,
        displayName: e.displayName,
        description: e.description,
        method: e.method,
        paramsSchema: Object.fromEntries(e.fields.map((f) => [f.name, f.type])),
        cacheTtl: e.cacheTtl,
        pathTemplate: e.pathTemplate,
        exampleResponse: e.exampleResponse,
        requestCount: stats ? stats(s.id).requests : null,
        lastRequestAt: null,
        enabled: e.enabled,
        minPlan: maxPlan(s.minPlan, e.minPlan),
        bulkEnabled: e.bulkEnabled,
      })),
    };
  }

  schema(ref, endpointSlug) {
    const s = this.find(ref);
    const e = s?.endpoints.find((x) => x.slug === endpointSlug);
    if (!e) return null;
    return { fields: e.fields.map((f) => ({ in: pathFieldNames(e).includes(f.name) ? "path" : "query", ...f })) };
  }

  categoryList() {
    return this.categories.map(({ slug, displayName, iconUrl, color, description }) => ({ slug, displayName, iconUrl, color, description }));
  }

  categoryCounts() {
    return this.categories.map((c) => {
      const ss = this.scrapers.filter((s) => s.category === c.slug && s.enabled);
      return { slug: c.slug, displayName: c.displayName, scrapers: ss.length, endpoints: ss.reduce((n, s) => n + s.endpoints.length, 0) };
    });
  }

  totals() {
    const enabled = this.scrapers.filter((s) => s.enabled);
    return {
      scrapers: enabled.length,
      endpoints: enabled.reduce((n, s) => n + s.endpoints.length, 0),
      categories: new Set(enabled.map((s) => s.category)).size,
    };
  }
}

/** ":username" / ":a/:b" → ["username"] / ["a","b"] */
export function pathFieldNames(endpoint) {
  return (endpoint.pathTemplate ?? "")
    .split("/")
    .filter((p) => p.startsWith(":"))
    .map((p) => p.slice(1));
}
