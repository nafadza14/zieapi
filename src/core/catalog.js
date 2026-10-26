// Catalog = seed structure (all sources/endpoints) merged with live implementations.
// Endpoint status: "live" (handler here), "upstream" (forwarded via ZIE_UPSTREAM_URL) or "planned".

import { stableId } from "./util.js";
import { maxPlan } from "./plans.js";
import { SEED_CATEGORIES, SEED_SCRAPERS } from "../catalog/seed.js";

const CATEGORY_BLURBS = {
  ads: "Public ad-library intelligence.",
  ai: "Chat, speech and generation endpoints.",
  application: "App-store listings, reviews and charts.",
  autocomplete: "Search suggestions from major engines.",
  design: "Design resources.",
  "dev-tools": "DNS, WHOIS, hashing and other developer utilities.",
  downloader: "Media download helpers.",
  esport: "Players, teams and tournaments.",
  finance: "Stocks, crypto, FX, gold and macro data — IDX first.",
  food: "Recipes, menus and food products.",
  games: "Game profiles and game data.",
  health: "Medical vocabularies, WHO and public-health data.",
  indonesia: "Indonesian public services and open data.",
  jobs: "Job listings from Indonesian and global boards.",
  logistics: "Parcel tracking and shipping rates.",
  marketplace: "Products and shops from e-commerce sites.",
  movie: "Films, TV and anime databases.",
  music: "Tracks, albums, artists and charts.",
  news: "Headlines and articles from Indonesian and global outlets.",
  places: "Nearby places and points of interest.",
  research: "Papers, citations and academic databases.",
  "search-tools": "Web, code and knowledge search.",
  "social-media": "Public profiles and posts.",
  "temp-mail": "Disposable inboxes for testing.",
  uploader: "File upload helpers.",
  "web-tools": "Fetch, inspect and transform web pages.",
};

const titleCase = (s) => s.replace(/(^|-)([a-z])/g, (_, a, b) => (a ? " " : "") + b.toUpperCase());

export class Catalog {
  constructor({ live = [], upstream = false, seed = true } = {}) {
    this.upstream = upstream;
    this.categories = SEED_CATEGORIES.map((c) => ({ ...c, iconUrl: null, description: CATEGORY_BLURBS[c.slug] ?? "" }));
    this.map = new Map();
    if (seed) for (const s of SEED_SCRAPERS) this._addSeed(s);
    for (const def of live) this._addLive(def);
    this.scrapers = [...this.map.values()];
    for (const s of this.scrapers) s.status = s.endpoints.some((e) => e.status === "live") ? "live" : upstream ? "upstream" : "planned";
  }

  _blank(key, displayName, tags = []) {
    const [category, slug] = key.split(":");
    if (!this.categories.some((c) => c.slug === category)) this.categories.push({ slug: category, displayName: titleCase(category), color: "#94a3b8", iconUrl: null, description: "" });
    return { id: stableId(key), key, category, slug, displayName, description: null, tags, iconUrl: null, enabled: true, minPlan: null, indonesian: category === "indonesia" || tags.some((t) => ["indonesia", "idx", "saham"].includes(t)), endpoints: [] };
  }

  _addSeed(s) {
    const sc = this._blank(s.k, s.n, s.t);
    for (const e of s.e) {
      sc.endpoints.push(this._endpoint(sc.key, { slug: e.s, displayName: e.d, method: e.m ?? "GET", pathTemplate: e.p ?? null, fields: e.f, cacheTtl: 300 }, null));
    }
    this.map.set(sc.key, sc);
  }

  _addLive(def) {
    const key = `${def.category}:${def.slug}`;
    const sc = this.map.get(key) ?? this._blank(key, def.displayName, def.tags ?? []);
    sc.displayName = def.displayName ?? sc.displayName;
    sc.description = def.description ?? sc.description;
    sc.tags = [...new Set([...(sc.tags ?? []), ...(def.tags ?? [])])];
    sc.minPlan = def.minPlan ?? sc.minPlan;
    if (def.indonesian) sc.indonesian = true;
    for (const ep of def.endpoints) {
      const built = this._endpoint(key, ep, ep.handler);
      const i = sc.endpoints.findIndex((x) => x.slug === ep.slug);
      if (i >= 0) sc.endpoints[i] = built;
      else sc.endpoints.push(built);
    }
    this.map.set(key, sc);
  }

  _endpoint(key, ep, handler) {
    return {
      id: stableId(`${key}/${ep.slug}`),
      slug: ep.slug,
      displayName: ep.displayName ?? titleCase(ep.slug),
      description: ep.description ?? null,
      method: (ep.method ?? "GET").toUpperCase(),
      fields: (ep.fields ?? []).map((f) => ({ ...f })),
      cacheTtl: ep.cacheTtl ?? 300,
      pathTemplate: ep.pathTemplate ?? null,
      enabled: ep.enabled !== false,
      minPlan: ep.minPlan ?? null,
      bulkEnabled: !!ep.bulkEnabled,
      timeoutMs: ep.timeoutMs ?? 25000,
      exampleResponse: ep.exampleResponse ?? null,
      handler,
      status: handler ? "live" : this.upstream ? "upstream" : "planned",
    };
  }

  find(ref) {
    if (!ref) return null;
    if (ref.includes(":")) return this.map.get(ref) ?? null;
    return this.scrapers.find((s) => s.slug === ref) ?? null;
  }

  resolve(projectKey, endpointSlug) {
    if (!projectKey?.includes(":")) return { scraper: null, endpoint: null };
    const scraper = this.map.get(projectKey) ?? null;
    return { scraper, endpoint: scraper?.endpoints.find((e) => e.slug === endpointSlug) ?? null };
  }

  // ---- public read models ----------------------------------------------------
  listItem(s, st = { requests: 0, success: 0 }, disabled) {
    return {
      id: s.id,
      slug: s.slug,
      category: s.category,
      key: s.key,
      displayName: s.displayName,
      description: s.description,
      tags: s.tags,
      iconUrl: s.iconUrl,
      endpointCount: s.endpoints.length,
      liveEndpoints: s.endpoints.filter((e) => e.status === "live").length,
      status: disabled?.has(s.key) ? "disabled" : s.status,
      totalRequests: st.requests,
      maxCacheTtl: Math.max(0, ...s.endpoints.map((e) => e.cacheTtl || 0)),
      minPlan: s.minPlan,
      hasBulk: s.endpoints.some((e) => e.bulkEnabled),
      hasGatedEndpoint: s.endpoints.some((e) => !!e.minPlan),
      indonesian: s.indonesian,
    };
  }

  list({ q, cat, cursor, limit, sort = "popular", bulk, indonesian, live } = {}, stats = {}, disabled = new Set()) {
    let rows = this.scrapers;
    if (cat) rows = rows.filter((s) => s.category === cat);
    if (bulk === "true" || bulk === true) rows = rows.filter((s) => s.endpoints.some((e) => e.bulkEnabled));
    if (indonesian === "true" || indonesian === true) rows = rows.filter((s) => s.indonesian);
    if (live === "true" || live === true) rows = rows.filter((s) => s.status === "live");
    if (q) {
      const needle = String(q).toLowerCase();
      rows = rows.filter((s) => searchText(s).includes(needle));
    }
    const items = rows.map((s) => this.listItem(s, stats[s.id], disabled));
    if (sort === "name") items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    else if (sort === "endpoints") items.sort((a, b) => b.endpointCount - a.endpointCount);
    else items.sort((a, b) => b.totalRequests - a.totalRequests || b.liveEndpoints - a.liveEndpoints || a.displayName.localeCompare(b.displayName));
    const lim = Math.min(500, Math.max(1, Number(limit) || 20));
    const off = Math.max(0, Number(cursor) || 0);
    return { items: items.slice(off, off + lim), nextCursor: off + lim < items.length ? String(off + lim) : null, total: items.length };
  }

  detail(ref, st, disabled) {
    const s = this.find(ref);
    if (!s) return null;
    return {
      ...this.listItem(s, st, disabled),
      enabled: !disabled?.has(s.key),
      endpoints: s.endpoints.map((e) => ({
        id: e.id,
        slug: e.slug,
        displayName: e.displayName,
        description: e.description,
        method: e.method,
        paramsSchema: Object.fromEntries(e.fields.map((f) => [f.name, f.type])),
        fields: this.schemaFields(e),
        cacheTtl: e.cacheTtl,
        pathTemplate: e.pathTemplate,
        exampleResponse: e.exampleResponse,
        enabled: e.enabled,
        status: e.status,
        minPlan: maxPlan(s.minPlan, e.minPlan),
        bulkEnabled: e.bulkEnabled,
      })),
    };
  }

  schemaFields(e) {
    const names = pathFieldNames(e);
    return e.fields.map(({ in: loc, ...f }) => ({ ...f, in: names.includes(f.name) ? "path" : loc === "body" || e.method === "POST" ? "body" : "query" }));
  }

  schema(ref, endpointSlug) {
    const e = this.find(ref)?.endpoints.find((x) => x.slug === endpointSlug);
    return e ? { fields: this.schemaFields(e) } : null;
  }

  categoryList({ withEmpty = false } = {}) {
    return this.categories
      .map((c) => {
        const ss = this.scrapers.filter((s) => s.category === c.slug);
        return { slug: c.slug, displayName: c.displayName, iconUrl: null, color: c.color, description: c.description, scrapers: ss.length, endpoints: ss.reduce((n, s) => n + s.endpoints.length, 0), live: ss.filter((s) => s.status === "live").length };
      })
      .filter((c) => withEmpty || c.scrapers > 0)
      .sort((a, b) => b.scrapers - a.scrapers);
  }

  totals() {
    const eps = this.scrapers.flatMap((s) => s.endpoints);
    return {
      scrapers: this.scrapers.length,
      endpoints: eps.length,
      liveScrapers: this.scrapers.filter((s) => s.status === "live").length,
      liveEndpoints: eps.filter((e) => e.status === "live").length,
      categories: this.categoryList().length,
    };
  }
}

function searchText(s) {
  return (s._search ??= [s.key, s.displayName, s.description ?? "", ...s.tags, ...s.endpoints.flatMap((e) => [e.slug, e.displayName ?? ""])].join(" ").toLowerCase());
}

export function pathFieldNames(endpoint) {
  return (endpoint.pathTemplate ?? "")
    .split("/")
    .filter((p) => p.startsWith(":"))
    .map((p) => p.slice(1));
}
