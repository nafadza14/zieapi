// Third batch of keyless public APIs (October 2026) plus a general RSS/Atom toolkit.
// Every endpoint was checked against the provider's live API from an external fetcher on 2026-10-28, except the
// ones marked "not verified" below (the fetcher was blocked by robots.txt; the APIs are documented and keyless).
// Providers' attribution and fair-use terms are repeated in each description; cache TTLs keep us well inside them.

import { url, getJson, getText, f, parseFeed, stripHtml, ScraperError } from "../kit.js";
import { assertPublicUrl } from "../ssrf.js";
import { api, get, lim, enc } from "./public-apis.js";

const UA = "apizie/2 (+https://github.com/nafadza14/zieapi)";

/* ─────────────────────────────── RSS / Atom toolkit ─────────────────────────────── */

const MAX_FEED = 3_000_000;

/** GET a caller-supplied URL: SSRF-checked on every redirect hop, size-capped. */
async function fetchPublicText(ctx, raw, accept) {
  let current = raw;
  for (let hop = 0; hop <= 4; hop++) {
    const u = await assertPublicUrl(current, ctx.lookup);
    let res;
    try {
      res = await ctx.fetch(u.toString(), { redirect: "manual", signal: ctx.signal, headers: { "user-agent": UA, accept } });
    } catch (e) {
      if (e?.name === "AbortError" || e?.name === "ZieTimeout") throw e;
      throw new ScraperError("Could not reach that URL", { context: { url: u.toString(), reason: e?.message } });
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel?.().catch(() => {});
      current = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) throw new ScraperError(`That URL returned HTTP ${res.status}`, { context: { url: u.toString(), upstreamStatus: res.status } });
    const text = await res.text();
    if (text.length > MAX_FEED) throw new ScraperError("Feed is too large (max 3 MB)");
    return { text, finalUrl: u.toString(), contentType: res.headers.get("content-type") ?? "" };
  }
  throw new ScraperError("Too many redirects");
}

const looksLikeFeed = (t) => /<(rss|feed|rdf:RDF)[\s>]/i.test(t.slice(0, 5000));
function discoverLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tagText = m[0];
    const rel = /rel=["']?([^"'\s>]+)/i.exec(tagText)?.[1]?.toLowerCase();
    const type = /type=["']?([^"'\s>]+)/i.exec(tagText)?.[1]?.toLowerCase() ?? "";
    const href = /href=["']([^"']+)["']/i.exec(tagText)?.[1];
    if (rel !== "alternate" || !href || !/rss|atom|xml|feed\+json/.test(type)) continue;
    try {
      out.push({ url: new URL(href.replace(/&amp;/g, "&"), base).toString(), type, title: stripHtml(/title=["']([^"']*)["']/i.exec(tagText)?.[1] ?? "") || null });
    } catch {}
  }
  return out.filter((x, i, a) => a.findIndex((y) => y.url === x.url) === i);
}

const rssTools = api(
  "web-tools",
  "rss-reader",
  "RSS & Atom Reader",
  "Turn any public RSS, Atom or RDF feed into clean JSON, find the feeds a website publishes, or merge several feeds into one timeline. Works with any news site, blog, podcast or YouTube channel feed.",
  "https://www.rssboard.org/rss-specification",
  ["rss", "atom", "feed", "news", "reader", "aggregator"],
  [
    {
      slug: "read",
      displayName: "Read a feed",
      description: "Fetch one RSS/Atom/RDF feed URL and return its items as JSON (title, link, summary, date, author, categories, image).",
      method: "GET",
      cacheTtl: 300,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [f.req("url", { example: "https://feeds.npr.org/1001/rss.xml", description: "Feed URL (http or https, public host)" }), lim(20, 100)],
      handler: async (p, ctx) => {
        const { text, finalUrl } = await fetchPublicText(ctx, p.url, "application/rss+xml, application/atom+xml, application/xml, text/xml, */*");
        if (!looksLikeFeed(text)) throw new ScraperError("That URL is not an RSS or Atom feed. Try the discover endpoint with the website address.", { context: { url: finalUrl } });
        const fd = parseFeed(text);
        return { url: finalUrl, title: fd.title, total: fd.count, count: Math.min(fd.count, p.limit ?? 20), items: fd.items.slice(0, p.limit ?? 20) };
      },
    },
    {
      slug: "discover",
      displayName: "Discover feeds on a website",
      description: "Given a website or article URL, list the RSS/Atom feeds it advertises in its HTML (<link rel=\"alternate\">). If the URL is itself a feed, it is returned.",
      method: "GET",
      cacheTtl: 3600,
      pathTemplate: null,
      bulkEnabled: true,
      fields: [f.req("url", { example: "https://techcrunch.com", description: "Website or page URL" })],
      handler: async (p, ctx) => {
        const { text, finalUrl } = await fetchPublicText(ctx, p.url, "text/html, application/xhtml+xml, application/rss+xml, */*");
        if (looksLikeFeed(text)) return { url: finalUrl, feeds: [{ url: finalUrl, type: "feed", title: parseFeed(text).title }] };
        return { url: finalUrl, feeds: discoverLinks(text, finalUrl) };
      },
    },
    {
      slug: "merge",
      displayName: "Merge feeds into one timeline",
      description: "Fetch up to 10 feeds at once and return one list sorted newest first, with duplicates (same link) removed. Feeds that fail are reported, not fatal.",
      method: "GET",
      cacheTtl: 300,
      pathTemplate: null,
      bulkEnabled: false,
      fields: [f.req("urls", { type: "array", example: ["https://feeds.npr.org/1004/rss.xml", "https://www.aljazeera.com/xml/rss/all.xml"], description: "Feed URLs (max 10), as an array or comma-separated" }), lim(30, 200)],
      handler: async (p, ctx) => {
        const urls = [...new Set((p.urls ?? []).map(String).filter(Boolean))].slice(0, 10);
        if (!urls.length) throw new ScraperError("Give at least one feed URL in urls");
        const results = await Promise.allSettled(urls.map((u) => fetchPublicText(ctx, u, "application/rss+xml, application/atom+xml, application/xml, */*")));
        const seen = new Set();
        const items = [];
        const feeds = [];
        results.forEach((r, i) => {
          if (r.status === "rejected") return feeds.push({ url: urls[i], ok: false, error: r.reason?.message ?? "failed" });
          if (!looksLikeFeed(r.value.text)) return feeds.push({ url: urls[i], ok: false, error: "not an RSS or Atom feed" });
          const fd = parseFeed(r.value.text);
          feeds.push({ url: urls[i], ok: true, title: fd.title, count: fd.count });
          for (const it of fd.items) {
            const k = it.link ?? `${it.title}|${it.publishedAt}`;
            if (seen.has(k)) continue;
            seen.add(k);
            items.push({ ...it, feed: fd.title ?? urls[i] });
          }
        });
        const t = (x) => Date.parse(x.publishedAt ?? "") || 0;
        items.sort((a, b) => t(b) - t(a));
        return { feeds, total: items.length, items: items.slice(0, p.limit ?? 30) };
      },
    },
  ]
);

/* ─────────────────────────────── maps, earth, space ─────────────────────────────── */

const overpass = api("places", "overpass", "OpenStreetMap Overpass", "Search OpenStreetMap for places by type around a point: dentists, cafes, hospitals, ATMs, fuel stations and more, with names, addresses, phone numbers, websites and opening hours where mappers added them. Data © OpenStreetMap contributors (ODbL). Not verified from our test network.", "https://wiki.openstreetmap.org/wiki/Overpass_API", ["openstreetmap", "osm", "poi", "places", "nearby"], [
  get("nearby", "Places nearby", "OSM nodes and ways with a given tag within a radius (meters) of a point.", [
    f.req("key", { example: "amenity", description: "OSM tag key, e.g. amenity, shop, tourism, healthcare" }),
    f.req("value", { example: "dentist", description: "OSM tag value, e.g. dentist, cafe, hospital, atm, supermarket" }),
    f.req("lat", { type: "number", example: -6.2088 }), f.req("lon", { type: "number", example: 106.8456 }),
    f.int("radius", { default: 2000, min: 50, max: 20000, description: "Meters" }), lim(50, 200),
  ], (p) => {
    const k = String(p.key).replace(/[^\w:-]/g, ""), v = String(p.value).replace(/[^\w:;.-]/g, "");
    const q = `[out:json][timeout:20];nwr["${k}"="${v}"](around:${p.radius},${p.lat},${p.lon});out center tags ${p.limit};`;
    return url("https://overpass-api.de/api/interpreter", { data: q });
  }, { ttl: 3600, map: (r) => ({ count: r.elements?.length ?? 0, places: (r.elements ?? []).map((e) => ({ id: `${e.type}/${e.id}`, name: e.tags?.name ?? null, lat: e.lat ?? e.center?.lat ?? null, lon: e.lon ?? e.center?.lon ?? null, address: [e.tags?.["addr:street"], e.tags?.["addr:housenumber"], e.tags?.["addr:city"], e.tags?.["addr:postcode"]].filter(Boolean).join(", ") || null, phone: e.tags?.phone ?? e.tags?.["contact:phone"] ?? null, website: e.tags?.website ?? e.tags?.["contact:website"] ?? null, openingHours: e.tags?.opening_hours ?? null, tags: e.tags ?? {} })), attribution: "© OpenStreetMap contributors, ODbL" }) }),
]);

const photon = api("places", "photon", "Photon Geocoder", "Fast typo-tolerant geocoding and search-as-you-type over OpenStreetMap data, by Komoot. Data © OpenStreetMap contributors. Not verified from our test network.", "https://photon.komoot.io", ["geocoding", "autocomplete", "openstreetmap", "address"], [
  get("search", "Search places", "Forward geocoding with optional location bias.", [f.req("q", { example: "Brandenburg Gate" }), lim(5, 50), f.num("lat"), f.num("lon"), f.enm("lang", ["default", "en", "de", "fr", "it"], { default: "default" })], (p) => url("https://photon.komoot.io/api/", { q: p.q, limit: p.limit, lat: p.lat, lon: p.lon, lang: p.lang === "default" ? undefined : p.lang }), { ttl: 86400 }),
  get("reverse", "Reverse geocode", "Address and place for a coordinate.", [f.req("lat", { type: "number", example: 52.5163 }), f.req("lon", { type: "number", example: 13.3777 })], (p) => url("https://photon.komoot.io/reverse", { lat: p.lat, lon: p.lon }), { ttl: 86400 }),
]);

const opentopo = api("places", "opentopodata", "Open Topo Data", "Elevation for up to 100 coordinates from public datasets (SRTM, ASTER, EU-DEM and more). Public server: 1 call/s, 1,000 calls/day shared across Apizie, so results are cached for a week.", "https://www.opentopodata.org", ["elevation", "terrain", "altitude", "dem"], [
  get("elevation", "Elevation", "Elevation in meters for one or more 'lat,lon' pairs separated by '|'.", [f.req("locations", { example: "-6.2,106.8|-7.94,112.95", description: "lat,lon|lat,lon (max 100)" }), f.enm("dataset", ["srtm90m", "srtm30m", "aster30m", "eudem25m", "mapzen"], { default: "srtm90m" })], (p) => url(`https://api.opentopodata.org/v1/${p.dataset}`, { locations: p.locations }), { ttl: 604800 }),
]);

const postcodesIo = api("places", "postcodes-io", "Postcodes.io (UK)", "Free UK postcode lookup, validation, nearest postcodes and reverse geocoding (Open Government Licence data).", "https://postcodes.io", ["uk", "postcode", "geocoding"], [
  get("lookup", "Look up a postcode", "Location and administrative areas for a UK postcode.", [f.req("postcode", { example: "SW1A 1AA" })], (p) => `https://api.postcodes.io/postcodes/${enc(p.postcode)}`, { ttl: 86400 }),
  get("validate", "Validate a postcode", "Whether a UK postcode exists.", [f.req("postcode", { example: "SW1A 1AA" })], (p) => `https://api.postcodes.io/postcodes/${enc(p.postcode)}/validate`, { ttl: 86400 }),
  get("reverse", "Nearest postcodes", "Postcodes nearest to a coordinate.", [f.req("lat", { type: "number", example: 51.501 }), f.req("lon", { type: "number", example: -0.1416 }), lim(10, 100)], (p) => url("https://api.postcodes.io/postcodes", { lat: p.lat, lon: p.lon, limit: p.limit }), { ttl: 86400 }),
  get("autocomplete", "Autocomplete", "Postcodes starting with a partial input.", [f.req("partial", { example: "SW1A" }), lim(10, 100)], (p) => url(`https://api.postcodes.io/postcodes/${enc(p.partial)}/autocomplete`, { limit: p.limit }), { ttl: 86400 }),
]);

const countriesNow = api("places", "countriesnow", "CountriesNow", "Countries with their cities, states, capitals, currencies, flags and population figures.", "https://countriesnow.space", ["countries", "cities", "states", "capitals"], [
  get("capitals", "Capitals", "Every country with its capital.", [], () => "https://countriesnow.space/api/v0.1/countries/capital", { ttl: 604800 }),
  get("currencies", "Currencies", "Every country with its currency.", [], () => "https://countriesnow.space/api/v0.1/countries/currency", { ttl: 604800 }),
  get("flags", "Flags", "Flag image URLs for every country.", [], () => "https://countriesnow.space/api/v0.1/countries/flag/images", { ttl: 604800 }),
  get("population", "Population", "Historical population for every country.", [], () => "https://countriesnow.space/api/v0.1/countries/population", { ttl: 604800 }),
  get("states", "States", "States/provinces for every country.", [], () => "https://countriesnow.space/api/v0.1/countries/states", { ttl: 604800 }),
]);

const gdacs = api("places", "gdacs", "GDACS Disaster Alerts", "Global Disaster Alert and Coordination System (UN and European Commission): current earthquakes, tropical cyclones, floods, volcanoes, droughts and wildfires with alert levels.", "https://www.gdacs.org", ["disaster", "earthquake", "cyclone", "flood", "alerts", "un"], [
  get("events", "Current events", "Events filtered by type and alert level (GeoJSON).", [
    f.str("types", { default: "EQ;TC;FL;VO;DR;WF", description: "Semicolon list: EQ earthquake, TC cyclone, FL flood, VO volcano, DR drought, WF wildfire" }),
    f.str("alertLevel", { default: "Green;Orange;Red", description: "Semicolon list of Green, Orange, Red" }),
  ], (p) => url("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH", { eventlist: p.types, alertlevel: p.alertLevel }), { ttl: 600 }),
]);

const swpc = api("places", "space-weather", "NOAA Space Weather", "NOAA Space Weather Prediction Center: planetary K-index, solar wind and alerts for aurora watchers, radio operators and satellite teams.", "https://www.swpc.noaa.gov", ["space-weather", "aurora", "kp-index", "solar", "noaa"], [
  get("kp-index", "Planetary K-index", "Observed planetary K-index (geomagnetic activity), 3-hourly.", [], () => "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", { ttl: 600 }),
  get("kp-forecast", "K-index forecast", "Predicted planetary K-index for the next days.", [], () => "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json", { ttl: 1800 }),
  get("alerts", "Alerts", "Recent space weather alerts, watches and warnings.", [], () => "https://services.swpc.noaa.gov/products/alerts.json", { ttl: 600 }),
  get("solar-wind", "Solar wind plasma", "Real-time solar wind plasma (density, speed, temperature), last 7 days.", [], () => "https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json", { ttl: 600 }),
]);

const volcanoes = api("places", "usgs-volcanoes", "USGS Volcano Alerts", "US volcanoes with elevated alert levels and their latest notices, from the USGS Volcano Hazards Program.", "https://volcanoes.usgs.gov", ["volcano", "usgs", "alerts", "hazards"], [
  get("elevated", "Elevated volcanoes", "Volcanoes currently above normal alert level.", [], () => "https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes", { ttl: 900 }),
  get("monitored", "Monitored volcanoes", "All monitored US volcanoes with their current status.", [], () => "https://volcanoes.usgs.gov/hans-public/api/volcano/getMonitoredVolcanoes", { ttl: 3600 }),
]);

const nasaImages = api("media", "nasa-images", "NASA Image and Video Library", "Search NASA's public image, video and audio library (no key needed).", "https://images.nasa.gov", ["nasa", "space", "images", "video"], [
  get("search", "Search media", "Images, videos or audio matching a query.", [f.req("q", { example: "apollo 11" }), f.enm("mediaType", ["image", "video", "audio"], { default: "image" }), f.int("page", { default: 1, min: 1, max: 100 })], (p) => url("https://images-api.nasa.gov/search", { q: p.q, media_type: p.mediaType, page: p.page }), { ttl: 86400 }),
  get("asset", "Asset files", "Every file (sizes, formats) for one NASA media id.", [f.req("nasaId", { example: "as11-40-5874" })], (p) => `https://images-api.nasa.gov/asset/${enc(p.nasaId)}`, { ttl: 86400 }),
]);

/* ─────────────────────────────── transport ─────────────────────────────── */

const adsb = api("transport", "adsb-lol", "ADS-B Live Flights", "Live aircraft positions from the community ADS-B network adsb.lol (open data, ODbL): flights near a point, by callsign, by registration or by ICAO hex.", "https://api.adsb.lol", ["flights", "aircraft", "ads-b", "aviation", "tracking"], [
  get("nearby", "Aircraft nearby", "Aircraft within a radius (nautical miles, max 250) of a point.", [f.req("lat", { type: "number", example: 51.47 }), f.req("lon", { type: "number", example: -0.45 }), f.int("radius", { default: 25, min: 1, max: 250 })], (p) => `https://api.adsb.lol/v2/point/${p.lat}/${p.lon}/${p.radius}`, { ttl: 15 }),
  get("callsign", "By callsign", "Aircraft broadcasting a callsign (e.g. a flight number).", [f.req("callsign", { example: "BAW123" })], (p) => `https://api.adsb.lol/v2/callsign/${enc(p.callsign)}`, { ttl: 15 }),
  get("registration", "By registration", "Aircraft by tail number.", [f.req("registration", { example: "G-XLEA" })], (p) => `https://api.adsb.lol/v2/registration/${enc(p.registration)}`, { ttl: 15 }),
  get("hex", "By ICAO hex", "Aircraft by 24-bit ICAO address.", [f.req("hex", { example: "4ca853" })], (p) => `https://api.adsb.lol/v2/hex/${enc(p.hex)}`, { ttl: 15 }),
]);

const tfl = api("transport", "tfl-status", "Transport for London Status", "Live London Underground, Overground, DLR, Elizabeth line and bus status from the TfL Unified API (anonymous access).", "https://api.tfl.gov.uk", ["london", "tube", "transit", "status", "uk"], [
  get("line-status", "Line status", "Current status of every line for a mode.", [f.enm("mode", ["tube", "overground", "dlr", "elizabeth-line", "tram", "bus", "river-bus"], { default: "tube" })], (p) => `https://api.tfl.gov.uk/Line/Mode/${p.mode}/Status`, { ttl: 60 }),
  get("arrivals", "Stop arrivals", "Next arrivals at a stop point (NaPTAN id).", [f.req("stopId", { example: "940GZZLUOXC", description: "StopPoint id, e.g. 940GZZLUOXC (Oxford Circus)" })], (p) => `https://api.tfl.gov.uk/StopPoint/${enc(p.stopId)}/Arrivals`, { ttl: 30 }),
  get("bike-points", "Santander bikes", "Docking stations with bikes and spaces available.", [], () => "https://api.tfl.gov.uk/BikePoint", { ttl: 120 }),
]);

/* ─────────────────────────────── finance ─────────────────────────────── */

const blockchainInfo = api("finance", "blockchain-ticker", "Blockchain.com Ticker", "Bitcoin price in 20+ currencies (15-minute delayed, last, buy, sell) from Blockchain.com.", "https://www.blockchain.com/explorer/api/exchange_rates_api", ["bitcoin", "btc", "price", "crypto"], [
  get("ticker", "BTC price in every currency", "Bitcoin prices keyed by currency code.", [], () => "https://blockchain.info/ticker", { ttl: 60 }),
  get("to-btc", "Convert to BTC", "How much BTC a fiat amount buys.", [f.req("currency", { example: "USD" }), f.req("value", { type: "number", example: 500 })], (p) => url("https://blockchain.info/tobtc", { currency: p.currency, value: p.value }), { ttl: 60, text: true, map: (t, p) => ({ currency: p.currency, value: p.value, btc: Number(String(t).trim()) }) }),
]);

const openEr = api("finance", "open-er-api", "ExchangeRate-API (Open Access)", "Daily exchange rates for 160+ currencies without a key. Rates By Exchange Rate API (https://www.exchangerate-api.com), updated once a day.", "https://www.exchangerate-api.com/docs/free", ["currency", "exchange-rates", "forex", "fx"], [
  get("latest", "Latest rates", "All rates against a base currency.", [f.str("base", { default: "USD", example: "EUR" })], (p) => `https://open.er-api.com/v6/latest/${enc(String(p.base).toUpperCase())}`, { ttl: 3600, map: (r) => ({ ...r, attribution: "Rates By Exchange Rate API" }) }),
]);

/* ─────────────────────────────── jobs ─────────────────────────────── */

const arbeitnow = api("jobs", "arbeitnow", "Arbeitnow Job Board", "Job listings from the Arbeitnow board (Europe-focused, many remote and visa-sponsored roles).", "https://www.arbeitnow.com/api/job-board-api", ["jobs", "remote", "europe", "careers"], [
  get("jobs", "Job listings", "Newest jobs, paginated.", [f.int("page", { default: 1, min: 1, max: 100 })], (p) => url("https://www.arbeitnow.com/api/job-board-api", { page: p.page }), { ttl: 1800 }),
]);

const remoteOk = api("jobs", "remoteok", "Remote OK", "Remote job listings from Remote OK. Terms: link back to Remote OK and mention it as the source when you show these jobs.", "https://remoteok.com/api", ["jobs", "remote", "careers", "startups"], [
  get("jobs", "Remote jobs", "Latest remote jobs, optionally by tag.", [f.str("tag", { example: "javascript", description: "Optional tag, e.g. javascript, design, marketing" }), lim(50, 200)], (p) => url("https://remoteok.com/api", { tag: p.tag }), {
    ttl: 1800,
    map: (r, p) => {
      const rows = Array.isArray(r) ? r : [];
      const legal = rows.find((x) => x.legal)?.legal ?? null;
      return { source: "Remote OK (https://remoteok.com)", legal, jobs: rows.filter((x) => x.id).slice(0, p.limit ?? 50) };
    },
  }),
]);

/* ─────────────────────────────── developer & web tools ─────────────────────────────── */

const hnSearch = api("search-tools", "hn-search", "Hacker News Search", "Full-text search over Hacker News stories and comments (Algolia HN Search API).", "https://hn.algolia.com/api", ["hacker-news", "search", "tech", "startups"], [
  get("search", "Search by relevance", "Stories, comments or Ask/Show HN matching a query.", [f.req("query", { example: "model context protocol" }), f.enm("tags", ["story", "comment", "ask_hn", "show_hn", "front_page"], { default: "story" }), f.int("page", { default: 0, min: 0, max: 50 }), lim(20, 100, "hitsPerPage")], (p) => url("https://hn.algolia.com/api/v1/search", { query: p.query, tags: p.tags, page: p.page, hitsPerPage: p.hitsPerPage }), { ttl: 300 }),
  get("search-by-date", "Search newest first", "Same as search, sorted by date.", [f.req("query", { example: "rust" }), f.enm("tags", ["story", "comment", "ask_hn", "show_hn"], { default: "story" }), lim(20, 100, "hitsPerPage")], (p) => url("https://hn.algolia.com/api/v1/search_by_date", { query: p.query, tags: p.tags, hitsPerPage: p.hitsPerPage }), { ttl: 120 }),
  get("item", "Item with comments", "One story with its full comment tree.", [f.req("id", { type: "integer", example: 8863 })], (p) => `https://hn.algolia.com/api/v1/items/${p.id}`, { ttl: 300 }),
]);

const trending = api("dev-tools", "github-trending", "GitHub Trending (OSS Insight)", "Trending GitHub repositories by period and language, from OSS Insight's public API.", "https://ossinsight.io/docs/api", ["github", "trending", "open-source", "repositories"], [
  get("repos", "Trending repositories", "Repositories trending in a period.", [f.enm("period", ["past_24_hours", "past_week", "past_month", "past_3_months"], { default: "past_24_hours" }), f.str("language", { example: "TypeScript", description: "Optional language, e.g. Python, Rust, TypeScript" })], (p) => url("https://api.ossinsight.io/v1/trends/repos", { period: p.period, language: p.language }), { ttl: 1800 }),
]);

const iconify = api("dev-tools", "iconify", "Iconify Icons", "Search 200,000+ open-source icons (Material, Tabler, Lucide, Font Awesome and more) and get SVG markup.", "https://iconify.design/docs/api/", ["icons", "svg", "design", "ui"], [
  get("search", "Search icons", "Icon names matching a keyword.", [f.req("query", { example: "home" }), lim(32, 999), f.str("prefix", { description: "Limit to one icon set, e.g. mdi, tabler, lucide" })], (p) => url("https://api.iconify.design/search", { query: p.query, limit: p.limit, prefix: p.prefix }), { ttl: 86400 }),
  get("svg", "Icon SVG", "SVG markup for one icon, e.g. mdi:home.", [f.req("icon", { example: "mdi:home", description: "prefix:name" }), f.str("color", { example: "#ff9ecf" }), f.int("height", { min: 8, max: 512 })], (p) => {
    const [prefix, name] = String(p.icon).split(":");
    if (!prefix || !name) throw new ScraperError("icon must look like prefix:name, e.g. mdi:home");
    return url(`https://api.iconify.design/${enc(prefix)}/${enc(name)}.svg`, { color: p.color, height: p.height });
  }, { ttl: 604800, text: true, map: (svg, p) => ({ icon: p.icon, svg }) }),
  get("collections", "Icon sets", "Every available icon set with its license and size.", [], () => "https://api.iconify.design/collections", { ttl: 604800 }),
]);

const googleDns = api("web-tools", "google-dns", "Google Public DNS", "DNS-over-HTTPS lookups through Google Public DNS (JSON API): A, AAAA, MX, TXT, NS, CNAME and more.", "https://developers.google.com/speed/public-dns/docs/doh/json", ["dns", "domain", "network", "doh"], [
  get("resolve", "Resolve a name", "DNS records of a type for a domain.", [f.req("name", { example: "example.com" }), f.enm("type", ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "CAA", "SRV", "PTR"], { default: "A" })], (p) => url("https://dns.google/resolve", { name: p.name, type: p.type }), { ttl: 300 }),
]);

const isgd = api("web-tools", "url-shortener", "is.gd URL Shortener", "Shorten links with is.gd (free, no account). Fair use: up to 200 new links per hour across Apizie; repeated requests for the same URL are cached.", "https://is.gd/apishorteningreference.php", ["url", "shortener", "links"], [
  get("shorten", "Shorten a URL", "Short is.gd link for a long URL.", [f.req("url", { example: "https://www.example.com/some/very/long/path?with=params" }), f.str("custom", { description: "Optional custom short path" })], (p) => url("https://is.gd/create.php", { format: "json", url: p.url, shorturl: p.custom }), { ttl: 2592000 }),
]);

/* ─────────────────────────────── fun & content ─────────────────────────────── */

const zenquotes = api("entertainment", "zenquotes", "ZenQuotes", "Inspirational quotes. Terms: show a link back to https://zenquotes.io when you display them.", "https://zenquotes.io", ["quotes", "inspiration", "motivation"], [
  get("today", "Quote of the day", "Today's quote.", [], () => "https://zenquotes.io/api/today", { ttl: 3600, map: (r) => ({ quotes: r, attribution: "Inspirational quotes provided by https://zenquotes.io" }) }),
  get("random", "Random quote", "A random quote (cached for a minute to respect the 5 requests / 30 s limit).", [], () => "https://zenquotes.io/api/random", { ttl: 60, map: (r) => ({ quotes: r, attribution: "Inspirational quotes provided by https://zenquotes.io" }) }),
]);

const uselessFacts = api("entertainment", "useless-facts", "Useless Facts", "Random and daily trivia facts in English or German.", "https://uselessfacts.jsph.pl", ["facts", "trivia", "fun"], [
  get("random", "Random fact", "A random fact.", [f.enm("language", ["en", "de"], { default: "en" })], (p) => url("https://uselessfacts.jsph.pl/api/v2/facts/random", { language: p.language }), { ttl: 0 }),
  get("today", "Fact of the day", "Today's fact.", [f.enm("language", ["en", "de"], { default: "en" })], (p) => url("https://uselessfacts.jsph.pl/api/v2/facts/today", { language: p.language }), { ttl: 3600 }),
]);

const emojihub = api("entertainment", "emojihub", "EmojiHub", "Emoji by category and group with HTML codes and Unicode points.", "https://github.com/cheatsnake/emojihub", ["emoji", "unicode", "fun"], [
  get("random", "Random emoji", "A random emoji, optionally from a category.", [f.str("category", { example: "smileys-and-people" })], (p) => (p.category ? `https://emojihub.yurace.pro/api/random/category/${enc(p.category)}` : "https://emojihub.yurace.pro/api/random"), { ttl: 0 }),
  get("all", "All emoji", "Every emoji, optionally in one category.", [f.str("category", { example: "food-and-drink" })], (p) => (p.category ? `https://emojihub.yurace.pro/api/all/category/${enc(p.category)}` : "https://emojihub.yurace.pro/api/all"), { ttl: 604800 }),
]);

const openLiga = api("entertainment", "openligadb", "OpenLigaDB Football", "Community-maintained football results and fixtures: Bundesliga, 2. Bundesliga, DFB-Pokal, Champions League and more.", "https://api.openligadb.de", ["football", "soccer", "bundesliga", "sports"], [
  get("current-matches", "Current matchday", "Matches of the current matchday for a league.", [f.str("league", { default: "bl1", description: "League shortcut, e.g. bl1, bl2, dfb" })], (p) => `https://api.openligadb.de/getmatchdata/${enc(p.league)}`, { ttl: 300 }),
  get("season-matches", "Season matches", "All matches of a season.", [f.str("league", { default: "bl1" }), f.req("season", { type: "integer", example: 2025 })], (p) => `https://api.openligadb.de/getmatchdata/${enc(p.league)}/${p.season}`, { ttl: 1800 }),
  get("table", "League table", "Standings for a league and season.", [f.str("league", { default: "bl1" }), f.req("season", { type: "integer", example: 2025 })], (p) => `https://api.openligadb.de/getbltable/${enc(p.league)}/${p.season}`, { ttl: 1800 }),
]);

export default [rssTools, overpass, photon, opentopo, postcodesIo, countriesNow, gdacs, swpc, volcanoes, nasaImages, adsb, tfl, blockchainInfo, openEr, arbeitnow, remoteOk, hnSearch, trending, iconify, googleDns, isgd, zenquotes, uselessFacts, emojihub, openLiga];
