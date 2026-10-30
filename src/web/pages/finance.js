import { layout, esc, fmt } from "../html.js";
import { FINANCE_PLANS, FINANCE_COPY, FINANCE_PAYG, LICENCE_COPY, ANNUAL_PAID_MONTHS } from "../../core/plans.js";
import { webPageLd, faqLd, breadcrumb } from "../seo.js";
import { scraperCard, rotatingTitle } from "./home.js";
import { AFFILIATION_NOTE } from "../../core/sources.js";

// /finance: the landing page for Apizie Finance, the premium add-on with official financial and economic data,
// used in marketing to teams building AI agents for research, finance and business analysis. The home page stays general.
// "Why Apizie": what a team building an AI agent gets instead of wiring official sources itself.
// Keep every claim true to what the product does today.
const WHY = [
  ["Every answer comes with its source", "Each response carries the publisher, the official URL, the retrieval time and the licence. Your agent cites it; your users can check it in one click."],
  ["Six official sources, one format", "SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF and the World Bank answer in the same JSON envelope, with the same auth, errors and URL pattern."],
  ["No connectors to maintain", "When a source changes its API, we fix it. Your code and your agent keep working."],
  ["Licence-aware by default", "We follow each publisher's terms: FRED series owned by third parties are excluded, SEC fair-access rules are respected, attribution text is included."],
  ["Built for AI agents", "A hosted MCP server for Claude, ChatGPT and Cursor, with read-only keys by default and per-key category limits."],
  ["Know when the data changes", "Data alerts send a signed webhook when a company files with the SEC, a FRED series updates or the ECB moves rates."],
];

export const FINANCE_FAQ = [
  ["What is Apizie Finance?", "Apizie Finance is a premium Apizie service for AI agents that need official financial and economic facts. It serves normalized data from SEC EDGAR, FRED, the ECB, the U.S. Treasury, GLEIF and the World Bank through one REST API and an MCP server, and every response includes a source block with the publisher, the official URL, when it was retrieved and the licence."],
  ["Why not call SEC EDGAR, FRED and the others directly?", "You can, and for one source that is often the right call. Apizie saves the work of wiring each source one by one, normalizing its format, fixing it when it changes, respecting each publisher's access rules and keeping the source of every number for citations. That is what you pay for, not the data itself."],
  ["Where does the data come from?", "Directly from each publisher's official public API: data.sec.gov and EDGAR full-text search, the FRED API, the ECB Data Portal, Treasury Fiscal Data and the Treasury yield-curve feed, the GLEIF LEI API and the World Bank Indicators API. No scraping."],
  ["How do I use it with Claude, ChatGPT or Cursor?", "Add the Apizie MCP server URL (/mcp). Claude and ChatGPT connect with OAuth and you choose read-only or read and write on the consent screen; Cursor, VS Code and Gemini CLI use an API key header. The agent can then fetch a company profile, rates or indicators and cite the source."],
  ["How much does it cost?", "Finance Starter is $49 a month (100,000 requests, commercial use inside your company, 5 data alerts). Finance Growth is $199 (1,000,000 requests, use in your own product with attribution, 50 alerts, bulk jobs). Finance Business is $499 (5,000,000 requests, 200 alerts). Pay yearly and get 2 months free. Redistribution and resale: Enterprise."],
  ["Is there a free tier?", "No. Apizie Finance is a paid add-on. The rest of Apizie, thousands of public APIs and the MCP server, stays free up to 1,000 requests a month, so you can build and test your integration before adding Finance."],
  ["Does it replace my Apizie plan?", "No. Finance runs next to your general plan (Free, Pro, Ultra or Max) with its own monthly quota. One API key and one MCP connection reach both."],
];

// Hero background: dark plate with violet light waves (self-hosted, WebP with JPEG fallback).
const HERO_BG = "/assets/hero/hero-waves.webp";
const HERO_BG_JPG = "/assets/hero/hero-waves.jpg";

const SAMPLE_RESPONSE = `{
  "project": "official:company",
  "data": {
    "name": "Apple Inc.",
    "financials": {
      "items": {
        "revenue": {
          "value": 416161000000,
          "fiscalYear": 2025,
          "form": "10-K",
          "source": "https://www.sec.gov/Archives/edgar/data/320193/..."
        }
      }
    }
  },
  "source": {
    "official": true,
    "publisher": "U.S. Securities and Exchange Commission",
    "url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193",
    "retrievedAt": "2026-10-30T09:12:44.000Z",
    "license": "Public U.S. government information, free to access",
    "attribution": "Source: U.S. Securities and Exchange Commission (SEC EDGAR), retrieved 2026-10-30, ..."
  },
  "timestamp": "2026-10-30T09:12:44.120Z"
}`;

export function financePage({ user, totals, official = [], combined = 0, global = [], apiUrl, publicUrl }) {
  const officialEndpoints = official.reduce((n, s) => n + (s.endpoints ?? 0), 0) + combined;
  const examples = [
    { key: "official:company", ep: "profile", qs: "?company=AAPL", label: "Company profile" },
    { key: "finance:fred", ep: "series-observations", qs: "?series=FEDFUNDS&length=12", label: "FRED series" },
    { key: "official:macro", ep: "euro-area", qs: "", label: "ECB rates" },
    { key: "finance:us-treasury", ep: "yield-curve", qs: "?length=1", label: "Treasury yields" },
    { key: "finance:gleif", ep: "lei", qs: "?query=Siemens&length=3", label: "LEI lookup" },
    { key: "official:macro", ep: "country", qs: "?country=DE", label: "Country data" },
  ];

  const hero = `
<section class="hero" aria-label="Introduction">
  <div class="hero-plate" aria-hidden="true">
    <picture><source srcset="${HERO_BG}" type="image/webp"><img class="hero-still" src="${HERO_BG_JPG}" alt="" width="1780" height="883" fetchpriority="high"></picture>
  </div>
  <div class="hero-inner">
    <a href="#pricing" class="hero-pill rise r1"><span class="pill-new">Premium</span><span class="pill-long">Apizie Finance · every answer comes with its official source</span><span class="pill-short">Apizie Finance · cited answers</span><span aria-hidden="true">→</span></a>
    ${rotatingTitle(HEADLINES())}
    <div class="rise r5 hero-cta"><a href="${user ? "/dashboard/billing?plan=fin_starter" : "/register?plan=fin_starter"}" class="pill pill-white pill-lg">Add Apizie Finance <span aria-hidden="true">→</span></a><a href="/mcp" class="pill pill-ghost pill-lg">Connect the MCP server</a></div>
    ${sourceStrip(official)}
  </div>
</section>`;

  const stats = `
<section class="stats-strip wrap" aria-label="At a glance">
  <div><b>${official.length}</b><span>official sources</span></div>
  <div><b>${fmt(officialEndpoints)}</b><span>official-data endpoints</span></div>
  <div><b>100%</b><span>of responses cite a source</span></div>
  <div><b>REST + MCP</b><span>one key for both</span></div>
  <div><b>$49</b><span>per month to start</span></div>
</section>`;

  const problem = `
<section class="section wrap" id="why">
  <div class="split">
    <div>
      <span class="eyebrow">The problem</span>
      <h2 class="display-2">Your agent needs facts.<br>Not guesses.</h2>
      <p class="lead">An agent that answers questions about companies, rates or economies needs current official data, and it needs to show where each number came from. Without Apizie your engineers wire SEC EDGAR, FRED and the Federal Reserve one by one, normalize every format, fix whatever breaks and store the source of each value for citations.</p>
      <p class="lead">Apizie Finance has already done that. One key, one format, and a citation on every answer.</p>
    </div>
    <div class="code-card"><div class="code-tabs"><button class="on">Response</button></div><pre class="code"><code>${esc(SAMPLE_RESPONSE)}</code></pre></div>
  </div>
  <div class="why">
    <div class="why-head"><span class="eyebrow">Why Apizie Finance</span><h3 class="display-3">What you get instead of building it.</h3></div>
    <ul class="why-list">${WHY.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join("")}</ul>
  </div>
</section>`;

  const who = `
<section class="section wrap" id="who">
  <div class="section-head"><span class="eyebrow">Who it is for</span><h2 class="display-2">Teams building AI agents on real data.</h2></div>
  <div class="grid-3">
    <article class="card step"><span class="step-n">01</span><h3>Research and analyst agents</h3><p>Answer questions about companies and markets with filings, financials and rates, and show the source of every number.</p></article>
    <article class="card step"><span class="step-n">02</span><h3>Fintech and KYB products</h3><p>Look up a company's SEC registration and its GLEIF Legal Entity Identifier in one call, with the official record linked.</p></article>
    <article class="card step"><span class="step-n">03</span><h3>Internal copilots</h3><p>Give your team's assistant read-only access to macro and company data it can cite, limited to the categories you choose.</p></article>
  </div>
</section>`;

  const sources = `
<section class="section wrap" id="sources">
  <div class="section-head"><span class="eyebrow">Official sources</span><h2 class="display-2">Six publishers. One API.</h2><p class="lead">Every value comes straight from the publisher's own public API. ${esc(AFFILIATION_NOTE)}</p></div>
  <div class="grid-3 source-grid">${official.map(sourceCard).join("")}</div>
  <div class="source-combined card">
    <div><span class="eyebrow">Combined endpoints</span><h3>Ask once, get the whole picture</h3><p><code>official:company/profile</code> joins SEC EDGAR and GLEIF: registrant profile, latest filings, LEI and headline annual financials, each value linked to its filing. <code>official:macro/us</code>, <code>/euro-area</code> and <code>/country</code> return the latest rates, inflation and fundamentals in one call.</p></div>
    <a class="pill pill-white" href="/category/official">See combined endpoints →</a>
  </div>
</section>`;

  const code = `
<section class="section wrap">
  <div class="split">
    <div>
      <span class="eyebrow">One pattern</span>
      <h2 class="display-2">Same call shape<br>for every source.</h2>
      <p class="lead">Every source lives at <code>/v1/{category}:{source}/{endpoint}</code> and answers with <code>{ project, data, source, timestamp }</code>. Swap the source and nothing else changes.</p>
      <div class="swap-chips" role="tablist" aria-label="Example sources">${examples.map((e, i) => `<button role="tab" class="swap${i === 0 ? " on" : ""}" data-swap='${esc(JSON.stringify(e))}' aria-selected="${i === 0}">${esc(e.label)}</button>`).join("")}</div>
    </div>
    <div class="code-card" data-codecard data-api="${esc(apiUrl)}">
      <div class="code-tabs" role="tablist">${["cURL", "JavaScript", "Python", "Go", "MCP"].map((t, i) => `<button role="tab" class="${i === 0 ? "on" : ""}" data-lang="${t}">${t}</button>`).join("")}<button class="copy" data-copy-code aria-label="Copy code">Copy</button></div>
      <pre class="code"><code data-code></code></pre>
      <div class="code-resp"><span class="ok">200 OK</span><span>· source: publisher, URL, licence</span></div>
    </div>
  </div>
</section>`;

  const features = `
<section class="section wrap">
  <div class="section-head"><span class="eyebrow">Built for production</span><h2 class="display-2">Data your product can stand behind.</h2></div>
  <div class="feature-grid">
    <article class="card feat f-wide"><h3>We keep every connector working</h3><p>Publishers change formats and endpoints. We watch every source, fix what breaks and show each endpoint's live status in the catalog.</p><div class="mini-status">${["live", "live", "live", "live", "live", "live"].map((s) => `<i class="dot-${s}"></i>`).join("")}</div></article>
    <article class="card feat"><h3>Citations built in</h3><p><code>source.url</code>, <code>retrievedAt</code>, <code>license</code> and ready-to-use <code>attribution</code> text on every response.</p></article>
    <article class="card feat"><h3>Data alerts</h3><p>Watch a company's filings, a FRED series, the Treasury curve or ECB rates, and get a signed webhook when they change.</p></article>
    <article class="card feat"><h3>Safe for agents</h3><p>New keys are read-only. Limit each key or MCP connection to the categories it needs. Every call is logged.</p></article>
    <article class="card feat"><h3>Fair billing</h3><p>A 5xx never costs you a request, refused calls are never billed, and every response tells you what is left this month.</p></article>
  </div>
</section>`;

  // Finance pricing lives on this page only (the general /pricing page covers the catalog plans).
  const finPlans = Object.values(FINANCE_PLANS);
  const planCta = (id) => (user ? `/dashboard/billing?plan=${id}` : `/register?plan=${id}`);
  const finRows = [
    ["Finance requests / month", (p) => p.monthly.toLocaleString("en-US")],
    ["Requests per minute", (p) => p.perMinute.toLocaleString("en-US")],
    ["Yearly price (2 months free)", (p) => `$${(p.priceUsd * ANNUAL_PAID_MONTHS).toLocaleString("en-US")}`],
    ["Licence", (p) => esc(LICENCE_COPY[p.licence])],
    ["SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF, World Bank", () => "✓"],
    ["Combined endpoints (company profile, macro)", () => "✓"],
    ["Source citation on every answer", () => "✓"],
    ["Data alerts (signed webhooks)", (p) => String(p.alerts)],
    ["Always-fresh data (bypass cache)", (p) => (p.minCacheTtl === 0 ? "✓" : `≥ ${p.minCacheTtl}s`)],
    ["Bulk jobs", (p) => (p.bulk ? `${p.bulkCap.toLocaleString("en-US")} items` : "-")],
    ["Support", (p) => ["", "Email", "Priority email", "Priority + onboarding call"][p.rank]],
  ];
  const pricing = `
<section class="section wrap finance-pricing" id="pricing">
  <div class="section-head center"><span class="eyebrow">Apizie Finance pricing</span><h2 class="display-2">Priced for products, not prototypes.</h2><p class="lead">A premium add-on next to your Apizie plan, with its own quota. Prices in US dollars, monthly or yearly with 2 months free.</p></div>
  <div class="plans plans-3">${finPlans
    .map((p) => {
      const c = FINANCE_COPY[p.id];
      return `<article class="card plan${c.popular ? " popular" : ""}" id="${p.id}" data-plan="${p.id}">
      ${c.popular ? '<span class="plan-flag">Most popular</span>' : ""}
      <h2><small class="plan-kicker">Finance</small> ${c.name}</h2><p class="muted">${c.tagline}</p>
      <div class="price"><b>$${p.priceUsd}</b><span>/ month</span></div>
      <p class="per">$${(p.priceUsd * ANNUAL_PAID_MONTHS).toLocaleString("en-US")}/year · ${esc(LICENCE_COPY[p.licence])}</p>
      <a class="pill ${c.popular ? "pill-white" : "pill-outline"} pill-block" href="${planCta(p.id)}">${c.cta}</a>
      <ul class="checks">${c.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    </article>`;
    })
    .join("")}</div>
  <p class="pay-note muted">Secure checkout by Dodo Payments · Card, Apple Pay and Google Pay · No auto-renewal · Above the Finance quota, pay-as-you-go uses your prepaid balance at $${FINANCE_PAYG.usdPer1k.toFixed(2)} per 1,000 requests</p>
  <article class="card enterprise-band"><div><h2 class="display-3">Finance Enterprise</h2><p class="muted">Redistribution or resale rights, an SLA with service credits, custom sources, security review and invoicing. Priced to your use.</p></div><a class="pill pill-white" href="${user ? "/dashboard/support?type=billing" : "mailto:support@zieads.com?subject=Apizie%20Finance%20Enterprise"}">Talk to us →</a></article>
  <div class="table-wrap mt"><table class="compare"><thead><tr><th></th>${finPlans.map((p) => `<th>${esc(p.name)}</th>`).join("")}</tr></thead><tbody>${finRows.map(([label, fn]) => `<tr><th scope="row">${label}</th>${finPlans.map((p) => `<td>${fn(p)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
</section>`;

  const more = global.length
    ? `
<section class="section wrap">
  <div class="section-head"><span class="eyebrow">Also included</span><h2 class="display-2">Plus ${fmt(totals.scrapers)} more APIs on the same key.</h2>
  <p class="lead">Your Apizie plan also covers news, research, open data and thousands of APIs imported from public OpenAPI specs, free up to 1,000 requests a month. Bring-your-own-key APIs run with your provider key, sent per request and never stored, and need a key with write access to change anything.</p></div>
  <div class="grid-4 top-grid">${global.map(scraperCard).join("")}</div>
  <div class="center"><a href="/scrapers" class="pill pill-outline">Browse the full catalog →</a> <a href="/docs/byok" class="pill pill-ghost">How your own key works</a></div>
</section>`
    : "";

  const agent = `
<section class="section wrap">
  <div class="split reverse">
    <div class="code-card"><div class="code-tabs"><button class="on">Claude Code</button></div><pre class="code"><code>claude mcp add --transport http apizie \\
  ${esc(apiUrl)}/mcp \\
  --header "x-api-key: apz_••••••••"</code></pre>
      <ul class="tool-list">${["search_scrapers", "get_scraper_schema", "list_categories", "run_scraper", "get_account", "get_usage", "bulk_submit", "bulk_status"].map((t) => `<li><code>${t}</code></li>`).join("")}</ul></div>
    <div><span class="eyebrow">MCP</span><h2 class="display-2">An agent that cites its sources.</h2><p class="lead">Point Claude, ChatGPT or Cursor at <code>/mcp</code>. The agent fetches a company profile or a rate, gets the official source with it, and quotes it in its answer. Connections are read-only unless you allow more.</p><a href="/mcp" class="pill pill-white">Set up MCP →</a></div>
  </div>
</section>`;

  const cta = `
<section class="cta-band wrap">
  <h2 class="display-2">Give your agent data it can cite.</h2>
  <p class="lead">Apizie Finance from $49 a month, next to your Apizie plan.</p>
  <a href="${user ? "/dashboard/billing?plan=fin_starter" : "/register?plan=fin_starter"}" class="pill pill-white pill-lg">Add Apizie Finance →</a>
</section>`;

  const faqSec = `
<section class="section wrap narrow" id="faq">
  <div class="section-head"><span class="eyebrow">FAQ</span><h2 class="display-2">Questions, answered.</h2></div>
  <div class="faq">${FINANCE_FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
</section>`;
  const description = "Apizie Finance: official-source data for AI agents. SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF and World Bank data in one REST API and MCP server, with the source on every answer. From $49 a month.";
  return layout({
    active: "finance",
    user,
    bodyClass: "home",
    fullTitle: "Apizie Finance: Official-Source Data for AI Agents, Cited (SEC EDGAR, FRED, ECB, Treasury, GLEIF, World Bank)",
    ogImage: "/assets/og/finance.png",
    description,
    markdown: true,
    canonical: "/finance",
    jsonLd: [webPageLd({ name: "Apizie Finance: official-source data for AI agents", description }), { "@type": "Product", name: "Apizie Finance", description, brand: { "@type": "Brand", name: "Apizie" }, offers: Object.values(FINANCE_PLANS).map((p) => ({ "@type": "Offer", name: p.name, price: String(p.priceUsd), priceCurrency: "USD", url: `${publicUrl}/finance#pricing`, description: `${p.monthly.toLocaleString("en-US")} requests per month. ${LICENCE_COPY[p.licence]}.` })) }, breadcrumb([["Home", "/"], ["Apizie Finance", "/finance"]]), faqLd(FINANCE_FAQ)],
    body: `<main>${hero}${stats}${problem}${who}${sources}${code}${features}${agent}${pricing}${more}${faqSec}${cta}</main>`,
    head: `<link rel="preload" as="image" href="${HERO_BG}" type="image/webp">`,
  });
}

function sourceCard(s) {
  const ex = s.example ? `/api/${s.project.replace(":", "/")}?endpoint=${encodeURIComponent(s.example.endpoint)}` : `/sources/${s.id}`;
  return `<article class="card source-card"><span class="eyebrow">${esc(s.country)}</span><h3><a href="/sources/${esc(s.id)}">${esc(s.name)}</a></h3><p class="muted small">${esc(s.publisher)}</p><p>${esc(s.covers)}.</p><div class="sc-meta"><span>${s.endpoints ?? 0} endpoints</span><a href="${esc(ex)}">Try it →</a></div></article>`;
}

function sourceStrip(official) {
  if (!official.length) return "";
  return `<div class="hero-brands rise r6"><p class="hero-brands-label"><span class="live-dot" aria-hidden="true"></span>Official sources, served and cited</p>
    <ul class="source-strip">${official.map((s) => `<li><a href="/sources/${esc(s.id)}"><b>${esc(s.name)}</b><small>${esc(s.publisher)}</small></a></li>`).join("")}</ul></div>`;
}


// Rotating hero headlines for the Apizie Finance landing page (same animation as the home hero).
const HEADLINES = () => [
  {
    lines: [[["Official-source data", "l"]], [["for"], ["AI agents", "r"]]],
    sub: "Apizie Finance serves SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF and the World Bank through one REST API and one MCP server. Every answer comes with its source.",
  },
  {
    lines: [[["Every answer", "l"]], [["comes with"], ["its source", "r"]]],
    sub: "Each response carries the publisher, the official URL, when it was retrieved and the licence, so your agent can cite it and your users can check it.",
  },
  {
    lines: [[["Skip building", "l"]], [["six connectors", "r"]]],
    sub: "No wiring SEC EDGAR, FRED and the Fed one by one, no format clean-up, no fixing what breaks, no storing sources for citations. It is done.",
  },
  {
    lines: [[["Know when", "l"]], [["the data changes", "r"]]],
    sub: "Data alerts send a signed webhook when a company files with the SEC, a FRED series updates, the Treasury publishes a new curve or the ECB moves rates.",
  },
];
