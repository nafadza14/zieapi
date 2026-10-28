import { webPageLd, breadcrumb, faqLd } from "../seo.js";
import { layout, esc, fmt } from "../html.js";
import { PLANS, PLAN_COPY, PAYG, perThousandUsd, ANNUAL_PAID_MONTHS } from "../../core/plans.js";

const FAQ = [
  ["Is Apizie really free?", "Yes. The Free plan gives every account 1,000 requests a month at up to 100 requests a minute, on every live endpoint, with no credit card. It does not expire."],
  ["What happens when I hit the quota?", "Requests return HTTP 429 with a clear message, the limit you hit and a Retry-After header. Nothing is charged unless you switch on pay-as-you-go, which bills extra requests at $0.40 per 1,000 from a prepaid balance. Otherwise upgrade or wait for the reset on the 1st (UTC)."],
  ["Do failed requests use up my quota?", "Server-side failures (5xx) are refunded automatically. Client errors (4xx such as invalid parameters) are counted, because the work was done."],
  ["Which tier do I need?", "Start on Free while you build. Move to Pro when real users arrive, Ultra when you need bulk jobs or always-fresh data, and Max for heavy pipelines."],
  ["How do I pay?", "Prices are in US dollars. Choose a plan and you go straight to a secure checkout by Dodo Payments, our merchant of record: pay by card, Apple Pay or Google Pay and the plan is active right away. Sales tax or VAT is added at checkout where it applies. Paying for 12 months up front gets you 2 months free."],
  ["Will I be charged automatically?", "No. Each payment covers the months you choose. The end date is shown in your dashboard; renew only if you want to, otherwise the account goes back to Free."],
  ["Is there a yearly discount?", "Yes. Pay for 10 months and get 12: Pro is $90 a year, Ultra $290 and Max $990."],
  ["How is Apizie different from a scraping framework?", "You don't run browsers, proxies or parsers. You call an endpoint and get stable JSON. We maintain the integrations; you maintain your product."],
  ["What about the legality of accessing public data?", "Apizie focuses on official APIs, open data and publicly published feeds. You remain responsible for how you use the data. See the Acceptable Use Policy."],
  ["Can I request a source that isn't in the catalog?", "Yes. Use Report an issue → Request a scraper. Popular requests are prioritised."],
];

export const PRICING_FAQ = FAQ;

export function pricingPage({ user }) {
  const plans = Object.values(PLANS);
  const rows = [
    ["Monthly requests", (p) => fmt(p.monthly)],
    ["Requests per minute", (p) => fmt(p.perMinute)],
    ["Price per 1,000 requests", (p) => perThousandUsd(p) ?? "-"],
    ["Yearly price (2 months free)", (p) => (p.priceUsd ? `$${p.priceUsd * ANNUAL_PAID_MONTHS}` : "-")],
    ["All live endpoints", () => "✓"],
    ["MCP server", () => "✓"],
    ["Usage dashboard", () => "✓"],
    ["Request log retention", (p) => `${p.logDays} days`],
    ["Cache control (ttl)", (p) => (p.minCacheTtl === null ? "-" : p.minCacheTtl === 0 ? "Always fresh" : `≥ ${p.minCacheTtl}s`)],
    ["Webhooks", (p) => (p.webhooks ? "✓" : "-")],
    ["Per-key IP allowlist", (p) => (p.rank >= 1 ? "✓" : "-")],
    ["Bulk jobs", (p) => (p.bulk ? `${fmt(p.bulkCap)} items` : "-")],
    ["Support", (p) => ["Community", "Email", "Email", "Priority"][p.rank]],
  ];
  const body = `<main>
<section class="page-head pricing-head"><div class="wrap center">
  <span class="eyebrow">Pricing</span><h1 class="display">Free until you have users.</h1>
  <p class="lead">Pick the monthly volume you need. Prices in US dollars, billed monthly, or yearly with 2 months free.</p>
  <div class="quota-toggle" role="group" aria-label="Monthly volume">${plans.map((p, i) => `<button data-quota="${p.id}" class="${i === 0 ? "on" : ""}">${fmt(p.monthly)}</button>`).join("")}</div>
</div></section>
<section class="wrap plans">
  ${plans
    .map((p) => {
      const c = PLAN_COPY[p.id];
      return `<article class="card plan${c.popular ? " popular" : ""}" id="${p.id}" data-plan="${p.id}">
      ${c.popular ? '<span class="plan-flag">Most popular</span>' : ""}
      <h2>${c.name}</h2><p class="muted">${c.tagline}</p>
      <div class="price"><b>$${p.priceUsd}</b><span>${p.priceUsd ? "/ month" : "forever"}</span></div>
      ${p.priceUsd ? `<p class="per">${perThousandUsd(p)} per 1,000 requests · $${p.priceUsd * ANNUAL_PAID_MONTHS}/year</p>` : '<p class="per">No credit card required</p>'}
      <a class="pill ${c.popular ? "pill-white" : "pill-outline"} pill-block" href="${user ? (p.id === "free" ? "/dashboard" : `/dashboard/billing?plan=${p.id}`) : `/register?plan=${p.id}`}">${c.cta}</a>
      <ul class="checks">${c.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    </article>`;
    })
    .join("")}
</section>
<p class="wrap pay-note muted">Secure checkout by Dodo Payments · Card, Apple Pay and Google Pay · No auto-renewal · Cancel any time</p>
<section class="section wrap">
  <div class="section-head"><h2 class="display-2">Every plan, side by side.</h2></div>
  <div class="table-wrap"><table class="compare"><thead><tr><th></th>${plans.map((p) => `<th>${PLAN_COPY[p.id].name}</th>`).join("")}</tr></thead><tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${label}</th>${plans.map((p) => `<td>${fn(p)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
</section>
<section class="section wrap">
  <div class="section-head"><h2 class="display-2">How the quota actually works</h2></div>
  <div class="grid-4">
    <article class="card"><h3>A 5xx never costs you a request.</h3><p>If the failure is on our side or the source is down, the request is refunded automatically.</p></article>
    <article class="card"><h3>The quota resets on the 1st, UTC.</h3><p>Unused requests don't roll over. Paid plans run for 30 days from activation.</p></article>
    <article class="card"><h3>Need a little more? Pay as you go.</h3><p>Switch it on and requests above your quota cost $${PAYG.usdPer1k.toFixed(2)} per 1,000 from a prepaid balance, instead of a 429.</p></article>
    <article class="card"><h3>You can see the ceiling coming.</h3><p>Every response carries <code>X-RateLimit-Remaining-Month</code>, and Pro+ accounts get a webhook at 80%.</p></article>
  </div>
</section>
<section class="section wrap narrow">
  <div class="section-head"><h2 class="display-2">Common questions</h2></div>
  <div class="faq">${FAQ.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
</section>
</main>`;
  const description = "Apizie pricing: Free 1,000 requests a month with no credit card, then Pro $9, Ultra $29 and Max $99 per month, or 2 months free yearly. Failed 5xx calls are refunded.";
  return layout({ fullTitle: "Pricing: Free 1,000 Requests/Month, Plans from $9 | Apizie", active: "pricing", user, body, description, ogImage: "/assets/og/pricing.png", markdown: true, jsonLd: [webPageLd({ name: "Apizie pricing", description }), breadcrumb([["Home", "/"], ["Pricing", "/pricing"]]), faqLd(FAQ)] });
}
