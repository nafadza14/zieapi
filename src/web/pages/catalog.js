import { webPageLd, breadcrumb, faqLd, apiLd, apiSummary, apiFaq, absUrl } from "../seo.js";
import { layout, esc, fmt, json, pageHead, statusBadge, sourceIcon } from "../html.js";
import { scraperCard } from "./home.js";

export function scrapersPage({ user, totals, categories, items, q = "", cat = "" }) {
  const body = `<main class="catalog-page">
${pageHead("Catalog", `Browse all ${fmt(totals.scrapers)} APIs`, `${fmt(totals.endpoints)} endpoints across ${totals.categories} categories · ${fmt(totals.liveEndpoints)} live on this server.`)}
<div class="wrap catalog" data-catalog>
  <aside class="cat-side" aria-label="Categories">
    <button class="cat-item on" data-cat="">All <span>${totals.scrapers}</span></button>
    ${categories.map((c) => `<button class="cat-item" data-cat="${esc(c.slug)}" style="--c:${esc(c.color)}"><i></i>${esc(c.displayName)} <span>${c.scrapers}</span></button>`).join("")}
  </aside>
  <section class="cat-main">
    <div class="cat-tools">
      <label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="search" placeholder="Search scrapers…" value="${esc(q)}" data-q aria-label="Search scrapers"><kbd>⌘K</kbd></label>
      <select data-sort aria-label="Sort"><option value="popular">Most used</option><option value="name">Name A–Z</option><option value="endpoints">Most endpoints</option></select>
    </div>
    <div class="filter-chips" role="group" aria-label="Filters">
      <button class="fchip on" data-filter="">All</button><button class="fchip" data-filter="live">Live now</button><button class="fchip" data-filter="bulk">Bulk support</button><button class="fchip" data-filter="global">Global APIs</button><button class="fchip" data-filter="nokey">No key needed</button><button class="fchip" data-filter="indonesian">Indonesian sources</button>
    </div>
    <div class="mobile-cats">${categories.map((c) => `<button class="cat-chip" data-cat="${esc(c.slug)}" style="--c:${esc(c.color)}"><i></i>${esc(c.displayName)}</button>`).join("")}</div>
    <p class="result-count" data-count aria-live="polite"></p>
    <div class="grid-3 scraper-grid" data-grid>${items.slice(0, 18).map(scraperCard).join("")}</div>
    <div class="center"><button class="pill pill-outline" data-more>Load more scrapers</button></div>
    <p class="muted center small">Missing a source? <a href="/report?type=request">Request a scraper</a>.</p>
  </section>
</div>
<script type="application/json" id="catalog-data">${json({ items: items.map(({ id, description, sourceUrl, maxCacheTtl, minPlan, hasGatedEndpoint, ...it }) => ({ ...it, description: description ? description.slice(0, 120) : null })), initialCat: cat })}</script>
</main>`;
  const description = `Browse ${totals.scrapers.toLocaleString("en-US")} public data APIs and ${totals.endpoints.toLocaleString("en-US")} endpoints: finance, news, Indonesia, social media, research, developer tools and 1,300+ global APIs. One key, clean JSON, MCP-ready.`;
  return layout({ fullTitle: `API Catalog: ${Math.floor(totals.scrapers / 100) * 100}+ Public Data APIs as JSON | Apizie`, active: "scrapers", user, body, description, ogImage: "/assets/og/api.png", canonical: "/scrapers", jsonLd: [webPageLd({ name: "Apizie API catalog", description, type: "CollectionPage" }), breadcrumb([["Home", "/"], ["Catalog", "/scrapers"]])] });
}

export function categoryPage({ user, category, items }) {
  const body = `<main>
${pageHead(`<a href="/scrapers">Catalog</a> / ${esc(category.displayName)}`, esc(category.displayName), `${esc(category.description)} ${category.scrapers.toLocaleString("en-US")} APIs · ${category.endpoints.toLocaleString("en-US")} endpoints.`)}
<div class="wrap section-tight">
  <div class="grid-3 scraper-grid">${items.map(scraperCard).join("")}</div>
  <p class="muted small machine-note">For AI tools: <a href="/category/${esc(category.slug)}/openapi.json" rel="nofollow">OpenAPI spec</a> · <a href="/category/${esc(category.slug)}/llms.txt" rel="nofollow">llms.txt</a>. These are files for agents and code generators, not pages. <a href="/docs#machine-readable">What is this?</a></p>
</div></main>`;
  const description = `${category.displayName} APIs on Apizie: ${category.scrapers} sources and ${category.endpoints} endpoints as clean JSON with one API key. ${category.description}`;
  const list = { "@type": "ItemList", itemListElement: items.slice(0, 50).map((i, n) => ({ "@type": "ListItem", position: n + 1, url: absUrl(`/api/${i.category}/${i.slug}`), name: `${i.displayName} API` })) };
  return layout({ fullTitle: `${category.displayName} APIs: ${category.scrapers} Sources as JSON | Apizie`, active: "scrapers", user, body, description, ogImage: "/assets/og/api.png", markdown: true, jsonLd: [webPageLd({ name: `${category.displayName} APIs`, description, type: "CollectionPage", extra: { mainEntity: list } }), breadcrumb([["Home", "/"], ["Catalog", "/scrapers"], [category.displayName, `/category/${category.slug}`]])] });
}

const CODE_LANGS = ["cURL", "JavaScript", "Python", "Go", "MCP"];

export function scraperPage({ user, s, category, apiUrl, epSlug }) {
  const ep = s.endpoints.find((e) => e.slug === epSlug) ?? s.endpoints[0];
  const errors = [
    [400, "Invalid params, or the source returned an error (exec error)"],
    [401, "Missing or invalid API key"],
    [403, "Your plan does not include this endpoint"],
    [404, "Unknown scraper or endpoint"],
    [429, "Per-minute or monthly limit reached. See Retry-After"],
    [501, "Listed in the catalog but not live on this server yet"],
    [503, "Temporarily disabled or missing server configuration"],
  ];
  const summary = apiSummary(s, apiUrl);
  const faq = apiFaq(s, apiUrl);
  const body = `<main class="detail" data-detail>
<section class="detail-head wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/scrapers">Scrapers</a><span>/</span><a href="/category/${esc(s.category)}">${esc(category?.displayName ?? s.category)}</a></nav>
  <div class="dh-row">
    ${sourceIcon(s, { size: "lg", color: category?.color ?? "#8b8ba7" })}
    <div><h1 class="display-3">${esc(s.displayName)}</h1><p class="sc-key">${esc(s.key)}${s.sourceUrl ? ` · <a class="src-link" href="${esc(s.sourceUrl)}" rel="noopener nofollow" target="_blank">${esc(s.sourceUrl.replace(/^https:\/\//, ""))} ↗</a>` : ""}</p></div>
    <div class="dh-actions">${statusBadge(s.status)}<button class="pill pill-outline pill-sm" data-mcp-open>Use from MCP</button></div>
  </div>
  ${s.description ? `<p class="lead">${esc(s.description)}</p>` : ""}
  <div class="tags">${s.tags.map((t) => `<a href="/scrapers?q=${esc(t)}" class="tag">${esc(t)}</a>`).join("")}</div>
  <div class="dh-stats"><span><b>${s.endpointCount}</b> endpoints</span>${s.status === "byok" ? `<span><b>${s.endpointCount}</b> with your key</span>` : `<span><b>${s.liveEndpoints}</b> live</span>`}<span><b>${fmt(s.totalRequests)}</b> calls</span>${s.hasBulk ? "<span><b>Bulk</b> supported</span>" : ""}</div>
</section>
<div class="wrap detail-body">
  <aside class="ep-list" aria-label="Endpoints">
    <label class="ep-select-label">Endpoint<select data-ep-select aria-label="Endpoint">${s.endpoints.map((e) => `<option value="${esc(e.slug)}"${e.slug === ep.slug ? " selected" : ""}>${esc(e.displayName)}</option>`).join("")}</select></label>
    <ul>${s.endpoints.map((e) => `<li><a href="?endpoint=${esc(e.slug)}" data-ep="${esc(e.slug)}" class="${e.slug === ep.slug ? "on" : ""}"><span class="m m-${e.method.toLowerCase()}">${e.method}</span><span class="ep-name">${esc(e.displayName)}</span><i class="dot-${e.status}" title="${e.status}"></i></a></li>`).join("")}</ul>
  </aside>
  <section class="ep-main" data-ep-main></section>
</div>
<section class="wrap api-about" aria-labelledby="about-h">
  <h2 id="about-h" class="display-3">About the ${esc(s.displayName)} API</h2>
  <p class="lead">${esc(summary)}</p>
  <div class="table-wrap"><table class="doc-table"><tr><th>Project key</th><td><code>${esc(s.key)}</code></td></tr><tr><th>Status</th><td>${statusBadge(s.status)}</td></tr><tr><th>Endpoints</th><td>${s.endpointCount}</td></tr><tr><th>Category</th><td><a href="/category/${esc(s.category)}">${esc(category?.displayName ?? s.category)}</a></td></tr>${s.sourceUrl ? `<tr><th>Source</th><td><a href="${esc(s.sourceUrl)}" rel="noopener nofollow">${esc(s.sourceUrl.replace(/^https?:\/\//, ""))}</a></td></tr>` : ""}<tr><th>Base URL</th><td><code>${esc(apiUrl)}/v1/${esc(s.key)}/{endpoint}</code></td></tr><tr><th>For AI tools</th><td><a href="/api/${esc(s.category)}/${esc(s.slug)}/openapi.json" rel="nofollow">OpenAPI spec</a> · <a href="/api/${esc(s.category)}/${esc(s.slug)}.md" rel="nofollow">Markdown</a> <a class="muted" href="/docs#machine-readable">(what is this?)</a></td></tr></table></div>
  <h2 class="display-3 mt">${esc(s.displayName)} API FAQ</h2>
  <div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
</section>
<dialog class="modal" data-mcp-modal><form method="dialog"><h2>Use ${esc(s.displayName)} from MCP</h2><p>Add Apizie to your agent once, then ask for “${esc(s.displayName)}”: the agent calls <code>run_scraper</code> with <code>${esc(s.key)}</code>.</p><pre class="code"><code>claude mcp add --transport http apizie ${esc(apiUrl)}/mcp \\
  --header "x-api-key: apz_••••••••"</code></pre><div class="center"><a href="/mcp" class="pill pill-outline pill-sm">Other clients</a> <button class="pill pill-white pill-sm">Close</button></div></form></dialog>
<script type="application/json" id="detail-data">${json({ scraper: { key: s.key, displayName: s.displayName, category: s.category, slug: s.slug, auth: s.auth ?? null, provider: s.provider ?? null, origin: s.origin }, endpoints: s.endpoints, current: ep.slug, apiUrl, errors, langs: CODE_LANGS, loggedIn: !!user })}</script>
</main>`;
  const firstSentence = (s.description ?? "").replace(/\s+/g, " ").split(/(?<=[.!?])\s/)[0].slice(0, 80).replace(/[.\s,;:]*$/, "");
  const description = `${s.displayName} API: ${s.endpointCount} endpoint${s.endpointCount === 1 ? "" : "s"} as clean JSON with one key${firstSentence ? `. ${firstSentence}` : ""}. MCP-ready, free 600 requests/month.`;
  return layout({
    fullTitle: `${s.displayName} API: ${s.endpointCount} Endpoint${s.endpointCount === 1 ? "" : "s"} as JSON | Apizie`,
    active: "scrapers", user, body, description, ogImage: "/assets/og/api.png", markdown: true, canonical: `/api/${s.category}/${s.slug}`,
    jsonLd: [webPageLd({ name: `${s.displayName} API`, description, extra: { mainEntity: { "@id": absUrl(`/api/${s.category}/${s.slug}`) + "#api" } } }), apiLd(s, category), breadcrumb([["Home", "/"], ["Catalog", "/scrapers"], [category?.displayName ?? s.category, `/category/${s.category}`], [`${s.displayName} API`, `/api/${s.category}/${s.slug}`]]), faqLd(faq)],
  });
}
