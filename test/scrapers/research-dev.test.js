import { test } from "node:test";
import assert from "node:assert/strict";
import defs from "../../src/scrapers/live/research-dev.js";
import { assertPublicUrl, isPrivateIp } from "../../src/scrapers/ssrf.js";
import { checkModule, mockFetch, run } from "./harness.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const privateLookup = async () => [{ address: "10.0.0.5", family: 4 }];

/** Like harness.run but lets us inject ctx.lookup. */
async function runL(key, endpoint, params, fetch, lookup = publicLookup) {
  const [cat, slug] = key.split(":");
  const e = defs.find((x) => x.category === cat && x.slug === slug).endpoints.find((x) => x.slug === endpoint);
  const p = { ...params };
  for (const fl of e.fields ?? []) if (p[fl.name] === undefined && fl.default !== undefined) p[fl.name] = fl.default;
  return e.handler(p, { fetch, lookup, signal: undefined });
}

const xmlRes = (body, status = 200, headers = {}) => () => new Response(body, { status, headers: { "content-type": "text/xml", ...headers } });

test("module shape", () => {
  checkModule(defs);
  assert.equal(defs.length, 23);
  const keys = defs.map((d) => `${d.category}:${d.slug}`);
  assert.equal(new Set(keys).size, keys.length);
});

// ── research ──
test("pubmed search + summaries", async () => {
  const fetch = mockFetch([
    ["esearch.fcgi", { esearchresult: { count: "2", idlist: ["1", "2"], querytranslation: "x" } }],
    ["esummary.fcgi", { result: { uids: ["1"], 1: { uid: "1", title: "T", authors: [{ name: "A B" }], fulljournalname: "J", pubdate: "2020", articleids: [{ idtype: "doi", value: "10.1/x" }] } } }],
  ]);
  const r = await run(defs, "research:pubmed", "search", { term: "covid", page: 2, limit: 10, sort: "pubDate", summaries: true }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.searchParams.get("retstart"), "10");
  assert.equal(u.searchParams.get("sort"), "pub_date");
  assert.equal(u.searchParams.get("retmode"), "json");
  assert.equal(r.total, 2);
  assert.deepEqual(r.ids, ["1", "2"]);
  assert.equal(r.items[0].doi, "10.1/x");
  assert.deepEqual(r.items[0].authors, ["A B"]);
});

test("pubmed abstract parses efetch XML", async () => {
  const xml = `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">123</PMID><Article><Journal><JournalIssue><Volume>5</Volume><PubDate><Year>2021</Year></PubDate></JournalIssue><Title>Nature</Title></Journal><ArticleTitle>Hello &amp; world</ArticleTitle><Abstract><AbstractText Label="BACKGROUND">Bg.</AbstractText><AbstractText Label="RESULTS">Res <i>x</i>.</AbstractText></Abstract><AuthorList><Author><LastName>Doe</LastName><ForeName>Jane</ForeName></Author></AuthorList></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">123</ArticleId><ArticleId IdType="doi">10.1/abc</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;
  const fetch = mockFetch([["efetch.fcgi", xmlRes(xml)]]);
  const r = await run(defs, "research:pubmed", "abstract", { id: "123" }, fetch);
  assert.match(fetch.calls[0].url, /db=pubmed.*id=123.*rettype=abstract/);
  assert.equal(r.title, "Hello & world");
  assert.equal(r.abstract, "BACKGROUND: Bg.\nRESULTS: Res x .");
  assert.deepEqual(r.authors, ["Jane Doe"]);
  assert.equal(r.doi, "10.1/abc");
  assert.equal(r.journal, "Nature");
  assert.equal(r.year, "2021");
});

test("pubmed spell, citation-match, trials-search", async () => {
  const fetch = mockFetch([
    ["espell.fcgi", xmlRes("<eSpellResult><Database>pubmed</Database><Query>asthmaa</Query><CorrectedQuery>asthma</CorrectedQuery></eSpellResult>")],
    ["ecitmatch.cgi", "proc natl acad sci u s a|1991|88|3248|mann bj|q1|2014248\n"],
    ["clinicaltrials.gov/api/v2/studies", { totalCount: 1, nextPageToken: "n", studies: [{ protocolSection: { identificationModule: { nctId: "NCT00000001", briefTitle: "B" }, statusModule: { overallStatus: "RECRUITING" }, designModule: { phases: ["PHASE2"] } } }] }],
  ]);
  assert.deepEqual(await run(defs, "research:pubmed", "spell", { term: "asthmaa" }, fetch), { db: "pubmed", query: "asthmaa", corrected: "asthma", changed: true });
  const cm = await run(defs, "research:pubmed", "citation-match", { journal: "proc natl acad sci u s a", year: 1991, volume: "88", firstPage: "3248", author: "mann bj" }, fetch);
  assert.equal(cm.pmid, "2014248");
  assert.equal(new URL(fetch.calls[1].url).searchParams.get("bdata"), "proc natl acad sci u s a|1991|88|3248|mann bj|q1|");
  const t = await run(defs, "research:pubmed", "trials-search", { condition: "diabetes", status: "RECRUITING" }, fetch);
  assert.equal(new URL(fetch.calls[2].url).searchParams.get("query.cond"), "diabetes");
  assert.equal(t.studies[0].nctId, "NCT00000001");
  assert.equal(t.nextCursor, "n");
});

test("europepmc search + citations", async () => {
  const fetch = mockFetch([
    ["/rest/search", { hitCount: 1, nextCursorMark: "AoE", resultList: { result: [{ id: "1", source: "MED", pmid: "1", title: "<i>T</i>", authorString: "X", pubYear: "2020", citedByCount: 4, isOpenAccess: "Y" }] } }],
    ["/MED/1/citations", { hitCount: 3, citationList: { citation: [{ id: "9" }] } }],
  ]);
  const r = await run(defs, "research:europepmc", "search", { query: "malaria", sort: "citedDesc" }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.searchParams.get("sort"), "CITED desc");
  assert.equal(u.searchParams.get("cursorMark"), "*");
  assert.equal(u.searchParams.get("format"), "json");
  assert.equal(r.results[0].title, "T");
  assert.equal(r.results[0].openAccess, true);
  assert.equal(r.nextCursor, "AoE");
  const c = await run(defs, "research:europepmc", "citations", { id: "1" }, fetch);
  assert.match(fetch.calls[1].url, /rest\/MED\/1\/citations\?page=1&pageSize=25&format=json/);
  assert.equal(c.total, 3);
});

test("doaj search-articles + journal-by-issn", async () => {
  const fetch = mockFetch([
    ["search/articles", { total: 1, page: 1, pageSize: 10, results: [{ id: "abc", bibjson: { title: "T", identifier: [{ type: "doi", id: "10.1/x" }], author: [{ name: "N" }], journal: { title: "J" } } }] }],
    ["search/journals", { total: 1, results: [{ id: "j1", bibjson: { title: "JT", eissn: "1234-5678", publisher: { name: "P", country: "ID" }, subject: [{ term: "Medicine" }] } }] }],
  ]);
  const r = await run(defs, "research:doaj", "search-articles", { query: "climate change", sort: "year", order: "asc" }, fetch);
  assert.match(fetch.calls[0].url, /^https:\/\/doaj\.org\/api\/search\/articles\/climate%20change\?/);
  assert.equal(new URL(fetch.calls[0].url).searchParams.get("sort"), "bibjson.year:asc");
  assert.equal(r.results[0].doi, "10.1/x");
  const j = await run(defs, "research:doaj", "journal-by-issn", { issn: "1234-5678" }, fetch);
  assert.match(fetch.calls[1].url, /search\/journals\/issn%3A1234-5678/);
  assert.equal(j.country, "ID");
  assert.deepEqual(j.subjects, ["Medicine"]);
});

// ── search tools ──
test("arxiv search parses Atom", async () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults>42</opensearch:totalResults><entry><id>http://arxiv.org/abs/2101.00001v1</id><updated>2021-01-02T00:00:00Z</updated><published>2021-01-01T00:00:00Z</published><title>A  Paper</title><summary> Sum </summary><author><name>Ann</name></author><author><name>Bob</name></author><arxiv:doi>10.1/y</arxiv:doi><link href="http://arxiv.org/abs/2101.00001v1" rel="alternate" type="text/html"/><link title="pdf" href="http://arxiv.org/pdf/2101.00001v1" rel="related" type="application/pdf"/><arxiv:primary_category term="cs.CL" scheme="x"/><category term="cs.CL" scheme="x"/><category term="cs.AI" scheme="x"/></entry></feed>`;
  const fetch = mockFetch([["export.arxiv.org", xmlRes(xml)]]);
  const r = await run(defs, "search-tools:arxiv", "search", { query: "llm", count: 5, page: 2 }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.searchParams.get("search_query"), "all:llm");
  assert.equal(u.searchParams.get("start"), "5");
  assert.equal(r.total, 42);
  assert.equal(r.results[0].id, "2101.00001v1");
  assert.equal(r.results[0].title, "A Paper");
  assert.deepEqual(r.results[0].authors, ["Ann", "Bob"]);
  assert.deepEqual(r.results[0].categories, ["cs.CL", "cs.AI"]);
  assert.equal(r.results[0].primaryCategory, "cs.CL");
  assert.equal(r.results[0].pdf, "http://arxiv.org/pdf/2101.00001v1");
});

test("wikipedia search", async () => {
  const fetch = mockFetch([["wikipedia.org/w/api.php", { query: { searchinfo: { totalhits: 5 }, search: [{ title: "Jakarta Raya", pageid: 1, snippet: '<span class="searchmatch">Jakarta</span> is' }] } }]]);
  const r = await run(defs, "search-tools:wikipedia", "search", { query: "Jakarta", lang: "id" }, fetch);
  assert.match(fetch.calls[0].url, /^https:\/\/id\.wikipedia\.org\/w\/api\.php\?.*srsearch=Jakarta/);
  assert.equal(r.results[0].snippet, "Jakarta is");
  assert.equal(r.results[0].url, "https://id.wikipedia.org/wiki/Jakarta_Raya");
});

test("hackernews search", async () => {
  const fetch = mockFetch([["hn.algolia.com", { nbHits: 1, page: 0, nbPages: 1, hits: [{ objectID: "9", title: "Rust", url: "https://r", author: "a", points: 10, num_comments: 2, created_at: "2020", _tags: ["story"] }] }]]);
  const r = await run(defs, "search-tools:hackernews", "search", { query: "rust", sort: "date" }, fetch);
  assert.match(fetch.calls[0].url, /api\/v1\/search_by_date\?query=rust&page=0/);
  assert.equal(r.results[0].type, "story");
  assert.equal(r.results[0].hnUrl, "https://news.ycombinator.com/item?id=9");
  assert.equal(r.page, 1);
});

test("stackoverflow search", async () => {
  const fetch = mockFetch([["api.stackexchange.com/2.3/search/advanced", { has_more: true, quota_remaining: 290, items: [{ question_id: 1, title: "How &amp; why", link: "l", score: 3, answer_count: 1, is_answered: true, tags: ["js"], owner: { display_name: "x" }, creation_date: 0 }] }]]);
  const r = await run(defs, "search-tools:stackoverflow", "search", { query: "fetch", site: "superuser" }, fetch);
  assert.equal(new URL(fetch.calls[0].url).searchParams.get("site"), "superuser");
  assert.equal(r.results[0].title, "How & why");
  assert.equal(r.results[0].createdAt, "1970-01-01T00:00:00.000Z");
});

test("npm search", async () => {
  const fetch = mockFetch([["registry.npmjs.org/-/v1/search", { total: 100, objects: [{ package: { name: "ky", version: "1.0.0", publisher: { username: "s" } }, score: { final: 0.9 } }] }]]);
  const r = await run(defs, "search-tools:npm", "search", { query: "http", count: 10, page: 3 }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.searchParams.get("from"), "20");
  assert.equal(u.searchParams.get("size"), "10");
  assert.equal(r.results[0].name, "ky");
  assert.equal(r.results[0].publisher, "s");
});

test("openverse search", async () => {
  const fetch = mockFetch([["api.openverse.org/v1/audio/", { result_count: 1, page_count: 1, page: 1, results: [{ id: "a", url: "u", license: "by", duration: 1000 }] }]]);
  const r = await run(defs, "search-tools:openverse", "search", { query: "rain", type: "audio" }, fetch);
  assert.match(fetch.calls[0].url, /q=rain/);
  assert.equal(r.results[0].duration, 1000);
});

// ── social ──
test("github profile + repo", async () => {
  const fetch = mockFetch([
    ["api.github.com/users/torvalds", { login: "torvalds", id: 1, followers: 10, html_url: "h", avatar_url: "a" }],
    ["api.github.com/repos/nodejs/node", { full_name: "nodejs/node", stargazers_count: 5, license: { spdx_id: "MIT" }, owner: { login: "nodejs" } }],
  ]);
  const r = await run(defs, "social-media:github-user", "profile", { username: "torvalds" }, fetch);
  assert.equal(r.followers, 10);
  assert.equal(fetch.calls[0].init.headers.accept, "application/vnd.github+json");
  const repo = await run(defs, "social-media:github-user", "repo", { owner: "nodejs", repo: "node" }, fetch);
  assert.equal(repo.license, "MIT");
  await assert.rejects(run(defs, "social-media:github-user", "profile", { username: "../x" }, fetch), /Invalid username/);
});

test("bluesky profile + post thread resolves handle", async () => {
  const fetch = mockFetch([
    ["app.bsky.actor.getProfile", { did: "did:plc:x", handle: "bsky.app", followersCount: 7 }],
    ["com.atproto.identity.resolveHandle", { did: "did:plc:x" }],
    ["app.bsky.feed.getPostThread", { thread: { $type: "app.bsky.feed.defs#threadViewPost", post: { uri: "at://did:plc:x/app.bsky.feed.post/abc", author: { handle: "bsky.app" }, record: { text: "hi" }, likeCount: 2 }, replies: [] } }],
  ]);
  const p = await run(defs, "social-media:bluesky", "profile", { handle: "bsky.app" }, fetch);
  assert.match(fetch.calls[0].url, /^https:\/\/public\.api\.bsky\.app\/xrpc\/app\.bsky\.actor\.getProfile\?actor=bsky\.app/);
  assert.equal(p.followers, 7);
  const t = await run(defs, "social-media:bluesky", "post", { url: "https://bsky.app/profile/bsky.app/post/abc" }, fetch);
  assert.equal(new URL(fetch.calls[2].url).searchParams.get("uri"), "at://did:plc:x/app.bsky.feed.post/abc");
  assert.equal(t.thread.text, "hi");
  assert.equal(t.thread.likes, 2);
  assert.equal(t.thread.url, "https://bsky.app/profile/bsky.app/post/abc");
});

test("discord invite + widget via code", async () => {
  const inv = { code: "abc", guild: { id: "123456789012345678", name: "G", icon: "ic" }, channel: { id: "1", name: "c", type: 0 }, approximate_member_count: 100, approximate_presence_count: 10 };
  const fetch = mockFetch([
    ["/invites/abc", inv],
    ["/guilds/123456789012345678/widget.json", { id: "123456789012345678", name: "G", presence_count: 10, channels: [], members: [{ id: "0", username: "u", status: "online" }] }],
  ]);
  const r = await run(defs, "social-media:discord", "invite", { code: "https://discord.gg/abc" }, fetch);
  assert.match(fetch.calls[0].url, /discord\.com\/api\/v10\/invites\/abc\?with_counts=true/);
  assert.equal(r.approximateMembers, 100);
  assert.equal(r.guild.icon, "https://cdn.discordapp.com/icons/123456789012345678/ic.png");
  const w = await run(defs, "social-media:discord", "widget", { code: "abc" }, fetch);
  assert.equal(w.members[0].status, "online");
});

// ── web tools ──
test("rdap availability: 404 → available, 200 → registered", async () => {
  const fetch = mockFetch([
    ["rdap.org/domain/free-name-xyz.com", () => new Response("", { status: 404 })],
    ["rdap.org/domain/example.com", { ldhName: "EXAMPLE.COM", status: ["active"], events: [{ eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" }], entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "RESERVED-IANA"]]] }] }],
  ]);
  assert.equal((await run(defs, "web-tools:rdap", "availability", { domain: "free-name-xyz.com" }, fetch)).available, true);
  const r = await run(defs, "web-tools:rdap", "availability", { domain: "https://Example.com/path" }, fetch);
  assert.equal(r.available, false);
  assert.equal(r.registrar, "RESERVED-IANA");
  await assert.rejects(run(defs, "web-tools:rdap", "availability", { domain: "not a domain" }, fetch), /Invalid domain/);
});

test("wayback snapshot", async () => {
  const fetch = mockFetch([["archive.org/wayback/available", { archived_snapshots: { closest: { available: true, url: "http://web.archive.org/web/20100101000000/example.com", timestamp: "20100101000000", status: "200" } } }]]);
  const r = await run(defs, "web-tools:wayback", "snapshot", { url: "example.com", timestamp: "2010" }, fetch);
  assert.match(fetch.calls[0].url, /url=example\.com&timestamp=2010/);
  assert.equal(r.snapshot.archivedAt, "2010-01-01T00:00:00Z");
  assert.ok(r.snapshot.url.startsWith("https://"));
});

test("weather forecast + geocode", async () => {
  const fetch = mockFetch([
    ["api.open-meteo.com/v1/forecast", { latitude: -6.2, longitude: 106.8, timezone: "Asia/Jakarta", current: { temperature_2m: 30, weather_code: 3 }, daily: { time: ["2026-01-01"], weather_code: [61], temperature_2m_max: [32], temperature_2m_min: [24] } }],
    ["geocoding-api.open-meteo.com", { results: [{ name: "Bandung", latitude: -6.9, longitude: 107.6, country_code: "ID" }] }],
  ]);
  const r = await run(defs, "web-tools:weather", "forecast", { lat: -6.2, lon: 106.8, days: 3 }, fetch);
  assert.equal(new URL(fetch.calls[0].url).searchParams.get("forecast_days"), "3");
  assert.equal(r.current.condition, "Overcast");
  assert.equal(r.daily[0].condition, "Slight rain");
  const g = await run(defs, "web-tools:weather", "geocode", { name: "Bandung" }, fetch);
  assert.equal(g.results[0].countryCode, "ID");
});

test("jina-reader is SSRF-checked and calls r.jina.ai", async () => {
  const fetch = mockFetch([["r.jina.ai", { code: 200, data: { title: "Ex", url: "https://example.com/", content: "# Hello" } }]]);
  const r = await runL("web-tools:jina-reader", "read", { url: "https://example.com" }, fetch);
  assert.equal(fetch.calls[0].url, "https://r.jina.ai/https://example.com/");
  assert.equal(r.content, "# Hello");
  await assert.rejects(runL("web-tools:jina-reader", "read", { url: "http://127.0.0.1/" }, fetch), /private/);
  await assert.rejects(runL("web-tools:jina-reader", "read", { url: "http://intranet.example/" }, fetch, privateLookup), /private/);
  assert.equal(fetch.calls.length, 1);
});

test("bin-lookup", async () => {
  const fetch = mockFetch([["lookup.binlist.net/45717360", { scheme: "visa", type: "debit", country: { alpha2: "DK", name: "Denmark" }, bank: { name: "Jyske Bank" } }]]);
  const r = await run(defs, "web-tools:bin-lookup", "lookup", { bin: "45717360" }, fetch);
  assert.equal(fetch.calls[0].init.headers["accept-version"], "3");
  assert.equal(r.scheme, "visa");
  assert.equal(r.country.code, "DK");
  await assert.rejects(run(defs, "web-tools:bin-lookup", "lookup", { bin: "4571736012345678" }, fetch), /6-8 digits/);
});

// ── dev tools ──
test("dns-lookup via Cloudflare DoH", async () => {
  const fetch = mockFetch([["cloudflare-dns.com/dns-query", { Status: 0, AD: true, Answer: [{ name: "example.com", type: 15, TTL: 300, data: "0 ." }] }]]);
  const r = await run(defs, "dev-tools:dns-lookup", "lookup", { domain: "example.com", type: "MX" }, fetch);
  assert.match(fetch.calls[0].url, /name=example\.com&type=MX/);
  assert.equal(fetch.calls[0].init.headers.accept, "application/dns-json");
  assert.deepEqual(r.answers, [{ name: "example.com", type: "MX", ttl: 300, data: "0 ." }]);
  assert.equal(r.status, "NOERROR");
});

test("ip-geo", async () => {
  const fetch = mockFetch([["ipwho.is/8.8.8.8", { ip: "8.8.8.8", success: true, country: "United States", country_code: "US", connection: { asn: 15169, isp: "Google LLC" } }]]);
  const r = await run(defs, "dev-tools:ip-geo", "lookup", { ip: "8.8.8.8" }, fetch);
  assert.equal(r.connection.asn, 15169);
  const bad = mockFetch([["ipwho.is", { success: false, message: "Invalid IP address" }]]);
  await assert.rejects(run(defs, "dev-tools:ip-geo", "lookup", { ip: "1.2.3.999" }, bad), /Invalid IP/);
});

test("whois-lookup via RDAP", async () => {
  const fetch = mockFetch([["rdap.org/domain/example.com", { ldhName: "EXAMPLE.COM", status: ["client transfer prohibited"], events: [{ eventAction: "expiration", eventDate: "2030-01-01" }], nameservers: [{ ldhName: "A.IANA-SERVERS.NET" }], secureDNS: { delegationSigned: true }, entities: [{ roles: ["registrar"], publicIds: [{ type: "IANA Registrar ID", identifier: "376" }], vcardArray: ["vcard", [["fn", {}, "text", "RESERVED"]]] }] }]]);
  const r = await run(defs, "dev-tools:whois-lookup", "lookup", { domain: "example.com" }, fetch);
  assert.equal(r.domain, "example.com");
  assert.equal(r.expiresAt, "2030-01-01");
  assert.deepEqual(r.nameservers, ["a.iana-servers.net"]);
  assert.equal(r.registrar.ianaId, "376");
  assert.equal(r.dnssec, true);
});

test("ssl-labs analyze", async () => {
  const fetch = mockFetch([["api.ssllabs.com/api/v3/analyze", { host: "example.com", status: "READY", endpoints: [{ ipAddress: "1.2.3.4", grade: "A+", statusMessage: "Ready" }] }]]);
  const r = await run(defs, "dev-tools:ssl-labs", "analyze", { host: "example.com" }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.searchParams.get("fromCache"), "on");
  assert.equal(r.endpoints[0].grade, "A+");
});

test("http-headers follows redirects with SSRF checks on every hop", async () => {
  const fetch = mockFetch([
    ["http://example.com/", () => new Response(null, { status: 301, headers: { location: "https://example.com/" } })],
    ["https://example.com/", () => new Response(null, { status: 200, headers: { "strict-transport-security": "max-age=1", server: "x" } })],
  ]);
  const r = await runL("dev-tools:http-headers", "inspect", { url: "http://example.com/" }, fetch);
  assert.equal(fetch.calls[0].init.method, "HEAD");
  assert.equal(fetch.calls[0].init.redirect, "manual");
  assert.equal(r.status, 200);
  assert.equal(r.finalUrl, "https://example.com/");
  assert.equal(r.redirects.length, 1);
  assert.equal(r.security["strict-transport-security"], true);
  assert.equal(r.headers.server, "x");

  const evil = mockFetch([["example.com", () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })]]);
  await assert.rejects(runL("dev-tools:http-headers", "inspect", { url: "https://example.com/" }, evil), /private/);
  assert.equal(evil.calls.length, 1);

  const loop = mockFetch([["example.com", () => new Response(null, { status: 302, headers: { location: "/again" } })]]);
  await assert.rejects(runL("dev-tools:http-headers", "inspect", { url: "https://example.com/" }, loop), /Too many redirects/);
  assert.equal(loop.calls.length, 4);
});

test("meta-preview extracts title/og/canonical", async () => {
  const html = `<!doctype html><html lang="id"><head><title> Hello &amp; Co </title><meta name="description" content="Desc"><meta property="og:title" content="OG T"><meta property='og:image' content='/img.png'><meta name="twitter:card" content="summary"><link rel="canonical" href="/canon"><link rel="shortcut icon" href="/fav.ico"></head><body>x</body></html>`;
  const fetch = mockFetch([["example.com", () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })]]);
  const r = await runL("dev-tools:meta-preview", "lookup", { url: "https://example.com/page" }, fetch);
  assert.equal(r.title, "Hello & Co");
  assert.equal(r.description, "Desc");
  assert.equal(r.og.title, "OG T");
  assert.equal(r.image, "https://example.com/img.png");
  assert.equal(r.canonical, "https://example.com/canon");
  assert.equal(r.icon, "https://example.com/fav.ico");
  assert.equal(r.twitter.card, "summary");
  assert.equal(r.lang, "id");
  await assert.rejects(runL("dev-tools:meta-preview", "lookup", { url: "http://[::1]/" }, fetch), /private/);
  const pdf = mockFetch([["example.com", () => new Response("%PDF", { headers: { "content-type": "application/pdf" } })]]);
  await assert.rejects(runL("dev-tools:meta-preview", "lookup", { url: "https://example.com/a.pdf" }, pdf), /Not an HTML page/);
});

// ── SSRF unit tests ──
test("isPrivateIp", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:a00:1::1", "garbage"])
    assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2a00:1450:4001::200e"]) assert.equal(isPrivateIp(ip), false, ip);
});

test("assertPublicUrl", async () => {
  assert.equal((await assertPublicUrl("https://example.com/x", publicLookup)).hostname, "example.com");
  assert.ok(await assertPublicUrl("http://example.com:8080/", publicLookup));
  const bad = [
    ["ftp://example.com/", /http/],
    ["file:///etc/passwd", /http/],
    ["https://user:pw@example.com/", /Credentials/],
    ["https://example.com:22/", /Port/],
    ["http://localhost/", /private/],
    ["http://foo.localhost/", /private/],
    ["http://127.1/", /private/], // WHATWG normalises to 127.0.0.1
    ["http://0x7f000001/", /private/],
    ["http://[::ffff:192.168.0.1]/", /private/],
    ["http://[fe80::1]/", /private/],
    ["not a url", /Invalid URL/],
  ];
  for (const [u, re] of bad) await assert.rejects(assertPublicUrl(u, publicLookup), re, u);
  await assert.rejects(assertPublicUrl("https://rebind.example/", privateLookup), /private/);
  await assert.rejects(assertPublicUrl("https://mixed.example/", async () => [{ address: "8.8.8.8" }, { address: "fd00::1" }]), /private/);
  await assert.rejects(assertPublicUrl("https://nx.example/", async () => { throw new Error("ENOTFOUND"); }), /could not be resolved/);
});
