// Provenance: where every answer came from.
// Each live call records the upstream URLs it fetched; this module turns them into a citation block
// (official publisher, API URL, human-readable page, licence and attribution) that ships with the response.

/** The official sources Apizie specialises in. Licence notes come from each publisher's own terms page. */
export const OFFICIAL_SOURCES = [
  {
    id: "sec-edgar",
    name: "SEC EDGAR",
    publisher: "U.S. Securities and Exchange Commission",
    hosts: ["sec.gov", "data.sec.gov", "efts.sec.gov"],
    country: "United States",
    covers: "Filings, company profiles and XBRL financial facts for every SEC registrant",
    license: "Public U.S. government information, free to access",
    termsUrl: "https://www.sec.gov/os/accessing-edgar-data",
    homepage: "https://www.sec.gov/edgar/search/",
    project: "finance:sec-edgar",
    example: { endpoint: "concept", params: { company: "AAPL", tag: "Revenues" } },
  },
  {
    id: "fred",
    name: "FRED",
    publisher: "Federal Reserve Bank of St. Louis",
    hosts: ["api.stlouisfed.org", "fred.stlouisfed.org"],
    country: "United States",
    covers: "Economic time series: interest rates, inflation, GDP, employment and more, with vintage history",
    license: "Free to use under the FRED API Terms of Use; series marked as copyrighted by a third party are excluded",
    termsUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html",
    homepage: "https://fred.stlouisfed.org/",
    notice: "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.",
    project: "finance:fred",
    example: { endpoint: "series-observations", params: { series: "FEDFUNDS", length: 12 } },
  },
  {
    id: "ecb",
    name: "ECB Data Portal",
    publisher: "European Central Bank",
    hosts: ["data-api.ecb.europa.eu", "data.ecb.europa.eu", "ecb.europa.eu"],
    country: "Euro area",
    covers: "Euro reference exchange rates, policy rates, HICP inflation and any ECB SDMX series",
    license: "Reusable free of charge with the source acknowledged",
    termsUrl: "https://www.ecb.europa.eu/services/disclaimer/html/index.en.html",
    homepage: "https://data.ecb.europa.eu/",
    project: "finance:ecb",
    example: { endpoint: "key-rates", params: {} },
  },
  {
    id: "us-treasury",
    name: "U.S. Treasury Fiscal Data",
    publisher: "U.S. Department of the Treasury",
    hosts: ["api.fiscaldata.treasury.gov", "fiscaldata.treasury.gov", "home.treasury.gov", "treasury.gov"],
    country: "United States",
    covers: "Par yield curve, federal debt, auctions, average interest rates and the daily Treasury statement",
    license: "Public U.S. government information",
    termsUrl: "https://fiscaldata.treasury.gov/about-us/",
    homepage: "https://fiscaldata.treasury.gov/",
    project: "finance:us-treasury",
    example: { endpoint: "yield-curve", params: { length: 5 } },
  },
  {
    id: "gleif",
    name: "GLEIF LEI",
    publisher: "Global Legal Entity Identifier Foundation",
    hosts: ["api.gleif.org", "search.gleif.org", "gleif.org"],
    country: "Global",
    covers: "Legal Entity Identifiers: legal names, addresses, registration status and parent companies",
    license: "CC0 1.0 (no rights reserved). Apizie is not affiliated with or endorsed by GLEIF",
    termsUrl: "https://www.gleif.org/en/meta/lei-data-terms-of-use",
    homepage: "https://search.gleif.org/",
    project: "finance:gleif",
    example: { endpoint: "lei", params: { query: "Apple Inc", length: 3 } },
  },
  {
    id: "world-bank",
    name: "World Bank Open Data",
    publisher: "The World Bank",
    hosts: ["api.worldbank.org", "data.worldbank.org", "worldbank.org"],
    country: "Global",
    covers: "Development and macro indicators for every country: GDP, inflation, population, debt and more",
    license: "Mostly CC BY 4.0, attribution required (check each dataset's licence)",
    termsUrl: "https://datacatalog.worldbank.org/all-licenses",
    homepage: "https://data.worldbank.org/",
    project: "finance:worldbank",
    example: { endpoint: "indicator", params: { country: "US", indicator: "NY.GDP.MKTP.CD", length: 5 } },
  },
];

export const OFFICIAL_IDS = OFFICIAL_SOURCES.map((s) => s.id);
export const OFFICIAL_PROJECTS = new Set(OFFICIAL_SOURCES.map((s) => s.project));
// Apizie Finance (premium): the six official sources plus the combined, cited endpoints built on them.
// Only accounts with an active Finance plan can call these projects.
export const FINANCE_PROJECTS = new Set([...OFFICIAL_PROJECTS, "official:company", "official:macro"]);
export const isFinanceKey = (key) => FINANCE_PROJECTS.has(key) || String(key ?? "").startsWith("official:");
export const officialById = (id) => OFFICIAL_SOURCES.find((s) => s.id === id) ?? null;
export const officialByProject = (key) => OFFICIAL_SOURCES.find((s) => s.project === key) ?? null;

export const AFFILIATION_NOTE = "Apizie is independent and not affiliated with or endorsed by the SEC, the Federal Reserve, the ECB, the U.S. Treasury, GLEIF or the World Bank.";

const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};
export function officialForHost(host) {
  host = String(host || "").toLowerCase();
  return OFFICIAL_SOURCES.find((s) => s.hosts.some((h) => host === h || host.endsWith("." + h))) ?? null;
}

/** Remove credentials from a URL so it can be shown to anyone. */
export function publicUrl(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/key|token|secret|sig|password|auth/i.test(k)) x.searchParams.delete(k);
    for (const k of ["file_type"]) x.searchParams.delete(k);
    x.username = "";
    x.password = "";
    return x.toString();
  } catch {
    return null;
  }
}

/** A page a person can open to check the value (not the raw API URL), when we know one. */
export function humanPage(u) {
  let x;
  try {
    x = new URL(u);
  } catch {
    return null;
  }
  const h = x.hostname;
  const q = (k) => x.searchParams.get(k);
  if (h === "api.stlouisfed.org") {
    const id = q("series_id");
    return id ? `https://fred.stlouisfed.org/series/${encodeURIComponent(id)}` : "https://fred.stlouisfed.org/";
  }
  if (h === "data.sec.gov") {
    const cik = /CIK(\d{10})/.exec(x.pathname)?.[1];
    return cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&owner=include&count=40` : "https://www.sec.gov/edgar/search/";
  }
  if (h === "efts.sec.gov") return `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(q("q") ?? "")}`;
  if (h.endsWith("sec.gov")) return x.pathname.startsWith("/Archives/") ? x.toString() : "https://www.sec.gov/edgar/search/";
  if (h === "api.worldbank.org") {
    const m = /\/country\/([^/]+)\/indicator\/([^/?]+)/.exec(x.pathname);
    return m ? `https://data.worldbank.org/indicator/${m[2]}?locations=${m[1]}` : "https://data.worldbank.org/";
  }
  if (h === "api.gleif.org") {
    const lei = /lei-records\/([A-Z0-9]{20})/i.exec(x.pathname)?.[1];
    return lei ? `https://search.gleif.org/#/record/${lei}` : "https://search.gleif.org/";
  }
  if (h === "data-api.ecb.europa.eu") {
    const m = /\/data\/([^/]+)\/([^/?]+)/.exec(x.pathname);
    return m ? `https://data.ecb.europa.eu/data/datasets/${m[1]}/${m[1]}.${m[2]}` : "https://data.ecb.europa.eu/";
  }
  if (h === "api.fiscaldata.treasury.gov") {
    const ds = /fiscal_service\/(.+)$/.exec(x.pathname)?.[1];
    return ds ? `https://fiscaldata.treasury.gov/api-documentation/#${ds.split("/").pop()}` : "https://fiscaldata.treasury.gov/";
  }
  if (h === "home.treasury.gov") return "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve";
  return null;
}

/**
 * Turn the URLs a handler fetched into the response's `source` block. Lookup helpers (like the SEC ticker list)
 * are kept, but the last call is usually the one that produced the data, so it leads.
 */
export function buildSource(urls, retrievedAt) {
  const clean = [...new Set((urls ?? []).map(publicUrl).filter(Boolean))];
  if (!clean.length) return null;
  const ordered = [...clean].reverse();
  const primary = ordered[0];
  const off = officialForHost(hostOf(primary)) ?? ordered.map((u) => officialForHost(hostOf(u))).find(Boolean) ?? null;
  const at = retrievedAt ?? new Date().toISOString();
  const page = humanPage(primary);
  const base = {
    official: !!off,
    provider: off?.name ?? hostOf(primary),
    publisher: off?.publisher ?? null,
    url: page ?? primary,
    apiUrl: primary,
    retrievedAt: at,
    license: off?.license ?? null,
    licenseUrl: off?.termsUrl ?? null,
    attribution: off ? `Source: ${off.publisher} (${off.name}), retrieved ${at.slice(0, 10)}${page ? `, ${page}` : ""}` : `Source: ${hostOf(primary)}, retrieved ${at.slice(0, 10)}`,
  };
  if (off?.notice) base.notice = off.notice;
  if (ordered.length > 1) base.also = ordered.slice(1, 6);
  return base;
}
