// Live news feeds, built only from the publishers' own RSS/Atom feeds (published for syndication).
// Each scraper exposes a single `latest` or `feed` endpoint, mirroring zapi.ink slugs.

import { url, feed, f, stripHtml, ScraperError } from "../kit.js";

const limitField = f.int("limit", { default: 20, min: 1, max: 50, description: "Jumlah item maksimum" });

/**
 * Build a news scraper.
 * @param {object} o
 *   slug, displayName, description, tags, indonesian, endpoint ("latest"|"feed"),
 *   base: default feed URL,
 *   param: name of the optional section param, sections: { value: feedUrl },
 *   extraFields / build(p) → URL for fully custom cases.
 */
function rss(o) {
  const fields = [];
  if (o.sections) fields.push(f.enm(o.param ?? "category", Object.keys(o.sections), { description: o.paramDesc ?? "Kanal / rubrik", example: Object.keys(o.sections)[0] }));
  fields.push(...(o.extraFields ?? []), limitField);
  return {
    category: "news",
    slug: o.slug,
    displayName: o.displayName,
    description: o.description,
    tags: ["news", "rss", ...(o.tags ?? [])],
    indonesian: !!o.indonesian,
    endpoints: [
      {
        slug: o.endpoint ?? "latest",
        displayName: o.indonesian ? "Berita Terbaru" : "Latest Feed",
        description: o.indonesian ? `Berita terbaru dari RSS resmi ${o.displayName}.` : `Latest items from the official ${o.displayName} feed.`,
        method: "GET",
        cacheTtl: 300,
        pathTemplate: null,
        bulkEnabled: false,
        fields,
        handler: async (p, ctx) => {
          const sec = o.sections ? p[o.param ?? "category"] : undefined;
          let target;
          if (o.build) target = o.build(p);
          else if (sec) {
            target = o.sections[sec];
            if (!target) throw new ScraperError(`Unknown ${o.param ?? "category"}: ${sec}`);
          } else target = o.base;
          const out = await feed(ctx, target, p.limit ?? 20);
          // Many feeds entity-escape their HTML; kit strips tags before decoding, so strip once more.
          out.items = out.items.map((i) => ({ ...i, description: i.description ? stripHtml(i.description) || null : null }));
          return { ...(sec ? { [o.param ?? "category"]: sec } : {}), ...out, publisher: o.displayName };
        },
      },
    ],
  };
}

const map = (keys, fn) => Object.fromEntries(keys.map((k) => [k, fn(k)]));

export const NEWS = [
  // ---------------------------------------------------------------- Indonesia
  rss({
    slug: "antara",
    displayName: "ANTARA News",
    description: "Kantor berita nasional ANTARA — berita terbaru dari RSS resminya, bisa per kanal.",
    indonesian: true,
    tags: ["indonesia", "antara"],
    base: "https://www.antaranews.com/rss/terkini.xml",
    sections: map(["politik", "hukum", "ekonomi", "metro", "sepakbola", "olahraga", "humaniora", "lifestyle", "hiburan", "dunia", "tekno", "otomotif"], (k) => `https://www.antaranews.com/rss/${k}.xml`),
  }),
  rss({
    slug: "cnn-indonesia",
    displayName: "CNN Indonesia",
    description: "Berita terbaru CNN Indonesia dari RSS resmi, bisa per kanal.",
    indonesian: true,
    tags: ["indonesia"],
    base: "https://www.cnnindonesia.com/rss",
    sections: map(["nasional", "internasional", "ekonomi", "olahraga", "teknologi", "hiburan", "gaya-hidup"], (k) => `https://www.cnnindonesia.com/${k}/rss`),
  }),
  rss({
    slug: "kompas",
    displayName: "Kompas.com",
    description: "Berita terbaru Kompas.com dari feed sindikasi resminya.",
    indonesian: true,
    tags: ["indonesia"],
    base: "https://rss.kompas.com/api/feed/social?apikey=bc58c81819dff4b8d5c53540a2fc7ffd83e6314a",
  }),
  rss({
    slug: "detik",
    displayName: "detikcom",
    description: "Berita terbaru detikcom dari RSS resmi tiap kanal (news, finance, sport, inet, dll).",
    indonesian: true,
    tags: ["indonesia"],
    base: "https://news.detik.com/rss",
    sections: {
      news: "https://news.detik.com/rss",
      finance: "https://finance.detik.com/rss",
      sport: "https://sport.detik.com/rss",
      sepakbola: "https://sport.detik.com/sepakbola/rss",
      inet: "https://inet.detik.com/rss",
      hot: "https://hot.detik.com/rss",
      food: "https://food.detik.com/rss",
      health: "https://health.detik.com/rss",
      oto: "https://oto.detik.com/rss",
      travel: "https://travel.detik.com/rss",
      wolipop: "https://wolipop.detik.com/rss",
    },
  }),
  rss({
    slug: "tempo",
    displayName: "Tempo",
    description: "Berita terbaru Tempo dari RSS resmi rss.tempo.co, bisa per rubrik.",
    indonesian: true,
    tags: ["indonesia"],
    base: "https://rss.tempo.co/",
    sections: map(["nasional", "metro", "bisnis", "dunia", "otomotif", "tekno", "gaya", "travel"], (k) => `https://rss.tempo.co/${k}`),
  }),
  rss({
    slug: "republika",
    displayName: "Republika",
    description: "Berita terbaru Republika dari RSS resminya.",
    indonesian: true,
    tags: ["indonesia"],
    base: "https://www.republika.co.id/rss",
  }),
  rss({
    slug: "tribunnews",
    displayName: "Tribunnews",
    description: "Berita terbaru Tribunnews.com dari RSS resminya.",
    indonesian: true,
    tags: ["indonesia"],
    base: "https://www.tribunnews.com/rss",
  }),
  rss({
    slug: "liputan6",
    displayName: "Liputan6",
    description: "Berita terbaru Liputan6.com dari feed resmi feed.liputan6.com, bisa per kanal.",
    indonesian: true,
    tags: ["indonesia"],
    base: "https://feed.liputan6.com/rss",
    sections: map(["news", "bisnis", "bola", "tekno", "showbiz", "health", "otomotif"], (k) => `https://feed.liputan6.com/rss/${k}`),
  }),
  rss({
    slug: "okezone",
    displayName: "Okezone",
    endpoint: "feed",
    description: "Berita terbaru Okezone dari layanan sindikasi RSS resminya.",
    indonesian: true,
    tags: ["indonesia"],
    base: "https://sindikasi.okezone.com/index.php/rss/0/RSS2.0",
  }),
  rss({
    slug: "mediaindonesia",
    displayName: "Media Indonesia",
    endpoint: "feed",
    description: "Berita terbaru Media Indonesia dari feed RSS resminya.",
    indonesian: true,
    tags: ["indonesia"],
    base: "https://mediaindonesia.com/feed",
  }),
  rss({
    slug: "katadata",
    displayName: "Katadata",
    endpoint: "feed",
    description: "Berita ekonomi & bisnis terbaru Katadata dari feed RSS resminya.",
    indonesian: true,
    tags: ["indonesia", "ekonomi"],
    base: "https://katadata.co.id/feed",
  }),
  rss({
    slug: "mongabay-id",
    displayName: "Mongabay Indonesia",
    endpoint: "feed",
    description: "Berita lingkungan dan konservasi terbaru dari feed RSS Mongabay Indonesia.",
    indonesian: true,
    tags: ["indonesia", "lingkungan"],
    base: "https://www.mongabay.co.id/feed/",
  }),
  rss({
    slug: "google-news",
    displayName: "Google News",
    endpoint: "feed",
    description: "Berita utama Google News edisi Indonesia, atau hasil pencarian topik bila query diisi.",
    indonesian: true,
    tags: ["indonesia", "aggregator"],
    extraFields: [
      f.str("query", { description: "Kata kunci pencarian (opsional)", example: "ekonomi digital" }),
      f.str("q", { description: "Alias untuk query" }),
    ],
    build: (p) => {
      const loc = { hl: "id", gl: "ID", ceid: "ID:id" };
      const q = p.query || p.q;
      return q ? url("https://news.google.com/rss/search", { q, ...loc }) : url("https://news.google.com/rss", loc);
    },
  }),

  // ------------------------------------------------------------ International
  rss({
    slug: "bbc",
    displayName: "BBC News",
    endpoint: "feed",
    description: "Top stories from the BBC News RSS feeds, optionally by section.",
    tags: ["world"],
    param: "section",
    paramDesc: "Section",
    base: "https://feeds.bbci.co.uk/news/rss.xml",
    sections: {
      world: "https://feeds.bbci.co.uk/news/world/rss.xml",
      technology: "https://feeds.bbci.co.uk/news/technology/rss.xml",
      business: "https://feeds.bbci.co.uk/news/business/rss.xml",
      entertainment: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
      science: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
      health: "https://feeds.bbci.co.uk/news/health/rss.xml",
      asia: "https://feeds.bbci.co.uk/news/world/asia/rss.xml",
    },
  }),
  rss({
    slug: "guardian",
    displayName: "The Guardian",
    endpoint: "feed",
    description: "Latest Guardian journalism from its public section RSS feeds.",
    tags: ["world"],
    param: "section",
    paramDesc: "Section",
    base: "https://www.theguardian.com/international/rss",
    sections: map(["world", "technology", "business", "sport", "environment", "science", "culture"], (k) => `https://www.theguardian.com/${k}/rss`),
  }),
  rss({
    slug: "the-verge",
    displayName: "The Verge",
    endpoint: "feed",
    description: "Latest stories from The Verge's official feed.",
    tags: ["tech"],
    base: "https://www.theverge.com/rss/index.xml",
  }),
  rss({
    slug: "ars-technica",
    displayName: "Ars Technica",
    endpoint: "feed",
    description: "Latest articles from the Ars Technica main RSS feed.",
    tags: ["tech", "science"],
    base: "https://feeds.arstechnica.com/arstechnica/index",
  }),
  rss({
    slug: "dev-to",
    displayName: "DEV Community",
    endpoint: "feed",
    description: "Latest DEV Community posts, optionally for a single tag.",
    tags: ["tech", "programming"],
    extraFields: [f.str("tag", { pattern: "^[a-z0-9]+$", description: "Tag (e.g. javascript)", example: "javascript" })],
    build: (p) => (p.tag ? `https://dev.to/feed/tag/${encodeURIComponent(p.tag)}` : "https://dev.to/feed"),
  }),
  rss({
    slug: "cointelegraph",
    displayName: "Cointelegraph",
    endpoint: "feed",
    description: "Crypto news from Cointelegraph's RSS, optionally filtered by tag or category.",
    tags: ["crypto"],
    extraFields: [
      f.str("section", { pattern: "^[a-z0-9-]+$", description: "Tag or category slug (e.g. bitcoin, ethereum)", example: "bitcoin" }),
      f.enm("sectionType", ["tag", "category"], { default: "tag" }),
    ],
    build: (p) => (p.section ? `https://cointelegraph.com/rss/${p.sectionType === "category" ? "category" : "tag"}/${p.section}` : "https://cointelegraph.com/rss"),
  }),
  rss({
    slug: "coindesk",
    displayName: "CoinDesk",
    endpoint: "feed",
    description: "Latest crypto news from CoinDesk's outbound RSS feed.",
    tags: ["crypto"],
    base: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  }),
  rss({
    slug: "marketwatch",
    displayName: "MarketWatch",
    endpoint: "feed",
    description: "MarketWatch headlines from the public Dow Jones RSS feeds.",
    tags: ["finance", "markets"],
    param: "section",
    paramDesc: "Feed",
    base: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    sections: map(["topstories", "marketpulse", "realtimeheadlines", "bulletins"], (k) => `https://feeds.content.dowjones.io/public/rss/mw_${k}`),
  }),
  rss({
    slug: "cnbc",
    displayName: "CNBC",
    endpoint: "feed",
    description: "CNBC headlines from its official section RSS feeds.",
    tags: ["finance", "business"],
    param: "section",
    paramDesc: "Section",
    base: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    sections: Object.fromEntries(
      Object.entries({
        "top-news": 100003114,
        business: 10001147,
        finance: 10000664,
        economy: 20910258,
        investing: 15839069,
        earnings: 15839135,
        politics: 10000113,
        international: 100727362,
      }).map(([k, id]) => [k, `https://www.cnbc.com/id/${id}/device/rss/rss.html`]),
    ),
  }),
];

export default NEWS;
