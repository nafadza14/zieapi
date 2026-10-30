// Official data: every response cites its source; combined company and macro endpoints; licence guards.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";
import { buildSource, humanPage, publicUrl, OFFICIAL_SOURCES } from "../src/core/sources.js";
import official from "../src/scrapers/live/official.js";
import { mockFetch, run } from "./scrapers/harness.js";

const SUBMISSIONS = {
  cik: "320193",
  name: "Apple Inc.",
  tickers: ["AAPL"],
  exchanges: ["Nasdaq"],
  sic: "3571",
  sicDescription: "Electronic Computers",
  stateOfIncorporation: "CA",
  fiscalYearEnd: "0927",
  addresses: { business: { street1: "One Apple Park Way", city: "Cupertino", stateOrCountry: "CA", zipCode: "95014" } },
  filings: { recent: { accessionNumber: ["0000320193-25-000079", "0000320193-25-000070"], form: ["10-K", "8-K"], filingDate: ["2025-10-31", "2025-10-30"], reportDate: ["2025-09-27", ""], primaryDocument: ["aapl-20250927.htm", "a8k.htm"], primaryDocDescription: ["10-K", "8-K"] } },
};
const concept = (tag, rows, unit = "USD") => ({ cik: 320193, taxonomy: "us-gaap", tag, units: { [unit]: rows } });
const FY = (val, end, start, accn = "0000320193-25-000079") => ({ start, end, val, fy: 2025, fp: "FY", form: "10-K", filed: "2025-10-31", accn });

test("source block: official publisher, human page, licence, credentials stripped", () => {
  const s = buildSource(["https://www.sec.gov/files/company_tickers.json", "https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=SECRET&file_type=json"], "2026-10-30T10:00:00.000Z");
  assert.equal(s.official, true);
  assert.equal(s.provider, "FRED");
  assert.equal(s.publisher, "Federal Reserve Bank of St. Louis");
  assert.equal(s.url, "https://fred.stlouisfed.org/series/DGS10");
  assert.ok(!JSON.stringify(s).includes("SECRET"), "API keys never appear in a citation");
  assert.match(s.attribution, /^Source: Federal Reserve Bank of St\. Louis \(FRED\), retrieved 2026-10-30/);
  assert.match(s.notice, /not endorsed or certified by the Federal Reserve Bank of St\. Louis/);
  assert.equal(s.also.length, 1);
  assert.equal(humanPage("https://api.gleif.org/api/v1/lei-records/HWUPKR0MPOU8FGXBT394"), "https://search.gleif.org/#/record/HWUPKR0MPOU8FGXBT394");
  assert.equal(humanPage("https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json"), "https://data.worldbank.org/indicator/NY.GDP.MKTP.CD?locations=US");
  assert.equal(publicUrl("https://x.test/a?token=1&q=2"), "https://x.test/a?q=2");
  assert.equal(buildSource([]), null);
  assert.equal(OFFICIAL_SOURCES.length, 6);
});

test("company/profile: SEC profile, filings, GLEIF match and annual financials, each value linked to its filing", async () => {
  const fetch = mockFetch([
    ["company_tickers.json", { 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }],
    ["submissions/CIK0000320193.json", SUBMISSIONS],
    ["us-gaap/Revenues.json", (u) => new Response("not found", { status: 404 })],
    ["RevenueFromContractWithCustomerExcludingAssessedTax", concept("RevenueFromContractWithCustomerExcludingAssessedTax", [FY(391035e6, "2024-09-28", "2023-10-01", "0000320193-24-000123"), FY(416161e6, "2025-09-27", "2024-09-29"), { ...FY(102466e6, "2025-09-27", "2025-06-29"), fp: "FY" }])],
    ["us-gaap/NetIncomeLoss.json", concept("NetIncomeLoss", [FY(112010e6, "2025-09-27", "2024-09-29")])],
    ["us-gaap/Assets.json", concept("Assets", [FY(359241e6, "2025-09-27")])],
    ["us-gaap/EarningsPerShareDiluted.json", concept("EarningsPerShareDiluted", [FY(7.46, "2025-09-27", "2024-09-29")], "USD/shares")],
    ["companyconcept", () => new Response("not found", { status: 404 })],
    ["lei-records", { data: [{ id: "HWUPKR0MPOU8FGXBT394", attributes: { lei: "HWUPKR0MPOU8FGXBT394", entity: { legalName: { name: "Apple Inc." }, status: "ACTIVE", legalAddress: { country: "US" } }, registration: { status: "ISSUED" } } }] }],
  ]);
  const out = await run(official, "official:company", "profile", { company: "AAPL" }, fetch);
  assert.equal(out.name, "Apple Inc.");
  assert.equal(out.sec.cik, "0000320193");
  assert.equal(out.sec.latestFilings.length, 2);
  assert.equal(out.sec.source.provider, "SEC EDGAR");
  assert.equal(out.lei.match, "name");
  assert.equal(out.lei.record.lei, "HWUPKR0MPOU8FGXBT394");
  assert.equal(out.lei.source.provider, "GLEIF LEI");
  const rev = out.financials.items.revenue;
  assert.equal(rev.value, 416161e6, "latest full year, not the quarter inside it");
  assert.equal(rev.concept, "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
  assert.equal(rev.source, "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/");
  assert.equal(out.financials.items.totalAssets.value, 359241e6);
  assert.equal(out.financials.items.epsDiluted.unit, "USD/shares");
  assert.equal(out.financials.fiscalYear, 2025);
});

test("company/profile never guesses an LEI: no exact name match lists candidates instead", async () => {
  const fetch = mockFetch([
    ["company_tickers.json", { 0: { cik_str: 1, ticker: "ACME", title: "Acme Widgets Corp" } }],
    ["submissions/", { ...SUBMISSIONS, name: "Acme Widgets Corp", filings: { recent: {} } }],
    ["lei-records", { data: [{ id: "X", attributes: { lei: "529900ABCDEFGHIJKL12", entity: { legalName: { name: "Acme Holdings GmbH" }, status: "ACTIVE", legalAddress: { country: "DE" } } } }] }],
  ]);
  const out = await run(official, "official:company", "profile", { company: "ACME", financials: false }, fetch);
  assert.equal(out.lei.match, "none");
  assert.equal(out.lei.record, null);
  assert.equal(out.lei.candidates[0].lei, "529900ABCDEFGHIJKL12");
  assert.equal(out.financials, null);
});

test("macro/country cites the World Bank for every indicator; a failing indicator does not sink the rest", async () => {
  const fetch = mockFetch([
    ["SL.UEM.TOTL.ZS", () => new Response("boom", { status: 500 })],
    ["worldbank.org", (u) => Response.json([{ page: 1 }, [{ date: "2024", value: /SP.POP/.test(u) ? 340110988 : 2.9 }]])],
  ]);
  const out = await run(official, "official:macro", "country", { country: "us" }, fetch);
  assert.equal(out.country, "US");
  assert.equal(out.indicators.population.value, 340110988);
  assert.equal(out.indicators.population.source.provider, "World Bank Open Data");
  assert.match(out.indicators.population.source.url, /data\.worldbank\.org\/indicator\/SP\.POP\.TOTL\?locations=US/);
  assert.ok(out.indicators.unemployment.error);
  assert.ok(fetch.calls.every((c) => /mrnev=1/.test(c.url)));
});

test("REST response carries the source block, and a cache hit keeps the original retrieval time", async () => {
  const calls = [];
  const fetch = async (u) => {
    calls.push(String(u));
    return Response.json([{ page: 1, total: 1 }, [{ country: { value: "United States" }, countryiso3code: "USA", indicator: { id: "NY.GDP.MKTP.CD", value: "GDP" }, date: "2024", value: 1 }]]);
  };
  const app = createApp({ quiet: true, logger: null, kv: new MemoryKV(), env: { ZIE_KEYS: "max+fin_growth:zie_test_key_official_0000" }, supabaseAuth: null, apiUrl: "http://api.test", publicUrl: "http://p.test", fetch });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  after(() => new Promise((r) => app.server.close(r)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const get = () => fetch2(`${base}/v1/finance:worldbank/indicator?country=US`, { headers: { "x-api-key": "zie_test_key_official_0000" } });
  const r1 = await get();
  const b1 = await r1.json();
  assert.equal(r1.status, 200);
  assert.equal(b1.source.provider, "World Bank Open Data");
  assert.equal(b1.source.official, true);
  assert.match(r1.headers.get("x-source"), /api\.worldbank\.org/);
  const r2 = await get();
  const b2 = await r2.json();
  assert.equal(r2.headers.get("x-cache"), "HIT");
  assert.equal(b2.source.retrievedAt, b1.source.retrievedAt);
  assert.equal(calls.length, 1);
});
const fetch2 = globalThis.fetch;
