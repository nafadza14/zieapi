// Official data, combined. These endpoints answer the questions AI agents ask most often in finance and
// business research in one call, from official sources only, and cite the source of every section and value:
//   official:company   SEC EDGAR + GLEIF: who a company is, its latest filings and headline financials
//   official:macro     U.S. Treasury + FRED + ECB + World Bank: rates, inflation and country fundamentals
// Each section carries its own `source`; values taken from a filing link to that filing.

import { url, getJson, f, ScraperError, num, env } from "../kit.js";
import { buildSource } from "../../core/sources.js";
import { usTreasury, ecb, fredScraper, gleif, resolveCik, archiveUrl } from "./finance.js";

const handlerOf = (def, slug) => def.endpoints.find((e) => e.slug === slug).handler;

/** Run one piece of work with its own URL recorder, so each section can cite exactly what it used. */
async function cited(ctx, fn) {
  const urls = [];
  const sub = { ...ctx, fetch: (u, init) => (urls.push(typeof u === "string" ? u : String(u?.url ?? u)), ctx.fetch(u, init)) };
  try {
    const data = await fn(sub);
    return { ...data, source: buildSource(urls) };
  } catch (e) {
    return { error: e?.message ?? String(e), source: buildSource(urls) };
  }
}

// ---------- company: SEC EDGAR + GLEIF ----------
const FIN = [
  ["revenue", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"], "USD"],
  ["netIncome", ["NetIncomeLoss"], "USD"],
  ["operatingIncome", ["OperatingIncomeLoss"], "USD"],
  ["totalAssets", ["Assets"], "USD"],
  ["totalLiabilities", ["Liabilities"], "USD"],
  ["stockholdersEquity", ["StockholdersEquity"], "USD"],
  ["operatingCashFlow", ["NetCashProvidedByUsedInOperatingActivities"], "USD"],
  ["epsDiluted", ["EarningsPerShareDiluted"], "USD/shares"],
];
const filingIndex = (cik, accn) => archiveUrl(cik, accn, "");

/** Latest annual (10-K, full fiscal year) value of the first tag the company reports. */
async function latestAnnual(ctx, cik, tags, unit) {
  for (const tag of tags) {
    let j;
    try {
      j = await getJson(ctx, `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`);
    } catch (e) {
      if (/404/.test(e.message)) continue;
      throw e;
    }
    // Income-statement and cash-flow items must cover the whole year; balance-sheet items are point-in-time.
    const rows = (j?.units?.[unit] ?? []).filter((v) => /^10-K/.test(v.form ?? "") && v.fp === "FY" && (isFlow(tag) ? v.start && daysBetween(v.start, v.end) > 300 : !v.start));
    if (!rows.length) continue;
    const best = rows.reduce((a, b) => (b.end > a.end || (b.end === a.end && b.filed > a.filed) ? b : a));
    return {
      value: best.val,
      unit,
      periodStart: best.start ?? null,
      periodEnd: best.end,
      fiscalYear: best.fy,
      form: best.form,
      filed: best.filed,
      accessionNumber: best.accn,
      concept: `us-gaap:${tag}`,
      source: filingIndex(cik, best.accn),
    };
  }
  return null;
}
const isFlow = (tag) => !["Assets", "Liabilities", "StockholdersEquity"].includes(tag);
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[.,'"()&]/g, " ")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|holdings?|group|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function secProfile(ctx, p) {
  const { cik } = await resolveCik(ctx, p);
  const s = await getJson(ctx, `https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = s.filings?.recent ?? {};
  const wanted = p.forms ? String(p.forms).toUpperCase().split(",").map((x) => x.trim()) : ["10-K", "10-Q", "8-K", "20-F", "40-F", "6-K", "DEF 14A"];
  const filings = (r.accessionNumber ?? [])
    .map((acc, i) => ({ form: r.form?.[i], filingDate: r.filingDate?.[i], reportDate: r.reportDate?.[i] || null, description: r.primaryDocDescription?.[i] || null, accessionNumber: acc, url: archiveUrl(cik, acc, r.primaryDocument?.[i]) }))
    .filter((x) => wanted.includes(String(x.form).toUpperCase()))
    .slice(0, p.filings ?? 5);
  const biz = s.addresses?.business ?? {};
  return {
    cik,
    name: s.name,
    tickers: s.tickers ?? [],
    exchanges: s.exchanges ?? [],
    sic: s.sic ?? null,
    industry: s.sicDescription ?? null,
    stateOfIncorporation: s.stateOfIncorporation ?? null,
    fiscalYearEnd: s.fiscalYearEnd ?? null,
    ein: s.ein ?? null,
    website: s.website || null,
    businessAddress: { street: [biz.street1, biz.street2].filter(Boolean).join(", ") || null, city: biz.city ?? null, state: biz.stateOrCountry ?? null, zip: biz.zipCode ?? null },
    formerNames: (s.formerNames ?? []).map((x) => x.name),
    latestFilings: filings,
  };
}

async function leiFor(ctx, { lei, name, country }) {
  const run = handlerOf(gleif, "lei");
  if (lei) {
    const r = await run({ lei }, ctx);
    return { match: "exact", record: r.records[0] ?? null, candidates: [] };
  }
  if (!name) return { match: "none", record: null, candidates: [] };
  const r = await run({ query: name, length: 10, country }, ctx);
  const want = norm(name);
  const active = (x) => x.status === "ACTIVE" || x.registration?.status === "ISSUED";
  const exact = r.records.filter((x) => norm(x.legalName) === want || x.otherNames.some((n) => norm(n) === want));
  const pick = exact.find(active) ?? exact[0] ?? null;
  return {
    match: pick ? "name" : "none",
    record: pick,
    // Never guess: when no record matches the name exactly, the closest ones are listed for the caller to check.
    candidates: pick ? [] : r.records.slice(0, 3).map((x) => ({ lei: x.lei, legalName: x.legalName, country: x.legalAddress?.country ?? null, status: x.status })),
  };
}

const company = {
  category: "official",
  slug: "company",
  displayName: "Company (SEC + GLEIF)",
  description: "One call for a company: SEC EDGAR profile and latest filings, its GLEIF Legal Entity Identifier and headline annual financials from XBRL, every value linked to the filing it came from.",
  tags: ["official", "sec", "gleif", "lei", "company", "fundamentals", "kyb", "citations"],
  endpoints: [
    {
      slug: "profile",
      displayName: "Company Profile",
      description: "SEC registrant profile, latest filings, GLEIF LEI record and latest annual financials (revenue, net income, assets, liabilities, equity, cash flow, EPS), each with its source filing.",
      method: "GET",
      cacheTtl: 21600,
      bulkEnabled: true,
      timeoutMs: 25000,
      fields: [
        f.str("company", { example: "AAPL", description: "Ticker or company name (SEC registrants)" }),
        f.str("cik", { description: "SEC Central Index Key" }),
        f.str("lei", { pattern: "^[A-Za-z0-9]{20}$", description: "20-character LEI; works for companies outside the SEC too" }),
        f.bool("financials", { default: true, description: "Include headline annual financials from XBRL" }),
        f.int("filings", { default: 5, min: 0, max: 20, description: "How many recent filings to list" }),
      ],
      handler: async (p, ctx) => {
        if (!p.company && !p.cik && !p.lei) throw new ScraperError("Provide company (ticker or name), cik or lei");
        let lei = null;
        if (p.lei) lei = await cited(ctx, (c) => leiFor(c, { lei: p.lei }));
        const secInput = p.company || p.cik ? p : lei?.record?.legalName ? { company: lei.record.legalName } : null;
        const sec = secInput ? await cited(ctx, (c) => secProfile(c, { ...secInput, filings: p.filings })) : null;
        if (sec?.error && !lei?.record) throw new ScraperError(sec.error);
        if (!lei && sec?.name) lei = await cited(ctx, (c) => leiFor(c, { name: sec.name, country: sec.businessAddress?.state && /^[A-Z]{2}$/.test(sec.businessAddress.state) ? "US" : undefined }));
        let financials = null;
        if (p.financials !== false && sec?.cik) {
          const items = await Promise.all(FIN.map(async ([k, tags, unit]) => [k, await latestAnnual(ctx, sec.cik, tags, unit).catch((e) => ({ error: e.message }))]));
          const got = Object.fromEntries(items.filter(([, v]) => v));
          const fy = Object.values(got).map((v) => v.fiscalYear).filter(Boolean);
          financials = { basis: "Latest full fiscal year reported on Form 10-K (XBRL, us-gaap)", fiscalYear: fy.length ? Math.max(...fy) : null, items: got };
        }
        return {
          name: sec?.name ?? lei?.record?.legalName ?? null,
          sec: sec ?? { error: "Not an SEC registrant or not found" },
          lei: lei ?? null,
          financials,
        };
      },
    },
  ],
};

// ---------- macro: Treasury, FRED, ECB, World Bank ----------
const FRED_US = [
  ["fedFundsEffective", "DFF", "Federal funds effective rate (%)"],
  ["treasury10y", "DGS10", "10-year Treasury constant maturity (%)"],
  ["spread10y2y", "T10Y2Y", "10-year minus 2-year Treasury spread (percentage points)"],
  ["cpi", "CPIAUCSL", "Consumer price index, all urban consumers (index 1982-84=100)"],
  ["unemployment", "UNRATE", "Unemployment rate (%)"],
];
const WB = [
  ["gdpUsd", "NY.GDP.MKTP.CD", "GDP (current US$)"],
  ["gdpGrowth", "NY.GDP.MKTP.KD.ZG", "GDP growth (annual %)"],
  ["inflation", "FP.CPI.TOTL.ZG", "Inflation, consumer prices (annual %)"],
  ["unemployment", "SL.UEM.TOTL.ZS", "Unemployment (% of labour force, ILO estimate)"],
  ["population", "SP.POP.TOTL", "Population, total"],
  ["governmentDebt", "GC.DOD.TOTL.GD.ZS", "Central government debt (% of GDP)"],
  ["currentAccount", "BN.CAB.XOKA.GD.ZS", "Current account balance (% of GDP)"],
];

async function treasuryLatest(ctx) {
  const run = handlerOf(usTreasury, "yield-curve");
  let r = await run({ length: 1 }, ctx);
  if (!r.latest) r = await run({ year: r.year - 1, length: 1 }, ctx); // first days of January
  return { date: r.latest?.date ?? null, ratesPercent: r.latest?.rates ?? {} };
}

const macro = {
  category: "official",
  slug: "macro",
  displayName: "Macro (Treasury, FRED, ECB, World Bank)",
  description: "Latest official rates, inflation and country fundamentals in one call: U.S. Treasury yields and FRED series, ECB policy rates and euro inflation, and World Bank indicators for any country, each section with its source.",
  tags: ["official", "macro", "rates", "inflation", "treasury", "fred", "ecb", "world-bank", "citations"],
  endpoints: [
    {
      slug: "us",
      displayName: "United States Snapshot",
      description: "Treasury par yield curve (latest day) plus FRED: effective fed funds, 10-year yield, 10y-2y spread, CPI and unemployment.",
      method: "GET",
      cacheTtl: 3600,
      timeoutMs: 20000,
      fields: [],
      handler: async (_p, ctx) => {
        const treasury = await cited(ctx, (c) => treasuryLatest(c));
        let fred;
        if (!env("FRED_API_KEY")) fred = { error: "FRED is not configured on this server" };
        else {
          const run = handlerOf(fredScraper, "series-observations");
          const rows = await Promise.all(
            FRED_US.map(async ([k, id, label]) => [k, await cited(ctx, async (c) => {
              const r = await run({ series: id, length: 1 }, c);
              const o = r.observations?.at(-1) ?? null;
              return { series: id, label, date: o?.date ?? null, value: o?.value ?? null };
            })]),
          );
          fred = Object.fromEntries(rows);
        }
        return { treasuryYieldCurve: treasury, fred };
      },
    },
    {
      slug: "euro-area",
      displayName: "Euro Area Snapshot",
      description: "ECB key interest rates (deposit facility, main refinancing, marginal lending), latest HICP inflation and the EUR/USD reference rate.",
      method: "GET",
      cacheTtl: 3600,
      timeoutMs: 20000,
      fields: [],
      handler: async (_p, ctx) => {
        const [rates, hicp, eurusd] = await Promise.all([
          cited(ctx, async (c) => {
            const r = await handlerOf(ecb, "key-rates")({ last: 1 }, c);
            return { rates: Object.fromEntries(r.rates.map((x) => [x.rate, { percent: x.latest?.value ?? null, since: x.latest?.period ?? null, title: x.title }])) };
          }),
          cited(ctx, async (c) => {
            const r = await handlerOf(ecb, "hicp")({ last: 1 }, c);
            const o = r.series?.[0]?.observations?.at(-1) ?? r.latest ?? null;
            return { measure: "Annual rate of change, euro area, all items (%)", period: o?.period ?? null, value: o?.value ?? null };
          }),
          cited(ctx, async (c) => {
            const r = await handlerOf(ecb, "exchange-rates")({ currency: "USD", last: 1 }, c);
            const o = r.rates?.[0]?.latest ?? null;
            return { pair: "EUR/USD", date: o?.period ?? null, rate: o?.value ?? null };
          }),
        ]);
        return { ecbKeyRates: rates, hicpInflation: hicp, eurUsd: eurusd };
      },
    },
    {
      slug: "country",
      displayName: "Country Fundamentals",
      description: "Latest available World Bank values for GDP, growth, inflation, unemployment, population, government debt and current account for one country.",
      method: "GET",
      cacheTtl: 86400,
      bulkEnabled: true,
      timeoutMs: 20000,
      fields: [f.req("country", { example: "US", pattern: "^[A-Za-z]{2,3}$", description: "ISO2 or ISO3 country code" })],
      handler: async (p, ctx) => {
        const c = encodeURIComponent(String(p.country).toUpperCase());
        const rows = await Promise.all(
          WB.map(async ([k, ind, label]) => [k, await cited(ctx, async (sub) => {
            const j = await getJson(sub, url(`https://api.worldbank.org/v2/country/${c}/indicator/${ind}`, { format: "json", mrnev: 1 }));
            if (!Array.isArray(j) || j[0]?.message) throw new ScraperError(j?.[0]?.message?.[0]?.value ?? "Unexpected World Bank response");
            const r = j[1]?.[0];
            return { indicator: ind, label, year: r?.date ?? null, value: num(r?.value) };
          })]),
        );
        const first = rows.map(([, v]) => v).find((v) => !v.error);
        if (!first) throw new ScraperError(rows[0][1].error ?? `No World Bank data for ${p.country}`);
        return { country: String(p.country).toUpperCase(), indicators: Object.fromEntries(rows) };
      },
    },
  ],
};

export default [company, macro];
