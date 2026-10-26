import { test } from "node:test";
import assert from "node:assert/strict";
import defs from "../../src/scrapers/live/media-apps.js";
import { checkModule, mockFetch, run } from "./harness.js";

test("media-apps module shape", () => checkModule(defs));

test("tvmaze search + episodes", async () => {
  const fetch = mockFetch([
    ["/search/shows", [{ score: 0.9, show: { id: 526, name: "The Office", url: "u", genres: ["Comedy"], rating: { average: 8.6 }, network: { name: "NBC", country: { code: "US" } }, image: { original: "img" }, summary: "<p>Paper <b>company</b></p>" } }]],
    ["/shows/526/episodes", [{ id: 1, name: "Pilot", season: 1, number: 1, airdate: "2005-03-24", summary: "<p>x</p>" }, { id: 2, name: "S2", season: 2, number: 1 }]],
  ]);
  const r = await run(defs, "movie:tvmaze", "search", { q: "the office" }, fetch);
  assert.equal(fetch.calls[0].url, "https://api.tvmaze.com/search/shows?q=the+office");
  assert.equal(r.shows[0].network, "NBC");
  assert.equal(r.shows[0].summary, "Paper company");
  assert.equal(r.people, undefined);
  const e = await run(defs, "movie:tvmaze", "episodes", { id: "526", season: 2 }, fetch);
  assert.equal(e.total, 1);
  assert.equal(e.episodes[0].id, 2);
});

test("tvmaze web schedule uses embedded show", async () => {
  const fetch = mockFetch([["/schedule/web", [{ id: 9, name: "Ep", season: 1, number: 3, _embedded: { show: { id: 5, name: "Webby" } } }]]]);
  const r = await run(defs, "movie:tvmaze", "schedule", { web: true, date: "2024-01-15" }, fetch);
  assert.match(fetch.calls[0].url, /schedule\/web\?date=2024-01-15&country=US/);
  assert.equal(r.episodes[0].show.name, "Webby");
});

test("anilist search posts GraphQL", async () => {
  const fetch = mockFetch([
    ["graphql.anilist.co", { data: { Page: { pageInfo: { total: 1, currentPage: 1, hasNextPage: false }, media: [{ id: 1, type: "ANIME", title: { romaji: "Sousou no Frieren" }, description: "A <br>tale", startDate: { year: 2023, month: 9, day: 29 }, coverImage: { large: "c" }, siteUrl: "s" }] } } }],
  ]);
  const r = await run(defs, "movie:anilist", "search", { q: "frieren", sort: "score" }, fetch);
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.equal(body.variables.search, "frieren");
  assert.equal(body.variables.sort, "SCORE_DESC");
  assert.equal(body.variables.type, "ANIME");
  assert.equal(r.results[0].startDate, "2023-09-29");
  assert.equal(r.results[0].description, "A tale");
});

test("anilist surfaces GraphQL errors", async () => {
  const fetch = mockFetch([["graphql.anilist.co", { data: null, errors: [{ message: "Not Found.", status: 404 }] }]]);
  await assert.rejects(run(defs, "movie:anilist", "media", { id: 999999999 }, fetch), /Not Found/);
});

test("myanimelist via jikan", async () => {
  const fetch = mockFetch([
    ["/anime/52991/full", { data: { mal_id: 52991, title: "Frieren", episodes: 28, aired: { string: "Sep 2023" }, studios: [{ name: "Madhouse" }], genres: [{ name: "Fantasy" }] } }],
    ["/seasons/2024/fall", { pagination: { current_page: 1, last_visible_page: 3, has_next_page: true, items: { total: 60 } }, data: [{ mal_id: 1, title: "A", episodes: 12 }] }],
  ]);
  const a = await run(defs, "movie:myanimelist", "anime", { id: "52991" }, fetch);
  assert.equal(fetch.calls[0].url, "https://api.jikan.moe/v4/anime/52991/full");
  assert.deepEqual(a.studios, ["Madhouse"]);
  const s = await run(defs, "movie:myanimelist", "seasonal", { year: 2024, season: "fall" }, fetch);
  assert.match(fetch.calls[1].url, /\/seasons\/2024\/fall\?page=1&limit=20/);
  assert.equal(s.total, 60);
  assert.equal(s.hasMore, true);
});

const itunesTrack = { wrapperType: "track", kind: "song", trackId: 11, trackName: "One More Time", artistName: "Daft Punk", collectionId: 22, artworkUrl100: "https://x/100x100bb.jpg", trackViewUrl: "tv" };

test("itunes search", async () => {
  const fetch = mockFetch([["itunes.apple.com/search", { resultCount: 1, results: [itunesTrack] }]]);
  const r = await run(defs, "music:itunes", "search", { query: "daft punk" }, fetch);
  assert.match(fetch.calls[0].url, /term=daft\+punk&media=music&entity=song&country=us&limit=20/);
  assert.equal(r.results[0].artwork, "https://x/600x600bb.jpg");
});

test("apple-music album + search paging", async () => {
  const fetch = mockFetch([
    ["/lookup", { results: [{ wrapperType: "collection", collectionId: 22, collectionName: "Discovery", copyright: "c" }, itunesTrack] }],
    ["/search", { results: [itunesTrack, { ...itunesTrack, trackId: 12 }, { ...itunesTrack, trackId: 13 }] }],
  ]);
  const a = await run(defs, "music:apple-music", "album", { id: "22" }, fetch);
  assert.match(fetch.calls[0].url, /lookup\?id=22&country=us&entity=song/);
  assert.equal(a.collectionName, "Discovery");
  assert.equal(a.tracks.length, 1);
  const s = await run(defs, "music:apple-music", "search", { q: "x", limit: 2, page: 2 }, fetch);
  assert.match(fetch.calls[1].url, /limit=4/);
  assert.equal(s.results[0].trackId, 13);
});

test("deezer search + error payload", async () => {
  const fetch = mockFetch([
    ["/search/album", { data: [{ id: 1, title: "Discovery", nb_tracks: 14, artist: { id: 27, name: "Daft Punk" } }], total: 1 }],
    ["/track/0", { error: { type: "DataException", message: "no data", code: 800 } }],
  ]);
  const r = await run(defs, "music:deezer", "search", { q: "discovery", type: "album", page: 2, limit: 10 }, fetch);
  assert.equal(fetch.calls[0].url, "https://api.deezer.com/search/album?q=discovery&limit=10&index=10");
  assert.equal(r.results[0].artist.name, "Daft Punk");
  await assert.rejects(run(defs, "music:deezer", "track", { id: "0" }, fetch), /no data/);
});

test("musicbrainz search", async () => {
  const fetch = mockFetch([["musicbrainz.org/ws/2/artist", { count: 1, offset: 0, artists: [{ id: "a", name: "Queen", "life-span": { begin: "1970" }, tags: [{ name: "rock" }] }] }]]);
  const r = await run(defs, "music:musicbrainz", "search", { query: "queen", entity: "artist" }, fetch);
  assert.match(fetch.calls[0].url, /\/ws\/2\/artist\?query=queen&limit=25&offset=0&fmt=json/);
  assert.deepEqual(r.results[0].tags, ["rock"]);
});

test("pokeapi pokemon", async () => {
  const fetch = mockFetch([["/pokemon/pikachu", { id: 25, name: "pikachu", height: 4, weight: 60, types: [{ slot: 1, type: { name: "electric" } }], abilities: [{ ability: { name: "static" }, is_hidden: false }], stats: [{ base_stat: 35, stat: { name: "hp" } }], moves: [], sprites: { front_default: "f", other: { "official-artwork": { front_default: "art" } } } }]]);
  const r = await run(defs, "games:pokeapi", "pokemon", { name: " Pikachu " }, fetch);
  assert.equal(fetch.calls[0].url, "https://pokeapi.co/api/v2/pokemon/pikachu");
  assert.equal(r.stats.hp, 35);
  assert.equal(r.sprites.artwork, "art");
});

test("cheapshark deals", async () => {
  const fetch = mockFetch([["/deals", [{ dealID: "abc", title: "Game", salePrice: "4.99", normalPrice: "19.99", savings: "75.037", isOnSale: "1", steamRatingText: "Positive", steamRatingPercent: "90", steamRatingCount: "100", releaseDate: 0 }]]]);
  const r = await run(defs, "games:cheapshark", "deals", { storeID: "1", upperPrice: 15 }, fetch);
  assert.equal(fetch.calls[0].url, "https://www.cheapshark.com/api/1.0/deals?storeID=1&upperPrice=15&pageSize=20&pageNumber=0");
  assert.equal(r.deals[0].salePrice, 4.99);
  assert.equal(r.deals[0].savings, 75.04);
  assert.equal(r.deals[0].isOnSale, true);
});

test("themealdb search + not found", async () => {
  const fetch = mockFetch([
    ["search.php", { meals: [{ idMeal: "52771", strMeal: "Arrabiata", strTags: "Pasta,Curry", strIngredient1: "penne", strMeasure1: "1 pound", strIngredient2: "", strIngredient3: null }] }],
    ["lookup.php", { meals: null }],
  ]);
  const r = await run(defs, "food:themealdb", "search", { query: "arrabiata" }, fetch);
  assert.equal(fetch.calls[0].url, "https://www.themealdb.com/api/json/v1/1/search.php?s=arrabiata");
  assert.deepEqual(r.meals[0].ingredients, [{ name: "penne", measure: "1 pound" }]);
  assert.deepEqual(r.meals[0].tags, ["Pasta", "Curry"]);
  await assert.rejects(run(defs, "food:themealdb", "lookup", { mealId: "1" }, fetch), /not found/);
});

test("openfoodfacts product", async () => {
  const fetch = mockFetch([["/api/v2/product/3017624010701.json", { status: 1, product: { code: "3017624010701", product_name: "Nutella", allergens_tags: ["en:milk"], nutriments: { "energy-kcal_100g": 539, sugars_100g: 56.3 } } }]]);
  const r = await run(defs, "food:openfoodfacts", "product", { barcode: "3017624010701" }, fetch);
  assert.match(fetch.calls[0].url, /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/3017624010701\.json\?fields=/);
  assert.deepEqual(r.allergens, ["milk"]);
  assert.equal(r.nutrimentsPer100g.sugars, 56.3);
});

test("who indicator-data builds OData filter", async () => {
  const fetch = mockFetch([
    ["/api/WHOSIS_000001", { value: [{ Id: 1, SpatialDim: "IDN", TimeDim: 2019, Dim1: "SEX_BTSX", NumericValue: 71.3, Value: "71.3" }, { Id: 2, SpatialDim: "IDN", TimeDim: 2021, Dim1: "SEX_BTSX", NumericValue: 68 }] }],
  ]);
  const r = await run(defs, "health:who", "indicator-data", { indicator: "WHOSIS_000001", country: "idn", yearFrom: 2015, dim1: "SEX_BTSX" }, fetch);
  const u = fetch.calls[0].url;
  assert.ok(u.startsWith("https://ghoapi.azureedge.net/api/WHOSIS_000001?$filter="));
  assert.equal(decodeURIComponent(u.split("$filter=")[1]), "SpatialDim eq 'IDN' and TimeDim ge 2015 and Dim1 eq 'SEX_BTSX'");
  assert.equal(r.data[0].year, 2021);
  assert.equal(r.total, 2);
});

test("who countries filtered by region", async () => {
  const fetch = mockFetch([["DIMENSION/COUNTRY/DimensionValues", { value: [{ Code: "IDN", Title: "Indonesia", ParentCode: "SEAR" }, { Code: "FRA", Title: "France", ParentCode: "EUR" }] }]]);
  const r = await run(defs, "health:who", "countries", { region: "sear" }, fetch);
  assert.deepEqual(r.countries.map((c) => c.code), ["IDN"]);
});

test("clinical-tables icd10 + generic search", async () => {
  const fetch = mockFetch([["clinicaltables.nlm.nih.gov/api/", [120, ["A15.0", "A15.4"], null, [["A15.0", "Tuberculosis of lung"], ["A15.4", "TB of lymph nodes"]]]]]);
  const r = await run(defs, "health:clinical-tables", "icd10", { terms: "tuberc", page: 2, limit: 2 }, fetch);
  assert.equal(fetch.calls[0].url, "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?terms=tuberc&count=2&offset=2&df=code%2Cname&sf=code%2Cname");
  assert.equal(r.total, 120);
  assert.deepEqual(r.results[0], { code: "A15.0", display: ["A15.0", "Tuberculosis of lung"] });
  assert.equal(r.hasMore, true);
  const fetch2 = mockFetch([["/api/rxterms/", [1, ["LIPITOR (Oral Pill)"], { STRENGTHS_AND_FORMS: [["10 mg Tab"]] }, [["LIPITOR (Oral Pill)"]]]]]);
  const d = await run(defs, "health:clinical-tables", "search", { table: "rxterms", terms: "lipitor" }, fetch2);
  assert.match(fetch2.calls[0].url, /ef=STRENGTHS_AND_FORMS%2CRXCUIS/);
  assert.deepEqual(d.results[0].extra.STRENGTHS_AND_FORMS, ["10 mg Tab"]);
});

test("medlineplus search-topics parses XML", async () => {
  const xml = `<?xml version="1.0"?><nlmSearchResult><term>diabetes</term><count>42</count><retstart>0</retstart><retmax>10</retmax>
  <list num="42" start="0" per="10"><document rank="0" url="https://medlineplus.gov/diabetes.html">
  <content name="title">&lt;span class="qt0"&gt;Diabetes&lt;/span&gt;</content><content name="altTitle">Sugar diabetes</content><content name="altTitle">DM</content>
  <content name="FullSummary">&lt;p&gt;Diabetes is a disease.&lt;/p&gt;</content><content name="groupName">Endocrine System</content></document></list></nlmSearchResult>`;
  const fetch = mockFetch([["wsearch.nlm.nih.gov", xml]]);
  const r = await run(defs, "health:medlineplus", "search-topics", { term: "diabetes" }, fetch);
  assert.equal(fetch.calls[0].url, "https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=diabetes&retstart=0&retmax=10&rettype=brief");
  assert.equal(r.total, 42);
  assert.equal(r.results[0].title, "Diabetes");
  assert.deepEqual(r.results[0].altTitles, ["Sugar diabetes", "DM"]);
  assert.equal(r.results[0].summary, "Diabetes is a disease.");
});

test("medlineplus connect lookup", async () => {
  const fetch = mockFetch([["connect.medlineplus.gov", { feed: { title: { _value: "MedlinePlus Connect" }, entry: [{ title: { _value: "Diabetes Type 2" }, link: [{ href: "https://medlineplus.gov/diabetestype2.html" }], summary: { _value: "<p>Info</p>" } }] } }]]);
  const r = await run(defs, "health:medlineplus", "lookup", { codeSystem: "icd10cm", code: "E11.9" }, fetch);
  assert.match(fetch.calls[0].url, /mainSearchCriteria\.v\.cs=2\.16\.840\.1\.113883\.6\.90&mainSearchCriteria\.v\.c=E11\.9/);
  assert.deepEqual(r.results[0], { title: "Diabetes Type 2", url: "https://medlineplus.gov/diabetestype2.html", summary: "Info" });
});

test("flathub collection", async () => {
  const fetch = mockFetch([["/collection/trending", { hits: [{ app_id: "org.gimp.GIMP", name: "GIMP", installs_last_month: 1000 }], page: 1, totalPages: 5, totalHits: 120 }]]);
  const r = await run(defs, "application:flathub", "collection", { collection: "trending" }, fetch);
  assert.equal(fetch.calls[0].url, "https://flathub.org/api/v2/collection/trending?page=1&per_page=25");
  assert.equal(r.apps[0].url, "https://flathub.org/apps/org.gimp.GIMP");
  assert.equal(r.total, 120);
});

test("snapcraft sends device-series header", async () => {
  const fetch = mockFetch([["/v2/snaps/info/firefox", { name: "firefox", "snap-id": "id1", snap: { title: "Firefox", publisher: { "display-name": "Mozilla", validation: "verified" }, media: [{ type: "icon", url: "i" }] }, "channel-map": [{ channel: { name: "stable", architecture: "amd64" }, version: "130" }, { channel: { name: "stable", architecture: "arm64" }, version: "130" }] }]]);
  const r = await run(defs, "application:snapcraft", "snap", { id: "firefox", architecture: "amd64" }, fetch);
  assert.equal(fetch.calls[0].init.headers["Snap-Device-Series"], "16");
  assert.equal(r.publisher.name, "Mozilla");
  assert.equal(r.channels.length, 1);
});

test("firefox-addons search", async () => {
  const fetch = mockFetch([["/addons/search/", { count: 1, next: null, results: [{ id: 1, slug: "ublock-origin", name: { "en-US": "uBlock Origin" }, summary: "Blocker", ratings: { average: 4.8, count: 10 }, average_daily_users: 9 }] }]]);
  const r = await run(defs, "application:firefox-addons", "search", { query: "ublock", sort: "users" }, fetch);
  assert.equal(fetch.calls[0].url, "https://addons.mozilla.org/api/v5/addons/search/?q=ublock&app=firefox&sort=users&lang=en-US&page=1&page_size=25");
  assert.equal(r.results[0].name, "uBlock Origin");
  assert.equal(r.results[0].rating.average, 4.8);
});

test("app-store reviews + charts", async () => {
  const fetch = mockFetch([
    ["customerreviews", { feed: { entry: [{ id: { label: "1" }, author: { name: { label: "Bob" } }, "im:rating": { label: "5" }, title: { label: "Great" }, content: { label: "Nice" }, "im:version": { label: "2.0" } }] } }],
    ["rss.applemarketingtools.com", { feed: { updated: "now", results: [{ id: "9", name: "App", artistName: "Dev", genres: [{ name: "Games" }] }] } }],
    ["/rss/topgrossingapplications", { feed: { entry: { id: { label: "u", attributes: { "im:id": "7", "im:bundleId": "b" } }, "im:name": { label: "Big" }, "im:price": { attributes: { amount: "0.00" } } } } }],
  ]);
  const r = await run(defs, "application:app-store", "reviews", { id: "284882215" }, fetch);
  assert.equal(fetch.calls[0].url, "https://itunes.apple.com/us/rss/customerreviews/page=1/id=284882215/sortby=mostrecent/json");
  assert.equal(r.reviews[0].rating, 5);
  const c = await run(defs, "application:app-store", "charts", { count: 20 }, fetch);
  assert.equal(fetch.calls[1].url, "https://rss.applemarketingtools.com/api/v2/us/apps/top-free/25/apps.json");
  assert.equal(c.apps[0].developer, "Dev");
  const g = await run(defs, "application:app-store", "charts", { feed: "topgrossingapplications", genre: "6014", country: "ID" }, fetch);
  assert.equal(fetch.calls[2].url, "https://itunes.apple.com/id/rss/topgrossingapplications/limit=50/genre=6014/json");
  assert.equal(g.apps[0].id, "7");
  assert.equal(g.apps[0].price, 0);
});

test("app-store app lookup", async () => {
  const fetch = mockFetch([["/lookup", { results: [{ trackId: 284882215, trackName: "Facebook", bundleId: "com.facebook.Facebook", averageUserRating: 4.1, fileSizeBytes: "1000" }] }]]);
  const r = await run(defs, "application:app-store", "app", { bundleId: "com.facebook.Facebook" }, fetch);
  assert.equal(fetch.calls[0].url, "https://itunes.apple.com/lookup?bundleId=com.facebook.Facebook&country=us");
  assert.equal(r.sizeBytes, 1000);
});

for (const [slug, base] of [["mail-tm", "https://api.mail.tm"], ["mail-gw", "https://api.mail.gw"]]) {
  test(`${slug} create + inbox`, async () => {
    const fetch = mockFetch([
      ["/domains", { "hydra:member": [{ id: "d", domain: "example.org", isActive: true, isPrivate: false }] }],
      ["/accounts", (u, init) => new Response(JSON.stringify({ id: "acc1", address: JSON.parse(init.body).address, createdAt: "t" }), { status: 201 })],
      ["/token", { id: "acc1", token: "TKN" }],
      ["/messages", { "hydra:member": [{ id: "m1", from: { address: "a@b.c" }, subject: "Hi", intro: "Hello" }] }],
    ]);
    const c = await run(defs, `temp-mail:${slug}`, "create", {}, fetch);
    assert.equal(fetch.calls[0].url, `${base}/domains`);
    assert.match(c.address, /^[a-z0-9]{12}@example\.org$/);
    assert.equal(c.token, "TKN");
    assert.equal(c.password.length, 16);
    assert.deepEqual(JSON.parse(fetch.calls[2].init.body), { address: c.address, password: c.password });
    const i = await run(defs, `temp-mail:${slug}`, "inbox", { address: c.address, token: "TKN" }, fetch);
    assert.equal(fetch.calls[3].url, `${base}/messages?page=1`);
    assert.equal(fetch.calls[3].init.headers.authorization, "Bearer TKN");
    assert.equal(i.messages[0].subject, "Hi");
    await assert.rejects(run(defs, `temp-mail:${slug}`, "inbox", { address: c.address }, fetch), /token/);
  });
}
