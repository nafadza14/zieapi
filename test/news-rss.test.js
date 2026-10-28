// International publisher feeds and the general RSS/Atom toolkit (offline: fetch and DNS are mocked).
import { test } from "node:test";
import assert from "node:assert/strict";
import news from "../src/scrapers/live/news-global.js";
import extra from "../src/scrapers/live/public-apis-3.js";
import existing from "../src/scrapers/live/news.js";

const RSS = (title, n = 3) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${Array.from({ length: n }, (_, i) => `<item><title>Story ${i}</title><link>https://example.org/${title.length}/${i}</link><pubDate>Tue, 2${i} Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Body ${i}&lt;/p&gt;</description></item>`).join("")}</channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom One</title><entry><title>A</title><link href="https://example.org/a"/><updated>2026-10-27T10:00:00Z</updated></entry></feed>`;
const lookup = async () => [{ address: "93.184.215.14", family: 4 }];

test("global news: unique slugs, no clash with existing news, every section URL is https or http and parses", async () => {
  const slugs = news.map((m) => m.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  const old = new Set(existing.map((m) => m.slug));
  for (const s of slugs) assert.ok(!old.has(s), `clash with existing news:${s}`);
  assert.ok(news.length >= 100);
  for (const m of news) {
    assert.equal(m.category, "news");
    assert.ok(!/—/.test(m.description), m.slug);
    const ep = m.endpoints[0];
    const sec = ep.fields.find((f) => f.name === "section");
    const values = sec ? sec.enum : [undefined];
    for (const v of values) {
      const calls = [];
      const out = await ep.handler({ ...(v ? { section: v } : {}), limit: 2 }, { fetch: async (u) => (calls.push(String(u)), new Response(RSS(m.displayName), { headers: { "content-type": "application/rss+xml" } })) });
      assert.equal(calls.length, 1);
      assert.match(calls[0], /^https?:\/\/[^/]+\.[a-z]+/, `${m.slug} ${v}`);
      assert.equal(out.items.length, 2);
      assert.equal(out.items[0].description, "Body 0");
      assert.equal(out.publisher, m.displayName);
    }
  }
});

const tools = extra.find((m) => m.slug === "rss-reader");
const ep = (slug) => tools.endpoints.find((e) => e.slug === slug);

test("rss-reader/read parses RSS and Atom, rejects non-feeds and private hosts", async () => {
  const fetch = async (u) => new Response(String(u).includes("atom") ? ATOM : String(u).includes("html") ? "<html><body>hi</body></html>" : RSS("Feed"), { status: 200 });
  const r = await ep("read").handler({ url: "https://example.org/rss.xml", limit: 2 }, { fetch, lookup });
  assert.equal(r.title, "Feed");
  assert.equal(r.items.length, 2);
  const a = await ep("read").handler({ url: "https://example.org/atom.xml", limit: 5 }, { fetch, lookup });
  assert.equal(a.items[0].link, "https://example.org/a");
  await assert.rejects(ep("read").handler({ url: "https://example.org/page.html" }, { fetch, lookup }), /not an RSS or Atom feed/);
  await assert.rejects(ep("read").handler({ url: "http://127.0.0.1/rss" }, { fetch, lookup: async () => [{ address: "127.0.0.1", family: 4 }] }), /private/i);
  // a redirect to a private address is refused too
  const redir = async (u) => (String(u).includes("start") ? new Response("", { status: 302, headers: { location: "http://10.0.0.5/feed" } }) : new Response(RSS("x")));
  await assert.rejects(ep("read").handler({ url: "https://example.org/start" }, { fetch: redir, lookup: async (h) => [{ address: h === "10.0.0.5" ? "10.0.0.5" : "93.184.215.14", family: 4 }] }), /private/i);
});

test("rss-reader/discover finds advertised feeds; merge sorts newest first and dedupes", async () => {
  const html = `<html><head><link rel="alternate" type="application/rss+xml" title="Main" href="/feed/"><link rel="alternate" type="application/atom+xml" href="https://example.org/atom.xml"><link rel="stylesheet" href="/x.css"></head></html>`;
  const d = await ep("discover").handler({ url: "https://example.org/" }, { fetch: async () => new Response(html), lookup });
  assert.deepEqual(d.feeds.map((x) => x.url), ["https://example.org/feed/", "https://example.org/atom.xml"]);
  assert.equal(d.feeds[0].title, "Main");
  const fetch = async (u) => (String(u).includes("bad") ? new Response("nope", { status: 500 }) : new Response(RSS(String(u).includes("one") ? "One" : "Two")));
  const m = await ep("merge").handler({ urls: ["https://a.example/one", "https://b.example/two", "https://c.example/bad"], limit: 50 }, { fetch, lookup });
  assert.equal(m.feeds.filter((x) => x.ok).length, 2);
  assert.equal(m.feeds.find((x) => !x.ok).url, "https://c.example/bad");
  assert.equal(m.total, 3, "same links from both feeds are merged once");
  assert.ok(Date.parse(m.items[0].publishedAt) >= Date.parse(m.items.at(-1).publishedAt));
});
