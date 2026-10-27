import { test } from "node:test";
import assert from "node:assert/strict";
import defs from "../../src/scrapers/live/news.js";
import { checkModule, mockFetch, run } from "./harness.js";

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Sample</title>
${Array.from({ length: 30 }, (_, i) => `<item><title><![CDATA[Judul ${i}]]></title><link>https://example.com/${i}</link><description>&lt;p&gt;Isi ${i}&lt;/p&gt;</description><pubDate>Mon, 26 Oct 2026 10:00:00 +0700</pubDate><dc:creator>Penulis</dc:creator><category>Nasional</category><media:content url="https://img.example.com/${i}.jpg"/></item>`).join("\n")}
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Sample</title>
<entry><title>Entry A</title><link rel="alternate" href="https://example.com/a"/><published>2026-10-26T03:00:00Z</published><summary>Sum A</summary><author><name>X</name></author></entry>
<entry><title>Entry B</title><link rel="alternate" href="https://example.com/b"/><updated>2026-10-25T03:00:00Z</updated><summary>Sum B</summary></entry>
</feed>`;

// [key, endpoint, params, expected URL]
const CASES = [
  ["antara", "latest", {}, "https://www.antaranews.com/rss/terkini.xml"],
  ["antara", "latest", { category: "ekonomi" }, "https://www.antaranews.com/rss/ekonomi.xml"],
  ["cnn-indonesia", "latest", {}, "https://www.cnnindonesia.com/rss"],
  ["cnn-indonesia", "latest", { category: "teknologi" }, "https://www.cnnindonesia.com/teknologi/rss"],
  ["kompas", "latest", {}, "https://rss.kompas.com/api/feed/social?apikey=bc58c81819dff4b8d5c53540a2fc7ffd83e6314a"],
  ["detik", "latest", {}, "https://news.detik.com/rss"],
  ["detik", "latest", { category: "sepakbola" }, "https://sport.detik.com/sepakbola/rss"],
  ["tempo", "latest", {}, "https://rss.tempo.co/"],
  ["tempo", "latest", { category: "bisnis" }, "https://rss.tempo.co/bisnis"],
  ["republika", "latest", {}, "https://www.republika.co.id/rss"],
  ["tribunnews", "latest", {}, "https://www.tribunnews.com/rss"],
  ["liputan6", "latest", {}, "https://feed.liputan6.com/rss"],
  ["liputan6", "latest", { category: "bisnis" }, "https://feed.liputan6.com/rss/bisnis"],
  ["okezone", "feed", {}, "https://sindikasi.okezone.com/index.php/rss/0/RSS2.0"],
  ["mediaindonesia", "feed", {}, "https://mediaindonesia.com/feed"],
  ["katadata", "feed", {}, "https://katadata.co.id/feed"],
  ["mongabay-id", "feed", {}, "https://www.mongabay.co.id/feed/"],
  ["google-news", "feed", {}, "https://news.google.com/rss?hl=id&gl=ID&ceid=ID%3Aid"],
  ["google-news", "feed", { query: "ekonomi digital" }, "https://news.google.com/rss/search?q=ekonomi+digital&hl=id&gl=ID&ceid=ID%3Aid"],
  ["google-news", "feed", { q: "banjir" }, "https://news.google.com/rss/search?q=banjir&hl=id&gl=ID&ceid=ID%3Aid"],
  ["bbc", "feed", {}, "https://feeds.bbci.co.uk/news/rss.xml"],
  ["bbc", "feed", { section: "entertainment" }, "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml"],
  ["guardian", "feed", {}, "https://www.theguardian.com/international/rss"],
  ["guardian", "feed", { section: "technology" }, "https://www.theguardian.com/technology/rss"],
  ["the-verge", "feed", {}, "https://www.theverge.com/rss/index.xml", ATOM],
  ["ars-technica", "feed", {}, "https://feeds.arstechnica.com/arstechnica/index"],
  ["dev-to", "feed", {}, "https://dev.to/feed"],
  ["dev-to", "feed", { tag: "javascript" }, "https://dev.to/feed/tag/javascript"],
  ["cointelegraph", "feed", {}, "https://cointelegraph.com/rss"],
  ["cointelegraph", "feed", { section: "bitcoin" }, "https://cointelegraph.com/rss/tag/bitcoin"],
  ["cointelegraph", "feed", { section: "market-analysis", sectionType: "category" }, "https://cointelegraph.com/rss/category/market-analysis"],
  ["coindesk", "feed", {}, "https://www.coindesk.com/arc/outboundfeeds/rss/"],
  ["marketwatch", "feed", {}, "https://feeds.content.dowjones.io/public/rss/mw_topstories"],
  ["marketwatch", "feed", { section: "marketpulse" }, "https://feeds.content.dowjones.io/public/rss/mw_marketpulse"],
  ["cnbc", "feed", {}, "https://www.cnbc.com/id/100003114/device/rss/rss.html"],
  ["cnbc", "feed", { section: "economy" }, "https://www.cnbc.com/id/20910258/device/rss/rss.html"],
];

test("module shape", () => checkModule(defs));

test("every scraper has a feed case and all are cacheTtl 300 with limit 1..50", () => {
  const covered = new Set(CASES.map((c) => c[0]));
  for (const s of defs) {
    assert.equal(s.category, "news");
    assert.ok(covered.has(s.slug), `no test case for ${s.slug}`);
    for (const e of s.endpoints) {
      assert.equal(e.cacheTtl, 300);
      const lim = e.fields.find((x) => x.name === "limit");
      assert.deepEqual([lim.default, lim.min, lim.max], [20, 1, 50]);
    }
  }
  assert.equal(defs.length, 22);
});

for (const [slug, ep, params, expected, body = RSS] of CASES) {
  test(`news:${slug}/${ep} ${JSON.stringify(params)}`, async () => {
    const fetch = mockFetch([[/./, body]]);
    const r = await run(defs, `news:${slug}`, ep, params, fetch);
    assert.equal(fetch.calls.length, 1);
    assert.equal(fetch.calls[0].url, expected);
    assert.equal(r.source, expected);
    if (body === RSS) {
      assert.equal(r.count, 20);
      assert.equal(r.items.length, 20);
      assert.deepEqual(r.items[0], {
        title: "Judul 0",
        link: "https://example.com/0",
        description: "Isi 0",
        publishedAt: "2026-10-26T03:00:00.000Z",
        author: "Penulis",
        categories: ["Nasional"],
        image: "https://img.example.com/0.jpg",
      });
    } else {
      assert.equal(r.count, 2);
      assert.equal(r.items[0].link, "https://example.com/a");
      assert.equal(r.items[1].publishedAt, "2026-10-25T03:00:00.000Z");
    }
  });
}

test("limit trims items", async () => {
  const r = await run(defs, "news:bbc", "feed", { limit: 5 }, mockFetch([[/./, RSS]]));
  assert.equal(r.items.length, 5);
});

test("upstream outage (5xx) surfaces as UpstreamError 502; upstream 4xx stays a ScraperError", async () => {
  const down = mockFetch([[/./, () => new Response("nope", { status: 503 })]]);
  await assert.rejects(run(defs, "news:antara", "latest", {}, down), (e) => e.name === "UpstreamError" && e.httpStatus === 502 && e.upstreamStatus === 503);
  const missing = mockFetch([[/./, () => new Response("nope", { status: 404 })]]);
  await assert.rejects(run(defs, "news:antara", "latest", {}, missing), (e) => e.name === "ScraperError");
});
