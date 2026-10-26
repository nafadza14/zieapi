// Live finance scrapers. Every endpoint uses an official, documented public API.
import { url, getJson, getText, f, ScraperError, num, requireEnv, decodeEntities } from "../kit.js";

// ---------- shared helpers ----------
const CCY = "^[A-Za-z]{3}$";
const DATE = "^\\d{4}-\\d{2}-\\d{2}$";

/** Accept epoch ms, epoch seconds or an ISO date string → epoch ms (or undefined). */
function toMs(v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (/^\d+$/.test(String(v))) {
    const n = Number(v);
    return n < 1e11 ? n * 1000 : n;
  }
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) throw new ScraperError(`Invalid time value: ${v}`);
  return t;
}
/** Same as toMs but returns epoch seconds. */
const toSec = (v) => {
  const ms = toMs(v);
  return ms === undefined ? undefined : Math.floor(ms / 1000);
};
const iso = (ms) => (ms === null || ms === undefined || ms === "" || Number.isNaN(Number(ms)) ? null : new Date(Number(ms)).toISOString());
const isoDate = (v) => {
  const ms = toMs(v);
  return ms === undefined ? undefined : new Date(ms).toISOString().slice(0, 10);
};
const lc = (s) => String(s ?? "").toLowerCase();

const count = (dflt, max, description = "Number of rows to return") => f.int("count", { default: dflt, min: 1, max, description });

// ======================================================================
// CoinGecko (public API, no key)
// ======================================================================
const CG = "https://api.coingecko.com/api/v3";

const coingecko = {
  category: "finance",
  slug: "coingecko",
  displayName: "CoinGecko",
  description: "Crypto prices, market rankings, categories, exchanges and derivatives from CoinGecko's public API.",
  tags: ["crypto", "prices", "market-cap", "coingecko"],
  endpoints: [
    {
      slug: "ping",
      displayName: "Ping",
      description: "Checks whether the CoinGecko API is reachable.",
      method: "GET",
      cacheTtl: 30,
      fields: [],
      handler: async (_p, ctx) => {
        const j = await getJson(ctx, `${CG}/ping`);
        return { ok: true, message: j?.gecko_says ?? null };
      },
    },
    {
      slug: "simple-price",
      displayName: "Simple Price",
      description: "Current price of one or more coins in one or more fiat/crypto currencies.",
      method: "GET",
      cacheTtl: 30,
      bulkEnabled: true,
      fields: [
        f.req("ids", { example: "bitcoin,ethereum", description: "Comma-separated CoinGecko coin ids" }),
        f.str("vsCurrencies", { default: "usd,idr", description: "Comma-separated quote currencies" }),
        f.enm("includeMarketCap", ["true", "false"], { default: "true" }),
        f.enm("include24hVol", ["true", "false"], { default: "true" }),
        f.enm("include24hChange", ["true", "false"], { default: "true" }),
        f.str("precision", { description: "Decimal places (0-18) or 'full'" }),
      ],
      handler: async (p, ctx) => {
        const j = await getJson(
          ctx,
          url(`${CG}/simple/price`, {
            ids: lc(p.ids).replace(/\s+/g, ""),
            vs_currencies: lc(p.vsCurrencies ?? "usd"),
            include_market_cap: p.includeMarketCap,
            include_24hr_vol: p.include24hVol,
            include_24hr_change: p.include24hChange,
            include_last_updated_at: "true",
            precision: p.precision,
          }),
        );
        return { prices: j ?? {} };
      },
    },
    {
      slug: "vs-currencies",
      displayName: "Supported vs Currencies",
      description: "List of quote currencies accepted by the price endpoints.",
      method: "GET",
      cacheTtl: 86400,
      fields: [],
      handler: async (_p, ctx) => {
        const j = await getJson(ctx, `${CG}/simple/supported_vs_currencies`);
        return { count: j?.length ?? 0, currencies: j ?? [] };
      },
    },
    {
      slug: "coins-markets",
      displayName: "Coins Markets",
      description: "Ranked coin list with price, market cap, volume and price change.",
      method: "GET",
      cacheTtl: 60,
      fields: [
        f.str("vsCurrency", { default: "usd" }),
        f.str("ids", { description: "Restrict to these coin ids (comma-separated)" }),
        f.str("category", { description: "CoinGecko category id, e.g. layer-1" }),
        f.enm("order", ["market_cap_desc", "market_cap_asc", "volume_desc", "volume_asc", "id_desc", "id_asc"], { default: "market_cap_desc" }),
        f.str("priceChangePercentage", { example: "1h,24h,7d", description: "Extra change windows" }),
        f.str("precision"),
        f.int("page", { default: 1, min: 1 }),
        f.int("limit", { default: 100, min: 1, max: 250 }),
      ],
      handler: async (p, ctx) => {
        const j = await getJson(
          ctx,
          url(`${CG}/coins/markets`, {
            vs_currency: lc(p.vsCurrency ?? "usd"),
            ids: p.ids,
            category: p.category,
            order: p.order,
            price_change_percentage: p.priceChangePercentage,
            precision: p.precision,
            page: p.page ?? 1,
            per_page: p.limit ?? 100,
          }),
        );
        const coins = (j ?? []).map((c) => ({
          id: c.id,
          symbol: c.symbol,
          name: c.name,
          image: c.image,
          rank: c.market_cap_rank,
          price: c.current_price,
          marketCap: c.market_cap,
          volume24h: c.total_volume,
          high24h: c.high_24h,
          low24h: c.low_24h,
          change24h: c.price_change_24h,
          changePct24h: c.price_change_percentage_24h,
          circulatingSupply: c.circulating_supply,
          totalSupply: c.total_supply,
          maxSupply: c.max_supply,
          ath: c.ath,
          athDate: c.ath_date,
          lastUpdated: c.last_updated,
          ...Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("price_change_percentage_") && k.endsWith("_in_currency"))),
        }));
        return { vsCurrency: lc(p.vsCurrency ?? "usd"), page: p.page ?? 1, count: coins.length, coins };
      },
    },
    {
      slug: "categories",
      displayName: "Categories",
      description: "Coin categories with aggregate market cap and 24h volume.",
      method: "GET",
      cacheTtl: 300,
      fields: [
        f.enm("order", ["market_cap_desc", "market_cap_asc", "name_desc", "name_asc", "market_cap_change_24h_desc", "market_cap_change_24h_asc"], { default: "market_cap_desc" }),
        f.str("query", { description: "Filter categories by name" }),
        f.int("limit", { min: 1, max: 1000 }),
      ],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, url(`${CG}/coins/categories`, { order: p.order }));
        let rows = (j ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          marketCap: c.market_cap,
          marketCapChange24h: c.market_cap_change_24h,
          volume24h: c.volume_24h,
          top3Coins: c.top_3_coins ?? [],
          updatedAt: c.updated_at,
        }));
        if (p.query) rows = rows.filter((c) => lc(c.name).includes(lc(p.query)) || lc(c.id).includes(lc(p.query)));
        if (p.limit) rows = rows.slice(0, p.limit);
        return { count: rows.length, categories: rows };
      },
    },
    {
      slug: "exchanges",
      displayName: "Exchanges",
      description: "Crypto exchanges ranked by trust score with 24h BTC volume.",
      method: "GET",
      cacheTtl: 300,
      fields: [f.int("page", { default: 1, min: 1 }), f.int("limit", { default: 100, min: 1, max: 250 })],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, url(`${CG}/exchanges`, { per_page: p.limit ?? 100, page: p.page ?? 1 }));
        const exchanges = (j ?? []).map((x) => ({
          id: x.id,
          name: x.name,
          country: x.country,
          yearEstablished: x.year_established,
          url: x.url,
          image: x.image,
          trustScore: x.trust_score,
          trustScoreRank: x.trust_score_rank,
          volume24hBtc: x.trade_volume_24h_btc,
        }));
        return { page: p.page ?? 1, count: exchanges.length, exchanges };
      },
    },
    {
      slug: "global",
      displayName: "Global",
      description: "Total crypto market cap, volume and dominance figures.",
      method: "GET",
      cacheTtl: 120,
      fields: [f.str("vsCurrency", { description: "Only return totals in this currency, e.g. usd" }), f.int("limit", { description: "Max dominance entries", min: 1, max: 50 })],
      handler: async (p, ctx) => {
        const d = (await getJson(ctx, `${CG}/global`))?.data ?? {};
        const pick = (obj) => (p.vsCurrency ? { [lc(p.vsCurrency)]: obj?.[lc(p.vsCurrency)] ?? null } : obj ?? {});
        let dominance = Object.entries(d.market_cap_percentage ?? {}).sort((a, b) => b[1] - a[1]);
        if (p.limit) dominance = dominance.slice(0, p.limit);
        return {
          activeCryptocurrencies: d.active_cryptocurrencies ?? null,
          markets: d.markets ?? null,
          totalMarketCap: pick(d.total_market_cap),
          totalVolume: pick(d.total_volume),
          marketCapPercentage: Object.fromEntries(dominance),
          marketCapChangePct24hUsd: d.market_cap_change_percentage_24h_usd ?? null,
          updatedAt: d.updated_at ? iso(d.updated_at * 1000) : null,
        };
      },
    },
    {
      slug: "derivatives",
      displayName: "Derivatives",
      description: "Derivative tickers across exchanges with funding rate, basis and open interest.",
      method: "GET",
      cacheTtl: 120,
      fields: [
        f.str("market", { description: "Filter by exchange/market name" }),
        f.str("indexId", { example: "BTC" }),
        f.str("symbol", { description: "Filter by contract symbol (substring)" }),
        f.enm("contractType", ["perpetual", "futures"]),
        f.int("page", { default: 1, min: 1 }),
        f.int("limit", { default: 100, min: 1, max: 1000 }),
      ],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, `${CG}/derivatives`);
        let rows = (j ?? []).filter(
          (d) =>
            (!p.market || lc(d.market).includes(lc(p.market))) &&
            (!p.indexId || lc(d.index_id) === lc(p.indexId)) &&
            (!p.symbol || lc(d.symbol).includes(lc(p.symbol))) &&
            (!p.contractType || lc(d.contract_type) === p.contractType),
        );
        const total = rows.length;
        const limit = p.limit ?? 100;
        const page = p.page ?? 1;
        rows = rows.slice((page - 1) * limit, page * limit).map((d) => ({
          market: d.market,
          symbol: d.symbol,
          indexId: d.index_id,
          price: num(d.price),
          changePct24h: num(d.price_percentage_change_24h),
          contractType: d.contract_type,
          index: num(d.index),
          basis: num(d.basis),
          spread: num(d.spread),
          fundingRate: num(d.funding_rate),
          openInterest: num(d.open_interest),
          volume24h: num(d.volume_24h),
          lastTradedAt: d.last_traded_at ? iso(d.last_traded_at * 1000) : null,
          expiredAt: d.expired_at ?? null,
        }));
        return { total, page, count: rows.length, derivatives: rows };
      },
    },
  ],
};

// ======================================================================
// Binance (public spot market data, api.binance.com)
// ======================================================================
const BN = "https://api.binance.com/api/v3";
const BN_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"];
const BN_QUOTES = ["all", "USDT", "USDC", "BTC", "ETH", "BNB", "FDUSD", "TRY", "EUR"];
const bnSym = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const symField = f.req("symbol", { example: "BTCUSDT", description: "Trading pair symbol" });

function bnTicker(t) {
  return {
    symbol: t.symbol,
    lastPrice: num(t.lastPrice),
    priceChange: num(t.priceChange),
    priceChangePercent: num(t.priceChangePercent),
    weightedAvgPrice: num(t.weightedAvgPrice),
    openPrice: num(t.openPrice),
    highPrice: num(t.highPrice),
    lowPrice: num(t.lowPrice),
    volume: num(t.volume),
    quoteVolume: num(t.quoteVolume),
    bidPrice: num(t.bidPrice),
    askPrice: num(t.askPrice),
    openTime: iso(t.openTime),
    closeTime: iso(t.closeTime),
    trades: t.count ?? null,
  };
}
const bnKline = (k) => ({
  openTime: iso(k[0]),
  open: num(k[1]),
  high: num(k[2]),
  low: num(k[3]),
  close: num(k[4]),
  volume: num(k[5]),
  closeTime: iso(k[6]),
  quoteVolume: num(k[7]),
  trades: k[8],
  takerBuyBaseVolume: num(k[9]),
  takerBuyQuoteVolume: num(k[10]),
});
const bnQuoteOk = (sym, quote) => !quote || quote === "all" || sym.endsWith(quote);

function klinesEndpoint(slug, path, displayName, description) {
  return {
    slug,
    displayName,
    description,
    method: "GET",
    cacheTtl: 30,
    fields: [
      symField,
      f.enm("interval", BN_INTERVALS, { default: "1d" }),
      count(200, 1000, "Number of candles"),
      ...(slug === "klines" ? [f.int("limit", { min: 1, max: 1000, description: "Alias of count" })] : []),
      f.str("startTime", { description: "Epoch ms or ISO date" }),
      f.str("endTime", { description: "Epoch ms or ISO date" }),
    ],
    handler: async (p, ctx) => {
      const symbol = bnSym(p.symbol);
      const j = await getJson(
        ctx,
        url(`${BN}/${path}`, { symbol, interval: p.interval, limit: p.limit ?? p.count ?? 200, startTime: toMs(p.startTime), endTime: toMs(p.endTime) }),
      );
      const candles = (j ?? []).map(bnKline);
      return { symbol, interval: p.interval, count: candles.length, candles };
    },
  };
}

const binance = {
  category: "finance",
  slug: "binance",
  displayName: "Binance",
  description: "Spot market data from Binance's public REST API: tickers, candles, order book and trades.",
  tags: ["crypto", "exchange", "orderbook", "klines", "usdt"],
  endpoints: [
    {
      slug: "ticker",
      displayName: "Ticker",
      description: "24-hour rolling statistics for one symbol.",
      method: "GET",
      cacheTtl: 10,
      bulkEnabled: true,
      fields: [symField],
      handler: async (p, ctx) => bnTicker(await getJson(ctx, url(`${BN}/ticker/24hr`, { symbol: bnSym(p.symbol) }))),
    },
    {
      slug: "tickers",
      displayName: "Tickers",
      description: "24-hour statistics for all symbols, filterable by quote asset and sortable.",
      method: "GET",
      cacheTtl: 30,
      fields: [
        f.enm("quote", BN_QUOTES, { default: "USDT" }),
        f.str("search", { description: "Substring of the symbol" }),
        f.enm("sort", ["volume", "change", "symbol"], { default: "volume" }),
        count(100, 3000),
      ],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, `${BN}/ticker/24hr`);
        let rows = (j ?? []).filter((t) => bnQuoteOk(t.symbol, p.quote) && (!p.search || t.symbol.includes(bnSym(p.search)))).map(bnTicker);
        const sorters = {
          volume: (a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0),
          change: (a, b) => (b.priceChangePercent ?? 0) - (a.priceChangePercent ?? 0),
          symbol: (a, b) => a.symbol.localeCompare(b.symbol),
        };
        rows.sort(sorters[p.sort ?? "volume"]);
        const total = rows.length;
        rows = rows.slice(0, p.count ?? 100);
        return { quote: p.quote ?? "USDT", total, count: rows.length, tickers: rows };
      },
    },
    klinesEndpoint("klines", "klines", "Klines", "OHLCV candlesticks for a symbol."),
    klinesEndpoint("ui-klines", "uiKlines", "UI Klines", "Candlesticks tuned for chart display."),
    {
      slug: "depth",
      displayName: "Order Book",
      description: "Bids and asks for a symbol.",
      method: "GET",
      cacheTtl: 5,
      fields: [symField, f.int("limit", { default: 50, min: 1, max: 5000, description: "Depth levels" })],
      handler: async (p, ctx) => {
        const symbol = bnSym(p.symbol);
        const j = await getJson(ctx, url(`${BN}/depth`, { symbol, limit: p.limit ?? 50 }));
        const side = (arr) => (arr ?? []).map(([price, qty]) => ({ price: num(price), qty: num(qty) }));
        return { symbol, lastUpdateId: j.lastUpdateId, bids: side(j.bids), asks: side(j.asks) };
      },
    },
    {
      slug: "trades",
      displayName: "Recent Trades",
      description: "Most recent trades for a symbol.",
      method: "GET",
      cacheTtl: 5,
      fields: [symField, count(100, 1000)],
      handler: async (p, ctx) => {
        const symbol = bnSym(p.symbol);
        const j = await getJson(ctx, url(`${BN}/trades`, { symbol, limit: p.count ?? 100 }));
        const trades = (j ?? []).map((t) => ({
          id: t.id,
          price: num(t.price),
          qty: num(t.qty),
          quoteQty: num(t.quoteQty),
          time: iso(t.time),
          isBuyerMaker: t.isBuyerMaker,
        }));
        return { symbol, count: trades.length, trades };
      },
    },
    {
      slug: "agg-trades",
      displayName: "Aggregate Trades",
      description: "Compressed trades that filled at the same price and time.",
      method: "GET",
      cacheTtl: 5,
      fields: [symField, count(500, 1000), f.str("startTime"), f.str("endTime"), f.str("fromId")],
      handler: async (p, ctx) => {
        const symbol = bnSym(p.symbol);
        const j = await getJson(
          ctx,
          url(`${BN}/aggTrades`, { symbol, limit: p.count ?? 500, startTime: toMs(p.startTime), endTime: toMs(p.endTime), fromId: p.fromId }),
        );
        const trades = (j ?? []).map((t) => ({
          aggId: t.a,
          price: num(t.p),
          qty: num(t.q),
          firstTradeId: t.f,
          lastTradeId: t.l,
          time: iso(t.T),
          isBuyerMaker: t.m,
        }));
        return { symbol, count: trades.length, trades };
      },
    },
    {
      slug: "avg-price",
      displayName: "Average Price",
      description: "Current average price over Binance's short rolling window.",
      method: "GET",
      cacheTtl: 10,
      fields: [symField],
      handler: async (p, ctx) => {
        const symbol = bnSym(p.symbol);
        const j = await getJson(ctx, url(`${BN}/avgPrice`, { symbol }));
        return { symbol, minutes: j.mins, price: num(j.price), closeTime: iso(j.closeTime) };
      },
    },
    {
      slug: "book-ticker",
      displayName: "Book Ticker",
      description: "Best bid and ask for a symbol.",
      method: "GET",
      cacheTtl: 5,
      fields: [symField],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, url(`${BN}/ticker/bookTicker`, { symbol: bnSym(p.symbol) }));
        return { symbol: j.symbol, bidPrice: num(j.bidPrice), bidQty: num(j.bidQty), askPrice: num(j.askPrice), askQty: num(j.askQty) };
      },
    },
    {
      slug: "ticker-windowed",
      displayName: "Rolling Window Ticker",
      description: "Price change statistics over a custom rolling window (1m–59m, 1h–23h, 1d–7d).",
      method: "GET",
      cacheTtl: 15,
      fields: [symField, f.str("windowSize", { default: "1d", pattern: "^\\d+[mhd]$", example: "4h" })],
      handler: async (p, ctx) => bnTicker(await getJson(ctx, url(`${BN}/ticker`, { symbol: bnSym(p.symbol), windowSize: p.windowSize ?? "1d" }))),
    },
    {
      slug: "exchange-info",
      displayName: "Exchange Info",
      description: "Trading rules and status for listed symbols.",
      method: "GET",
      cacheTtl: 3600,
      fields: [
        f.str("symbol"),
        f.str("symbols", { description: "Comma-separated symbols" }),
        f.enm("quote", BN_QUOTES, { default: "USDT" }),
        f.str("search"),
        f.enm("status", ["all", "trading"], { default: "trading" }),
        count(100, 5000),
      ],
      handler: async (p, ctx) => {
        const list = p.symbols ? String(p.symbols).split(",").map(bnSym).filter(Boolean) : null;
        const j = await getJson(
          ctx,
          url(`${BN}/exchangeInfo`, { symbol: p.symbol && !list ? bnSym(p.symbol) : undefined, symbols: list ? JSON.stringify(list) : undefined }),
        );
        const single = Boolean(p.symbol || list);
        let rows = (j.symbols ?? []).filter(
          (s) =>
            (single || bnQuoteOk(s.symbol, p.quote)) &&
            (!p.search || s.symbol.includes(bnSym(p.search))) &&
            ((p.status ?? "trading") === "all" || s.status === "TRADING"),
        );
        const total = rows.length;
        rows = rows.slice(0, p.count ?? 100).map((s) => ({
          symbol: s.symbol,
          status: s.status,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          baseAssetPrecision: s.baseAssetPrecision,
          quoteAssetPrecision: s.quoteAssetPrecision ?? s.quotePrecision,
          orderTypes: s.orderTypes,
          isSpotTradingAllowed: s.isSpotTradingAllowed,
          filters: s.filters,
        }));
        return { timezone: j.timezone, serverTime: iso(j.serverTime), total, count: rows.length, symbols: rows };
      },
    },
    {
      slug: "time",
      displayName: "Server Time",
      description: "Binance server time.",
      method: "GET",
      cacheTtl: 0,
      fields: [],
      handler: async (_p, ctx) => {
        const j = await getJson(ctx, `${BN}/time`);
        return { serverTime: j.serverTime, iso: iso(j.serverTime) };
      },
    },
  ],
};

// ======================================================================
// Indodax (public API)
// ======================================================================
const IDX = "https://indodax.com";
const idxPair = (s) => lc(s).replace(/[^a-z0-9]/g, "");
const idxQuoteOk = (pairId, quote) => !quote || quote === "all" || pairId.endsWith(quote);

function idxTicker(pair, t) {
  const vol = Object.fromEntries(Object.entries(t).filter(([k]) => k.startsWith("vol_")).map(([k, v]) => [k.slice(4), num(v)]));
  return {
    pair,
    last: num(t.last),
    buy: num(t.buy),
    sell: num(t.sell),
    high: num(t.high),
    low: num(t.low),
    volume: vol,
    serverTime: t.server_time ? iso(Number(t.server_time) * 1000) : null,
  };
}

const indodax = {
  category: "finance",
  slug: "indodax",
  displayName: "Indodax",
  description: "Harga, order book dan transaksi kripto dari bursa Indonesia Indodax (public API).",
  tags: ["crypto", "indonesia", "idr", "exchange", "orderbook"],
  indonesian: true,
  endpoints: [
    {
      slug: "ticker",
      displayName: "Ticker",
      description: "Last price, bid/ask and 24h volume for one pair.",
      method: "GET",
      cacheTtl: 10,
      bulkEnabled: true,
      fields: [f.req("pair", { example: "btcidr", description: "Pair id, e.g. btcidr or btc_idr" })],
      handler: async (p, ctx) => {
        const pair = idxPair(p.pair);
        const j = await getJson(ctx, `${IDX}/api/ticker/${pair}`);
        if (!j?.ticker) throw new ScraperError(j?.error_description ?? `Unknown pair ${p.pair}`);
        return idxTicker(pair, j.ticker);
      },
    },
    {
      slug: "tickers",
      displayName: "All Tickers",
      description: "Tickers for every pair, filterable by quote currency.",
      method: "GET",
      cacheTtl: 15,
      fields: [f.enm("quote", ["all", "idr", "usdt"], { default: "all" }), f.str("search")],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, `${IDX}/api/ticker_all`);
        const rows = Object.entries(j?.tickers ?? {})
          .map(([k, t]) => idxTicker(idxPair(k), t))
          .filter((t) => idxQuoteOk(t.pair, p.quote) && (!p.search || t.pair.includes(idxPair(p.search))));
        return { count: rows.length, tickers: rows };
      },
    },
    {
      slug: "depth",
      displayName: "Order Book",
      description: "Buy and sell orders for a pair.",
      method: "GET",
      cacheTtl: 5,
      fields: [f.req("pair", { example: "btcidr" }), f.int("limit", { min: 1, max: 1000 })],
      handler: async (p, ctx) => {
        const pair = idxPair(p.pair);
        const j = await getJson(ctx, `${IDX}/api/depth/${pair}`);
        if (!j || (!j.buy && !j.sell)) throw new ScraperError(j?.error_description ?? `Unknown pair ${p.pair}`);
        const side = (a) => (a ?? []).slice(0, p.limit ?? Infinity).map(([price, amount]) => ({ price: num(price), amount: num(amount) }));
        return { pair, bids: side(j.buy), asks: side(j.sell) };
      },
    },
    {
      slug: "trades",
      displayName: "Trades",
      description: "Recent executed trades for a pair.",
      method: "GET",
      cacheTtl: 5,
      fields: [f.req("pair", { example: "btcidr" }), f.int("limit", { default: 50, min: 1, max: 1000 })],
      handler: async (p, ctx) => {
        const pair = idxPair(p.pair);
        const j = await getJson(ctx, `${IDX}/api/trades/${pair}`);
        if (!Array.isArray(j)) throw new ScraperError(j?.error_description ?? `Unknown pair ${p.pair}`);
        const trades = j.slice(0, p.limit ?? 50).map((t) => ({
          id: t.tid,
          time: t.date ? iso(Number(t.date) * 1000) : null,
          price: num(t.price),
          amount: num(t.amount),
          type: t.type,
        }));
        return { pair, count: trades.length, trades };
      },
    },
    {
      slug: "pairs",
      displayName: "Pairs",
      description: "All tradable pairs with their base/quote currencies.",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.enm("quote", ["all", "idr", "usdt"], { default: "all" }), f.str("search")],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, `${IDX}/api/pairs`);
        const pairs = (j ?? [])
          .filter((x) => (!p.quote || p.quote === "all" || lc(x.base_currency) === p.quote) && (!p.search || lc(x.id).includes(idxPair(p.search)) || lc(x.description).includes(lc(p.search))))
          .map((x) => ({
            id: x.id,
            symbol: x.symbol,
            tickerId: x.ticker_id,
            description: x.description,
            asset: x.traded_currency,
            quote: x.base_currency,
            assetUnit: x.traded_currency_unit,
            minTradeQuote: num(x.trade_min_base_currency),
            minTradeAsset: num(x.trade_min_traded_currency),
            pricePrecision: x.price_precision ?? null,
            logo: x.url_logo_png ?? x.url_logo ?? null,
          }));
        return { count: pairs.length, pairs };
      },
    },
    {
      slug: "klines",
      displayName: "Klines",
      description: "OHLCV candles from Indodax's TradingView history feed.",
      method: "GET",
      cacheTtl: 30,
      fields: [
        f.req("pair", { example: "btcidr" }),
        f.str("tf", { default: "15", description: "Timeframe: 1, 15, 30, 60, 240, 1D, 3D, 1W" }),
        f.str("from", { description: "Epoch seconds/ms or ISO date (default: 24h ago)" }),
        f.str("to", { description: "Epoch seconds/ms or ISO date (default: now)" }),
        f.int("limit", { min: 1, max: 5000 }),
      ],
      handler: async (p, ctx) => {
        const symbol = idxPair(p.pair).toUpperCase();
        const to = toSec(p.to) ?? Math.floor(Date.now() / 1000);
        const from = toSec(p.from) ?? to - 86400;
        const j = await getJson(ctx, url(`${IDX}/tradingview/history_v2`, { symbol, tf: p.tf ?? "15", from, to }));
        if (!Array.isArray(j)) throw new ScraperError("Unexpected kline response", { context: { body: JSON.stringify(j).slice(0, 200) } });
        let candles = j.map((c) => ({
          time: iso(Number(c.Time) * 1000),
          open: num(c.Open),
          high: num(c.High),
          low: num(c.Low),
          close: num(c.Close),
          volume: num(c.Volume),
        }));
        if (p.limit) candles = candles.slice(-p.limit);
        return { pair: lc(symbol), tf: p.tf ?? "15", count: candles.length, candles };
      },
    },
  ],
};

// ======================================================================
// OKX v5 public endpoints
// ======================================================================
const OKX = "https://www.okx.com/api/v5";
const OKX_BARS = ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D", "2D", "3D", "1W", "1M", "3M", "6Hutc", "12Hutc", "1Dutc", "2Dutc", "3Dutc", "1Wutc", "1Mutc", "3Mutc"];
const okxInst = f.req("symbol", { example: "BTC-USDT-SWAP", description: "OKX instrument id (instId)" });

async function okx(ctx, path, params) {
  const j = await getJson(ctx, url(`${OKX}${path}`, params));
  if (j?.code !== "0" && j?.code !== 0) throw new ScraperError(`OKX error ${j?.code}: ${j?.msg || "unknown"}`, { context: { path } });
  return j.data ?? [];
}
const okxCandle = (c) => ({
  time: iso(c[0]),
  open: num(c[1]),
  high: num(c[2]),
  low: num(c[3]),
  close: num(c[4]),
  volume: num(c[5]),
  volumeCcy: num(c[6]),
  volumeQuote: num(c[7]),
  confirmed: c[8] === undefined ? null : c[8] === "1",
});
const okxTicker = (t) => ({
  instId: t.instId,
  instType: t.instType,
  last: num(t.last),
  lastSz: num(t.lastSz),
  bidPx: num(t.bidPx),
  askPx: num(t.askPx),
  open24h: num(t.open24h),
  high24h: num(t.high24h),
  low24h: num(t.low24h),
  vol24h: num(t.vol24h),
  volCcy24h: num(t.volCcy24h),
  changePct24h: num(t.last) && num(t.open24h) ? ((num(t.last) - num(t.open24h)) / num(t.open24h)) * 100 : null,
  time: iso(t.ts),
});
const rubikFields = (extra = []) => [
  f.str("currency", { default: "BTC" }),
  ...extra,
  f.enm("period", ["5m", "1H", "1D"], { default: "5m" }),
  f.str("start", { description: "Epoch ms or ISO date" }),
  f.str("end", { description: "Epoch ms or ISO date" }),
];

function okxCandles(slug, path, displayName, description) {
  return {
    slug,
    displayName,
    description,
    method: "GET",
    cacheTtl: 30,
    fields: [
      okxInst,
      f.enm("bar", OKX_BARS, { default: "5m" }),
      f.str("end", { description: "Return candles older than this time (epoch ms or ISO)" }),
      count(100, slug === "candles" ? 300 : 100, "Number of candles"),
      f.int("page", { default: 1, min: 1, max: 1 }),
    ],
    handler: async (p, ctx) => {
      const d = await okx(ctx, path, { instId: p.symbol, bar: p.bar ?? "5m", after: toMs(p.end), limit: p.count ?? 100 });
      const candles = d.map(okxCandle);
      return { instId: p.symbol, bar: p.bar ?? "5m", count: candles.length, candles };
    },
  };
}

const okxEx = {
  category: "finance",
  slug: "okx",
  displayName: "OKX",
  description: "OKX v5 public market data: tickers, candles, order books, funding, open interest and trading statistics.",
  tags: ["okx", "crypto", "derivatives", "funding", "open-interest", "candles"],
  endpoints: [
    {
      slug: "ticker",
      displayName: "Ticker",
      description: "Latest price and 24h stats for one instrument.",
      method: "GET",
      cacheTtl: 10,
      bulkEnabled: true,
      fields: [okxInst],
      handler: async (p, ctx) => {
        const d = await okx(ctx, "/market/ticker", { instId: p.symbol });
        if (!d[0]) throw new ScraperError(`No ticker for ${p.symbol}`);
        return okxTicker(d[0]);
      },
    },
    {
      slug: "tickers",
      displayName: "Tickers",
      description: "Tickers for every instrument of a type.",
      method: "GET",
      cacheTtl: 15,
      fields: [f.enm("instType", ["SPOT", "MARGIN", "SWAP", "FUTURES", "OPTION"], { default: "SWAP" }), f.str("instFamily"), f.str("uly")],
      handler: async (p, ctx) => {
        const d = await okx(ctx, "/market/tickers", { instType: p.instType ?? "SWAP", instFamily: p.instFamily, uly: p.uly });
        return { instType: p.instType ?? "SWAP", count: d.length, tickers: d.map(okxTicker) };
      },
    },
    {
      slug: "books",
      displayName: "Order Book",
      description: "Bids and asks for one instrument.",
      method: "GET",
      cacheTtl: 5,
      fields: [okxInst, count(20, 400, "Depth per side")],
      handler: async (p, ctx) => {
        const d = (await okx(ctx, "/market/books", { instId: p.symbol, sz: p.count ?? 20 }))[0] ?? {};
        const side = (a) => (a ?? []).map((r) => ({ price: num(r[0]), size: num(r[1]), orders: num(r[3]) }));
        return { instId: p.symbol, time: iso(d.ts), bids: side(d.bids), asks: side(d.asks) };
      },
    },
    okxCandles("candles", "/market/candles", "Candles", "Recent OHLCV candles for an instrument."),
    okxCandles("history-candles", "/market/history-candles", "History Candles", "Older OHLCV candles going back years."),
    {
      slug: "trades",
      displayName: "Trades",
      description: "Most recent trades for an instrument.",
      method: "GET",
      cacheTtl: 5,
      fields: [okxInst, count(100, 500)],
      handler: async (p, ctx) => {
        const d = await okx(ctx, "/market/trades", { instId: p.symbol, limit: p.count ?? 100 });
        const trades = d.map((t) => ({ tradeId: t.tradeId, price: num(t.px), size: num(t.sz), side: t.side, time: iso(t.ts) }));
        return { instId: p.symbol, count: trades.length, trades };
      },
    },
    {
      slug: "funding-rate",
      displayName: "Funding Rate",
      description: "Current and next funding rate of a perpetual swap.",
      method: "GET",
      cacheTtl: 30,
      fields: [okxInst],
      handler: async (p, ctx) => {
        const r = (await okx(ctx, "/public/funding-rate", { instId: p.symbol }))[0];
        if (!r) throw new ScraperError(`No funding rate for ${p.symbol}`);
        return {
          instId: r.instId,
          fundingRate: num(r.fundingRate),
          nextFundingRate: num(r.nextFundingRate),
          fundingTime: iso(r.fundingTime),
          nextFundingTime: iso(r.nextFundingTime),
          minFundingRate: num(r.minFundingRate),
          maxFundingRate: num(r.maxFundingRate),
        };
      },
    },
    {
      slug: "funding-rate-history",
      displayName: "Funding Rate History",
      description: "Past funding rates of a perpetual swap.",
      method: "GET",
      cacheTtl: 300,
      fields: [okxInst, f.str("end", { description: "Older than this time" }), count(100, 400), f.int("page", { default: 1, min: 1, max: 1 })],
      handler: async (p, ctx) => {
        const d = await okx(ctx, "/public/funding-rate-history", { instId: p.symbol, after: toMs(p.end), limit: p.count ?? 100 });
        const history = d.map((r) => ({ fundingRate: num(r.fundingRate), realizedRate: num(r.realizedRate), fundingTime: iso(r.fundingTime) }));
        return { instId: p.symbol, count: history.length, history };
      },
    },
    {
      slug: "instruments",
      displayName: "Instruments",
      description: "Instrument specifications (tick size, lot size, contract value…).",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.enm("instType", ["SPOT", "MARGIN", "SWAP", "FUTURES", "OPTION"], { default: "SWAP" }), f.str("symbol"), f.str("instFamily"), f.str("uly")],
      handler: async (p, ctx) => {
        const d = await okx(ctx, "/public/instruments", { instType: p.instType ?? "SWAP", instId: p.symbol, instFamily: p.instFamily, uly: p.uly });
        const instruments = d.map((i) => ({
          instId: i.instId,
          instType: i.instType,
          instFamily: i.instFamily || null,
          baseCcy: i.baseCcy || null,
          quoteCcy: i.quoteCcy || null,
          settleCcy: i.settleCcy || null,
          ctVal: num(i.ctVal),
          ctValCcy: i.ctValCcy || null,
          tickSz: num(i.tickSz),
          lotSz: num(i.lotSz),
          minSz: num(i.minSz),
          maxLever: num(i.lever),
          state: i.state,
          listTime: iso(i.listTime),
          expTime: i.expTime ? iso(i.expTime) : null,
        }));
        return { count: instruments.length, instruments };
      },
    },
    {
      slug: "mark-price",
      displayName: "Mark Price",
      description: "Mark prices used for margin and liquidation.",
      method: "GET",
      cacheTtl: 10,
      fields: [f.enm("instType", ["MARGIN", "SWAP", "FUTURES", "OPTION"], { default: "SWAP" }), f.str("symbol"), f.str("instFamily")],
      handler: async (p, ctx) => {
        const d = await okx(ctx, "/public/mark-price", { instType: p.instType ?? "SWAP", instId: p.symbol, instFamily: p.instFamily });
        const prices = d.map((r) => ({ instId: r.instId, instType: r.instType, markPx: num(r.markPx), time: iso(r.ts) }));
        return { count: prices.length, prices };
      },
    },
    {
      slug: "open-interest",
      displayName: "Open Interest",
      description: "Open interest per derivative instrument.",
      method: "GET",
      cacheTtl: 30,
      fields: [f.enm("instType", ["SWAP", "FUTURES", "OPTION"], { default: "SWAP" }), f.str("symbol"), f.str("instFamily")],
      handler: async (p, ctx) => {
        const d = await okx(ctx, "/public/open-interest", { instType: p.instType ?? "SWAP", instId: p.symbol, instFamily: p.instFamily });
        const rows = d.map((r) => ({ instId: r.instId, instType: r.instType, oi: num(r.oi), oiCcy: num(r.oiCcy), oiUsd: num(r.oiUsd), time: iso(r.ts) }));
        return { count: rows.length, openInterest: rows };
      },
    },
    {
      slug: "price-limit",
      displayName: "Price Limit",
      description: "Highest buy and lowest sell price currently allowed.",
      method: "GET",
      cacheTtl: 10,
      fields: [okxInst],
      handler: async (p, ctx) => {
        const r = (await okx(ctx, "/public/price-limit", { instId: p.symbol }))[0];
        if (!r) throw new ScraperError(`No price limit for ${p.symbol}`);
        return { instId: r.instId, buyLimit: num(r.buyLmt), sellLimit: num(r.sellLmt), time: iso(r.ts) };
      },
    },
    {
      slug: "long-short-ratio",
      displayName: "Long/Short Account Ratio",
      description: "Ratio of accounts net long vs net short on contracts.",
      method: "GET",
      cacheTtl: 300,
      fields: rubikFields(),
      handler: async (p, ctx) => {
        const d = await okx(ctx, "/rubik/stat/contracts/long-short-account-ratio", { ccy: p.currency ?? "BTC", period: p.period ?? "5m", begin: toMs(p.start), end: toMs(p.end) });
        const rows = d.map((r) => ({ time: iso(r[0]), ratio: num(r[1]) }));
        return { currency: p.currency ?? "BTC", period: p.period ?? "5m", count: rows.length, data: rows };
      },
    },
    {
      slug: "open-interest-volume",
      displayName: "Open Interest & Volume",
      description: "Aggregate contract open interest and trading volume over time.",
      method: "GET",
      cacheTtl: 300,
      fields: rubikFields(),
      handler: async (p, ctx) => {
        const d = await okx(ctx, "/rubik/stat/contracts/open-interest-volume", { ccy: p.currency ?? "BTC", period: p.period ?? "5m", begin: toMs(p.start), end: toMs(p.end) });
        const rows = d.map((r) => ({ time: iso(r[0]), openInterestUsd: num(r[1]), volumeUsd: num(r[2]) }));
        return { currency: p.currency ?? "BTC", period: p.period ?? "5m", count: rows.length, data: rows };
      },
    },
    {
      slug: "taker-volume",
      displayName: "Taker Volume",
      description: "Taker buy vs sell volume over time.",
      method: "GET",
      cacheTtl: 300,
      fields: rubikFields([f.enm("instType", ["SPOT", "CONTRACTS"], { default: "CONTRACTS" })]),
      handler: async (p, ctx) => {
        const d = await okx(ctx, "/rubik/stat/taker-volume", { ccy: p.currency ?? "BTC", instType: p.instType ?? "CONTRACTS", period: p.period ?? "5m", begin: toMs(p.start), end: toMs(p.end) });
        const rows = d.map((r) => ({ time: iso(r[0]), sellVolume: num(r[1]), buyVolume: num(r[2]) }));
        return { currency: p.currency ?? "BTC", instType: p.instType ?? "CONTRACTS", period: p.period ?? "5m", count: rows.length, data: rows };
      },
    },
  ],
};

// ======================================================================
// Bybit v5 market endpoints
// ======================================================================
const BY = "https://api.bybit.com/v5/market";
const BY_INTERVALS = ["1", "3", "5", "15", "30", "60", "120", "240", "360", "720", "D", "W", "M"];
const BY_PERIODS = ["5min", "15min", "30min", "1h", "4h", "1d"];
const bySym = f.req("symbol", { example: "BTCUSDT" });
const byCat = (values = ["linear", "inverse"]) => f.enm("category", values, { default: "linear" });
const byRange = [f.str("start", { description: "Epoch ms or ISO date" }), f.str("end", { description: "Epoch ms or ISO date" })];

async function bybit(ctx, path, params) {
  const j = await getJson(ctx, url(`${BY}${path}`, params));
  if (j?.retCode !== 0) throw new ScraperError(`Bybit error ${j?.retCode}: ${j?.retMsg || "unknown"}`, { context: { path } });
  return j.result ?? {};
}

function byKline(slug, path, displayName, description, cats, full) {
  return {
    slug,
    displayName,
    description,
    method: "GET",
    cacheTtl: 30,
    fields: [bySym, byCat(cats), f.enm("interval", BY_INTERVALS, { default: "5" }), ...byRange, count(200, 1000, "Number of candles"), f.int("page", { default: 1, min: 1, max: 1 })],
    handler: async (p, ctx) => {
      const r = await bybit(ctx, path, { category: p.category ?? "linear", symbol: bnSym(p.symbol), interval: p.interval ?? "5", start: toMs(p.start), end: toMs(p.end), limit: p.count ?? 200 });
      const candles = (r.list ?? []).map((k) => ({
        time: iso(k[0]),
        open: num(k[1]),
        high: num(k[2]),
        low: num(k[3]),
        close: num(k[4]),
        ...(full ? { volume: num(k[5]), turnover: num(k[6]) } : {}),
      }));
      return { symbol: r.symbol ?? bnSym(p.symbol), category: r.category ?? p.category ?? "linear", interval: p.interval ?? "5", count: candles.length, candles };
    },
  };
}

const bybitEx = {
  category: "finance",
  slug: "bybit",
  displayName: "Bybit",
  description: "Bybit v5 public market data: candles, tickers, order book, funding, open interest and long/short ratio.",
  tags: ["bybit", "crypto", "derivatives", "open-interest", "funding", "klines"],
  endpoints: [
    byKline("kline", "/kline", "Kline", "OHLCV candles (newest first).", ["linear", "inverse", "spot"], true),
    byKline("mark-price-kline", "/mark-price-kline", "Mark Price Kline", "Mark price candles.", ["linear", "inverse"], false),
    byKline("index-price-kline", "/index-price-kline", "Index Price Kline", "Index price candles.", ["linear", "inverse"], false),
    byKline("premium-index-kline", "/premium-index-price-kline", "Premium Index Kline", "Premium index candles for perpetuals.", ["linear"], false),
    {
      slug: "tickers",
      displayName: "Tickers",
      description: "Latest price, 24h stats, funding and open interest.",
      method: "GET",
      cacheTtl: 10,
      fields: [byCat(["linear", "inverse", "spot", "option"]), f.str("symbol"), f.str("baseCoin"), f.str("expDate")],
      handler: async (p, ctx) => {
        const r = await bybit(ctx, "/tickers", { category: p.category ?? "linear", symbol: p.symbol ? bnSym(p.symbol) : undefined, baseCoin: p.baseCoin, expDate: p.expDate });
        const tickers = (r.list ?? []).map((t) => ({
          symbol: t.symbol,
          lastPrice: num(t.lastPrice),
          markPrice: num(t.markPrice),
          indexPrice: num(t.indexPrice),
          prevPrice24h: num(t.prevPrice24h),
          changePct24h: t.price24hPcnt === undefined ? null : num(t.price24hPcnt) * 100,
          high24h: num(t.highPrice24h),
          low24h: num(t.lowPrice24h),
          volume24h: num(t.volume24h),
          turnover24h: num(t.turnover24h),
          openInterest: num(t.openInterest),
          openInterestValue: num(t.openInterestValue),
          fundingRate: num(t.fundingRate),
          nextFundingTime: t.nextFundingTime ? iso(t.nextFundingTime) : null,
          bid1Price: num(t.bid1Price),
          ask1Price: num(t.ask1Price),
        }));
        return { category: r.category ?? p.category ?? "linear", count: tickers.length, tickers };
      },
    },
    {
      slug: "orderbook",
      displayName: "Orderbook",
      description: "Bids and asks for a symbol.",
      method: "GET",
      cacheTtl: 5,
      fields: [bySym, byCat(["linear", "inverse", "spot", "option"]), count(50, 1000, "Depth per side")],
      handler: async (p, ctx) => {
        const r = await bybit(ctx, "/orderbook", { category: p.category ?? "linear", symbol: bnSym(p.symbol), limit: p.count ?? 50 });
        const side = (a) => (a ?? []).map(([price, size]) => ({ price: num(price), size: num(size) }));
        return { symbol: r.s, time: iso(r.ts), updateId: r.u, bids: side(r.b), asks: side(r.a) };
      },
    },
    {
      slug: "recent-trade",
      displayName: "Recent Trade",
      description: "Most recent public trades.",
      method: "GET",
      cacheTtl: 5,
      fields: [bySym, byCat(["linear", "inverse", "spot", "option"]), f.str("baseCoin"), count(100, 1000)],
      handler: async (p, ctx) => {
        const r = await bybit(ctx, "/recent-trade", { category: p.category ?? "linear", symbol: bnSym(p.symbol), baseCoin: p.baseCoin, limit: p.count ?? 100 });
        const trades = (r.list ?? []).map((t) => ({ id: t.execId, symbol: t.symbol, price: num(t.price), size: num(t.size), side: t.side, time: iso(t.time), isBlockTrade: t.isBlockTrade }));
        return { count: trades.length, trades };
      },
    },
    {
      slug: "instruments-info",
      displayName: "Instruments Info",
      description: "Contract and spot instrument specifications.",
      method: "GET",
      cacheTtl: 3600,
      fields: [
        byCat(["linear", "inverse", "spot", "option"]),
        f.str("symbol"),
        f.str("baseCoin"),
        f.enm("status", ["Trading", "PreLaunch", "Delivering", "Closed"]),
        count(500, 1000),
        f.int("page", { default: 1, min: 1, max: 1 }),
      ],
      handler: async (p, ctx) => {
        const r = await bybit(ctx, "/instruments-info", { category: p.category ?? "linear", symbol: p.symbol ? bnSym(p.symbol) : undefined, baseCoin: p.baseCoin, status: p.status, limit: p.count ?? 500 });
        const instruments = (r.list ?? []).map((i) => ({
          symbol: i.symbol,
          status: i.status,
          baseCoin: i.baseCoin,
          quoteCoin: i.quoteCoin,
          settleCoin: i.settleCoin ?? null,
          contractType: i.contractType ?? null,
          launchTime: i.launchTime ? iso(i.launchTime) : null,
          tickSize: num(i.priceFilter?.tickSize),
          qtyStep: num(i.lotSizeFilter?.qtyStep ?? i.lotSizeFilter?.basePrecision),
          minOrderQty: num(i.lotSizeFilter?.minOrderQty),
          maxLeverage: num(i.leverageFilter?.maxLeverage),
          fundingInterval: i.fundingInterval ?? null,
        }));
        return { category: r.category ?? p.category ?? "linear", count: instruments.length, nextCursor: r.nextPageCursor || null, instruments };
      },
    },
    {
      slug: "funding-history",
      displayName: "Funding History",
      description: "Historical funding rates of a perpetual contract.",
      method: "GET",
      cacheTtl: 300,
      fields: [bySym, byCat(), ...byRange, count(200, 200), f.int("page", { default: 1, min: 1, max: 1 })],
      handler: async (p, ctx) => {
        const r = await bybit(ctx, "/funding/history", { category: p.category ?? "linear", symbol: bnSym(p.symbol), startTime: toMs(p.start), endTime: toMs(p.end), limit: p.count ?? 200 });
        const history = (r.list ?? []).map((x) => ({ symbol: x.symbol, fundingRate: num(x.fundingRate), time: iso(x.fundingRateTimestamp) }));
        return { count: history.length, history };
      },
    },
    {
      slug: "open-interest",
      displayName: "Open Interest",
      description: "Open interest history of a contract.",
      method: "GET",
      cacheTtl: 120,
      fields: [bySym, byCat(), f.enm("intervalTime", BY_PERIODS, { default: "5min" }), ...byRange, count(200, 200), f.int("page", { default: 1, min: 1, max: 1 })],
      handler: async (p, ctx) => {
        const r = await bybit(ctx, "/open-interest", {
          category: p.category ?? "linear",
          symbol: bnSym(p.symbol),
          intervalTime: p.intervalTime ?? "5min",
          startTime: toMs(p.start),
          endTime: toMs(p.end),
          limit: p.count ?? 200,
        });
        const data = (r.list ?? []).map((x) => ({ openInterest: num(x.openInterest), time: iso(x.timestamp) }));
        return { symbol: r.symbol ?? bnSym(p.symbol), count: data.length, nextCursor: r.nextPageCursor || null, data };
      },
    },
    {
      slug: "account-ratio",
      displayName: "Long/Short Ratio",
      description: "Share of accounts holding long vs short positions.",
      method: "GET",
      cacheTtl: 300,
      fields: [bySym, byCat(), f.enm("period", BY_PERIODS, { default: "5min" }), ...byRange, count(200, 500), f.int("page", { default: 1, min: 1, max: 1 })],
      handler: async (p, ctx) => {
        const r = await bybit(ctx, "/account-ratio", {
          category: p.category ?? "linear",
          symbol: bnSym(p.symbol),
          period: p.period ?? "5min",
          startTime: toMs(p.start),
          endTime: toMs(p.end),
          limit: p.count ?? 200,
        });
        const data = (r.list ?? []).map((x) => ({ buyRatio: num(x.buyRatio), sellRatio: num(x.sellRatio), time: iso(x.timestamp) }));
        return { symbol: bnSym(p.symbol), period: p.period ?? "5min", count: data.length, data };
      },
    },
  ],
};

// ======================================================================
// mempool.space
// ======================================================================
const MP = "https://mempool.space/api";
const mempool = {
  category: "finance",
  slug: "mempool-space",
  displayName: "Mempool.space",
  description: "Bitcoin network fees, mempool backlog, latest blocks and difficulty adjustment from mempool.space.",
  tags: ["bitcoin", "fees", "mempool", "blocks", "crypto"],
  endpoints: [
    {
      slug: "fees",
      displayName: "Recommended Fees",
      description: "Suggested fee rates (sat/vB) for different confirmation targets.",
      method: "GET",
      cacheTtl: 30,
      fields: [],
      handler: async (_p, ctx) => {
        const j = await getJson(ctx, `${MP}/v1/fees/recommended`);
        return { unit: "sat/vB", fastest: j.fastestFee, halfHour: j.halfHourFee, hour: j.hourFee, economy: j.economyFee, minimum: j.minimumFee };
      },
    },
    {
      slug: "blocks",
      displayName: "Blocks",
      description: "The 15 most recent blocks, or 15 blocks ending at a given height.",
      method: "GET",
      cacheTtl: 60,
      fields: [f.int("height", { min: 0 })],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, p.height === undefined || p.height === null ? `${MP}/v1/blocks` : `${MP}/v1/blocks/${p.height}`);
        const blocks = (j ?? []).map((b) => ({
          id: b.id,
          height: b.height,
          time: b.timestamp ? iso(b.timestamp * 1000) : null,
          txCount: b.tx_count,
          size: b.size,
          weight: b.weight,
          difficulty: b.difficulty,
          medianFee: b.extras?.medianFee ?? null,
          totalFees: b.extras?.totalFees ?? null,
          reward: b.extras?.reward ?? null,
          pool: b.extras?.pool?.name ?? null,
        }));
        return { count: blocks.length, blocks };
      },
    },
    {
      slug: "mempool",
      displayName: "Mempool",
      description: "Current mempool backlog: transaction count, virtual size and total fees.",
      method: "GET",
      cacheTtl: 30,
      fields: [],
      handler: async (_p, ctx) => {
        const j = await getJson(ctx, `${MP}/mempool`);
        return { count: j.count, vsize: j.vsize, totalFee: j.total_fee, feeHistogram: (j.fee_histogram ?? []).map(([feeRate, vsize]) => ({ feeRate, vsize })) };
      },
    },
    {
      slug: "difficulty-adjustment",
      displayName: "Difficulty Adjustment",
      description: "Progress toward and estimate of the next difficulty retarget.",
      method: "GET",
      cacheTtl: 120,
      fields: [],
      handler: async (_p, ctx) => {
        const j = await getJson(ctx, `${MP}/v1/difficulty-adjustment`);
        return {
          progressPercent: j.progressPercent,
          difficultyChange: j.difficultyChange,
          estimatedRetargetDate: iso(j.estimatedRetargetDate),
          remainingBlocks: j.remainingBlocks,
          remainingTimeMs: j.remainingTime,
          previousRetarget: j.previousRetarget,
          nextRetargetHeight: j.nextRetargetHeight,
          avgBlockTimeMs: j.timeAvg,
        };
      },
    },
    {
      slug: "fee-projection",
      displayName: "Projected Blocks",
      description: "Projected next blocks built from the current mempool, with fee ranges.",
      method: "GET",
      cacheTtl: 30,
      fields: [],
      handler: async (_p, ctx) => {
        const j = await getJson(ctx, `${MP}/v1/fees/mempool-blocks`);
        const blocks = (j ?? []).map((b, i) => ({ index: i, blockSize: b.blockSize, blockVSize: b.blockVSize, txCount: b.nTx, totalFees: b.totalFees, medianFee: b.medianFee, feeRange: b.feeRange }));
        return { count: blocks.length, blocks };
      },
    },
  ],
};

// ======================================================================
// DefiLlama
// ======================================================================
const LL = "https://api.llama.fi";
const LLS = "https://stablecoins.llama.fi";
const pegTotal = (o) => (o ? Object.values(o).reduce((a, b) => a + (Number(b) || 0), 0) : null);
const filterRange = (rows, from, to) => {
  const a = toSec(from);
  const b = toSec(to);
  return rows.filter((r) => (a === undefined || r.date >= a) && (b === undefined || r.date <= b));
};

const defillama = {
  category: "finance",
  slug: "defillama",
  displayName: "DefiLlama",
  description: "DeFi total value locked by chain and protocol, plus stablecoin supply data from DefiLlama.",
  tags: ["defi", "tvl", "stablecoin", "crypto", "finance"],
  endpoints: [
    {
      slug: "chains",
      displayName: "Chain TVL",
      description: "Current TVL of every chain, largest first.",
      method: "GET",
      cacheTtl: 600,
      fields: [f.int("length", { min: 1, max: 1000 }), f.num("minTvl", { min: 0 })],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, `${LL}/v2/chains`);
        let chains = (j ?? [])
          .map((c) => ({ name: c.name, tvl: c.tvl, tokenSymbol: c.tokenSymbol ?? null, geckoId: c.gecko_id ?? null, chainId: c.chainId ?? null }))
          .filter((c) => !p.minTvl || c.tvl >= p.minTvl)
          .sort((a, b) => b.tvl - a.tvl);
        if (p.length) chains = chains.slice(0, p.length);
        return { count: chains.length, chains };
      },
    },
    {
      slug: "protocols",
      displayName: "Protocols",
      description: "DeFi protocols with TVL and recent change, filterable by category or chain.",
      method: "GET",
      cacheTtl: 600,
      fields: [f.str("category", { example: "Dexs" }), f.str("chain", { example: "Ethereum" }), f.str("query"), f.num("minTvl", { min: 0 }), f.int("page", { default: 1, min: 1 }), f.int("limit", { default: 50, min: 1, max: 500 })],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, `${LL}/protocols`);
        let rows = (j ?? []).filter(
          (x) =>
            (!p.category || lc(x.category) === lc(p.category)) &&
            (!p.chain || (x.chains ?? []).some((c) => lc(c) === lc(p.chain))) &&
            (!p.query || lc(x.name).includes(lc(p.query)) || lc(x.slug).includes(lc(p.query))) &&
            (!p.minTvl || (x.tvl ?? 0) >= p.minTvl),
        );
        rows.sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0));
        const total = rows.length;
        const limit = p.limit ?? 50;
        const page = p.page ?? 1;
        const protocols = rows.slice((page - 1) * limit, page * limit).map((x) => ({
          name: x.name,
          slug: x.slug,
          symbol: x.symbol,
          category: x.category,
          chains: x.chains ?? [],
          tvl: x.tvl ?? null,
          chainTvl: p.chain ? x.chainTvls?.[Object.keys(x.chainTvls ?? {}).find((k) => lc(k) === lc(p.chain))] ?? null : undefined,
          change1d: x.change_1d ?? null,
          change7d: x.change_7d ?? null,
          mcap: x.mcap ?? null,
          url: x.url ?? null,
          logo: x.logo ?? null,
        }));
        return { total, page, count: protocols.length, protocols };
      },
    },
    {
      slug: "chain-tvl-history",
      displayName: "Chain TVL History",
      description: "Daily historical TVL for all chains combined or one chain.",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.str("chain", { example: "Ethereum" }), f.str("from", { description: "Unix seconds or ISO date" }), f.str("to"), f.int("limit", { min: 1, description: "Keep only the latest N points" })],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, p.chain ? `${LL}/v2/historicalChainTvl/${encodeURIComponent(p.chain)}` : `${LL}/v2/historicalChainTvl`);
        let rows = filterRange((j ?? []).map((r) => ({ date: Number(r.date), tvl: r.tvl })), p.from, p.to);
        if (p.limit) rows = rows.slice(-p.limit);
        return { chain: p.chain ?? "all", count: rows.length, points: rows.map((r) => ({ date: iso(r.date * 1000).slice(0, 10), timestamp: r.date, tvl: r.tvl })) };
      },
    },
    {
      slug: "stablecoins",
      displayName: "Stablecoins",
      description: "Stablecoins ranked by circulating supply.",
      method: "GET",
      cacheTtl: 600,
      fields: [f.int("length", { min: 1, max: 1000 }), f.str("peg", { example: "peggedUSD", description: "Peg type, e.g. peggedUSD, peggedEUR" })],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, url(`${LLS}/stablecoins`, { includePrices: "true" }));
        let rows = (j?.peggedAssets ?? [])
          .filter((s) => !p.peg || lc(s.pegType) === lc(p.peg))
          .map((s) => ({
            id: s.id,
            name: s.name,
            symbol: s.symbol,
            geckoId: s.gecko_id ?? null,
            pegType: s.pegType,
            pegMechanism: s.pegMechanism,
            circulating: pegTotal(s.circulating),
            circulatingPrevDay: pegTotal(s.circulatingPrevDay),
            price: num(s.price),
            chains: s.chains ?? [],
          }))
          .sort((a, b) => (b.circulating ?? 0) - (a.circulating ?? 0));
        if (p.length) rows = rows.slice(0, p.length);
        return { count: rows.length, stablecoins: rows };
      },
    },
    {
      slug: "stablecoin-chains",
      displayName: "Stablecoin Chains",
      description: "Stablecoin supply held on each chain.",
      method: "GET",
      cacheTtl: 600,
      fields: [f.str("peg", { example: "peggedUSD" }), f.int("limit", { min: 1, max: 1000 }), f.num("minCirculating", { min: 0 })],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, `${LLS}/stablecoinchains`);
        let rows = (j ?? [])
          .map((c) => ({
            name: c.name,
            tokenSymbol: c.tokenSymbol ?? null,
            geckoId: c.gecko_id ?? null,
            circulatingUsd: p.peg ? Number(c.totalCirculatingUSD?.[p.peg] ?? 0) : pegTotal(c.totalCirculatingUSD),
            byPeg: c.totalCirculatingUSD ?? {},
          }))
          .filter((c) => !p.minCirculating || c.circulatingUsd >= p.minCirculating)
          .sort((a, b) => b.circulatingUsd - a.circulatingUsd);
        if (p.limit) rows = rows.slice(0, p.limit);
        return { count: rows.length, chains: rows };
      },
    },
    {
      slug: "stablecoin-history",
      displayName: "Stablecoin History",
      description: "Daily total stablecoin market cap, overall or on one chain.",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.str("peg", { description: "Only sum this peg type, e.g. peggedUSD" }), f.str("chain", { example: "Ethereum" }), f.str("from"), f.str("to"), f.int("limit", { min: 1 })],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, p.chain ? `${LLS}/stablecoincharts/${encodeURIComponent(p.chain)}` : `${LLS}/stablecoincharts/all`);
        let rows = filterRange(
          (j ?? []).map((r) => ({
            date: Number(r.date),
            circulatingUsd: p.peg ? Number(r.totalCirculatingUSD?.[p.peg] ?? 0) : pegTotal(r.totalCirculatingUSD),
          })),
          p.from,
          p.to,
        );
        if (p.limit) rows = rows.slice(-p.limit);
        return { chain: p.chain ?? "all", peg: p.peg ?? "all", count: rows.length, points: rows.map((r) => ({ date: iso(r.date * 1000).slice(0, 10), timestamp: r.date, circulatingUsd: r.circulatingUsd })) };
      },
    },
  ],
};

// ======================================================================
// Blockchain.com (blockchain.info) charts & stats API
// ======================================================================
const BCI = "https://api.blockchain.info";
const BCI_CHARTS = [
  "mempool-size", "mempool-count", "mempool-growth", "transactions-per-second", "utxo-count", "avg-confirmation-time", "median-confirmation-time",
  "market-price", "market-cap", "trade-volume", "total-bitcoins", "avg-block-size", "blocks-size", "n-transactions", "n-transactions-total",
  "n-transactions-per-block", "n-transactions-excluding-popular", "n-unique-addresses", "hash-rate", "difficulty", "miners-revenue",
  "transaction-fees", "transaction-fees-usd", "cost-per-transaction", "cost-per-transaction-percent", "output-volume",
  "estimated-transaction-volume", "estimated-transaction-volume-usd", "my-wallet-n-users",
];
const blockchainInfo = {
  category: "finance",
  slug: "blockchain-info",
  displayName: "Blockchain.com Charts",
  description: "Bitcoin network statistics and historical chart series from Blockchain.com's public API.",
  tags: ["bitcoin", "on-chain", "hash-rate", "charts", "crypto"],
  endpoints: [
    {
      slug: "chart",
      displayName: "Chart",
      description: "Time series for a Bitcoin network metric.",
      method: "GET",
      cacheTtl: 900,
      fields: [
        f.enm("chart", BCI_CHARTS, { default: "mempool-size" }),
        f.str("timespan", { example: "30days", description: "e.g. 7days, 1year, all" }),
        f.str("start", { description: "Start date (YYYY-MM-DD)" }),
        f.str("rollingAverage", { example: "7days" }),
        f.enm("sampled", ["true", "false"], { default: "false" }),
        f.int("limit", { min: 1, description: "Keep only the latest N points" }),
      ],
      handler: async (p, ctx) => {
        const j = await getJson(
          ctx,
          url(`${BCI}/charts/${p.chart ?? "mempool-size"}`, { timespan: p.timespan, start: p.start ? isoDate(p.start) : undefined, rollingAverage: p.rollingAverage, sampled: p.sampled, format: "json" }),
        );
        if (j?.status && j.status !== "ok") throw new ScraperError(`Chart error: ${j.status}`);
        let values = (j?.values ?? []).map((v) => ({ time: iso(v.x * 1000), timestamp: v.x, value: v.y }));
        if (p.limit) values = values.slice(-p.limit);
        return { chart: p.chart ?? "mempool-size", name: j?.name ?? null, unit: j?.unit ?? null, period: j?.period ?? null, description: j?.description ?? null, count: values.length, values };
      },
    },
    {
      slug: "stats",
      displayName: "Stats",
      description: "Snapshot of Bitcoin price, hash rate, difficulty, fees and volume.",
      method: "GET",
      cacheTtl: 300,
      fields: [],
      handler: async (_p, ctx) => {
        const j = await getJson(ctx, `${BCI}/stats`);
        return {
          marketPriceUsd: j.market_price_usd,
          hashRate: j.hash_rate,
          difficulty: j.difficulty,
          minutesBetweenBlocks: j.minutes_between_blocks,
          blocksMined24h: j.n_blocks_mined,
          btcMined24h: j.n_btc_mined != null ? j.n_btc_mined / 1e8 : null,
          totalBtc: j.totalbc != null ? j.totalbc / 1e8 : null,
          blockHeight: j.n_blocks_total,
          transactions24h: j.n_tx,
          totalFeesBtc: j.total_fees_btc != null ? j.total_fees_btc / 1e8 : null,
          minersRevenueUsd: j.miners_revenue_usd,
          tradeVolumeUsd: j.trade_volume_usd,
          estimatedTxVolumeUsd: j.estimated_transaction_volume_usd,
          nextRetarget: j.nextretarget,
          timestamp: iso(j.timestamp),
        };
      },
    },
  ],
};

// ======================================================================
// Fear & Greed (crypto, alternative.me)
// ======================================================================
const FNG = "https://api.alternative.me/fng/";
const fngRow = (d) => ({
  value: num(d.value),
  classification: d.value_classification,
  date: iso(Number(d.timestamp) * 1000).slice(0, 10),
  timestamp: Number(d.timestamp),
  ...(d.time_until_update ? { secondsUntilUpdate: num(d.time_until_update) } : {}),
});
async function fng(ctx, limit) {
  const j = await getJson(ctx, url(FNG, { limit, format: "json" }));
  if (j?.metadata?.error) throw new ScraperError(`alternative.me error: ${j.metadata.error}`);
  return (j?.data ?? []).map(fngRow);
}
const fearGreed = {
  category: "finance",
  slug: "fear-greed",
  displayName: "Crypto Fear & Greed",
  description: "Daily crypto market sentiment score (0 = extreme fear, 100 = extreme greed) from alternative.me.",
  tags: ["sentiment", "crypto", "index", "market-mood"],
  endpoints: [
    {
      slug: "crypto",
      displayName: "Crypto Sentiment",
      description: "Latest index value plus the last N days.",
      method: "GET",
      cacheTtl: 900,
      fields: [count(30, 3650, "Number of days")],
      handler: async (p, ctx) => {
        const rows = await fng(ctx, p.count ?? 30);
        return { current: rows[0] ?? null, count: rows.length, history: rows };
      },
    },
    {
      slug: "crypto-history",
      displayName: "Crypto History",
      description: "Full or date-bounded history of the crypto index.",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.int("limit", { default: 0, min: 0, description: "0 = all available days" }), f.str("from", { description: "Unix seconds or ISO date" }), f.str("to")],
      handler: async (p, ctx) => {
        const bounded = p.from || p.to;
        let rows = await fng(ctx, bounded ? 0 : p.limit ?? 0);
        const a = toSec(p.from);
        const b = toSec(p.to);
        rows = rows.filter((r) => (a === undefined || r.timestamp >= a) && (b === undefined || r.timestamp <= b));
        if (bounded && p.limit) rows = rows.slice(0, p.limit);
        return { count: rows.length, history: rows };
      },
    },
  ],
};

// ======================================================================
// Crypto price (simple wrapper around CoinGecko)
// ======================================================================
const SYMBOL_IDS = {
  btc: "bitcoin", eth: "ethereum", usdt: "tether", bnb: "binancecoin", sol: "solana", xrp: "ripple", usdc: "usd-coin", ada: "cardano",
  doge: "dogecoin", trx: "tron", ton: "the-open-network", dot: "polkadot", matic: "matic-network", pol: "polygon-ecosystem-token",
  ltc: "litecoin", shib: "shiba-inu", avax: "avalanche-2", link: "chainlink", bch: "bitcoin-cash", xlm: "stellar", atom: "cosmos",
  uni: "uniswap", near: "near", apt: "aptos", arb: "arbitrum", op: "optimism", sui: "sui", pepe: "pepe", dai: "dai", etc: "ethereum-classic",
};
const cryptoPrice = {
  category: "finance",
  slug: "crypto-price",
  displayName: "Crypto Price",
  description: "Quick crypto price lookup by ticker symbol or CoinGecko id, in any quote currency (default USD and IDR).",
  tags: ["utility", "crypto", "prices"],
  endpoints: [
    {
      slug: "price",
      displayName: "Get Crypto Price",
      description: "Price, 24h change and market cap for one or more coins.",
      method: "GET",
      cacheTtl: 30,
      bulkEnabled: true,
      fields: [f.req("coins", { example: "btc,eth,solana", description: "Comma-separated symbols or CoinGecko ids" }), f.str("vs", { default: "usd,idr", description: "Comma-separated quote currencies" })],
      handler: async (p, ctx) => {
        const inputs = String(p.coins).split(",").map((s) => lc(s).trim()).filter(Boolean);
        const ids = inputs.map((s) => SYMBOL_IDS[s] ?? s);
        const vs = String(p.vs ?? "usd,idr").split(",").map((s) => lc(s).trim()).filter(Boolean);
        const j = await getJson(
          ctx,
          url(`${CG}/simple/price`, { ids: [...new Set(ids)].join(","), vs_currencies: vs.join(","), include_24hr_change: "true", include_market_cap: "true", include_last_updated_at: "true" }),
        );
        const prices = inputs.map((input, i) => {
          const d = j?.[ids[i]];
          if (!d) return { input, id: ids[i], found: false };
          const out = { input, id: ids[i], found: true, prices: {}, change24h: {}, marketCap: {}, updatedAt: d.last_updated_at ? iso(d.last_updated_at * 1000) : null };
          for (const c of vs) {
            out.prices[c] = d[c] ?? null;
            out.change24h[c] = d[`${c}_24h_change`] ?? null;
            out.marketCap[c] = d[`${c}_market_cap`] ?? null;
          }
          return out;
        });
        return { vs, count: prices.length, prices };
      },
    },
  ],
};

// ======================================================================
// Frankfurter (ECB reference rates) — used by currency-convert and fx
// ======================================================================
const FX = "https://api.frankfurter.dev/v1";
const up = (s) => String(s ?? "").toUpperCase().trim();
async function fxRate(ctx, from, to, date) {
  if (from === to) return { rate: 1, date: date ?? null };
  const j = await getJson(ctx, url(`${FX}/${date ?? "latest"}`, { base: from, symbols: to }));
  const rate = j?.rates?.[to];
  if (rate === undefined) throw new ScraperError(`No rate available for ${from}→${to}`);
  return { rate, date: j.date };
}
const round = (x, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

const currencyConvert = {
  category: "finance",
  slug: "currency-convert",
  displayName: "Currency Converter",
  description: "Convert an amount between currencies using European Central Bank reference rates.",
  tags: ["utility", "finance", "currency"],
  endpoints: [
    {
      slug: "convert",
      displayName: "Convert Currency",
      description: "Converts an amount from one currency to another at the latest reference rate.",
      method: "GET",
      cacheTtl: 3600,
      bulkEnabled: true,
      fields: [f.str("from", { default: "USD", pattern: CCY }), f.str("to", { default: "IDR", pattern: CCY }), f.num("amount", { default: 1, min: 0 })],
      handler: async (p, ctx) => {
        const from = up(p.from ?? "USD");
        const to = up(p.to ?? "IDR");
        const amount = Number(p.amount ?? 1);
        const { rate, date } = await fxRate(ctx, from, to);
        return { from, to, amount, rate, result: round(amount * rate, 4), date, source: "ECB via Frankfurter" };
      },
    },
  ],
};

const fx = {
  category: "finance",
  slug: "fx",
  displayName: "Kurs Valuta (ECB)",
  description: "Kurs referensi harian Bank Sentral Eropa (ECB) via Frankfurter: kurs terbaru, konversi, riwayat, dan daftar mata uang — termasuk Rupiah (IDR).",
  tags: ["kurs", "forex", "idr", "rupiah", "usd", "currency", "finance"],
  indonesian: true,
  endpoints: [
    {
      slug: "latest",
      displayName: "Kurs Terbaru",
      description: "Kurs terbaru (atau pada tanggal tertentu) dari mata uang dasar ke mata uang lain.",
      method: "GET",
      cacheTtl: 3600,
      fields: [
        f.str("base", { default: "USD", pattern: CCY, description: "Mata uang dasar (ISO 4217)" }),
        f.str("symbols", { example: "IDR,SGD,EUR", description: "Mata uang tujuan, pisahkan dengan koma" }),
        f.str("date", { pattern: DATE, description: "Tanggal kurs (YYYY-MM-DD), kosong = terbaru" }),
      ],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, url(`${FX}/${p.date ?? "latest"}`, { base: up(p.base ?? "USD"), symbols: p.symbols ? up(p.symbols).replace(/\s+/g, "") : undefined }));
        return { base: j.base, date: j.date, rates: j.rates ?? {}, source: "ECB via Frankfurter" };
      },
    },
    {
      slug: "convert",
      displayName: "Konversi",
      description: "Konversi nominal antar mata uang, mis. USD ke IDR.",
      method: "GET",
      cacheTtl: 3600,
      bulkEnabled: true,
      fields: [
        f.num("amount", { required: true, min: 0, example: 100, description: "Nominal" }),
        f.req("from", { pattern: CCY, example: "USD" }),
        f.req("to", { pattern: CCY, example: "IDR" }),
        f.str("date", { pattern: DATE, description: "Tanggal kurs (YYYY-MM-DD)" }),
      ],
      handler: async (p, ctx) => {
        const from = up(p.from);
        const to = up(p.to);
        const { rate, date } = await fxRate(ctx, from, to, p.date);
        return { amount: p.amount, from, to, rate, result: round(p.amount * rate, 4), date, source: "ECB via Frankfurter" };
      },
    },
    {
      slug: "history",
      displayName: "Riwayat Kurs",
      description: "Deret waktu kurs harian antara dua tanggal.",
      method: "GET",
      cacheTtl: 21600,
      fields: [
        f.req("start", { pattern: DATE, example: "2026-01-01", description: "Tanggal awal (YYYY-MM-DD)" }),
        f.str("end", { pattern: DATE, description: "Tanggal akhir (YYYY-MM-DD), kosong = hari ini" }),
        f.str("base", { default: "USD", pattern: CCY }),
        f.str("symbols", { default: "IDR", description: "Mata uang tujuan, pisahkan dengan koma" }),
      ],
      handler: async (p, ctx) => {
        const j = await getJson(ctx, url(`${FX}/${p.start}..${p.end ?? ""}`, { base: up(p.base ?? "USD"), symbols: p.symbols ? up(p.symbols).replace(/\s+/g, "") : undefined }));
        const series = Object.entries(j?.rates ?? {}).map(([date, rates]) => ({ date, rates }));
        return { base: j.base, startDate: j.start_date, endDate: j.end_date, count: series.length, series, source: "ECB via Frankfurter" };
      },
    },
    {
      slug: "currencies",
      displayName: "Daftar Mata Uang",
      description: "Semua kode mata uang yang didukung beserta namanya.",
      method: "GET",
      cacheTtl: 86400,
      fields: [],
      handler: async (_p, ctx) => {
        const j = await getJson(ctx, `${FX}/currencies`);
        const currencies = Object.entries(j ?? {}).map(([code, name]) => ({ code, name }));
        return { count: currencies.length, currencies };
      },
    },
  ],
};

// ======================================================================
// World Bank Indicators API v2
// ======================================================================
const worldbank = {
  category: "finance",
  slug: "worldbank",
  displayName: "World Bank",
  description: "Development and macroeconomic indicators (GDP, inflation, population…) by country from the World Bank API.",
  tags: ["worldbank", "macro", "gdp", "indicator", "finance"],
  endpoints: [
    {
      slug: "indicator",
      displayName: "Indicator Series",
      description: "Yearly values of a World Bank indicator for a country (newest first).",
      method: "GET",
      cacheTtl: 86400,
      bulkEnabled: true,
      fields: [
        f.str("country", { default: "ID", description: "ISO2/ISO3 code(s), ';'-separated, or 'all'" }),
        f.str("indicator", { default: "NY.GDP.MKTP.CD", description: "Indicator code, e.g. FP.CPI.TOTL.ZG (inflation)" }),
        f.str("date", { example: "2010:2024", description: "Year or year range" }),
        f.int("length", { default: 20, min: 1, max: 1000 }),
      ],
      handler: async (p, ctx) => {
        const country = encodeURIComponent(p.country ?? "ID");
        const indicator = encodeURIComponent(p.indicator ?? "NY.GDP.MKTP.CD");
        const j = await getJson(ctx, url(`https://api.worldbank.org/v2/country/${country}/indicator/${indicator}`, { format: "json", per_page: p.length ?? 20, date: p.date }));
        if (!Array.isArray(j) || j[0]?.message) {
          const msg = j?.[0]?.message?.[0]?.value ?? "Unexpected World Bank response";
          throw new ScraperError(msg);
        }
        const [meta, rows] = j;
        const data = (rows ?? []).map((r) => ({
          country: r.country?.value,
          countryCode: r.countryiso3code || r.country?.id,
          indicator: r.indicator?.id,
          indicatorName: r.indicator?.value,
          year: r.date,
          value: r.value,
          unit: r.unit || null,
        }));
        return { indicator: data[0]?.indicator ?? p.indicator, indicatorName: data[0]?.indicatorName ?? null, total: meta?.total ?? data.length, lastUpdated: meta?.lastupdated ?? null, count: data.length, data };
      },
    },
  ],
};

// ======================================================================
// GLEIF LEI API
// ======================================================================
const GLEIF = "https://api.gleif.org/api/v1";
const leiRow = (r) => {
  const a = r.attributes ?? {};
  const e = a.entity ?? {};
  const addr = (x) => (x ? { lines: x.addressLines ?? [], city: x.city ?? null, region: x.region ?? null, country: x.country ?? null, postalCode: x.postalCode ?? null } : null);
  return {
    lei: a.lei ?? r.id,
    legalName: e.legalName?.name ?? null,
    otherNames: (e.otherNames ?? []).map((n) => n.name),
    status: e.status ?? null,
    category: e.category ?? null,
    jurisdiction: e.jurisdiction ?? null,
    legalForm: e.legalForm?.id ?? null,
    registeredAs: e.registeredAs ?? null,
    legalAddress: addr(e.legalAddress),
    headquartersAddress: addr(e.headquartersAddress),
    registration: {
      status: a.registration?.status ?? null,
      initialDate: a.registration?.initialRegistrationDate ?? null,
      lastUpdate: a.registration?.lastUpdateDate ?? null,
      nextRenewal: a.registration?.nextRenewalDate ?? null,
      managingLou: a.registration?.managingLou ?? null,
    },
    bic: a.bic ?? [],
  };
};
const gleif = {
  category: "finance",
  slug: "gleif",
  displayName: "GLEIF",
  description: "Look up Legal Entity Identifier (LEI) records from the Global LEI Foundation by code, name or country.",
  tags: ["lei", "gleif", "entity", "compliance", "finance"],
  endpoints: [
    {
      slug: "lei",
      displayName: "LEI Records",
      description: "Fetch one LEI record or search records by name and country.",
      method: "GET",
      cacheTtl: 86400,
      bulkEnabled: true,
      fields: [
        f.str("query", { example: "Bank Central Asia", description: "Full-text search on entity names" }),
        f.str("lei", { pattern: "^[A-Za-z0-9]{20}$", description: "20-character LEI code" }),
        f.str("country", { pattern: "^[A-Za-z]{2}$", description: "Legal address country (ISO2)" }),
        f.int("length", { default: 10, min: 1, max: 200 }),
      ],
      handler: async (p, ctx) => {
        if (p.lei) {
          const j = await getJson(ctx, `${GLEIF}/lei-records/${up(p.lei)}`);
          return { count: 1, records: [leiRow(j.data)] };
        }
        if (!p.query && !p.country) throw new ScraperError("Provide lei, query or country");
        const j = await getJson(
          ctx,
          url(`${GLEIF}/lei-records`, { "filter[fulltext]": p.query, "filter[entity.legalAddress.country]": p.country ? up(p.country) : undefined, "page[size]": p.length ?? 10, "page[number]": 1 }),
        );
        const records = (j?.data ?? []).map(leiRow);
        return { total: j?.meta?.pagination?.total ?? records.length, count: records.length, records };
      },
    },
  ],
};

// ======================================================================
// US Treasury — Fiscal Data API + Treasury yield-curve XML feed
// ======================================================================
const FD = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const fdFilter = (parts) => parts.filter(Boolean).join(",") || undefined;
async function fiscal(ctx, path, { filter, sort = "-record_date", page = 1, size = 100, fields } = {}) {
  const j = await getJson(ctx, url(`${FD}/${path}`, { filter, sort, fields, "page[number]": page, "page[size]": size, format: "json" }));
  if (j?.error) throw new ScraperError(`Fiscal Data error: ${j.error} ${j.message ?? ""}`.trim());
  return { rows: j?.data ?? [], total: j?.meta?.["total-count"] ?? null, pages: j?.meta?.["total-pages"] ?? null };
}
const numify = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && !/date|cusip|_id$/.test(k) ? Number(v) : v === "null" ? null : v]));
const rangeFilter = (field, from, to) => [from ? `${field}:gte:${isoDate(from)}` : null, to ? `${field}:lte:${isoDate(to)}` : null];
const pageFields = [f.int("page", { default: 1, min: 1 }), f.int("length", { default: 100, min: 1, max: 10000 })];

const usTreasury = {
  category: "finance",
  slug: "us-treasury",
  displayName: "US Treasury",
  description: "US federal debt, Treasury auction results, average interest rates, daily cash balance and the par yield curve from official Treasury data.",
  tags: ["treasury", "yield", "bond", "macro", "finance"],
  endpoints: [
    {
      slug: "yield-curve",
      displayName: "Yield Curve",
      description: "Daily Treasury par yield curve rates (1-month to 30-year) for a year.",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.int("year", { min: 1990, max: 2100, description: "Calendar year (default: current)" }), f.int("length", { min: 1, max: 400, description: "Keep only the latest N days" })],
      handler: async (p, ctx) => {
        const year = p.year ?? new Date().getUTCFullYear();
        const xml = await getText(
          ctx,
          url("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml", { data: "daily_treasury_yield_curve", field_tdr_date_value: year }),
          { headers: { accept: "application/xml, text/xml, */*" } },
        );
        const entries = [...xml.matchAll(/<m:properties>([\s\S]*?)<\/m:properties>/g)].map((m) => {
          const props = m[1];
          const date = /<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>/.exec(props)?.[1]?.slice(0, 10) ?? null;
          const rates = {};
          for (const r of props.matchAll(/<d:BC_([0-9A-Z_]+)[^>]*?(?:\/>|>([^<]*)<\/d:BC_\1>)/g)) {
            if (r[1].endsWith("DISPLAY")) continue;
            rates[r[1].toLowerCase().replace(/_/g, ".")] = num(r[2]);
          }
          return { date, rates };
        });
        let days = entries.filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date));
        if (p.length) days = days.slice(-p.length);
        return { year, count: days.length, latest: days.at(-1) ?? null, days };
      },
    },
    {
      slug: "debt-to-penny",
      displayName: "Debt to the Penny",
      description: "Total public debt outstanding, split into public and intragovernmental holdings.",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.str("from", { pattern: DATE }), f.str("to", { pattern: DATE }), ...pageFields],
      handler: async (p, ctx) => {
        const r = await fiscal(ctx, "v2/accounting/od/debt_to_penny", { filter: fdFilter(rangeFilter("record_date", p.from, p.to)), page: p.page, size: p.length ?? 100 });
        const data = r.rows.map((x) => ({ date: x.record_date, debtHeldByPublic: num(x.debt_held_public_amt), intragovernmental: num(x.intragov_hold_amt), totalDebt: num(x.tot_pub_debt_out_amt) }));
        return { total: r.total, page: p.page ?? 1, count: data.length, data };
      },
    },
    {
      slug: "avg-interest-rates",
      displayName: "Average Interest Rates",
      description: "Monthly average interest rate on Treasury securities by type.",
      method: "GET",
      cacheTtl: 86400,
      fields: [f.enm("securityType", ["Marketable", "Non-marketable", "Interest-bearing Debt"]), f.str("security", { example: "Treasury Bills" }), f.str("from", { pattern: DATE }), f.str("to", { pattern: DATE }), ...pageFields],
      handler: async (p, ctx) => {
        const filter = fdFilter([...rangeFilter("record_date", p.from, p.to), p.securityType ? `security_type_desc:eq:${p.securityType}` : null, p.security ? `security_desc:eq:${p.security}` : null]);
        const r = await fiscal(ctx, "v2/accounting/od/avg_interest_rates", { filter, page: p.page, size: p.length ?? 100 });
        const data = r.rows.map((x) => ({ date: x.record_date, securityType: x.security_type_desc, security: x.security_desc, avgInterestRate: num(x.avg_interest_rate_amt) }));
        return { total: r.total, page: p.page ?? 1, count: data.length, data };
      },
    },
    {
      slug: "auctions",
      displayName: "Auctions",
      description: "Treasury securities auction announcements and results.",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.enm("securityType", ["Bill", "Note", "Bond"]), f.str("securityTerm", { example: "4-Week" }), f.str("cusip"), f.str("from", { pattern: DATE }), f.str("to", { pattern: DATE }), ...pageFields],
      handler: async (p, ctx) => {
        const filter = fdFilter([
          ...rangeFilter("auction_date", p.from, p.to),
          p.securityType ? `security_type:eq:${p.securityType}` : null,
          p.securityTerm ? `security_term:eq:${p.securityTerm}` : null,
          p.cusip ? `cusip:eq:${up(p.cusip)}` : null,
        ]);
        const r = await fiscal(ctx, "v1/accounting/od/auctions_query", { filter, sort: "-auction_date", page: p.page, size: p.length ?? 100 });
        const data = r.rows.map((x) => ({
          cusip: x.cusip,
          securityType: x.security_type,
          securityTerm: x.security_term,
          auctionDate: x.auction_date,
          issueDate: x.issue_date,
          maturityDate: x.maturity_date,
          highYield: num(x.high_yield),
          highDiscountRate: num(x.high_discount_rate),
          interestRate: num(x.int_rate),
          highPrice: num(x.high_price),
          offeringAmount: num(x.offering_amt),
          bidToCoverRatio: num(x.bid_to_cover_ratio),
        }));
        return { total: r.total, page: p.page ?? 1, count: data.length, data };
      },
    },
    {
      slug: "daily-treasury-statement",
      displayName: "Daily Treasury Statement",
      description: "Operating cash balance of the Treasury General Account from the Daily Treasury Statement.",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.str("account", { description: "Account type, e.g. 'Treasury General Account (TGA) Closing Balance'" }), f.str("from", { pattern: DATE }), f.str("to", { pattern: DATE }), ...pageFields],
      handler: async (p, ctx) => {
        const filter = fdFilter([...rangeFilter("record_date", p.from, p.to), p.account ? `account_type:eq:${p.account}` : null]);
        const r = await fiscal(ctx, "v1/accounting/dts/operating_cash_balance", { filter, page: p.page, size: p.length ?? 100 });
        return { total: r.total, page: p.page ?? 1, count: r.rows.length, data: r.rows.map(numify) };
      },
    },
  ],
};

// ======================================================================
// ECB Data Portal (SDMX REST, data-api.ecb.europa.eu)
// ======================================================================
const ECB = "https://data-api.ecb.europa.eu/service";

/** Flatten SDMX-JSON 1.0 data message into a list of series with observations. */
export function parseSdmxJson(j) {
  const ds = j?.dataSets?.[0];
  const st = j?.structure ?? {};
  const sDims = st.dimensions?.series ?? [];
  const oDim = st.dimensions?.observation?.[0];
  const sAttrs = st.attributes?.series ?? [];
  const series = Object.entries(ds?.series ?? {}).map(([k, s]) => {
    const idx = k.split(":").map(Number);
    const dims = Object.fromEntries(sDims.map((d, i) => [d.id, d.values?.[idx[i]]?.id ?? null]));
    const attrs = {};
    (s.attributes ?? []).forEach((v, i) => {
      if (v !== null && v !== undefined && sAttrs[i]) attrs[sAttrs[i].id] = sAttrs[i].values?.[v]?.name ?? sAttrs[i].values?.[v]?.id ?? null;
    });
    const observations = Object.entries(s.observations ?? {})
      .map(([o, vals]) => ({ period: oDim?.values?.[Number(o)]?.id ?? o, value: vals?.[0] ?? null }))
      .sort((a, b) => String(a.period).localeCompare(String(b.period)));
    return { key: sDims.map((d) => dims[d.id]).join("."), dimensions: dims, title: attrs.TITLE ?? attrs.TITLE_COMPL ?? null, unit: attrs.UNIT ?? null, observations };
  });
  return series;
}
async function ecbData(ctx, flow, key, p) {
  const j = await getJson(
    ctx,
    url(`${ECB}/data/${encodeURIComponent(flow)}/${key}`, {
      format: "jsondata",
      startPeriod: p.from,
      endPeriod: p.to,
      lastNObservations: p.last,
      firstNObservations: p.first,
      detail: p.detail,
      updatedAfter: p.updatedAfter,
      includeHistory: p.history,
    }),
    { headers: { accept: "application/json" } },
  );
  return parseSdmxJson(j);
}
const ecbRange = [f.str("from", { description: "Start period, e.g. 2024-01 or 2024-01-31" }), f.str("to", { description: "End period" }), f.int("last", { min: 1, description: "Only the last N observations" })];
const KEY_RATES = { MRR: "MRR_FR", DFR: "DFR", MLF: "MLFR" };

const ecb = {
  category: "finance",
  slug: "ecb",
  displayName: "European Central Bank",
  description: "Euro exchange rates, policy interest rates, inflation (HICP) and any SDMX series from the ECB Data Portal.",
  tags: ["ecb", "euro", "interest-rates", "inflation", "exchange-rates", "macro"],
  endpoints: [
    {
      slug: "series",
      displayName: "Series",
      description: "Raw access to any ECB dataflow/series key (SDMX).",
      method: "GET",
      cacheTtl: 3600,
      fields: [
        f.req("dataflow", { example: "EXR", description: "Dataflow id, e.g. EXR, ICP, FM" }),
        f.str("key", { example: "D.USD.EUR.SP00.A", description: "Series key with '.'-separated dimensions; empty dimension = wildcard" }),
        ...ecbRange,
        f.int("first", { min: 1 }),
        f.enm("detail", ["full", "dataonly", "serieskeysonly", "nodata"]),
        f.str("updatedAfter"),
        f.enm("history", ["true", "false"]),
        f.int("length", { min: 1, max: 1000, description: "Max series returned" }),
      ],
      handler: async (p, ctx) => {
        let series = await ecbData(ctx, p.dataflow.toUpperCase(), p.key ?? "", p);
        const total = series.length;
        if (p.length) series = series.slice(0, p.length);
        return { dataflow: p.dataflow.toUpperCase(), key: p.key ?? "", total, count: series.length, series };
      },
    },
    {
      slug: "exchange-rates",
      displayName: "Exchange Rates",
      description: "Euro foreign exchange reference rates (units of currency per 1 EUR).",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.str("currency", { default: "USD", example: "USD+IDR", description: "Currency code(s), '+'-separated" }), f.enm("frequency", ["D", "M", "Q", "A"], { default: "D" }), ...ecbRange],
      handler: async (p, ctx) => {
        const cur = up(p.currency ?? "USD").replace(/[,\s]+/g, "+");
        const last = p.last ?? (p.from || p.to ? undefined : 10);
        const series = await ecbData(ctx, "EXR", `${p.frequency ?? "D"}.${cur}.EUR.SP00.A`, { ...p, last });
        return {
          base: "EUR",
          frequency: p.frequency ?? "D",
          rates: series.map((s) => ({ currency: s.dimensions.CURRENCY, title: s.title, latest: s.observations.at(-1) ?? null, observations: s.observations })),
        };
      },
    },
    {
      slug: "key-rates",
      displayName: "Key Interest Rates",
      description: "ECB policy rates: main refinancing (MRR), deposit facility (DFR) and marginal lending (MLF).",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.enm("rate", ["MRR", "DFR", "MLF", "all"], { default: "all" }), ...ecbRange],
      handler: async (p, ctx) => {
        const which = !p.rate || p.rate === "all" ? Object.keys(KEY_RATES) : [p.rate];
        const last = p.last ?? (p.from || p.to ? undefined : 10);
        const series = await ecbData(ctx, "FM", `B.U2.EUR.4F.KR.${which.map((r) => KEY_RATES[r]).join("+")}.LEV`, { ...p, last });
        const byCode = Object.fromEntries(Object.entries(KEY_RATES).map(([a, b]) => [b, a]));
        return {
          rates: series.map((s) => ({ rate: byCode[s.dimensions.PROVIDER_FM_ID] ?? s.dimensions.PROVIDER_FM_ID, title: s.title, latest: s.observations.at(-1) ?? null, observations: s.observations })),
        };
      },
    },
    {
      slug: "hicp",
      displayName: "HICP Inflation",
      description: "Harmonised Index of Consumer Prices for the euro area or a member state.",
      method: "GET",
      cacheTtl: 21600,
      fields: [
        f.str("item", { default: "000000", description: "COICOP item code; 000000 = all items" }),
        f.str("area", { default: "U2", description: "U2 = euro area, or ISO2 country e.g. DE" }),
        f.enm("measure", ["ANR", "INX", "ANR_S", "MRR", "CTG", "CTG_S", "WGT"], { default: "ANR", description: "ANR = annual rate of change" }),
        ...ecbRange,
      ],
      handler: async (p, ctx) => {
        const measure = p.measure ?? "ANR";
        const freq = measure === "WGT" ? "A" : "M";
        const last = p.last ?? (p.from || p.to ? undefined : 12);
        const series = await ecbData(ctx, "ICP", `${freq}.${up(p.area ?? "U2")}.N.${p.item ?? "000000"}.4.${measure}`, { ...p, last });
        const s = series[0];
        return { area: up(p.area ?? "U2"), item: p.item ?? "000000", measure, title: s?.title ?? null, latest: s?.observations.at(-1) ?? null, observations: s?.observations ?? [] };
      },
    },
    {
      slug: "dataflows",
      displayName: "Dataflows",
      description: "List of available ECB dataflows (datasets).",
      method: "GET",
      cacheTtl: 86400,
      fields: [f.str("agency", { default: "ECB" }), f.str("query", { description: "Filter by id or name" })],
      handler: async (p, ctx) => {
        const xml = await getText(ctx, `${ECB}/dataflow/${encodeURIComponent(p.agency ?? "ECB")}`, { headers: { accept: "application/vnd.sdmx.structure+xml;version=2.1, application/xml" } });
        let flows = [...xml.matchAll(/<str:Dataflow\b([^>]*)>([\s\S]*?)<\/str:Dataflow>/g)].map((m) => ({
          id: /\bid="([^"]+)"/.exec(m[1])?.[1] ?? null,
          agency: /\bagencyID="([^"]+)"/.exec(m[1])?.[1] ?? null,
          name: decodeEntities((/<com:Name[^>]*xml:lang="en"[^>]*>([\s\S]*?)<\/com:Name>/.exec(m[2]) ?? /<com:Name[^>]*>([\s\S]*?)<\/com:Name>/.exec(m[2]))?.[1]?.trim() ?? ""),
        }));
        if (p.query) flows = flows.filter((x) => lc(x.id).includes(lc(p.query)) || lc(x.name).includes(lc(p.query)));
        return { count: flows.length, dataflows: flows };
      },
    },
  ],
};

// ======================================================================
// SEC EDGAR (data.sec.gov + EDGAR full-text search)
// ======================================================================
const SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json";
const pad10 = (c) => String(c).replace(/\D/g, "").padStart(10, "0");

async function resolveCik(ctx, { cik, company }) {
  if (cik) return { cik: pad10(cik), ticker: null, name: null };
  if (!company) throw new ScraperError("Provide company (ticker or name) or cik");
  if (/^\d{1,10}$/.test(String(company).trim())) return { cik: pad10(company), ticker: null, name: null };
  const list = Object.values((await getJson(ctx, SEC_TICKERS)) ?? {});
  const q = lc(company).trim();
  const hit = list.find((x) => lc(x.ticker) === q) ?? list.find((x) => lc(x.title) === q) ?? list.find((x) => lc(x.title).includes(q));
  if (!hit) throw new ScraperError(`Company not found: ${company}`);
  return { cik: pad10(hit.cik_str), ticker: hit.ticker, name: hit.title };
}
const secCompanyFields = [f.str("company", { example: "AAPL", description: "Ticker or company name" }), f.str("cik", { description: "SEC Central Index Key" })];
const archiveUrl = (cik, accession, doc) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(accession).replace(/-/g, "")}/${doc ?? ""}`;

const secEdgar = {
  category: "finance",
  slug: "sec-edgar",
  displayName: "SEC EDGAR",
  description: "US public-company filings, profiles and XBRL financial facts from the SEC's EDGAR APIs.",
  tags: ["filings", "sec", "fundamentals", "xbrl", "us-stocks"],
  endpoints: [
    {
      slug: "search",
      displayName: "Search Filings",
      description: "Full-text search across EDGAR filings since 2001.",
      method: "GET",
      cacheTtl: 900,
      fields: [
        f.str("q", { example: '"artificial intelligence"', description: "Search terms (use quotes for phrases)" }),
        f.str("company", { description: "Ticker, company name or CIK to restrict results" }),
        f.str("forms", { example: "10-K,8-K" }),
        f.str("from", { pattern: DATE }),
        f.str("to", { pattern: DATE }),
        f.int("page", { default: 1, min: 1, max: 100 }),
      ],
      handler: async (p, ctx) => {
        if (!p.q && !p.company) throw new ScraperError("Provide q or company");
        const who = p.company ? await resolveCik(ctx, { company: p.company }) : null;
        const page = p.page ?? 1;
        const j = await getJson(
          ctx,
          url("https://efts.sec.gov/LATEST/search-index", {
            q: p.q,
            ciks: who?.cik,
            forms: p.forms ? up(p.forms).replace(/\s+/g, "") : undefined,
            dateRange: p.from || p.to ? "custom" : undefined,
            startdt: p.from,
            enddt: p.to,
            from: (page - 1) * 100 || undefined,
          }),
        );
        const hits = (j?.hits?.hits ?? []).map((h) => {
          const s = h._source ?? {};
          const [adsh, doc] = String(h._id ?? "").split(":");
          const cik = s.ciks?.[0];
          return {
            accessionNumber: s.adsh ?? adsh,
            form: s.form ?? s.file_type ?? null,
            filedAt: s.file_date ?? null,
            periodEnding: s.period_ending ?? null,
            companies: s.display_names ?? [],
            ciks: s.ciks ?? [],
            url: cik ? archiveUrl(cik, s.adsh ?? adsh, doc) : null,
          };
        });
        return { total: j?.hits?.total?.value ?? hits.length, page, count: hits.length, hits };
      },
    },
    {
      slug: "company",
      displayName: "Company",
      description: "Company profile: CIK, tickers, industry (SIC), addresses and fiscal year end.",
      method: "GET",
      cacheTtl: 86400,
      bulkEnabled: true,
      fields: secCompanyFields,
      handler: async (p, ctx) => {
        const { cik } = await resolveCik(ctx, p);
        const s = await getJson(ctx, `https://data.sec.gov/submissions/CIK${cik}.json`);
        return {
          cik,
          name: s.name,
          tickers: s.tickers ?? [],
          exchanges: s.exchanges ?? [],
          entityType: s.entityType ?? null,
          sic: s.sic ?? null,
          sicDescription: s.sicDescription ?? null,
          category: s.category ?? null,
          ein: s.ein ?? null,
          fiscalYearEnd: s.fiscalYearEnd ?? null,
          stateOfIncorporation: s.stateOfIncorporation ?? null,
          website: s.website || null,
          phone: s.phone ?? null,
          addresses: s.addresses ?? {},
          formerNames: s.formerNames ?? [],
          recentFilingCount: s.filings?.recent?.accessionNumber?.length ?? 0,
        };
      },
    },
    {
      slug: "filings",
      displayName: "Filings",
      description: "A company's recent filings, optionally filtered by form type.",
      method: "GET",
      cacheTtl: 900,
      fields: [...secCompanyFields, f.str("form", { example: "10-K" }), f.int("page", { default: 1, min: 1 }), count(25, 200)],
      handler: async (p, ctx) => {
        const { cik } = await resolveCik(ctx, p);
        const s = await getJson(ctx, `https://data.sec.gov/submissions/CIK${cik}.json`);
        const r = s.filings?.recent ?? {};
        const forms = p.form ? up(p.form).split(",").map((x) => x.trim()) : null;
        const all = (r.accessionNumber ?? [])
          .map((acc, i) => ({
            accessionNumber: acc,
            form: r.form?.[i],
            filingDate: r.filingDate?.[i],
            reportDate: r.reportDate?.[i] || null,
            primaryDocument: r.primaryDocument?.[i] || null,
            description: r.primaryDocDescription?.[i] || null,
            url: archiveUrl(cik, acc, r.primaryDocument?.[i]),
          }))
          .filter((x) => !forms || forms.includes(up(x.form)));
        const size = p.count ?? 25;
        const page = p.page ?? 1;
        const filings = all.slice((page - 1) * size, page * size);
        return { cik, name: s.name, total: all.length, page, count: filings.length, filings };
      },
    },
    {
      slug: "concept",
      displayName: "Concept",
      description: "All reported values of one XBRL concept (e.g. Revenues) for a company.",
      method: "GET",
      cacheTtl: 21600,
      fields: [
        ...secCompanyFields,
        f.str("tag", { default: "Revenues", example: "NetIncomeLoss" }),
        f.enm("taxonomy", ["us-gaap", "ifrs-full", "dei", "srt"], { default: "us-gaap" }),
        f.enm("period", ["all", "annual", "quarterly"], { default: "all" }),
      ],
      handler: async (p, ctx) => {
        const { cik } = await resolveCik(ctx, p);
        const j = await getJson(ctx, `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${p.taxonomy ?? "us-gaap"}/${encodeURIComponent(p.tag ?? "Revenues")}.json`);
        const period = p.period ?? "all";
        const keep = (v) => period === "all" || (period === "annual" ? v.fp === "FY" : /^Q[1-4]$/.test(v.fp ?? ""));
        const units = Object.fromEntries(
          Object.entries(j?.units ?? {}).map(([u, vals]) => [
            u,
            vals.filter(keep).map((v) => ({ start: v.start ?? null, end: v.end, value: v.val, fiscalYear: v.fy, fiscalPeriod: v.fp, form: v.form, filed: v.filed, frame: v.frame ?? null, accessionNumber: v.accn })),
          ]),
        );
        return { cik, entityName: j?.entityName ?? null, taxonomy: j?.taxonomy, tag: j?.tag, label: j?.label ?? null, description: j?.description ?? null, units };
      },
    },
  ],
};

// ======================================================================
// FRED (St. Louis Fed) — needs FRED_API_KEY
// ======================================================================
const FRED = "https://api.stlouisfed.org/fred";
async function fred(ctx, path, params = {}) {
  const api_key = requireEnv("FRED_API_KEY");
  const j = await getJson(ctx, url(`${FRED}/${path}`, { ...params, api_key, file_type: "json" }));
  if (j?.error_code) throw new ScraperError(`FRED error ${j.error_code}: ${j.error_message ?? ""}`.trim());
  return j;
}
const FRED_PAGE = 100;
const fredPage = f.int("page", { default: 1, min: 1 });
const offsetOf = (page, size = FRED_PAGE) => ((page ?? 1) - 1) * size;
const seriesField = f.str("series", { default: "DGS10", example: "CPIAUCSL", description: "FRED series id" });
const FREQ = { Daily: "d", Weekly: "w", Biweekly: "bw", Monthly: "m", Quarterly: "q", Semiannual: "sa", Annual: "a" };
const SORT = { relevance: "search_rank", popularity: "popularity", title: "title", frequency: "frequency", units: "units", seasonality: "seasonal_adjustment", updated: "last_updated", start: "observation_start", end: "observation_end" };
const obs = (o) => ({ date: o.date, value: o.value === "." ? null : num(o.value), ...(o.realtime_start ? { realtimeStart: o.realtime_start, realtimeEnd: o.realtime_end } : {}) });
const seriesMeta = (s) => ({
  id: s.id,
  title: s.title,
  frequency: s.frequency,
  units: s.units,
  seasonalAdjustment: s.seasonal_adjustment,
  observationStart: s.observation_start,
  observationEnd: s.observation_end,
  lastUpdated: s.last_updated,
  popularity: s.popularity,
  notes: s.notes ?? null,
});

const fredScraper = {
  category: "finance",
  slug: "fred",
  displayName: "FRED",
  description: "US and international economic time series from the Federal Reserve Bank of St. Louis (requires a free FRED API key on the server).",
  tags: ["fred", "macro", "economics", "time-series", "rates", "point-in-time"],
  endpoints: [
    {
      slug: "series",
      displayName: "Series",
      description: "Metadata for one series.",
      method: "GET",
      cacheTtl: 86400,
      fields: [seriesField],
      handler: async (p, ctx) => {
        const j = await fred(ctx, "series", { series_id: p.series ?? "DGS10" });
        if (!j.seriess?.[0]) throw new ScraperError(`Series not found: ${p.series}`);
        return seriesMeta(j.seriess[0]);
      },
    },
    {
      slug: "series-observations",
      displayName: "Series Observations",
      description: "Data points of a series, with optional unit transformation and frequency aggregation.",
      method: "GET",
      cacheTtl: 3600,
      bulkEnabled: true,
      fields: [
        seriesField,
        f.str("from", { pattern: DATE }),
        f.str("to", { pattern: DATE }),
        f.enm("transformation", ["lin", "chg", "ch1", "pch", "pc1", "pca", "cch", "cca", "log"]),
        f.enm("frequency", Object.keys(FREQ)),
        f.enm("aggregation", ["avg", "sum", "eop"]),
        f.int("length", { min: 1, max: 100000, description: "Keep only the latest N observations" }),
      ],
      handler: async (p, ctx) => {
        const j = await fred(ctx, "series/observations", {
          series_id: p.series ?? "DGS10",
          observation_start: p.from,
          observation_end: p.to,
          units: p.transformation,
          frequency: p.frequency ? FREQ[p.frequency] : undefined,
          aggregation_method: p.aggregation,
          sort_order: p.length ? "desc" : "asc",
          limit: p.length,
        });
        let observations = (j.observations ?? []).map(obs);
        if (p.length) observations = observations.reverse();
        return { series: p.series ?? "DGS10", units: j.units ?? null, count: observations.length, observations };
      },
    },
    {
      slug: "observations-vintage",
      displayName: "Observations Vintage",
      description: "Series values as they were known on specific past vintage dates (point-in-time).",
      method: "GET",
      cacheTtl: 86400,
      fields: [seriesField, f.str("vintages", { example: "2020-01-15,2021-01-15", description: "Comma-separated vintage dates" }), f.str("from", { pattern: DATE }), f.str("to", { pattern: DATE }), f.int("length", { min: 1, max: 100000 })],
      handler: async (p, ctx) => {
        const j = await fred(ctx, "series/observations", {
          series_id: p.series ?? "DGS10",
          vintage_dates: p.vintages ? String(p.vintages).replace(/\s+/g, "") : undefined,
          observation_start: p.from,
          observation_end: p.to,
          limit: p.length,
        });
        const observations = (j.observations ?? []).map(obs);
        return { series: p.series ?? "DGS10", vintages: p.vintages ?? null, count: observations.length, observations };
      },
    },
    {
      slug: "vintage-dates",
      displayName: "Vintage Dates",
      description: "Dates on which a series was revised or newly released.",
      method: "GET",
      cacheTtl: 86400,
      fields: [seriesField, f.int("length", { min: 1, max: 10000, description: "Keep only the latest N dates" })],
      handler: async (p, ctx) => {
        const j = await fred(ctx, "series/vintagedates", { series_id: p.series ?? "DGS10", sort_order: p.length ? "desc" : "asc", limit: p.length });
        return { series: p.series ?? "DGS10", count: (j.vintage_dates ?? []).length, vintageDates: j.vintage_dates ?? [] };
      },
    },
    {
      slug: "series-search",
      displayName: "Series Search",
      description: "Search series by keywords.",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.req("query", { example: "indonesia inflation" }), fredPage, f.enm("sort", Object.keys(SORT), { default: "relevance" })],
      handler: async (p, ctx) => {
        const sort = SORT[p.sort ?? "relevance"];
        const j = await fred(ctx, "series/search", {
          search_text: p.query,
          order_by: sort,
          sort_order: ["search_rank", "popularity", "last_updated"].includes(sort) ? "desc" : "asc",
          limit: FRED_PAGE,
          offset: offsetOf(p.page),
        });
        const series = (j.seriess ?? []).map(seriesMeta);
        return { total: j.count ?? series.length, page: p.page ?? 1, count: series.length, series };
      },
    },
    {
      slug: "category",
      displayName: "Category",
      description: "A FRED category with its child categories and series.",
      method: "GET",
      cacheTtl: 86400,
      fields: [f.int("category", { default: 0, min: 0, description: "Category id (0 = root)" }), fredPage],
      handler: async (p, ctx) => {
        const id = p.category ?? 0;
        const [c, kids, ser] = await Promise.all([
          fred(ctx, "category", { category_id: id }),
          fred(ctx, "category/children", { category_id: id }),
          fred(ctx, "category/series", { category_id: id, limit: FRED_PAGE, offset: offsetOf(p.page) }),
        ]);
        const cat = c.categories?.[0] ?? { id, name: null, parent_id: null };
        return {
          id: cat.id,
          name: cat.name,
          parentId: cat.parent_id ?? null,
          children: (kids.categories ?? []).map((k) => ({ id: k.id, name: k.name })),
          seriesTotal: ser.count ?? 0,
          page: p.page ?? 1,
          series: (ser.seriess ?? []).map(seriesMeta),
        };
      },
    },
    {
      slug: "releases",
      displayName: "Releases",
      description: "Economic data releases published on FRED.",
      method: "GET",
      cacheTtl: 86400,
      fields: [fredPage, f.str("query", { description: "Filter by release name" })],
      handler: async (p, ctx) => {
        const j = await fred(ctx, "releases", p.query ? { limit: 1000 } : { limit: FRED_PAGE, offset: offsetOf(p.page) });
        let releases = (j.releases ?? []).map((r) => ({ id: r.id, name: r.name, pressRelease: r.press_release, link: r.link ?? null }));
        if (p.query) releases = releases.filter((r) => lc(r.name).includes(lc(p.query)));
        return { total: p.query ? releases.length : j.count ?? releases.length, page: p.page ?? 1, count: releases.length, releases };
      },
    },
    {
      slug: "release-dates",
      displayName: "Release Dates",
      description: "Scheduled and past release dates, for all releases or one release.",
      method: "GET",
      cacheTtl: 3600,
      fields: [f.str("from", { pattern: DATE }), f.str("to", { pattern: DATE }), f.int("release", { min: 1, description: "Release id" }), f.int("year", { min: 1900, max: 2100 }), fredPage],
      handler: async (p, ctx) => {
        const from = p.from ?? (p.year ? `${p.year}-01-01` : undefined);
        const to = p.to ?? (p.year ? `${p.year}-12-31` : undefined);
        const params = {
          realtime_start: from,
          realtime_end: to,
          include_release_dates_with_no_data: "true",
          limit: FRED_PAGE,
          offset: offsetOf(p.page),
          sort_order: "desc",
        };
        const j = p.release ? await fred(ctx, "release/dates", { release_id: p.release, ...params }) : await fred(ctx, "releases/dates", { ...params, order_by: "release_date" });
        const dates = (j.release_dates ?? []).map((d) => ({ releaseId: d.release_id, releaseName: d.release_name ?? null, date: d.date }));
        return { total: j.count ?? dates.length, page: p.page ?? 1, count: dates.length, releaseDates: dates };
      },
    },
    {
      slug: "sources",
      displayName: "Sources",
      description: "Institutions that provide data to FRED.",
      method: "GET",
      cacheTtl: 86400,
      fields: [fredPage, f.str("query")],
      handler: async (p, ctx) => {
        const j = await fred(ctx, "sources", p.query ? { limit: 1000 } : { limit: FRED_PAGE, offset: offsetOf(p.page) });
        let sources = (j.sources ?? []).map((s) => ({ id: s.id, name: s.name, link: s.link ?? null }));
        if (p.query) sources = sources.filter((s) => lc(s.name).includes(lc(p.query)));
        return { total: p.query ? sources.length : j.count ?? sources.length, page: p.page ?? 1, count: sources.length, sources };
      },
    },
    {
      slug: "tags",
      displayName: "Tags",
      description: "FRED tags ordered by popularity.",
      method: "GET",
      cacheTtl: 86400,
      fields: [fredPage],
      handler: async (p, ctx) => {
        const j = await fred(ctx, "tags", { limit: FRED_PAGE, offset: offsetOf(p.page), order_by: "popularity", sort_order: "desc" });
        const tags = (j.tags ?? []).map((t) => ({ name: t.name, group: t.group_id, notes: t.notes || null, popularity: t.popularity, seriesCount: t.series_count }));
        return { total: j.count ?? tags.length, page: p.page ?? 1, count: tags.length, tags };
      },
    },
  ],
};

export default [
  coingecko,
  binance,
  indodax,
  okxEx,
  bybitEx,
  mempool,
  defillama,
  blockchainInfo,
  fearGreed,
  cryptoPrice,
  currencyConvert,
  fx,
  worldbank,
  gleif,
  usTreasury,
  ecb,
  secEdgar,
  fredScraper,
];
