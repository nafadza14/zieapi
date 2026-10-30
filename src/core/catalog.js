// Catalog = seed structure (all sources/endpoints) merged with live implementations.
// Endpoint status: "live" (handler here), "upstream" (forwarded via ZIE_UPSTREAM_URL) or "planned".

import { isFinanceKey } from "./sources.js";
import { stableId } from "./util.js";
import { maxPlan } from "./plans.js";
import { SEED_CATEGORIES, SEED_SCRAPERS } from "../catalog/seed.js";
import { SOURCE_DOMAINS } from "../catalog/domains.js";
import { SOURCE_ICONS } from "../catalog/icons.js";
import { PROVIDER_ICONS } from "../catalog/icons-global.js";
import { DIRECTORY_CATEGORIES, loadDirectoryIndex, loadEndpoints } from "./directory.js";

const CATEGORY_BLURBS = {
  ads: "Public ad-library intelligence.",
  ai: "Chat, speech and generation endpoints.",
  application: "App-store listings, reviews and charts.",
  autocomplete: "Search suggestions from major engines.",
  design: "Design resources.",
  "dev-tools": "DNS, WHOIS, hashing and other developer utilities.",
  downloader: "Media download helpers.",
  esport: "Players, teams and tournaments.",
  official: "Apizie Finance (premium): combined, cited data from SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF and the World Bank.",
  finance: "Stocks, crypto, FX, gold and macro data, plus the Apizie Finance official sources.",
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

// Read or write: does calling this endpoint change anything at the provider? Apizie's own sources only read.
// Bring-your-own-key APIs follow the provider's HTTP method, except operations whose name says they only read
// (list, get, describe, search…), which are common as POST in cloud APIs. Any other POST, PUT, PATCH or DELETE
// counts as a write.
const READ_VERBS = /^(list|get|describe|search|query|lookup|look-up|find|fetch|retrieve|read|check|validate|verify|estimate|preview|calculate|count|batch-?get|show|view|head|detect|translate|recognize|predict|classify|analy[sz]e|summarize|compare|resolve|explain|evaluate)(\b|[-_ A-Z])/i;
export function accessOf(upstreamMethod, ep = {}) {
  if (!upstreamMethod) return "read";
  const m = String(upstreamMethod).toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return "read";
  if (m !== "POST") return "write"; // PUT, PATCH, DELETE always change something
  if (READ_VERBS.test(String(ep.slug ?? "")) || READ_VERBS.test(String(ep.displayName ?? "").trim())) return "read";
  return "write";
}

// Apizie Finance (premium add-on): the six official sources and the combined official:* endpoints.
export const isOfficialKey = (key) => isFinanceKey(key);

const titleCase = (s) => s.replace(/(^|-)([a-z])/g, (_, a, b) => (a ? " " : "") + b.toUpperCase());

export class Catalog {
  constructor({ live = [], upstream = false, seed = true, directory = true } = {}) {
    this.upstream = upstream;
    // Apizie Finance's combined endpoints (official:company, official:macro) live in their own category.
    const official = { slug: "official", displayName: "Apizie Finance", color: "#c4b5fd", description: CATEGORY_BLURBS.official };
    this.categories = [...SEED_CATEGORIES, official, ...DIRECTORY_CATEGORIES.filter((d) => !SEED_CATEGORIES.some((c) => c.slug === d.slug))].map((c) => ({ ...c, iconUrl: null, description: c.description ?? CATEGORY_BLURBS[c.slug] ?? "" }));
    this.map = new Map();
    if (seed) for (const s of SEED_SCRAPERS) this._addSeed(s);
    for (const def of live) this._addLive(def);
    for (const s of this.map.values()) s.status = s.endpoints.some((e) => e.status === "live") ? "live" : upstream ? "upstream" : "planned";
    if (directory) for (const entry of loadDirectoryIndex()) this._addDirectory(entry);
    // Planned sources and endpoints (listed for the roadmap, not callable) are kept for the admin dashboard only:
    // `all` has everything, `scrapers` and every public read model leave them out so users never see them.
    this.all = [...this.map.values()];
    let plannedEndpoints = 0;
    for (const s of this.all) {
      if (s.lazy) continue;
      if (s.status === "planned") {
        plannedEndpoints += s.endpoints.length;
        continue;
      }
      const hidden = s.endpoints.filter((e) => e.status === "planned");
      if (hidden.length) {
        s.plannedEndpoints = hidden;
        s.endpoints = s.endpoints.filter((e) => e.status !== "planned");
        plannedEndpoints += hidden.length;
      }
    }
    this.scrapers = this.all.filter((s) => s.status !== "planned");
    this.planned = { scrapers: this.all.length - this.scrapers.length, endpoints: plannedEndpoints };
    this.overrides = {}; // admin-set logo URLs, refreshed per request by the app
  }

  /** A global API from the OpenAPI directory. Endpoints load on first access. */
  _addDirectory(entry) {
    let key = entry.k;
    for (let i = 2; this.map.has(key); i++) key = `${entry.k}-${i}`;
    const sc = this._blank(key, entry.n, (entry.g ?? []).map((g) => g.replace(/_/g, "-")));
    const host = entry.p;
    const h = host.split(":")[0].toLowerCase();
    sc.description = entry.d || null;
    sc.provider = host;
    sc.sourceUrl = entry.w;
    sc.iconUrl = SOURCE_ICONS[h] ?? SOURCE_ICONS[h.replace(/^(api|www)\./, "")] ?? PROVIDER_ICONS[h] ?? null;
    sc.auth = entry.a;
    sc.origin = "directory";
    sc.version = entry.v;
    sc.lazy = true;
    sc._count = entry.o;
    sc.status = entry.a ? "byok" : "live";
    let eps = null;
    Object.defineProperty(sc, "endpoints", {
      enumerable: false,
      get: () => (eps ??= loadEndpoints({ ...entry, k: key }, (ep) => ({ ...this._endpoint(key, ep, ep.handler), status: ep.status, upstreamMethod: ep.upstreamMethod }))),
    });
    this.map.set(key, sc);
  }

  _blank(key, displayName, tags = []) {
    const [category, slug] = key.split(":");
    if (!this.categories.some((c) => c.slug === category)) this.categories.push({ slug: category, displayName: titleCase(category), color: "#94a3b8", iconUrl: null, description: "" });
    const domain = SOURCE_DOMAINS[key] ?? null;
    const host = domain ? domain.split("/")[0] : null;
    return { id: stableId(key), key, category, slug, displayName, description: null, tags, iconUrl: host ? SOURCE_ICONS[host] ?? null : null, sourceUrl: domain ? `https://${domain}` : null, enabled: true, minPlan: null, indonesian: category === "indonesia" || tags.some((t) => ["indonesia", "idx", "saham"].includes(t)), endpoints: [] };
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
    if (def.iconUrl) sc.iconUrl = def.iconUrl;
    if (def.sourceUrl) sc.sourceUrl = def.sourceUrl;
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
      access: ep.access ?? accessOf(ep.upstreamMethod, ep),
    };
  }

  /** Public lookup: planned sources are invisible unless { all: true } (admin). */
  find(ref, { all = false } = {}) {
    if (!ref) return null;
    if (ref.includes(":")) {
      const s = this.map.get(ref) ?? null;
      return s && (all || s.status !== "planned") ? s : null;
    }
    return (all ? this.all : this.scrapers).find((s) => s.slug === ref) ?? null;
  }

  resolve(projectKey, endpointSlug) {
    if (!projectKey?.includes(":")) return { scraper: null, endpoint: null };
    const scraper = this.map.get(projectKey) ?? null;
    return { scraper, endpoint: scraper?.endpoints.find((e) => e.slug === endpointSlug) ?? null };
  }

  // ---- public read models ----------------------------------------------------
  listItem(s, st = { requests: 0, success: 0 }, disabled) {
    return {
      official: isOfficialKey(s.key),
      premium: isOfficialKey(s.key) ? "finance" : null,
      id: s.id,
      slug: s.slug,
      category: s.category,
      key: s.key,
      displayName: s.displayName,
      description: s.description,
      tags: s.tags,
      iconUrl: this.overrides[s.key] || s.iconUrl,
      sourceUrl: s.sourceUrl,
      endpointCount: epCount(s),
      liveEndpoints: s.lazy ? (s.status === "live" ? s._count : 0) : s.endpoints.filter((e) => e.status === "live").length,
      auth: s.auth ?? null,
      provider: s.provider ?? null,
      origin: s.origin ?? "native",
      status: disabled?.has(s.key) ? "disabled" : s.status,
      totalRequests: st.requests,
      maxCacheTtl: s.lazy ? 60 : Math.max(0, ...s.endpoints.map((e) => e.cacheTtl || 0)),
      minPlan: s.minPlan,
      hasBulk: s.lazy ? true : s.endpoints.some((e) => e.bulkEnabled),
      hasGatedEndpoint: s.lazy ? false : s.endpoints.some((e) => !!e.minPlan),
      indonesian: s.indonesian,
    };
  }

  list({ q, cat, cursor, limit, sort = "popular", bulk, indonesian, live, auth, origin, status } = {}, stats = {}, disabled = new Set()) {
    let rows = this.scrapers;
    if (cat) rows = rows.filter((s) => s.category === cat);
    if (origin) rows = rows.filter((s) => (s.origin ?? "native") === origin);
    if (auth === "none") rows = rows.filter((s) => !s.auth);
    if (auth === "byok") rows = rows.filter((s) => !!s.auth);
    if (bulk === "true" || bulk === true) rows = rows.filter((s) => (s.lazy ? true : s.endpoints.some((e) => e.bulkEnabled)));
    if (indonesian === "true" || indonesian === true) rows = rows.filter((s) => s.indonesian);
    if (live === "true" || live === true) rows = rows.filter((s) => s.status === "live");
    if (q) {
      const needle = String(q).toLowerCase();
      rows = rows.filter((s) => searchText(s).includes(needle));
    }
    let items = rows.map((s) => this.listItem(s, stats[s.id], disabled));
    if (status) items = items.filter((i) => i.status === status);
    if (sort === "name") items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    else if (sort === "endpoints") items.sort((a, b) => b.endpointCount - a.endpointCount);
    else items.sort((a, b) => b.totalRequests - a.totalRequests || b.liveEndpoints - a.liveEndpoints || a.displayName.localeCompare(b.displayName));
    const lim = Math.min(2000, Math.max(1, Number(limit) || 20));
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
        ...(e.upstreamMethod && e.upstreamMethod !== e.method ? { upstreamMethod: e.upstreamMethod } : {}),
        access: e.access ?? "read",
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
    // Directory operations carry the upstream location in `src` (path | query | header | body); native fields use `in`.
    return e.fields.map(({ in: loc, src, ...f }) => {
      const where = names.includes(f.name) ? "path" : src ?? loc ?? (e.method === "POST" ? "body" : "query");
      return { ...f, in: where };
    });
  }

  schema(ref, endpointSlug) {
    const e = this.find(ref)?.endpoints.find((x) => x.slug === endpointSlug);
    return e ? { fields: this.schemaFields(e) } : null;
  }

  categoryList({ withEmpty = false } = {}) {
    return this.categories
      .map((c) => {
        const ss = this.scrapers.filter((s) => s.category === c.slug);
        return { slug: c.slug, displayName: c.displayName, iconUrl: null, color: c.color, description: c.description, scrapers: ss.length, endpoints: ss.reduce((n, s) => n + epCount(s), 0), live: ss.filter((s) => s.status === "live").length };
      })
      .filter((c) => withEmpty || c.scrapers > 0)
      .sort((a, b) => b.scrapers - a.scrapers);
  }

  totals() {
    if (this._totals) return this._totals;
    let endpoints = 0, liveEndpoints = 0, byokEndpoints = 0;
    for (const s of this.scrapers) {
      endpoints += epCount(s);
      if (s.lazy) {
        if (s.status === "live") liveEndpoints += s._count;
        else byokEndpoints += s._count;
      } else liveEndpoints += s.endpoints.filter((e) => e.status === "live").length;
    }
    const directory = this.scrapers.filter((s) => s.origin === "directory").length;
    return (this._totals = {
      scrapers: this.scrapers.length,
      endpoints,
      liveScrapers: this.scrapers.filter((s) => s.status === "live").length,
      byokScrapers: this.scrapers.filter((s) => s.status === "byok").length,
      liveEndpoints,
      byokEndpoints,
      usableEndpoints: liveEndpoints + byokEndpoints,
      directoryApis: directory,
      categories: this.categoryList().length,
      plannedScrapers: this.planned.scrapers,
      plannedEndpoints: this.planned.endpoints,
    });
  }
}

function searchText(s) {
  return (s._search ??= [s.key, s.displayName, s.description ?? "", s.provider ?? "", ...s.tags, ...(s.lazy ? [] : s.endpoints.flatMap((e) => [e.slug, e.displayName ?? ""]))].join(" ").toLowerCase());
}
const epCount = (s) => (s.lazy ? s._count : s.endpoints.length);

export function pathFieldNames(endpoint) {
  return (endpoint.pathTemplate ?? "")
    .split("/")
    .filter((p) => p.startsWith(":"))
    .map((p) => p.slice(1));
}
