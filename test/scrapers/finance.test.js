import { test } from "node:test";
import assert from "node:assert/strict";
import defs, { parseSdmxJson } from "../../src/scrapers/live/finance.js";
import { checkModule, mockFetch, run } from "./harness.js";

test("finance module shape", () => {
  checkModule(defs);
  const keys = defs.map((d) => `${d.category}:${d.slug}`);
  for (const k of [
    "finance:coingecko", "finance:binance", "finance:indodax", "finance:okx", "finance:bybit", "finance:mempool-space", "finance:defillama",
    "finance:blockchain-info", "finance:fear-greed", "finance:crypto-price", "finance:currency-convert", "finance:fx", "finance:worldbank",
    "finance:gleif", "finance:us-treasury", "finance:ecb", "finance:sec-edgar", "finance:fred",
  ]) assert.ok(keys.includes(k), k);
});

// ---------- CoinGecko ----------
test("coingecko simple-price", async () => {
  const fetch = mockFetch([["/simple/price", { bitcoin: { usd: 67000, idr: 1.05e9, usd_market_cap: 1.3e12 } }]]);
  const out = await run(defs, "finance:coingecko", "simple-price", { ids: "Bitcoin" }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://api.coingecko.com/api/v3/simple/price");
  assert.equal(u.searchParams.get("ids"), "bitcoin");
  assert.equal(u.searchParams.get("vs_currencies"), "usd,idr");
  assert.equal(u.searchParams.get("include_24hr_vol"), "true");
  assert.equal(out.prices.bitcoin.usd, 67000);
});

test("coingecko coins-markets + derivatives filter", async () => {
  const fetch = mockFetch([
    ["/coins/markets", [{ id: "bitcoin", symbol: "btc", name: "Bitcoin", market_cap_rank: 1, current_price: 67000, market_cap: 1.3e12, price_change_percentage_24h: 1.2 }]],
    ["/derivatives", [
      { market: "Binance (Futures)", symbol: "BTCUSDT", index_id: "BTC", price: "67000", contract_type: "perpetual", funding_rate: 0.01, open_interest: 1e9, volume_24h: 2e9, last_traded_at: 1700000000 },
      { market: "OKX", symbol: "ETH-USDT-SWAP", index_id: "ETH", price: "3000", contract_type: "perpetual" },
    ]],
  ]);
  const m = await run(defs, "finance:coingecko", "coins-markets", { limit: 5 }, fetch);
  assert.match(fetch.calls[0].url, /vs_currency=usd.*per_page=5|per_page=5.*vs_currency=usd/);
  assert.deepEqual([m.coins[0].id, m.coins[0].rank, m.coins[0].price], ["bitcoin", 1, 67000]);
  const d = await run(defs, "finance:coingecko", "derivatives", { indexId: "btc" }, fetch);
  assert.equal(d.total, 1);
  assert.equal(d.derivatives[0].price, 67000);
});

// ---------- Binance ----------
test("binance klines + tickers", async () => {
  const fetch = mockFetch([
    ["/klines", [[1700000000000, "1.0", "2.0", "0.5", "1.5", "100", 1700000059999, "150", 10, "50", "75", "0"]]],
    ["/ticker/24hr", [
      { symbol: "BTCUSDT", lastPrice: "67000", priceChangePercent: "1.5", quoteVolume: "9000000" },
      { symbol: "ETHUSDT", lastPrice: "3000", priceChangePercent: "3", quoteVolume: "5000000" },
      { symbol: "ETHBTC", lastPrice: "0.05", priceChangePercent: "1", quoteVolume: "100" },
    ]],
  ]);
  const k = await run(defs, "finance:binance", "klines", { symbol: "btc-usdt", interval: "1h", count: 2, startTime: "2023-11-14T00:00:00Z" }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.pathname, "/api/v3/klines");
  assert.equal(u.searchParams.get("symbol"), "BTCUSDT");
  assert.equal(u.searchParams.get("limit"), "2");
  assert.equal(u.searchParams.get("startTime"), String(Date.parse("2023-11-14T00:00:00Z")));
  assert.equal(k.candles[0].close, 1.5);
  assert.equal(k.candles[0].openTime, new Date(1700000000000).toISOString());
  const t = await run(defs, "finance:binance", "tickers", { sort: "change" }, fetch);
  assert.deepEqual(t.tickers.map((x) => x.symbol), ["ETHUSDT", "BTCUSDT"]);
});

test("binance depth", async () => {
  const fetch = mockFetch([["/depth", { lastUpdateId: 1, bids: [["100.0", "2.0"]], asks: [["101.0", "1.0"]] }]]);
  const out = await run(defs, "finance:binance", "depth", { symbol: "BTCUSDT", limit: 5 }, fetch);
  assert.match(fetch.calls[0].url, /^https:\/\/api\.binance\.com\/api\/v3\/depth\?symbol=BTCUSDT&limit=5$/);
  assert.deepEqual(out.bids[0], { price: 100, qty: 2 });
});

// ---------- Indodax ----------
test("indodax ticker + tickers", async () => {
  const t = { high: "1100000000", low: "1000000000", vol_btc: "12.5", vol_idr: "13000000000", last: "1050000000", buy: "1049000000", sell: "1050000000", server_time: 1700000000 };
  const fetch = mockFetch([
    ["/api/ticker_all", { tickers: { btc_idr: t, eth_usdt: { ...t, last: "3000" } } }],
    ["/api/ticker/", { ticker: t }],
  ]);
  const out = await run(defs, "finance:indodax", "ticker", { pair: "BTC_IDR" }, fetch);
  assert.equal(fetch.calls[0].url, "https://indodax.com/api/ticker/btcidr");
  assert.equal(out.last, 1050000000);
  assert.equal(out.volume.idr, 13000000000);
  const all = await run(defs, "finance:indodax", "tickers", { quote: "idr" }, fetch);
  assert.deepEqual(all.tickers.map((x) => x.pair), ["btcidr"]);
});

test("indodax klines", async () => {
  const fetch = mockFetch([["/tradingview/history_v2", [{ Time: 1700000000, Open: 1, High: 2, Low: 0.5, Close: 1.5, Volume: "10" }]]]);
  const out = await run(defs, "finance:indodax", "klines", { pair: "btcidr", from: "1699990000", to: "1700000000" }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.searchParams.get("symbol"), "BTCIDR");
  assert.equal(u.searchParams.get("tf"), "15");
  assert.equal(u.searchParams.get("from"), "1699990000");
  assert.equal(out.candles[0].volume, 10);
});

// ---------- OKX ----------
test("okx ticker + error code", async () => {
  const fetch = mockFetch([
    ["instId=BAD", { code: "51001", msg: "Instrument ID does not exist", data: [] }],
    ["/market/ticker", { code: "0", msg: "", data: [{ instType: "SWAP", instId: "BTC-USDT-SWAP", last: "110", open24h: "100", high24h: "111", low24h: "99", vol24h: "5", ts: "1700000000000" }] }],
  ]);
  const out = await run(defs, "finance:okx", "ticker", { symbol: "BTC-USDT-SWAP" }, fetch);
  assert.equal(fetch.calls[0].url, "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP");
  assert.equal(out.last, 110);
  assert.equal(Math.round(out.changePct24h), 10);
  await assert.rejects(run(defs, "finance:okx", "ticker", { symbol: "BAD" }, fetch), /51001/);
});

test("okx candles + taker volume", async () => {
  const fetch = mockFetch([
    ["/market/candles", { code: "0", data: [["1700000000000", "1", "2", "0.5", "1.5", "10", "15", "15", "1"]] }],
    ["/rubik/stat/taker-volume", { code: "0", data: [["1700000000000", "100", "120"]] }],
  ]);
  const c = await run(defs, "finance:okx", "candles", { symbol: "BTC-USDT", bar: "1H", count: 50 }, fetch);
  assert.match(fetch.calls[0].url, /instId=BTC-USDT&bar=1H&limit=50/);
  assert.equal(c.candles[0].confirmed, true);
  const tv = await run(defs, "finance:okx", "taker-volume", {}, fetch);
  assert.match(fetch.calls[1].url, /ccy=BTC&instType=CONTRACTS&period=5m/);
  assert.deepEqual([tv.data[0].sellVolume, tv.data[0].buyVolume], [100, 120]);
});

// ---------- Bybit ----------
test("bybit kline + tickers", async () => {
  const fetch = mockFetch([
    ["/kline", { retCode: 0, retMsg: "OK", result: { category: "linear", symbol: "BTCUSDT", list: [["1700000000000", "1", "2", "0.5", "1.5", "10", "15"]] } }],
    ["/tickers", { retCode: 0, retMsg: "OK", result: { category: "linear", list: [{ symbol: "BTCUSDT", lastPrice: "67000", price24hPcnt: "0.015", fundingRate: "0.0001", openInterest: "5000", nextFundingTime: "1700003600000" }] } }],
  ]);
  const k = await run(defs, "finance:bybit", "kline", { symbol: "BTCUSDT", interval: "60" }, fetch);
  assert.match(fetch.calls[0].url, /^https:\/\/api\.bybit\.com\/v5\/market\/kline\?category=linear&symbol=BTCUSDT&interval=60&limit=200$/);
  assert.equal(k.candles[0].turnover, 15);
  const t = await run(defs, "finance:bybit", "tickers", { symbol: "BTCUSDT" }, fetch);
  assert.equal(t.tickers[0].changePct24h, 1.5);
  assert.equal(t.tickers[0].fundingRate, 0.0001);
});

test("bybit retCode error", async () => {
  const fetch = mockFetch([["/orderbook", { retCode: 10001, retMsg: "params error", result: {} }]]);
  await assert.rejects(run(defs, "finance:bybit", "orderbook", { symbol: "X" }, fetch), /10001/);
});

// ---------- mempool.space ----------
test("mempool fees + blocks", async () => {
  const fetch = mockFetch([
    ["/v1/fees/recommended", { fastestFee: 20, halfHourFee: 15, hourFee: 10, economyFee: 5, minimumFee: 1 }],
    ["/v1/blocks/800000", [{ id: "000abc", height: 800000, timestamp: 1690168629, tx_count: 3721, size: 1600000, weight: 3990000, extras: { medianFee: 12, pool: { name: "Foundry USA" } } }]],
  ]);
  const fees = await run(defs, "finance:mempool-space", "fees", {}, fetch);
  assert.equal(fetch.calls[0].url, "https://mempool.space/api/v1/fees/recommended");
  assert.deepEqual([fees.fastest, fees.economy], [20, 5]);
  const b = await run(defs, "finance:mempool-space", "blocks", { height: 800000 }, fetch);
  assert.equal(b.blocks[0].pool, "Foundry USA");
});

// ---------- DefiLlama ----------
test("defillama chains + stablecoins", async () => {
  const fetch = mockFetch([
    ["api.llama.fi/v2/chains", [{ name: "Tron", tvl: 8e9, tokenSymbol: "TRX" }, { name: "Ethereum", tvl: 6e10, tokenSymbol: "ETH", chainId: 1 }]],
    ["stablecoins.llama.fi/stablecoins", { peggedAssets: [
      { id: "1", name: "Tether", symbol: "USDT", pegType: "peggedUSD", circulating: { peggedUSD: 1.2e11 }, price: 1 },
      { id: "2", name: "EURC", symbol: "EURC", pegType: "peggedEUR", circulating: { peggedEUR: 1e8 }, price: 1.08 },
    ] }],
  ]);
  const c = await run(defs, "finance:defillama", "chains", { length: 1 }, fetch);
  assert.deepEqual(c.chains.map((x) => x.name), ["Ethereum"]);
  const s = await run(defs, "finance:defillama", "stablecoins", { peg: "peggedUSD" }, fetch);
  assert.match(fetch.calls[1].url, /includePrices=true/);
  assert.equal(s.stablecoins.length, 1);
  assert.equal(s.stablecoins[0].circulating, 1.2e11);
});

// ---------- blockchain.info ----------
test("blockchain-info chart", async () => {
  const fetch = mockFetch([["/charts/hash-rate", { status: "ok", name: "Total Hash Rate", unit: "TH/s", period: "day", values: [{ x: 1700000000, y: 5e8 }, { x: 1700086400, y: 5.1e8 }] }]]);
  const out = await run(defs, "finance:blockchain-info", "chart", { chart: "hash-rate", timespan: "30days", limit: 1 }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://api.blockchain.info/charts/hash-rate");
  assert.equal(u.searchParams.get("format"), "json");
  assert.equal(u.searchParams.get("timespan"), "30days");
  assert.deepEqual(out.values.map((v) => v.value), [5.1e8]);
});

// ---------- Fear & Greed ----------
test("fear-greed crypto", async () => {
  const fetch = mockFetch([["api.alternative.me/fng", { name: "Fear and Greed Index", data: [{ value: "72", value_classification: "Greed", timestamp: "1700000000", time_until_update: "3600" }, { value: "40", value_classification: "Fear", timestamp: "1699913600" }], metadata: { error: null } }]]);
  const out = await run(defs, "finance:fear-greed", "crypto", { count: 2 }, fetch);
  assert.match(fetch.calls[0].url, /limit=2/);
  assert.equal(out.current.value, 72);
  assert.equal(out.current.classification, "Greed");
  const h = await run(defs, "finance:fear-greed", "crypto-history", { from: "1699950000" }, fetch);
  assert.match(fetch.calls[1].url, /limit=0/);
  assert.equal(h.count, 1);
});

// ---------- crypto-price ----------
test("crypto-price maps symbols to ids", async () => {
  const fetch = mockFetch([["/simple/price", { bitcoin: { usd: 67000, idr: 1.05e9, usd_24h_change: 1.2 } }]]);
  const out = await run(defs, "finance:crypto-price", "price", { coins: "BTC,nope" }, fetch);
  assert.match(fetch.calls[0].url, /ids=bitcoin%2Cnope/);
  assert.equal(out.prices[0].prices.idr, 1.05e9);
  assert.equal(out.prices[0].change24h.usd, 1.2);
  assert.equal(out.prices[1].found, false);
});

// ---------- currency-convert / fx ----------
test("currency-convert", async () => {
  const fetch = mockFetch([["frankfurter.dev/v1/latest", { amount: 1, base: "USD", date: "2026-10-23", rates: { IDR: 16250.5 } }]]);
  const out = await run(defs, "finance:currency-convert", "convert", { amount: 10 }, fetch);
  assert.equal(fetch.calls[0].url, "https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR");
  assert.equal(out.result, 162505);
  const same = await run(defs, "finance:currency-convert", "convert", { from: "idr", to: "IDR", amount: 5 }, fetch);
  assert.equal(same.result, 5);
  assert.equal(fetch.calls.length, 1);
});

test("fx latest, history, currencies", async () => {
  const fetch = mockFetch([
    ["/v1/latest", { base: "USD", date: "2026-10-23", rates: { IDR: 16250, SGD: 1.3 } }],
    ["/v1/2026-01-01..2026-01-03", { base: "USD", start_date: "2026-01-02", end_date: "2026-01-02", rates: { "2026-01-02": { IDR: 16100 } } }],
    ["/v1/currencies", { IDR: "Indonesian Rupiah", USD: "United States Dollar" }],
  ]);
  const l = await run(defs, "finance:fx", "latest", { symbols: "idr, sgd" }, fetch);
  assert.equal(fetch.calls[0].url, "https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR%2CSGD");
  assert.equal(l.rates.IDR, 16250);
  const h = await run(defs, "finance:fx", "history", { start: "2026-01-01", end: "2026-01-03" }, fetch);
  assert.deepEqual(h.series, [{ date: "2026-01-02", rates: { IDR: 16100 } }]);
  const c = await run(defs, "finance:fx", "currencies", {}, fetch);
  assert.equal(c.count, 2);
});

// ---------- World Bank ----------
test("worldbank indicator + error", async () => {
  const fetch = mockFetch([
    ["/indicator/BAD", [{ message: [{ id: "120", key: "Invalid value", value: "The provided parameter value is not valid" }] }]],
    ["api.worldbank.org/v2/country/ID/indicator/NY.GDP.MKTP.CD", [
      { page: 1, pages: 1, per_page: 20, total: 64, lastupdated: "2026-07-01" },
      [{ indicator: { id: "NY.GDP.MKTP.CD", value: "GDP (current US$)" }, country: { id: "ID", value: "Indonesia" }, countryiso3code: "IDN", date: "2025", value: 1.4e12, unit: "", obs_status: "", decimal: 0 }],
    ]],
  ]);
  const out = await run(defs, "finance:worldbank", "indicator", {}, fetch);
  assert.match(fetch.calls[0].url, /format=json&per_page=20/);
  assert.equal(out.data[0].countryCode, "IDN");
  assert.equal(out.indicatorName, "GDP (current US$)");
  await assert.rejects(run(defs, "finance:worldbank", "indicator", { indicator: "BAD" }, fetch), /not valid/);
});

// ---------- GLEIF ----------
test("gleif search", async () => {
  const rec = {
    type: "lei-records",
    id: "549300ABCDEFGHIJKL12",
    attributes: {
      lei: "549300ABCDEFGHIJKL12",
      entity: { legalName: { name: "PT Bank Contoh Tbk" }, legalAddress: { addressLines: ["Jl. Sudirman 1"], city: "Jakarta", country: "ID" }, status: "ACTIVE", jurisdiction: "ID" },
      registration: { status: "ISSUED", initialRegistrationDate: "2015-01-01T00:00:00Z" },
      bic: ["CENAIDJA"],
    },
  };
  const fetch = mockFetch([["/lei-records", { data: [rec], meta: { pagination: { total: 1 } } }]]);
  const out = await run(defs, "finance:gleif", "lei", { query: "bank contoh", country: "id" }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.searchParams.get("filter[fulltext]"), "bank contoh");
  assert.equal(u.searchParams.get("filter[entity.legalAddress.country]"), "ID");
  assert.equal(out.records[0].legalName, "PT Bank Contoh Tbk");
  assert.equal(out.records[0].legalAddress.city, "Jakarta");
});

// ---------- US Treasury ----------
test("us-treasury debt-to-penny", async () => {
  const fetch = mockFetch([["debt_to_penny", { data: [{ record_date: "2026-10-22", debt_held_public_amt: "29000000000000.00", intragov_hold_amt: "7400000000000.00", tot_pub_debt_out_amt: "36400000000000.00" }], meta: { "total-count": 1 } }]]);
  const out = await run(defs, "finance:us-treasury", "debt-to-penny", { from: "2026-10-01", length: 5 }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.pathname, "/services/api/fiscal_service/v2/accounting/od/debt_to_penny");
  assert.equal(u.searchParams.get("filter"), "record_date:gte:2026-10-01");
  assert.equal(u.searchParams.get("page[size]"), "5");
  assert.equal(u.searchParams.get("sort"), "-record_date");
  assert.equal(out.data[0].totalDebt, 36400000000000);
});

test("us-treasury yield-curve parses XML", async () => {
  const xml = `<?xml version="1.0"?><feed><entry><content type="application/xml"><m:properties>
    <d:Id m:type="Edm.Int32">1</d:Id><d:NEW_DATE m:type="Edm.DateTime">2026-10-22T00:00:00</d:NEW_DATE>
    <d:BC_1MONTH m:type="Edm.Double">4.1</d:BC_1MONTH><d:BC_1_5MONTH m:type="Edm.Double" m:null="true" />
    <d:BC_10YEAR m:type="Edm.Double">4.05</d:BC_10YEAR><d:BC_30YEARDISPLAY m:type="Edm.Double">4.5</d:BC_30YEARDISPLAY>
  </m:properties></content></entry></feed>`;
  const fetch = mockFetch([["home.treasury.gov", xml]]);
  const out = await run(defs, "finance:us-treasury", "yield-curve", { year: 2026 }, fetch);
  assert.match(fetch.calls[0].url, /data=daily_treasury_yield_curve&field_tdr_date_value=2026/);
  assert.equal(out.latest.date, "2026-10-22");
  assert.deepEqual(out.latest.rates, { "1month": 4.1, "1.5month": null, "10year": 4.05 });
});

// ---------- ECB ----------
const sdmx = {
  dataSets: [{ series: { "0:0:0:0:0": { attributes: [0], observations: { "0": [1.08], "1": [1.09] } } } }],
  structure: {
    dimensions: {
      series: [
        { id: "FREQ", values: [{ id: "D" }] },
        { id: "CURRENCY", values: [{ id: "USD" }] },
        { id: "CURRENCY_DENOM", values: [{ id: "EUR" }] },
        { id: "EXR_TYPE", values: [{ id: "SP00" }] },
        { id: "EXR_SUFFIX", values: [{ id: "A" }] },
      ],
      observation: [{ id: "TIME_PERIOD", values: [{ id: "2026-10-22" }, { id: "2026-10-23" }] }],
    },
    attributes: { series: [{ id: "TITLE", values: [{ name: "US dollar/Euro" }] }] },
  },
};
test("ecb exchange-rates", async () => {
  const fetch = mockFetch([["/data/EXR/", sdmx]]);
  const out = await run(defs, "finance:ecb", "exchange-rates", { currency: "usd" }, fetch);
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A");
  assert.equal(u.searchParams.get("format"), "jsondata");
  assert.equal(u.searchParams.get("lastNObservations"), "10");
  assert.equal(out.rates[0].currency, "USD");
  assert.deepEqual(out.rates[0].latest, { period: "2026-10-23", value: 1.09 });
  assert.equal(parseSdmxJson(sdmx)[0].title, "US dollar/Euro");
});

test("ecb key-rates key", async () => {
  const fetch = mockFetch([["/data/FM/", sdmx]]);
  await run(defs, "finance:ecb", "key-rates", { rate: "DFR" }, fetch);
  assert.match(fetch.calls[0].url, /\/data\/FM\/B\.U2\.EUR\.4F\.KR\.DFR\.LEV\?/);
});

// ---------- SEC EDGAR ----------
test("sec-edgar company resolves ticker", async () => {
  const fetch = mockFetch([
    ["company_tickers.json", { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }],
    ["data.sec.gov/submissions/CIK0000320193.json", { cik: "320193", name: "Apple Inc.", tickers: ["AAPL"], exchanges: ["Nasdaq"], sic: "3571", sicDescription: "Electronic Computers", fiscalYearEnd: "0928", filings: { recent: { accessionNumber: ["0000320193-25-000079", "0000320193-25-000070"], form: ["10-K", "8-K"], filingDate: ["2025-10-31", "2025-10-30"], reportDate: ["2025-09-27", ""], primaryDocument: ["aapl-20250927.htm", "a8k.htm"], primaryDocDescription: ["10-K", "8-K"] } } }],
  ]);
  const c = await run(defs, "finance:sec-edgar", "company", { company: "aapl" }, fetch);
  assert.equal(c.cik, "0000320193");
  assert.equal(c.sicDescription, "Electronic Computers");
  const fl = await run(defs, "finance:sec-edgar", "filings", { cik: "320193", form: "10-K" }, fetch);
  assert.equal(fl.total, 1);
  assert.equal(fl.filings[0].url, "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm");
});

test("sec-edgar concept + search", async () => {
  const fetch = mockFetch([
    ["companyconcept/CIK0000320193/us-gaap/Revenues.json", { cik: 320193, taxonomy: "us-gaap", tag: "Revenues", label: "Revenues", entityName: "Apple Inc.", units: { USD: [
      { start: "2024-09-29", end: "2025-09-27", val: 416e9, accn: "x", fy: 2025, fp: "FY", form: "10-K", filed: "2025-10-31" },
      { start: "2025-06-29", end: "2025-09-27", val: 102e9, accn: "y", fy: 2025, fp: "Q4", form: "10-K", filed: "2025-10-31" },
    ] } }],
    ["efts.sec.gov/LATEST/search-index", { hits: { total: { value: 1 }, hits: [{ _id: "0000320193-25-000079:aapl-20250927.htm", _source: { ciks: ["0000320193"], display_names: ["Apple Inc.  (AAPL)  (CIK 0000320193)"], form: "10-K", file_date: "2025-10-31", adsh: "0000320193-25-000079" } }] } }],
  ]);
  const c = await run(defs, "finance:sec-edgar", "concept", { cik: "320193", period: "annual" }, fetch);
  assert.equal(c.units.USD.length, 1);
  assert.equal(c.units.USD[0].value, 416e9);
  const s = await run(defs, "finance:sec-edgar", "search", { q: "tariffs", forms: "10-k", from: "2025-01-01", to: "2025-12-31" }, fetch);
  const u = new URL(fetch.calls[1].url);
  assert.equal(u.searchParams.get("forms"), "10-K");
  assert.equal(u.searchParams.get("dateRange"), "custom");
  assert.equal(s.hits[0].url, "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm");
});

// ---------- FRED ----------
test("fred needs key, then fetches observations", async () => {
  const prev = process.env.FRED_API_KEY;
  delete process.env.FRED_API_KEY;
  const fetch = mockFetch([
    ["fred/series?", { seriess: [{ id: "DGS10", notes: "Treasury constant maturity yields." }] }],
    ["series/observations", { units: "lin", observations: [{ date: "2026-10-22", value: "4.05" }, { date: "2026-10-21", value: "." }] }],
  ]);
  await assert.rejects(run(defs, "finance:fred", "series-observations", {}, fetch), /FRED_API_KEY/);
  process.env.FRED_API_KEY = "abc123";
  try {
    const out = await run(defs, "finance:fred", "series-observations", { series: "DGS10", frequency: "Monthly", length: 2 }, fetch);
    const u = new URL(fetch.calls.at(-1).url);
    assert.equal(u.origin + u.pathname, "https://api.stlouisfed.org/fred/series/observations");
    assert.equal(u.searchParams.get("api_key"), "abc123");
    assert.equal(u.searchParams.get("file_type"), "json");
    assert.equal(u.searchParams.get("frequency"), "m");
    assert.equal(u.searchParams.get("sort_order"), "desc");
    assert.deepEqual(out.observations, [{ date: "2026-10-21", value: null }, { date: "2026-10-22", value: 4.05 }]);
    // a series FRED marks as copyrighted by a third party is refused, never fetched
    const cr = mockFetch([["fred/series?", { seriess: [{ id: "SP500", notes: "Copyright, 2016, S&P Dow Jones Indices LLC. All rights reserved." }] }]]);
    await assert.rejects(run(defs, "finance:fred", "series-observations", { series: "SP500" }, cr), /copyrighted by a third-party/);
    assert.ok(!cr.calls.some((c) => c.url.includes("series/observations")));
  } finally {
    if (prev === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = prev;
  }
});
