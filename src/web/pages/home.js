import { layout, esc, fmt, idr, json, sourceIcon } from "../html.js";
import { PLANS, PLAN_COPY } from "../../core/plans.js";
import { HERO_BRANDS } from "../brands.js";
import { webPageLd, faqLd } from "../seo.js";

export const HOME_FAQ = [
  ["What is Apizie?", "Apizie is an API gateway that puts 1,600+ public APIs and data sources (Wikipedia, GitHub, Binance, BMKG, Indonesian news, research databases and 1,300+ global APIs) behind one API key. Every source answers in the same JSON shape: { project, data, timestamp }."],
  ["How do I use Apizie with Claude, ChatGPT or Cursor?", "Add the Apizie MCP server URL (/mcp) to your app. Claude.ai, Claude Desktop and ChatGPT connect with one click through OAuth; Cursor, VS Code and Gemini CLI use an API key header. The agent can then search the catalog and call any API as a tool."],
  ["Is Apizie free?", "Yes. The Free plan includes 600 requests a month at 100 requests a minute on every live endpoint, with no credit card. Paid plans (Pro, Ultra, Max) raise the limits and add bulk jobs and webhooks."],
  ["Which data sources does Apizie cover?", "Indonesian sources (BMKG earthquakes and weather, IDX stocks, prayer times, postal codes, local news), global finance and crypto (Binance, OKX, CoinGecko), research (PubMed, arXiv), developer tools (GitHub, npm, Docker Hub) and 1,300+ global APIs imported from public OpenAPI specifications."],
  ["What does a request look like?", "GET /v1/{category}:{api}/{endpoint}?param=value with the header x-api-key. For example /v1/search-tools:wikipedia/search?query=Borobudur returns Wikipedia search results as JSON."],
];


const GLOBE_STILL = "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/f1631235-0a76-464d-8f1d-2c4b48a997d5.jpg";
const GLOBE_VIDEO = "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/e71aea27-a808-4ae3-8231-a469d49285d4.mp4";

export function homePage({ user, totals, categories, top, global = [], liveKeys = null, apiUrl, publicUrl }) {
  const apiCount = `${(Math.floor((totals.scrapers ?? 0) / 100) * 100).toLocaleString("en-US")}+`;
  const examples = [
    { key: "indonesia:bmkg", ep: "gempa-terkini", qs: "", label: "Gempa BMKG" },
    { key: "finance:coingecko", ep: "simple-price", qs: "?ids=bitcoin&vs_currencies=idr", label: "Harga kripto" },
    { key: "news:antara", ep: "latest", qs: "?limit=5", label: "Berita Antara" },
    { key: "indonesia:sholat-kemenag", ep: "city-search", qs: "?q=bandung", label: "Jadwal sholat" },
    { key: "search-tools:wikipedia", ep: "search", qs: "?q=Borobudur", label: "Wikipedia" },
  ];

  const hero = `
<section class="hero" aria-label="Introduction">
  <div class="hero-plate" aria-hidden="true">
    <img class="hero-still" src="${GLOBE_STILL}" alt="" width="1672" height="941" fetchpriority="high">
    <video class="hero-video" src="${GLOBE_VIDEO}" muted loop playsinline preload="auto" data-hero-video></video>
  </div>
  <div class="hero-chips" aria-hidden="true">
    <span class="chip-coin c1">{ }</span><span class="chip-coin c2">Rp</span><span class="chip-coin c3">₿</span><span class="chip-coin c4"><svg viewBox="0 0 24 24"><path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v10M7.5 9.5l9 5M16.5 9.5l-9 5" stroke="currentColor" stroke-width="1.2" opacity=".7"/></svg></span>
  </div>
  <div class="hero-inner">
    <a href="/mcp" class="hero-pill rise r1"><span class="pill-new">New</span><span class="pill-long">MCP server for Claude, ChatGPT &amp; Cursor</span><span class="pill-short">MCP for Claude &amp; ChatGPT</span><span aria-hidden="true">→</span></a>
    <h1 class="hero-title"><span class="rise r2"><span class="grad-l">One API key</span> for</span><span class="rise r3"><span class="grad-r">${apiCount}</span> data sources</span></h1>
    <p class="hero-sub rise r4">Stock prices, earthquakes, news, GitHub and Wikipedia as clean JSON. Call them from your code, or let Claude, ChatGPT and Cursor use them through MCP.</p>
    <div class="rise r5 hero-cta"><a href="${user ? "/dashboard" : "/register"}" class="pill pill-white pill-lg">Get Started <span aria-hidden="true">→</span></a><a href="/scrapers" class="pill pill-ghost pill-lg">Browse ${fmt(totals.scrapers)} APIs</a></div>
    ${brandStrip(totals, liveKeys)}
  </div>
  <a href="#steps" class="scroll-hint rise r6" aria-label="Scroll down">
    <svg viewBox="0 0 120 120" class="scroll-ring" aria-hidden="true"><defs><path id="arcL" d="M18 60a42 42 0 0 1 42-42"/><path id="arcR" d="M60 18a42 42 0 0 1 42 42"/></defs><text><textPath href="#arcL" startOffset="18%">JSON</textPath></text><text><textPath href="#arcR" startOffset="30%">MCP</textPath></text></svg>
    <span class="mouse"><span class="wheel"></span></span>
  </a>
</section>`;

  const stats = `
<section class="stats-strip wrap" aria-label="At a glance">
  <div><b>${fmt(totals.scrapers)}</b><span>APIs</span></div>
  <div><b>${fmt(totals.endpoints)}</b><span>endpoints</span></div>
  <div><b>${fmt(totals.liveEndpoints)}</b><span>live right now</span></div>
  <div><b>${totals.categories}</b><span>categories</span></div>
  <div><b>600</b><span>free requests / month</span></div>
</section>`;

  const steps = `
<section class="section wrap" id="steps">
  <div class="section-head"><span class="eyebrow">How it works</span><h2 class="display-2">Three steps to clean data.</h2></div>
  <div class="grid-3">
    <article class="card step"><span class="step-n">01</span><h3>Get a free API key</h3><p>Sign up with Google, GitHub, Discord or email. Your first key is ready in seconds. No card needed.</p></article>
    <article class="card step"><span class="step-n">02</span><h3>Pick a scraper</h3><p>Search ${fmt(totals.scrapers)} sources across ${totals.categories} categories. Every endpoint documents its parameters.</p></article>
    <article class="card step"><span class="step-n">03</span><h3>Call it, get JSON</h3><p>Same URL pattern, same envelope, every source: <code>{ project, data, timestamp }</code>.</p></article>
  </div>
</section>`;

  const find = `
<section class="section wrap">
  <div class="section-head"><span class="eyebrow">Catalog</span><h2 class="display-2">Find the scraper you need.</h2></div>
  <form action="/scrapers" class="search-xl" role="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input name="q" placeholder="Try “saham”, “gempa”, “tiktok”, “jadwal sholat”…" aria-label="Search scrapers"><button class="pill pill-white">Search</button></form>
  <div class="cat-chips">${categories.slice(0, 14).map((c) => `<a href="/category/${c.slug}" class="cat-chip" style="--c:${esc(c.color)}"><i></i>${esc(c.displayName)} <span>${c.scrapers}</span></a>`).join("")}</div>
  <div class="grid-4 top-grid">${top.map(scraperCard).join("")}</div>
  <div class="center"><a href="/scrapers" class="pill pill-outline">See all ${fmt(totals.scrapers)} scrapers →</a></div>
</section>`;

  const globalSec = global.length
    ? `
<section class="section wrap">
  <div class="section-head"><span class="eyebrow">Global APIs</span><h2 class="display-2">${fmt(totals.directoryApis ?? 0)} global APIs. One gateway.</h2>
  <p class="lead">Payments, messaging, developer tools, media, open data and more, imported from public OpenAPI specs. ${fmt(totals.liveEndpoints)} endpoints work with no extra setup. The rest run with your own provider key: send it in <code>x-upstream-key</code> and Apizie never stores it.</p></div>
  <div class="grid-4 top-grid">${global.map(scraperCard).join("")}</div>
  <div class="center"><a href="/scrapers?filter=global" class="pill pill-outline">Explore global APIs →</a> <a href="/docs/byok" class="pill pill-ghost">How your own key works</a></div>
</section>`
    : "";

  const code = `
<section class="section wrap">
  <div class="split">
    <div>
      <span class="eyebrow">One pattern</span>
      <h2 class="display-2">Change one word.<br>Scrape any source.</h2>
      <p class="lead">Every source lives at <code>/v1/{category}:{scraper}/{endpoint}</code>. Swap the project key and you are talking to a different website. Same auth, same envelope, same errors.</p>
      <div class="swap-chips" role="tablist" aria-label="Example sources">${examples.map((e, i) => `<button role="tab" class="swap${i === 0 ? " on" : ""}" data-swap='${esc(JSON.stringify(e))}' aria-selected="${i === 0}">${esc(e.label)}</button>`).join("")}</div>
    </div>
    <div class="code-card" data-codecard data-api="${esc(apiUrl)}">
      <div class="code-tabs" role="tablist">${["cURL", "JavaScript", "Python", "Go", "MCP"].map((t, i) => `<button role="tab" class="${i === 0 ? "on" : ""}" data-lang="${t}">${t}</button>`).join("")}<button class="copy" data-copy-code aria-label="Copy code">Copy</button></div>
      <pre class="code"><code data-code></code></pre>
      <div class="code-resp"><span class="ok">200 OK</span><span>· 184 ms</span><span>· X-Cache: MISS</span></div>
    </div>
  </div>
</section>`;

  const features = `
<section class="section wrap">
  <div class="section-head"><span class="eyebrow">Reliability</span><h2 class="display-2">Built to stay working.</h2></div>
  <div class="feature-grid">
    <article class="card feat f-wide"><h3>We keep every scraper working</h3><p>Sources change their markup and APIs constantly. Health checks run around the clock and every endpoint reports its live status in the catalog, so you never guess.</p><div class="mini-status">${["live", "live", "live", "upstream", "live", "live", "planned", "live"].map((s) => `<i class="dot-${s}"></i>`).join("")}</div></article>
    <article class="card feat"><h3>One response shape</h3><p><code>project</code>, <code>data</code>, <code>timestamp</code>. Errors use the same codes everywhere.</p></article>
    <article class="card feat"><h3>Built for AI agents</h3><p>A remote MCP server exposes the whole catalog as tools for Claude, Cursor and VS Code.</p></article>
    <article class="card feat"><h3>Indonesian sources, first class</h3><p>IDX, BMKG, Kemenag, wilayah, Rupiah, local news and jobs. Not an afterthought.</p></article>
    <article class="card feat"><h3>Pay for what you use</h3><p>A 5xx never costs you a request. Quotas reset on the 1st (UTC) and every response tells you what is left.</p></article>
  </div>
</section>`;

  const pricing = `
<section class="section wrap">
  <div class="section-head"><span class="eyebrow">Pricing</span><h2 class="display-2">Free until you have users.</h2></div>
  <div class="grid-4 plans-mini">${Object.values(PLANS).map((p) => `<a href="/pricing#${p.id}" class="card plan-mini${PLAN_COPY[p.id].popular ? " popular" : ""}"><h3>${PLAN_COPY[p.id].name}</h3><b>${p.priceIdr ? idr(p.priceIdr) : "Rp0"}<small>${p.priceIdr ? "/mo" : " forever"}</small></b><span>${fmt(p.monthly)} req / month</span><span>${fmt(p.perMinute)} req / minute</span></a>`).join("")}</div>
  <div class="center"><a href="/pricing" class="pill pill-outline">Compare plans →</a></div>
</section>`;

  const agent = `
<section class="section wrap">
  <div class="split reverse">
    <div class="code-card"><div class="code-tabs"><button class="on">Claude Code</button></div><pre class="code"><code>claude mcp add --transport http apizie \\
  ${esc(apiUrl)}/mcp \\
  --header "x-api-key: apz_••••••••"</code></pre>
      <ul class="tool-list">${["search_scrapers", "get_scraper_schema", "list_categories", "run_scraper", "get_account", "get_usage", "bulk_submit", "bulk_status"].map((t) => `<li><code>${t}</code></li>`).join("")}</ul></div>
    <div><span class="eyebrow">MCP</span><h2 class="display-2">Let your AI agent do the scraping.</h2><p class="lead">Point any MCP client at <code>/mcp</code>. Your agent searches the catalog, reads the schema and runs the endpoint, on the same key and quota as REST.</p><a href="/mcp" class="pill pill-white">Set up MCP →</a></div>
  </div>
</section>`;

  const cta = `
<section class="cta-band wrap">
  <h2 class="display-2">Start scraping in a minute.</h2>
  <p class="lead">600 free requests every month. No credit card.</p>
  <a href="${user ? "/dashboard/keys" : "/register"}" class="pill pill-white pill-lg">Get a free API key →</a>
</section>`;

  const faqSec = `
<section class="section wrap narrow" id="faq">
  <div class="section-head"><span class="eyebrow">FAQ</span><h2 class="display-2">Questions, answered.</h2></div>
  <div class="faq">${HOME_FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
</section>`;
  const description = `One API key for ${apiCount} public data APIs: Wikipedia, GitHub, Binance, BMKG, news and 1,300+ global APIs as clean JSON, plus an MCP server for Claude, ChatGPT and Cursor. Free 600 requests/month.`;
  return layout({ active: "home", user, bodyClass: "home", description, markdown: true, canonical: "/", jsonLd: [webPageLd({ name: "Apizie: One API key for every public data source", description }), faqLd(HOME_FAQ)], body: `<main>${hero}${stats}${steps}${find}${globalSec}${code}${features}${pricing}${agent}${faqSec}${cta}</main>`, head: `<link rel="preload" as="image" href="${GLOBE_STILL}">` });
}

export function scraperCard(s) {
  return `<a class="card scraper-card" href="/api/${esc(s.category)}/${esc(s.slug)}">
  <div class="sc-top">${sourceIcon(s)}<span class="badge badge-${esc(s.status)}">${{ live: "Live", byok: "Your key", upstream: "Upstream", planned: "Planned", disabled: "Off" }[s.status] ?? ""}</span></div>
  <h3>${esc(s.displayName)}</h3>
  <p class="sc-key">${esc(s.category)}:${esc(s.slug)}</p>
  <div class="sc-meta"><span>${s.endpointCount} endpoint${s.endpointCount === 1 ? "" : "s"}</span>${s.totalRequests ? `<span>${fmt(s.totalRequests)} calls</span>` : ""}${s.hasBulk ? "<span>Bulk</span>" : ""}</div>
</a>`;
}

export const _json = json;

function brandStrip(totals, liveKeys) {
  const brands = HERO_BRANDS.filter((b) => !liveKeys || liveKeys.has(b.key));
  if (!brands.length) return "";
  const item = (b, hidden) => {
    const [cat, slug] = b.key.split(":");
    return `<a class="brand" href="/api/${esc(cat)}/${esc(slug)}"${hidden ? ' tabindex="-1" aria-hidden="true"' : ` aria-label="${esc(b.name)} API (live)"`}><span class="brand-tile"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="${esc(b.color)}" d="${b.path}"/></svg></span><span>${esc(b.name)}</span></a>`;
  };
  return `<div class="hero-brands rise r6">
      <p class="hero-brands-label"><span class="live-dot" aria-hidden="true"></span>Live right now, no extra keys needed</p>
      <div class="brand-marquee"><div class="brand-track">${brands.map((b) => item(b, false)).join("")}${brands.map((b) => item(b, true)).join("")}</div></div>
    </div>`;
}
