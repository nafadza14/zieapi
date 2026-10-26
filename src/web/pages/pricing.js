import { layout, esc, fmt, idr } from "../html.js";
import { PLANS, PLAN_COPY } from "../../core/plans.js";

const FAQ = [
  ["Is Apizie really free?", "Yes. The Free plan gives every account 600 requests a month at up to 100 requests a minute, on every live endpoint, with no credit card. It does not expire."],
  ["What happens when I hit the quota?", "Requests return HTTP 429 with a clear message, the limit you hit and a Retry-After header. Nothing is charged automatically. Upgrade from the dashboard or wait for the reset on the 1st (UTC)."],
  ["Do failed requests use up my quota?", "Server-side failures (5xx) are refunded automatically. Client errors (4xx such as invalid parameters) are counted, because the work was done."],
  ["Which tier do I need?", "Start on Free while you build. Move to Pro when real users arrive, Ultra when you need bulk jobs or always-fresh data, and Max for heavy pipelines."],
  ["How do I pay?", "Upgrades are invoiced in Rupiah. Create an invoice from Billing, pay by bank transfer and submit the reference. Your plan is activated as soon as the payment is verified."],
  ["How is Apizie different from a scraping framework?", "You don't run browsers, proxies or parsers. You call an endpoint and get stable JSON. We maintain the integrations; you maintain your product."],
  ["What about the legality of accessing public data?", "Apizie focuses on official APIs, open data and publicly published feeds. You remain responsible for how you use the data. See the Acceptable Use Policy."],
  ["Can I request a source that isn't in the catalog?", "Yes. Use Report an issue → Request a scraper. Popular requests are prioritised."],
];

export function pricingPage({ user }) {
  const plans = Object.values(PLANS);
  const rows = [
    ["Monthly requests", (p) => fmt(p.monthly)],
    ["Requests per minute", (p) => fmt(p.perMinute)],
    ["Price per 1,000 requests", (p) => (p.priceIdr ? idr(Math.round((p.priceIdr / p.monthly) * 1000)) : "-")],
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
  <p class="lead">Pick the monthly volume you need. Prices in Rupiah, billed monthly.</p>
  <div class="quota-toggle" role="group" aria-label="Monthly volume">${plans.map((p, i) => `<button data-quota="${p.id}" class="${i === 0 ? "on" : ""}">${fmt(p.monthly)}</button>`).join("")}</div>
</div></section>
<section class="wrap plans">
  ${plans
    .map((p) => {
      const c = PLAN_COPY[p.id];
      return `<article class="card plan${c.popular ? " popular" : ""}" id="${p.id}" data-plan="${p.id}">
      ${c.popular ? '<span class="plan-flag">Most popular</span>' : ""}
      <h2>${c.name}</h2><p class="muted">${c.tagline}</p>
      <div class="price"><b>${p.priceIdr ? idr(p.priceIdr) : "Rp0"}</b><span>${p.priceIdr ? "/ month" : "forever"}</span></div>
      ${p.priceIdr ? `<p class="per">${idr(Math.round((p.priceIdr / p.monthly) * 1000))} per 1,000 requests</p>` : '<p class="per">No credit card required</p>'}
      <a class="pill ${c.popular ? "pill-white" : "pill-outline"} pill-block" href="${user ? (p.id === "free" ? "/dashboard" : `/dashboard/billing?plan=${p.id}`) : `/register?plan=${p.id}`}">${c.cta}</a>
      <ul class="checks">${c.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    </article>`;
    })
    .join("")}
</section>
<section class="section wrap">
  <div class="section-head"><h2 class="display-2">Every plan, side by side.</h2></div>
  <div class="table-wrap"><table class="compare"><thead><tr><th></th>${plans.map((p) => `<th>${PLAN_COPY[p.id].name}</th>`).join("")}</tr></thead><tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${label}</th>${plans.map((p) => `<td>${fn(p)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
</section>
<section class="section wrap">
  <div class="section-head"><h2 class="display-2">How the quota actually works</h2></div>
  <div class="grid-3">
    <article class="card"><h3>A 5xx never costs you a request.</h3><p>If the failure is on our side or the source is down, the request is refunded automatically.</p></article>
    <article class="card"><h3>The quota resets on the 1st, UTC.</h3><p>Unused requests don't roll over. Paid plans run for 30 days from activation.</p></article>
    <article class="card"><h3>You can see the ceiling coming.</h3><p>Every response carries <code>X-RateLimit-Remaining-Month</code>, and Pro+ accounts get a webhook at 80%.</p></article>
  </div>
</section>
<section class="section wrap narrow">
  <div class="section-head"><h2 class="display-2">Common questions</h2></div>
  <div class="faq">${FAQ.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
</section>
</main>`;
  return layout({ title: "Pricing", active: "pricing", user, body, description: "Free 600 requests/month. Pro, Ultra and Max plans in Rupiah." });
}
