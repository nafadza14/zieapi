// Second batch of keyless public APIs (iteration 8). Same pattern as public-apis.js: one documented
// public URL per endpoint, provider JSON returned as `data`. Sources: docs/API-SOURCES.md.

import { url, postJson, f } from "../kit.js";
import { api, get, lim, date, enc } from "./public-apis.js";

/** One POST endpoint that sends a JSON body built from the params. */
const post = (slug, displayName, description, fields, target, body, opts = {}) => ({
  slug,
  displayName,
  description,
  method: "POST",
  cacheTtl: opts.ttl ?? 300,
  pathTemplate: null,
  bulkEnabled: true,
  fields,
  handler: async (p, ctx) => postJson(ctx, target(p), body(p)),
});

/* ────────────────────────────── crypto exchanges and markets ────────────────────────────── */

const bitfinex = api("finance", "bitfinex", "Bitfinex", "Public tickers and candles from Bitfinex.", "https://docs.bitfinex.com/docs/rest-public", ["crypto", "exchange"], [
  get("ticker", "Ticker", "Bid, ask, last price and daily change.", [f.req("symbol", { example: "tBTCUSD" })], (p) => `https://api-pub.bitfinex.com/v2/ticker/${enc(p.symbol)}`, { ttl: 15 }),
  get("candles", "Candles", "Recent candles.", [f.req("symbol", { example: "tETHUSD" }), f.enm("timeframe", ["1m", "5m", "15m", "30m", "1h", "3h", "6h", "12h", "1D", "1W"], { default: "1h" }), lim(100, 10000)],
    (p) => url(`https://api-pub.bitfinex.com/v2/candles/trade:${p.timeframe}:${enc(p.symbol)}/hist`, { limit: p.limit }), { ttl: 60 }),
]);
const gemini = api("finance", "gemini-exchange", "Gemini", "Public ticker data from the Gemini exchange.", "https://docs.gemini.com/rest-api/", ["crypto", "exchange"], [
  get("ticker", "Ticker", "Bid, ask, last and volume.", [f.req("symbol", { example: "btcusd" })], (p) => `https://api.gemini.com/v1/pubticker/${enc(p.symbol.toLowerCase())}`, { ttl: 15 }),
  get("symbols", "Symbols", "Tradable symbols.", [], () => "https://api.gemini.com/v1/symbols", { ttl: 86400 }),
]);
const htx = api("finance", "htx", "HTX (Huobi)", "Public market data from HTX.", "https://www.htx.com/en-us/opend/newApiPages/", ["crypto", "exchange"], [
  get("ticker", "Ticker", "24h merged ticker.", [f.req("symbol", { example: "btcusdt" })], (p) => url("https://api.huobi.pro/market/detail/merged", { symbol: p.symbol.toLowerCase() }), { ttl: 15 }),
]);
const mexc = api("finance", "mexc", "MEXC", "Spot prices and 24h stats from MEXC.", "https://mexcdevelop.github.io/apidocs/spot_v3_en/", ["crypto", "exchange", "altcoins"], [
  get("price", "Price", "Latest price for a symbol.", [f.req("symbol", { example: "BTCUSDT" })], (p) => url("https://api.mexc.com/api/v3/ticker/price", { symbol: p.symbol.toUpperCase() }), { ttl: 15 }),
  get("24h", "24h stats", "24 hour rolling statistics.", [f.req("symbol", { example: "ETHUSDT" })], (p) => url("https://api.mexc.com/api/v3/ticker/24hr", { symbol: p.symbol.toUpperCase() }), { ttl: 30 }),
]);
const bitget = api("finance", "bitget", "Bitget", "Spot tickers from Bitget.", "https://www.bitget.com/api-doc/spot/intro", ["crypto", "exchange"], [
  get("ticker", "Ticker", "Ticker for one symbol.", [f.req("symbol", { example: "BTCUSDT" })], (p) => url("https://api.bitget.com/api/v2/spot/market/tickers", { symbol: p.symbol.toUpperCase() }), { ttl: 15 }),
]);
const cryptoCom = api("finance", "crypto-com-exchange", "Crypto.com Exchange", "Public tickers from the Crypto.com Exchange.", "https://exchange-docs.crypto.com/exchange/v1/rest-ws/index.html", ["crypto", "exchange"], [
  get("tickers", "Tickers", "One or all instruments.", [f.str("instrument", { example: "BTC_USDT" })], (p) => url("https://api.crypto.com/exchange/v1/public/get-tickers", { instrument_name: p.instrument }), { ttl: 15 }),
]);
const upbit = api("finance", "upbit", "Upbit", "Korean won and BTC markets from Upbit.", "https://global-docs.upbit.com", ["crypto", "exchange", "korea"], [
  get("ticker", "Ticker", "Tickers for markets.", [f.req("markets", { example: "KRW-BTC,KRW-ETH" })], (p) => url("https://api.upbit.com/v1/ticker", { markets: p.markets }), { ttl: 15 }),
  get("markets", "Markets", "Every market code.", [], () => "https://api.upbit.com/v1/market/all", { ttl: 86400 }),
]);
const deribit = api("finance", "deribit", "Deribit", "Crypto options and futures index prices and instruments.", "https://docs.deribit.com", ["crypto", "options", "derivatives"], [
  get("index", "Index price", "Current index price.", [f.enm("index", ["btc_usd", "eth_usd", "sol_usd"], { default: "btc_usd" })], (p) => url("https://www.deribit.com/api/v2/public/get_index_price", { index_name: p.index }), { ttl: 10 }),
  get("instruments", "Instruments", "Active instruments for a currency.", [f.enm("currency", ["BTC", "ETH", "SOL", "USDC"], { default: "BTC" }), f.enm("kind", ["future", "option", "spot"], { default: "future" })],
    (p) => url("https://www.deribit.com/api/v2/public/get_instruments", { currency: p.currency, kind: p.kind, expired: "false" }), { ttl: 3600 }),
]);
const coinlore = api("finance", "coinlore", "CoinLore", "Prices and market data for 12,000+ crypto assets.", "https://www.coinlore.com/cryptocurrency-data-api", ["crypto", "prices", "market-cap"], [
  get("tickers", "Tickers", "Coins ranked by market cap.", [f.int("start", { default: 0, min: 0 }), lim(100, 100)], (p) => url("https://api.coinlore.net/api/tickers/", { start: p.start, limit: p.limit }), { ttl: 120 }),
  get("global", "Global", "Total market statistics.", [], () => "https://api.coinlore.net/api/global/", { ttl: 300 }),
]);
const blockchair = api("finance", "blockchair", "Blockchair", "Blockchain statistics for Bitcoin, Ethereum, Litecoin, Dogecoin and more.", "https://blockchair.com/api/docs", ["blockchain", "bitcoin", "ethereum", "explorer"], [
  get("stats", "Chain stats", "Blocks, transactions, fees and mempool.", [f.enm("chain", ["bitcoin", "ethereum", "litecoin", "dogecoin", "bitcoin-cash", "dash", "zcash"], { default: "bitcoin" })], (p) => `https://api.blockchair.com/${p.chain}/stats`, { ttl: 300 }),
]);
const currencyApi = api("finance", "currency-api", "Currency API (fawazahmed0)", "Daily exchange rates for 200+ fiat currencies, crypto and metals, free with no limits.", "https://github.com/fawazahmed0/exchange-api", ["currency", "exchange-rates", "crypto", "gold"], [
  get("rates", "Rates", "Rates from one currency to all others.", [f.str("base", { default: "usd" }), f.str("date", { default: "latest", description: "latest or YYYY-MM-DD" })],
    (p) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${enc(p.date ?? "latest")}/v1/currencies/${enc(String(p.base ?? "usd").toLowerCase())}.json`, { ttl: 3600 }),
  get("currencies", "Currencies", "Every currency code and name.", [], () => "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies.json", { ttl: 86400 }),
]);
const stooq = api("finance", "stooq", "Stooq", "Delayed quotes for stocks, indices, ETFs, currencies and commodities worldwide.", "https://stooq.com", ["stocks", "quotes", "indices", "etf"], [
  get("quote", "Quote", "Latest OHLC and volume. Symbols like aapl.us, ^spx, eurusd, gc.f.", [f.req("symbol", { example: "aapl.us" })], (p) => url("https://stooq.com/q/l/", { s: p.symbol.toLowerCase(), f: "sd2t2ohlcvn", h: "", e: "json" }), { ttl: 300 }),
]);
const bankOfCanada = api("finance", "bank-of-canada", "Bank of Canada Valet", "Exchange rates, interest rates and economic series from the Bank of Canada.", "https://www.bankofcanada.ca/valet/docs", ["central-bank", "canada", "exchange-rates", "interest-rates"], [
  get("observations", "Observations", "Recent values of a series, e.g. FXUSDCAD or V39079 (policy rate).", [f.req("series", { example: "FXUSDCAD" }), f.int("recent", { default: 10, min: 1, max: 1000 })],
    (p) => url(`https://www.bankofcanada.ca/valet/observations/${enc(p.series)}/json`, { recent: p.recent }), { ttl: 3600 }),
]);
const bcb = api("finance", "banco-central-brasil", "Banco Central do Brasil (SGS)", "Brazilian central bank time series: Selic, IPCA inflation, exchange rates and more.", "https://dadosabertos.bcb.gov.br", ["central-bank", "brazil", "interest-rates", "inflation"], [
  get("series", "Series", "Last N values of an SGS series (432 = Selic target, 433 = IPCA, 1 = USD/BRL).", [f.req("code", { type: "integer", example: 432 }), f.int("last", { default: 10, min: 1, max: 20 })],
    (p) => url(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${p.code}/dados/ultimos/${p.last ?? 10}`, { formato: "json" }), { ttl: 3600 }),
]);

/* ────────────────────────────── developer tooling and status ────────────────────────────── */

const depsDev = api("dev-tools", "deps-dev", "deps.dev (Open Source Insights)", "Google's dependency, license, security advisory and OpenSSF Scorecard data for npm, PyPI, Go, Maven, Cargo and NuGet.", "https://docs.deps.dev/api/v3/", ["dependencies", "supply-chain", "licenses", "security"], [
  get("package", "Package", "Versions of a package.", [f.enm("system", ["npm", "pypi", "go", "maven", "cargo", "nuget"], { required: true, example: "npm" }), f.req("name", { example: "react" })],
    (p) => `https://api.deps.dev/v3/systems/${p.system}/packages/${enc(p.name)}`, { ttl: 3600 }),
  get("version", "Version", "Licenses, advisories and links for one version.", [f.enm("system", ["npm", "pypi", "go", "maven", "cargo", "nuget"], { required: true, example: "npm" }), f.req("name", { example: "lodash" }), f.req("version", { example: "4.17.21" })],
    (p) => `https://api.deps.dev/v3/systems/${p.system}/packages/${enc(p.name)}/versions/${enc(p.version)}`, { ttl: 86400 }),
  get("project", "Project", "Stars, forks and OpenSSF Scorecard for a source repo.", [f.req("project", { example: "github.com/facebook/react" })], (p) => `https://api.deps.dev/v3/projects/${enc(p.project)}`, { ttl: 86400 }),
]);
const osv = api("security", "osv", "OSV (Open Source Vulnerabilities)", "Google's distributed vulnerability database for open-source packages.", "https://google.github.io/osv.dev/api/", ["vulnerabilities", "cve", "open-source", "supply-chain"], [
  post("query", "Query package", "Known vulnerabilities affecting a package version.", [f.enm("ecosystem", ["npm", "PyPI", "Go", "Maven", "crates.io", "NuGet", "RubyGems", "Packagist", "Debian", "Alpine"], { required: true, example: "npm" }), f.req("name", { example: "lodash" }), f.str("version", { example: "4.17.15" })],
    () => "https://api.osv.dev/v1/query", (p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, ...(p.version ? { version: p.version } : {}) }), { ttl: 3600 }),
  get("vuln", "Vulnerability", "One advisory by OSV, GHSA or CVE id.", [f.req("id", { example: "GHSA-p6mc-m468-83gw" })], (p) => `https://api.osv.dev/v1/vulns/${enc(p.id)}`, { ttl: 86400 }),
]);
const bundlephobia = api("dev-tools", "bundlephobia", "Bundlephobia", "Minified and gzipped size of any npm package.", "https://bundlephobia.com", ["npm", "bundle-size", "javascript"], [
  get("size", "Size", "Size and dependency count.", [f.req("package", { example: "react@18.3.1" })], (p) => url("https://bundlephobia.com/api/size", { package: p.package }), { ttl: 86400 }),
]);
const npms = api("dev-tools", "npms", "npms.io", "npm package search ranked by quality, popularity and maintenance.", "https://api-docs.npms.io", ["npm", "javascript", "search"], [
  get("search", "Search", "Ranked search.", [f.req("query", { example: "date picker" }), lim(10, 250, "size")], (p) => url("https://api.npms.io/v2/search", { q: p.query, size: p.size }), { ttl: 3600 }),
]);
const jsdelivrStats = api("dev-tools", "jsdelivr", "jsDelivr", "CDN download statistics and file listings for npm and GitHub packages.", "https://www.jsdelivr.com/docs/data.jsdelivr.com", ["cdn", "npm", "downloads"], [
  get("stats", "Package stats", "Hits and bandwidth for an npm package.", [f.req("package", { example: "jquery" }), f.enm("period", ["day", "week", "month", "quarter", "year"], { default: "month" })],
    (p) => url(`https://data.jsdelivr.com/v1/stats/packages/npm/${p.package.split("/").map(enc).join("/")}`, { period: p.period }), { ttl: 21600 }),
  get("top", "Top packages", "Most requested npm packages.", [f.enm("period", ["day", "week", "month", "quarter", "year"], { default: "month" }), lim(10, 100)],
    (p) => url("https://data.jsdelivr.com/v1/stats/packages", { period: p.period, type: "npm", limit: p.limit }), { ttl: 21600 }),
]);
const homebrew = api("dev-tools", "homebrew", "Homebrew", "macOS and Linux package formulae and casks with versions and install counts.", "https://formulae.brew.sh/docs/api/", ["homebrew", "macos", "packages"], [
  get("formula", "Formula", "One formula.", [f.req("name", { example: "wget" })], (p) => `https://formulae.brew.sh/api/formula/${enc(p.name)}.json`, { ttl: 21600 }),
  get("cask", "Cask", "One cask (GUI app).", [f.req("name", { example: "visual-studio-code" })], (p) => `https://formulae.brew.sh/api/cask/${enc(p.name)}.json`, { ttl: 21600 }),
]);
const archLinux = api("dev-tools", "arch-linux", "Arch Linux Packages", "Official Arch Linux package search.", "https://wiki.archlinux.org/title/Official_repositories_web_interface", ["linux", "packages"], [
  get("search", "Search", "Packages by name or description.", [f.req("query", { example: "python" })], (p) => url("https://archlinux.org/packages/search/json/", { q: p.query }), { ttl: 21600 }),
]);
const STATUS = {
  github: "www.githubstatus.com", openai: "status.openai.com", anthropic: "status.anthropic.com", cloudflare: "www.cloudflarestatus.com", discord: "discordstatus.com",
  vercel: "www.vercel-status.com", netlify: "www.netlifystatus.com", atlassian: "status.atlassian.com", dropbox: "status.dropbox.com", reddit: "www.redditstatus.com",
  twilio: "status.twilio.com", digitalocean: "status.digitalocean.com", npm: "status.npmjs.org", zoom: "status.zoom.us", linear: "linearstatus.com", datadog: "status.datadoghq.com",
};
const statuspage = api("dev-tools", "service-status", "Service Status", "Live status, incidents and component health of popular developer services (Statuspage).", "https://www.atlassian.com/software/statuspage", ["status", "uptime", "incidents", "monitoring"], [
  get("summary", "Summary", "Overall status, components and active incidents.", [f.enm("service", Object.keys(STATUS), { required: true, example: "github" })], (p) => `https://${STATUS[p.service]}/api/v2/summary.json`, { ttl: 60 }),
  get("incidents", "Recent incidents", "The last 50 incidents.", [f.enm("service", Object.keys(STATUS), { required: true, example: "openai" })], (p) => `https://${STATUS[p.service]}/api/v2/incidents.json`, { ttl: 300 }),
]);
const ipwho = api("dev-tools", "ipwho", "ipwho.is", "IP geolocation: country, city, timezone, ISP and ASN (free, no key).", "https://ipwho.is", ["ip", "geolocation", "asn"], [
  get("lookup", "Lookup", "Details for an IPv4 or IPv6 address.", [f.req("ip", { example: "1.1.1.1" })], (p) => `https://ipwho.is/${enc(p.ip)}`, { ttl: 86400 }),
]);
const colorApi = api("web-tools", "color-api", "The Color API", "Names, conversions and schemes for any color.", "https://www.thecolorapi.com", ["colors", "design", "palette"], [
  get("id", "Identify", "Name and conversions for a hex color.", [f.req("hex", { example: "0047AB", pattern: "^#?[0-9A-Fa-f]{6}$" })], (p) => url("https://www.thecolorapi.com/id", { hex: p.hex.replace("#", "") }), { ttl: 604800 }),
  get("scheme", "Scheme", "A color scheme from a seed color.", [f.req("hex", { example: "24B1E0", pattern: "^#?[0-9A-Fa-f]{6}$" }), f.enm("mode", ["monochrome", "monochrome-dark", "monochrome-light", "analogic", "complement", "analogic-complement", "triad", "quad"], { default: "analogic" }), f.int("count", { default: 5, min: 2, max: 12 })],
    (p) => url("https://www.thecolorapi.com/scheme", { hex: p.hex.replace("#", ""), mode: p.mode, count: p.count }), { ttl: 604800 }),
]);
const mathjs = api("web-tools", "mathjs", "math.js", "Evaluate math expressions, unit conversions and matrices.", "https://api.mathjs.org", ["math", "calculator", "units"], [
  get("evaluate", "Evaluate", "Result of an expression, e.g. 2 inch to cm or sqrt(16).", [f.req("expr", { example: "12.7 cm to inch" }), f.int("precision", { default: 14, min: 1, max: 64 })],
    (p) => url("https://api.mathjs.org/v4/", { expr: p.expr, precision: p.precision }), { ttl: 86400, text: true, map: (t, p) => ({ expression: p.expr, result: String(t).trim() }) }),
]);
const timeapi = api("web-tools", "timeapi", "TimeAPI.io", "Current time in any timezone, timezone list and conversions.", "https://timeapi.io/swagger/index.html", ["time", "timezone", "clock"], [
  get("now", "Current time", "Time in an IANA timezone.", [f.req("timeZone", { example: "Asia/Tokyo" })], (p) => url("https://timeapi.io/api/time/current/zone", { timeZone: p.timeZone }), { ttl: 30 }),
  get("zones", "Timezones", "Every IANA timezone.", [], () => "https://timeapi.io/api/timezone/availabletimezones", { ttl: 604800 }),
]);
const translate = api("ai", "mymemory-translate", "MyMemory Translate", "Machine translation and translation memory for 200+ language pairs (5,000 free characters a day).", "https://mymemory.translated.net/doc/spec.php", ["translation", "languages", "nlp"], [
  get("translate", "Translate", "Translate a short text.", [f.req("text", { example: "Good morning, how are you?" }), f.req("langpair", { example: "en|es", description: "source|target ISO codes" })],
    (p) => url("https://api.mymemory.translated.net/get", { q: p.text, langpair: p.langpair }), { ttl: 86400 }),
]);

/* ────────────────────────────── test and sample data ────────────────────────────── */

const randomUser = api("dev-tools", "random-user", "Random User", "Realistic fake user profiles with photos for testing and mockups.", "https://randomuser.me/documentation", ["fake-data", "testing", "mock"], [
  get("users", "Users", "Generate users.", [lim(5, 5000, "results"), f.str("nationalities", { example: "us,gb,fr" }), f.enm("gender", ["male", "female"]), f.str("seed")],
    (p) => url("https://randomuser.me/api/", { results: p.results, nat: p.nationalities, gender: p.gender, seed: p.seed }), { ttl: 0 }),
]);
const dummyJson = api("dev-tools", "dummyjson", "DummyJSON", "Fake products, carts, users, posts, recipes and quotes for prototypes and tests.", "https://dummyjson.com/docs", ["fake-data", "testing", "mock", "ecommerce"], [
  get("resource", "List", "Items of one resource.", [f.enm("resource", ["products", "carts", "users", "posts", "comments", "todos", "quotes", "recipes"], { required: true, example: "products" }), lim(30, 194), f.int("skip", { default: 0, min: 0 })],
    (p) => url(`https://dummyjson.com/${p.resource}`, { limit: p.limit, skip: p.skip }), { ttl: 3600 }),
  get("search", "Search products", "Product search.", [f.req("query", { example: "phone" })], (p) => url("https://dummyjson.com/products/search", { q: p.query }), { ttl: 3600 }),
]);
const fakeStore = api("ecommerce", "fake-store", "Fake Store API", "A small fake e-commerce catalog: products, categories, carts and users.", "https://fakestoreapi.com/docs", ["fake-data", "ecommerce", "testing"], [
  get("products", "Products", "Every product, optionally by category.", [f.enm("category", ["electronics", "jewelery", "men's clothing", "women's clothing"]), lim(20, 20)],
    (p) => (p.category ? url(`https://fakestoreapi.com/products/category/${enc(p.category)}`, { limit: p.limit }) : url("https://fakestoreapi.com/products", { limit: p.limit })), { ttl: 3600 }),
  get("product", "Product", "One product.", [f.req("id", { type: "integer", example: 1 })], (p) => `https://fakestoreapi.com/products/${p.id}`, { ttl: 3600 }),
]);
const jsonPlaceholder = api("dev-tools", "jsonplaceholder", "JSONPlaceholder", "Free fake REST API for testing: posts, comments, albums, photos, todos and users.", "https://jsonplaceholder.typicode.com", ["fake-data", "testing", "rest"], [
  get("resource", "List", "Items of one resource.", [f.enm("resource", ["posts", "comments", "albums", "photos", "todos", "users"], { required: true, example: "posts" }), f.int("userId")],
    (p) => url(`https://jsonplaceholder.typicode.com/${p.resource}`, { userId: p.userId }), { ttl: 86400 }),
]);

/* ────────────────────────────── games and fandom ────────────────────────────── */

const scryfall = api("games", "scryfall", "Scryfall", "Magic: The Gathering cards, prices, sets and images.", "https://scryfall.com/docs/api", ["mtg", "cards", "tcg"], [
  get("search", "Search cards", "Scryfall search syntax.", [f.req("query", { example: "c:red t:dragon" }), f.int("page", { default: 1, min: 1 })], (p) => url("https://api.scryfall.com/cards/search", { q: p.query, page: p.page }), { ttl: 3600 }),
  get("named", "Card by name", "Fuzzy name match.", [f.req("name", { example: "lightning bolt" })], (p) => url("https://api.scryfall.com/cards/named", { fuzzy: p.name }), { ttl: 86400 }),
  get("random", "Random card", "One random card.", [], () => "https://api.scryfall.com/cards/random", { ttl: 0 }),
  get("sets", "Sets", "Every set.", [], () => "https://api.scryfall.com/sets", { ttl: 86400 }),
]);
const ygopro = api("games", "yugioh", "Yu-Gi-Oh! (YGOPRODeck)", "Yu-Gi-Oh! card database with prices and images.", "https://ygoprodeck.com/api-guide/", ["yugioh", "cards", "tcg"], [
  get("cards", "Cards", "Search by fuzzy name, type or archetype.", [f.str("name", { example: "dark magician" }), f.str("archetype"), f.str("type"), lim(20, 100, "num"), f.int("offset", { default: 0, min: 0 })],
    (p) => url("https://db.ygoprodeck.com/api/v7/cardinfo.php", { fname: p.name, archetype: p.archetype, type: p.type, num: p.num, offset: p.offset }), { ttl: 86400 }),
]);
const pokemonTcg = api("games", "pokemon-tcg", "Pokémon TCG", "Pokémon Trading Card Game cards, sets and market prices.", "https://docs.pokemontcg.io", ["pokemon", "cards", "tcg"], [
  get("cards", "Search cards", "Lucene-style query.", [f.req("query", { example: "name:charizard" }), lim(20, 250, "pageSize")], (p) => url("https://api.pokemontcg.io/v2/cards", { q: p.query, pageSize: p.pageSize }), { ttl: 3600 }),
  get("sets", "Sets", "Every set.", [], () => "https://api.pokemontcg.io/v2/sets", { ttl: 86400 }),
]);
const openDota = api("games", "opendota", "OpenDota", "Dota 2 heroes, pro matches and player statistics.", "https://docs.opendota.com", ["dota", "esports", "games"], [
  get("heroes", "Heroes", "Hero list with roles.", [], () => "https://api.opendota.com/api/heroes", { ttl: 86400 }),
  get("hero-stats", "Hero stats", "Pick and win rates by rank.", [], () => "https://api.opendota.com/api/heroStats", { ttl: 3600 }),
  get("player", "Player", "Profile and rank for an account id.", [f.req("accountId", { example: "87278757" })], (p) => `https://api.opendota.com/api/players/${enc(p.accountId)}`, { ttl: 3600 }),
  get("pro-matches", "Pro matches", "Recent professional matches.", [], () => "https://api.opendota.com/api/proMatches", { ttl: 600 }),
]);
const ddragon = api("games", "league-data-dragon", "League of Legends Data Dragon", "Champions, items and versions from Riot's static Data Dragon CDN.", "https://developer.riotgames.com/docs/lol#data-dragon", ["league-of-legends", "lol", "riot", "games"], [
  get("versions", "Versions", "Game patch versions, newest first.", [], () => "https://ddragon.leagueoflegends.com/api/versions.json", { ttl: 21600 }),
  get("champions", "Champions", "Every champion for a patch.", [f.req("version", { example: "14.1.1" }), f.str("locale", { default: "en_US" })], (p) => `https://ddragon.leagueoflegends.com/cdn/${enc(p.version)}/data/${enc(p.locale)}/champion.json`, { ttl: 86400 }),
]);
const valorant = api("games", "valorant-api", "Valorant API", "Valorant agents, weapons, maps and skins (community API).", "https://valorant-api.com", ["valorant", "riot", "games"], [
  get("agents", "Agents", "Playable agents.", [f.str("language", { default: "en-US" })], (p) => url("https://valorant-api.com/v1/agents", { isPlayableCharacter: "true", language: p.language }), { ttl: 86400 }),
  get("weapons", "Weapons", "Weapons and stats.", [], () => "https://valorant-api.com/v1/weapons", { ttl: 86400 }),
  get("maps", "Maps", "Maps.", [], () => "https://valorant-api.com/v1/maps", { ttl: 86400 }),
]);
const mojang = api("games", "minecraft", "Minecraft (Mojang + mcsrvstat)", "Minecraft player UUIDs and Java/Bedrock server status.", "https://api.mcsrvstat.us", ["minecraft", "games", "servers"], [
  get("player", "Player UUID", "UUID for a Java Edition username.", [f.req("username", { example: "Notch" })], (p) => `https://api.mojang.com/users/profiles/minecraft/${enc(p.username)}`, { ttl: 86400 }),
  get("server", "Server status", "Online players, version and MOTD.", [f.req("address", { example: "mc.hypixel.net" }), f.enm("edition", ["java", "bedrock"], { default: "java" })],
    (p) => `https://api.mcsrvstat.us/${p.edition === "bedrock" ? "bedrock/3" : "3"}/${enc(p.address)}`, { ttl: 300 }),
]);
const gw2 = api("games", "guild-wars-2", "Guild Wars 2", "Official Guild Wars 2 API: items, trading post prices and world data.", "https://wiki.guildwars2.com/wiki/API:Main", ["gw2", "mmo", "games"], [
  get("prices", "Trading post prices", "Buy and sell prices for item ids.", [f.req("ids", { example: "19684,19709" })], (p) => url("https://api.guildwars2.com/v2/commerce/prices", { ids: p.ids }), { ttl: 300 }),
  get("items", "Items", "Item details.", [f.req("ids", { example: "12452,28445" })], (p) => url("https://api.guildwars2.com/v2/items", { ids: p.ids }), { ttl: 86400 }),
]);
const speedrun = api("games", "speedrun-com", "Speedrun.com", "Games, categories and world records from speedrun.com.", "https://github.com/speedruncomorg/api", ["speedrun", "games", "records"], [
  get("games", "Search games", "Games by name.", [f.req("name", { example: "super mario 64" })], (p) => url("https://www.speedrun.com/api/v1/games", { name: p.name }), { ttl: 86400 }),
  get("records", "Records", "Top runs for each category of a game.", [f.req("gameId", { example: "o1y9wo6q" }), f.int("top", { default: 1, min: 1, max: 10 })], (p) => url(`https://www.speedrun.com/api/v1/games/${enc(p.gameId)}/records`, { top: p.top }), { ttl: 3600 }),
]);
const rickMorty = api("entertainment", "rick-and-morty", "Rick and Morty API", "Characters, locations and episodes of Rick and Morty.", "https://rickandmortyapi.com/documentation", ["tv", "characters", "fandom"], [
  get("characters", "Characters", "Filter characters.", [f.str("name", { example: "rick" }), f.enm("status", ["alive", "dead", "unknown"]), f.int("page", { default: 1, min: 1 })], (p) => url("https://rickandmortyapi.com/api/character", { name: p.name, status: p.status, page: p.page }), { ttl: 86400 }),
  get("episodes", "Episodes", "Filter episodes.", [f.str("name"), f.int("page", { default: 1, min: 1 })], (p) => url("https://rickandmortyapi.com/api/episode", { name: p.name, page: p.page }), { ttl: 86400 }),
]);
const swapi = api("entertainment", "star-wars", "SWAPI (Star Wars)", "People, films, planets, starships and species from Star Wars.", "https://swapi.dev", ["star-wars", "movies", "fandom"], [
  get("search", "Search", "Search one resource.", [f.enm("resource", ["people", "films", "planets", "starships", "species", "vehicles"], { required: true, example: "people" }), f.str("query", { example: "skywalker" })],
    (p) => url(`https://swapi.dev/api/${p.resource}/`, { search: p.query }), { ttl: 86400 }),
]);
const ghibli = api("movie", "studio-ghibli", "Studio Ghibli", "Films, people and locations from Studio Ghibli.", "https://ghibliapi.vercel.app", ["anime", "movies", "ghibli"], [
  get("films", "Films", "Every film with director, release year and score.", [], () => "https://ghibliapi.vercel.app/films", { ttl: 604800 }),
]);
const kitsu = api("movie", "kitsu", "Kitsu", "Anime and manga database with ratings and episode data.", "https://kitsu.docs.apiary.io", ["anime", "manga"], [
  get("anime", "Search anime", "Search by title.", [f.req("query", { example: "cowboy bebop" }), lim(10, 20)], (p) => url("https://kitsu.io/api/edge/anime", { "filter[text]": p.query, "page[limit]": p.limit }), { ttl: 86400 }),
  get("manga", "Search manga", "Search by title.", [f.req("query", { example: "berserk" }), lim(10, 20)], (p) => url("https://kitsu.io/api/edge/manga", { "filter[text]": p.query, "page[limit]": p.limit }), { ttl: 86400 }),
  get("trending", "Trending anime", "Trending this week.", [], () => "https://kitsu.io/api/edge/trending/anime", { ttl: 3600 }),
]);
const disney = api("entertainment", "disney-characters", "Disney API", "Disney characters with their films, shows and appearances.", "https://disneyapi.dev/docs", ["disney", "characters"], [
  get("characters", "Characters", "Search characters by name.", [f.str("name", { example: "Mickey Mouse" }), f.int("page", { default: 1, min: 1 })], (p) => url("https://api.disneyapi.dev/character", { name: p.name, page: p.page }), { ttl: 86400 }),
]);
const coverArt = api("music", "cover-art-archive", "Cover Art Archive", "Album artwork for MusicBrainz releases.", "https://musicbrainz.org/doc/Cover_Art_Archive/API", ["albums", "artwork", "music"], [
  get("release", "Release art", "Front, back and other images for a release MBID.", [f.req("mbid", { example: "76df3287-6cda-33eb-8e9a-044b5e15ffdd" })], (p) => `https://coverartarchive.org/release/${enc(p.mbid)}`, { ttl: 604800 }),
]);

/* ────────────────────────────── travel, transit, places ────────────────────────────── */

const swissTransport = api("transport", "swiss-transport", "Swiss Public Transport", "Timetables and connections for trains, buses and boats in Switzerland.", "https://transport.opendata.ch", ["trains", "switzerland", "timetable", "public-transport"], [
  get("connections", "Connections", "Next connections between two places.", [f.req("from", { example: "Zürich HB" }), f.req("to", { example: "Bern" }), lim(4, 16)], (p) => url("https://transport.opendata.ch/v1/connections", { from: p.from, to: p.to, limit: p.limit }), { ttl: 60 }),
  get("stationboard", "Departures", "Departures from a station.", [f.req("station", { example: "Luzern" }), lim(10, 40)], (p) => url("https://transport.opendata.ch/v1/stationboard", { station: p.station, limit: p.limit }), { ttl: 60 }),
  get("locations", "Locations", "Stations and stops by name.", [f.req("query", { example: "Basel" })], (p) => url("https://transport.opendata.ch/v1/locations", { query: p.query }), { ttl: 86400 }),
]);
const irail = api("transport", "irail", "iRail (Belgian railways)", "Belgian train connections, liveboards and stations.", "https://docs.irail.be", ["trains", "belgium", "timetable"], [
  get("connections", "Connections", "Routes between two stations.", [f.req("from", { example: "Brussels-Central" }), f.req("to", { example: "Ghent-Sint-Pieters" })], (p) => url("https://api.irail.be/connections/", { from: p.from, to: p.to, format: "json", lang: "en" }), { ttl: 60 }),
  get("liveboard", "Liveboard", "Departures at a station.", [f.req("station", { example: "Antwerp-Central" })], (p) => url("https://api.irail.be/liveboard/", { station: p.station, format: "json", lang: "en" }), { ttl: 60 }),
]);
const metNorway = api("places", "met-norway", "MET Norway (yr.no)", "Global weather forecasts from the Norwegian Meteorological Institute.", "https://api.met.no/weatherapi/locationforecast/2.0/documentation", ["weather", "forecast", "norway"], [
  get("forecast", "Forecast", "Compact location forecast.", [f.req("lat", { type: "number", example: 59.91 }), f.req("lon", { type: "number", example: 10.75 })], (p) => url("https://api.met.no/weatherapi/locationforecast/2.0/compact", { lat: Number(p.lat).toFixed(4), lon: Number(p.lon).toFixed(4) }), { ttl: 1800 }),
]);
const seventimer = api("places", "7timer", "7Timer!", "Astronomy and civil weather forecasts (seeing, transparency, cloud cover) for any coordinate.", "http://www.7timer.info/doc.php", ["weather", "astronomy", "forecast"], [
  get("forecast", "Forecast", "Forecast product for a coordinate.", [f.req("lat", { type: "number", example: 23.09 }), f.req("lon", { type: "number", example: 113.17 }), f.enm("product", ["civil", "civillight", "astro", "two"], { default: "civillight" })],
    (p) => url("https://www.7timer.info/bin/api.pl", { lat: p.lat, lon: p.lon, product: p.product, output: "json" }), { ttl: 3600 }),
]);
const eonet = api("open-data", "nasa-eonet", "NASA EONET", "Natural events tracked by NASA: wildfires, storms, volcanoes, floods and sea ice.", "https://eonet.gsfc.nasa.gov/docs/v3", ["nasa", "wildfires", "disasters", "earth"], [
  get("events", "Events", "Open or recent natural events.", [f.enm("status", ["open", "closed", "all"], { default: "open" }), f.str("category", { example: "wildfires" }), f.int("days", { default: 30, min: 1, max: 3650 }), lim(50, 1000)],
    (p) => url("https://eonet.gsfc.nasa.gov/api/v3/events", { status: p.status, category: p.category, days: p.days, limit: p.limit }), { ttl: 1800 }),
  get("categories", "Categories", "Event categories.", [], () => "https://eonet.gsfc.nasa.gov/api/v3/categories", { ttl: 86400 }),
]);
const reliefweb = api("news", "reliefweb", "ReliefWeb", "Humanitarian reports, disasters and jobs from the UN Office for the Coordination of Humanitarian Affairs.", "https://apidoc.reliefweb.int", ["humanitarian", "disasters", "un", "news"], [
  get("reports", "Reports", "Search humanitarian reports.", [f.str("query", { example: "flood" }), lim(10, 1000)], (p) => url("https://api.reliefweb.int/v1/reports", { appname: "apizie", "query[value]": p.query, limit: p.limit, "sort[]": "date:desc" }), { ttl: 1800 }),
  get("disasters", "Disasters", "Current and past disasters.", [f.str("query", { example: "earthquake" }), lim(10, 1000)], (p) => url("https://api.reliefweb.int/v1/disasters", { appname: "apizie", "query[value]": p.query, limit: p.limit, "sort[]": "date:desc" }), { ttl: 1800 }),
]);
const spaceflightNews = api("news", "spaceflight-news", "Spaceflight News", "Space industry news from 40+ outlets.", "https://api.spaceflightnewsapi.net/v4/docs/", ["space", "news", "nasa", "spacex"], [
  get("articles", "Articles", "Latest articles, optionally searched.", [f.str("search", { example: "starship" }), lim(10, 100)], (p) => url("https://api.spaceflightnewsapi.net/v4/articles/", { search: p.search, limit: p.limit }), { ttl: 900 }),
]);
const celestrak = api("open-data", "celestrak", "CelesTrak", "Orbital elements for satellites by NORAD id or group.", "https://celestrak.org/NORAD/documentation/gp-data-formats.php", ["satellites", "orbits", "space", "tle"], [
  get("satellite", "Satellite", "General perturbations data for one NORAD catalog number.", [f.req("noradId", { example: "25544" })], (p) => url("https://celestrak.org/NORAD/elements/gp.php", { CATNR: p.noradId, FORMAT: "json" }), { ttl: 21600 }),
  get("group", "Group", "Satellites in a group, e.g. stations, starlink, gps-ops.", [f.req("group", { example: "stations" })], (p) => url("https://celestrak.org/NORAD/elements/gp.php", { GROUP: p.group, FORMAT: "json" }), { ttl: 21600 }),
]);

/* ────────────────────────────── libraries, archives, faith ────────────────────────────── */

const internetArchive = api("search-tools", "internet-archive", "Internet Archive", "Search 40M+ books, movies, music and software in the Internet Archive and read item metadata.", "https://archive.org/developers/", ["archive", "books", "media", "library"], [
  get("search", "Search items", "Advanced search.", [f.req("query", { example: "title:(moby dick) AND mediatype:texts" }), lim(20, 1000, "rows"), f.int("page", { default: 1, min: 1 })],
    (p) => url("https://archive.org/advancedsearch.php", { q: p.query, "fl[]": ["identifier", "title", "creator", "year", "mediatype", "downloads"], rows: p.rows, page: p.page, output: "json" }), { ttl: 3600 }),
  get("metadata", "Item metadata", "Files and metadata for an item.", [f.req("identifier", { example: "principleofrelat00eins" })], (p) => `https://archive.org/metadata/${enc(p.identifier)}`, { ttl: 86400 }),
]);
const loc = api("search-tools", "library-of-congress", "Library of Congress", "Search the Library of Congress digital collections: books, maps, photos, newspapers and recordings.", "https://www.loc.gov/apis/", ["library", "archives", "history", "usa"], [
  get("search", "Search", "Search all collections.", [f.req("query", { example: "moon landing" }), lim(25, 150, "count"), f.int("page", { default: 1, min: 1 })], (p) => url("https://www.loc.gov/search/", { q: p.query, fo: "json", c: p.count, sp: p.page }), { ttl: 3600 }),
]);
const aladhan = api("places", "prayer-times", "Prayer Times (AlAdhan)", "Islamic prayer times for any city or coordinate worldwide, with Hijri dates.", "https://aladhan.com/prayer-times-api", ["prayer-times", "islam", "hijri", "calendar"], [
  get("by-city", "By city", "Today's timings for a city.", [f.req("city", { example: "London" }), f.req("country", { example: "United Kingdom" }), f.int("method", { description: "Calculation method id (default by country)" })],
    (p) => url("https://api.aladhan.com/v1/timingsByCity", { city: p.city, country: p.country, method: p.method }), { ttl: 3600 }),
  get("by-coordinates", "By coordinates", "Timings for a coordinate and date.", [f.req("latitude", { type: "number", example: 21.4225 }), f.req("longitude", { type: "number", example: 39.8262 }), f.str("date", { description: "DD-MM-YYYY, default today" })],
    (p) => url(`https://api.aladhan.com/v1/timings/${p.date ?? ""}`, { latitude: p.latitude, longitude: p.longitude }), { ttl: 3600 }),
]);
const quranCloud = api("education", "quran-cloud", "Al Quran Cloud", "The Quran in Arabic and 100+ translations, with audio editions.", "https://alquran.cloud/api", ["quran", "islam", "translation"], [
  get("surah", "Surah", "A surah in one edition.", [f.req("surah", { type: "integer", example: 1 }), f.str("edition", { default: "en.asad" })], (p) => `https://api.alquran.cloud/v1/surah/${p.surah}/${enc(p.edition ?? "en.asad")}`, { ttl: 604800 }),
  get("search", "Search", "Search a translation.", [f.req("keyword", { example: "mercy" }), f.str("edition", { default: "en.asad" })], (p) => `https://api.alquran.cloud/v1/search/${enc(p.keyword)}/all/${enc(p.edition ?? "en.asad")}`, { ttl: 86400 }),
]);
const hebcal = api("places", "hebcal", "Hebcal", "Jewish holidays, Shabbat times and Hebrew dates.", "https://www.hebcal.com/home/developer-apis", ["jewish", "holidays", "calendar"], [
  get("holidays", "Holidays", "Major holidays for a year.", [f.str("year", { default: "now" })], (p) => url("https://www.hebcal.com/hebcal", { v: 1, cfg: "json", maj: "on", min: "on", year: p.year }), { ttl: 86400 }),
  get("shabbat", "Shabbat times", "Candle lighting and Havdalah for a GeoNames id.", [f.req("geonameid", { example: "281184" })], (p) => url("https://www.hebcal.com/shabbat", { cfg: "json", geonameid: p.geonameid }), { ttl: 3600 }),
]);

/* ────────────────────────────── regional public data ────────────────────────────── */

const brasilApi = api("open-data", "brasilapi", "BrasilAPI", "Brazilian public data in one API: postal codes (CEP), banks, holidays, company registry (CNPJ) and area codes.", "https://brasilapi.com.br/docs", ["brazil", "cep", "cnpj", "banks"], [
  get("cep", "Postal code", "Address for a CEP.", [f.req("cep", { example: "01001000" })], (p) => `https://brasilapi.com.br/api/cep/v2/${enc(p.cep)}`, { ttl: 604800 }),
  get("cnpj", "Company", "Company registry record.", [f.req("cnpj", { example: "19131243000197" })], (p) => `https://brasilapi.com.br/api/cnpj/v1/${enc(p.cnpj)}`, { ttl: 86400 }),
  get("banks", "Banks", "Every bank with its code.", [], () => "https://brasilapi.com.br/api/banks/v1", { ttl: 604800 }),
  get("holidays", "Holidays", "National holidays in a year.", [f.int("year", { required: true, example: 2026 })], (p) => `https://brasilapi.com.br/api/feriados/v1/${p.year}`, { ttl: 604800 }),
]);
const indiaPincode = api("places", "india-pincode", "India Postal PIN", "Post offices and districts for Indian PIN codes.", "https://www.postalpincode.in/Api-Details", ["india", "postal-code", "pin"], [
  get("pincode", "PIN code", "Post offices for a PIN.", [f.req("pincode", { example: "110001" })], (p) => `https://api.postalpincode.in/pincode/${enc(p.pincode)}`, { ttl: 604800 }),
]);
const japanZip = api("places", "japan-postcode", "Japan Postal Code (zipcloud)", "Addresses for Japanese postal codes.", "https://zipcloud.ibsnet.co.jp/doc/api", ["japan", "postal-code"], [
  get("lookup", "Lookup", "Address for a 7-digit code.", [f.req("zipcode", { example: "1000001" })], (p) => url("https://zipcloud.ibsnet.co.jp/api/search", { zipcode: p.zipcode }), { ttl: 604800 }),
]);
const unSdg = api("open-data", "un-sdg", "UN SDG Indicators", "United Nations Sustainable Development Goals: goals, targets and indicator data.", "https://unstats.un.org/sdgapi/swagger/", ["un", "sdg", "development", "statistics"], [
  get("goals", "Goals", "The 17 goals with targets.", [], () => "https://unstats.un.org/sdgapi/v1/sdg/Goal/List?includechildren=true", { ttl: 604800 }),
  get("series-data", "Series data", "Observations for an indicator series and country (M49 code).", [f.req("seriesCode", { example: "SI_POV_DAY1" }), f.str("areaCode", { example: "356" }), lim(50, 1000, "pageSize")],
    (p) => url("https://unstats.un.org/sdgapi/v1/sdg/Series/Data", { seriesCode: p.seriesCode, areaCode: p.areaCode, pageSize: p.pageSize }), { ttl: 86400 }),
]);

export default [
  bitfinex, gemini, htx, mexc, bitget, cryptoCom, upbit, deribit, coinlore, blockchair, currencyApi, stooq, bankOfCanada, bcb,
  depsDev, osv, bundlephobia, npms, jsdelivrStats, homebrew, archLinux, statuspage, ipwho, colorApi, mathjs, timeapi, translate,
  randomUser, dummyJson, fakeStore, jsonPlaceholder,
  scryfall, ygopro, pokemonTcg, openDota, ddragon, valorant, mojang, gw2, speedrun, rickMorty, swapi, ghibli, kitsu, disney, coverArt,
  swissTransport, irail, metNorway, seventimer, eonet, reliefweb, spaceflightNews, celestrak,
  internetArchive, loc, aladhan, quranCloud, hebcal,
  brasilApi, indiaPincode, japanZip, unSdg,
];
