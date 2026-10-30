import { webPageLd, breadcrumb, absUrl } from "../seo.js";
import { layout, esc } from "../html.js";

const c = (code, lang = "bash") => `<div class="code-card sm"><div class="code-tabs"><button class="on">${lang}</button><button class="copy" data-copy-code>Copy</button></div><pre class="code"><code>${esc(code)}</code></pre></div>`;

export const DOCS = [
  {
    group: "Getting started",
    pages: [
      {
        slug: "",
        title: "Overview",
        body: (api) => `<p class="lead">Apizie is a managed API gateway: one API key, one URL pattern and one JSON envelope for thousands of public data sources. Official financial data (SEC EDGAR, FRED, the ECB, the U.S. Treasury, GLEIF and the World Bank) with a citation on every answer is the premium <a href="/finance">Apizie Finance</a> service.</p>
<div class="grid-2 doc-cards">
<a class="card" href="/docs/quickstart"><h3>Quickstart</h3><p>Make your first call in under a minute.</p></a>
<a class="card" href="/docs/authentication"><h3>Authentication</h3><p>API keys, headers and IP allowlists.</p></a>
<a class="card" href="/docs/rest-api"><h3>REST API</h3><p>URL pattern, verbs, path params and envelopes.</p></a>
<a class="card" href="/docs/mcp"><h3>MCP server</h3><p>Give AI agents the whole catalog as tools.</p></a>
<a class="card" href="/docs/finance"><h3>Apizie Finance</h3><p>Premium official financial data: access, quota and pricing.</p></a>
<a class="card" href="/docs/citations"><h3>Sources and citations</h3><p>The <code>source</code> block and how to cite it.</p></a>
<a class="card" href="/docs/permissions"><h3>Key permissions</h3><p>Read-only keys, write access and category limits.</p></a>
<a class="card" href="/docs/alerts"><h3>Data alerts</h3><p>Apizie Finance: a webhook when an official source changes.</p></a>
<a class="card" href="/sources"><h3>Official sources</h3><p>What each publisher covers and its licence.</p></a>
</div>
<h2>Base URL</h2><p><code>${esc(api)}</code></p>
<h2 id="machine-readable">For AI tools and code generators</h2><p>These are plain-text and JSON files meant for software, not for reading in a browser. Point an AI assistant, an agent framework or an SDK generator at them and it learns every Apizie endpoint at once. People usually want the <a href="/scrapers">catalog</a> or the <a href="/mcp">MCP setup</a> instead.</p><ul><li><a href="/openapi.json">/openapi.json</a>: OpenAPI 3.1 for every endpoint (per category: <code>/category/{slug}/openapi.json</code>)</li><li><a href="/llms.txt">/llms.txt</a> and <a href="/llms-full.txt">/llms-full.txt</a>: a summary and the full catalog in the <a href="https://llmstxt.org" rel="noopener">llms.txt</a> format that AI assistants read</li></ul>`,
      },
      {
        slug: "quickstart",
        title: "Quickstart",
        body: (api) => `<ol class="steps-list"><li><a href="/register">Create an account</a> and copy your first key from <a href="/dashboard/keys">Dashboard → API keys</a>.</li><li>Pick a scraper from the <a href="/scrapers">catalog</a>.</li><li>Call it:</li></ol>
${c(`curl "${api}/v1/places:open-meteo/forecast?latitude=48.8566&longitude=2.3522" \\\n  -H "x-api-key: apz_xxx"`)}
<p>Response:</p>${c(`{\n  "project": "places:open-meteo",\n  "data": {\n    "latitude": 48.86, "longitude": 2.35, "timezone": "Europe/Paris",\n    "current": { "temperature_2m": 14.2, "wind_speed_10m": 9.4, "...": "…" },\n    "daily": { "temperature_2m_max": [16.1, 15.4, "…"], "...": "…" }\n  },\n  "timestamp": "2026-10-26T03:00:00.000Z"\n}`, "json")}
<h2>From JavaScript</h2>${c(`const res = await fetch("${api}/v1/finance:coingecko/simple-price?ids=bitcoin,ethereum&vsCurrencies=usd", {\n  headers: { "x-api-key": process.env.APIZIE_KEY },\n});\nconst { data } = await res.json();`, "javascript")}
<h2>From Python</h2>${c(`import requests\nr = requests.get("${api}/v1/news:guardian/feed", params={"section": "technology", "limit": 5},\n                 headers={"x-api-key": "apz_xxx"})\nprint(r.json()["data"]["items"][0]["title"])`, "python")}
<p>Apizie Finance endpoints (SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF, World Bank and <code>official:*</code>) need a <a href="/finance">Finance plan</a> and include a full <code>source</code> block to cite. See <a href="/docs/finance">Apizie Finance</a>.</p>`,
      },
      {
        slug: "authentication",
        title: "Authentication",
        body: () => `<p>Every <code>/v1</code> and <code>/mcp</code> request needs an API key. Send it in any of these headers:</p>
<table class="doc-table"><tr><th>Header</th><th>Example</th></tr><tr><td><code>x-api-key</code></td><td><code>x-api-key: apz_xxx</code> (recommended)</td></tr><tr><td><code>Authorization</code></td><td><code>Authorization: Bearer apz_xxx</code></td></tr><tr><td><code>api-key</code></td><td><code>api-key: apz_xxx</code></td></tr></table>
<h2>Managing keys</h2><p>Create, rename, disable and delete keys in <a href="/dashboard/keys">Dashboard → API keys</a>. The full key is shown only once; we store a SHA-256 hash.</p>
<h2>Permissions</h2><p>New keys are read-only and can be limited to categories. See <a href="/docs/permissions">Key permissions</a>.</p>
<h2>IP allowlist</h2><p>On Pro and above, restrict a key to specific client IPs. Requests from other IPs get <code>403</code>.</p>
<h2>Keep keys server-side</h2><p>Never ship a key in a browser or mobile app. Call Apizie from your backend and forward the result.</p>`,
      },
    ],
  },
  {
    group: "Core",
    pages: [
      {
        slug: "rest-api",
        title: "REST API",
        body: (api) => `<h2>URL pattern</h2><p><code>${esc(api)}/v1/{category}:{scraper}/{endpoint}[/{path-params}]</code></p>
<p>The <em>project key</em> <code>{category}:{scraper}</code> identifies the source (e.g. <code>finance:binance</code>). Each endpoint documents its verb. Most are <code>GET</code> with query parameters; <code>POST</code> endpoints take a JSON body. Calling with the wrong verb returns <code>405</code> with <code>content.expected</code> and an <code>Allow</code> header.</p>
<h2>Path parameters</h2><p>Endpoints such as <code>profile/:username</code> take the value in the path: <code>/v1/social-media:github-user/profile/torvalds</code>. You can also pass it as a query parameter.</p>
<h2>Success envelope</h2>${c(`{ "project": "finance:fred", "data": { … }, "source": { "publisher": "Federal Reserve Bank of St. Louis", "url": "https://fred.stlouisfed.org/series/DGS10", "retrievedAt": "…", "license": "…" }, "timestamp": "2026-10-26T03:00:00.000Z" }`, "json")}<p>See <a href="/docs/citations">Sources and citations</a> for every field of <code>source</code>.</p>
<h2>Response headers</h2><table class="doc-table"><tr><td><code>X-RateLimit-Remaining</code></td><td>Requests left this minute</td></tr><tr><td><code>X-RateLimit-Remaining-Month</code></td><td>Requests left this month</td></tr><tr><td><code>X-Cache</code></td><td><code>HIT</code>, <code>MISS</code>, <code>BYPASS</code> or <code>NONE</code></td></tr><tr><td><code>X-Source</code></td><td>The official API URL the data came from (credentials removed)</td></tr><tr><td><code>x-request-id</code></td><td>Include it when reporting an issue</td></tr></table>
<h2>Caching</h2><p>Each endpoint has a default cache TTL. Pro accounts may lower it to 30 s with <code>?ttl=30</code>; Ultra and Max may bypass it with <code>?ttl=0</code>. Apizie Finance requests follow the Finance plan (Starter 30 s, Growth and Business may bypass). A cached answer keeps the original <code>source.retrievedAt</code>.</p>`,
      },
      {
        slug: "finance",
        title: "Apizie Finance",
        body: (api) => `<p class="lead">Apizie Finance is a premium Apizie service: official financial and economic data from six publishers (SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF and World Bank) through one REST API and one MCP server. Every answer carries its source: publisher, official link, retrieval time, licence and attribution text.</p>
<h2>What it covers</h2><ul><li>The six sources: <code>finance:sec-edgar</code>, <code>finance:fred</code>, <code>finance:ecb</code>, <code>finance:us-treasury</code>, <code>finance:gleif</code>, <code>finance:worldbank</code> (see <a href="/sources">Official sources</a>).</li><li>Combined endpoints: <code>official:company/profile</code> (SEC EDGAR + GLEIF, annual financials linked to filings), <code>official:macro/us</code>, <code>/euro-area</code> and <code>/country</code>.</li><li><a href="/docs/alerts">Data alerts</a> with signed <code>data.changed</code> webhooks.</li></ul>
<h2>Access</h2><p>Finance is an add-on next to your general plan (Free, Pro, Ultra or Max). The same API key and MCP connection reach both. Without an active Finance plan these endpoints answer <code>403 finance_plan_required</code> with an <code>upgrade_url</code>; the call is not billed. Catalog items and MCP search results show <code>premium: "finance"</code>.</p>
${c(`curl "${api}/v1/official:company/profile?company=AAPL" \\\n  -H "x-api-key: apz_xxx"`)}
<h2>Quota and pricing</h2><table class="doc-table"><tr><th>Plan</th><th>Price</th><th>Finance requests / month</th><th>Licence</th><th>Alerts</th></tr><tr><td>Finance Starter</td><td>$49 / month</td><td>100,000</td><td>Commercial use inside your company</td><td>5</td></tr><tr><td>Finance Growth</td><td>$199 / month</td><td>1,000,000</td><td>Use in your own product, with attribution</td><td>50</td></tr><tr><td>Finance Business</td><td>$499 / month</td><td>5,000,000</td><td>Use in your own product, with attribution</td><td>200</td></tr></table>
<p>Finance requests count against the Finance quota only, never against your general plan. Response headers (<code>X-RateLimit-*</code>) show the Finance limits on Finance calls, and <code>GET /v1/usage</code> returns both under <code>month</code> and <code>finance</code>. Above the Finance quota, pay-as-you-go (if switched on) uses the same balance at $1.00 per 1,000 requests. Yearly billing gives 2 months free. Redistribution and resale need an Enterprise agreement. See <a href="/finance#pricing">Apizie Finance pricing</a>.</p>`,
      },
      {
        slug: "citations",
        title: "Sources and citations",
        body: (api) => `<p class="lead">Responses include a <code>source</code> block, complete for the six <a href="/finance">Apizie Finance</a> sources, so your agent can cite the data and your users can check it.</p>
${c(`{\n  "project": "finance:fred",\n  "data": { "series": "FEDFUNDS", "observations": [ … ] },\n  "source": {\n    "official": true,\n    "provider": "FRED",\n    "publisher": "Federal Reserve Bank of St. Louis",\n    "url": "https://fred.stlouisfed.org/series/FEDFUNDS",\n    "apiUrl": "https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&…",\n    "retrievedAt": "2026-10-30T09:12:44.000Z",\n    "license": "Free to use under the FRED API Terms of Use; …",\n    "licenseUrl": "https://fred.stlouisfed.org/docs/api/terms_of_use.html",\n    "attribution": "Source: Federal Reserve Bank of St. Louis (FRED), retrieved 2026-10-30, https://fred.stlouisfed.org/series/FEDFUNDS",\n    "notice": "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis."\n  },\n  "timestamp": "2026-10-30T09:12:44.120Z"\n}`, "json")}
<table class="doc-table"><tr><th>Field</th><th>Meaning</th></tr>
<tr><td><code>official</code></td><td><code>true</code> when the data came from one of the six <a href="/sources">official sources</a></td></tr>
<tr><td><code>provider</code>, <code>publisher</code></td><td>The source and the organisation that publishes it</td></tr>
<tr><td><code>url</code></td><td>A page a person can open to check the value</td></tr>
<tr><td><code>apiUrl</code></td><td>The official API URL that was called, with credentials removed (also in the <code>X-Source</code> header)</td></tr>
<tr><td><code>retrievedAt</code></td><td>When the data was fetched from the source. Cached answers keep the original time.</td></tr>
<tr><td><code>license</code>, <code>licenseUrl</code></td><td>The publisher's terms</td></tr>
<tr><td><code>attribution</code></td><td>A ready-to-use citation line</td></tr>
<tr><td><code>notice</code></td><td>Text a publisher asks you to show (FRED)</td></tr>
<tr><td><code>also</code></td><td>Other URLs used to build the answer (for example a ticker lookup)</td></tr></table>
<h2>Per-value sources</h2><p>Combined endpoints cite each section, and values taken from a filing link to that filing. In <code>official:company/profile</code>, <code>financials.items.revenue.source</code> is the SEC filing index for the 10-K the number came from.</p>
<h2>Prompting an agent</h2><p>Over MCP the server tells agents to cite <code>source</code>. In your own prompts, ask for it: “Answer with the figure and cite source.attribution.”</p>
<h2>Licence rules we apply</h2><ul><li>FRED series that FRED marks as copyrighted by a third party are refused with a clear error.</li><li>SEC requests identify Apizie with a contact address and stay under the SEC's fair-access rate.</li><li>${esc("Apizie is independent and not affiliated with or endorsed by the SEC, the Federal Reserve, the ECB, the U.S. Treasury, GLEIF or the World Bank.")}</li></ul>`,
      },
      {
        slug: "errors",
        title: "Errors",
        body: () => `<p>Errors use <code>{ content, message, errors }</code>. Plan, bulk and quota errors add <code>{ error: { code, message } }</code>.</p>
<table class="doc-table"><tr><th>Status</th><th>Meaning</th><th>Shape</th></tr>
<tr><td>400</td><td>Invalid params</td><td><code>message: "Invalid params"</code>, <code>errors: [{ path, message }]</code></td></tr>
<tr><td>400</td><td>Source error</td><td><code>{ project, error, errors, context?, timestamp }</code></td></tr>
<tr><td>400</td><td>Bulk cap exceeded</td><td><code>error.code: "bulk_cap_exceeded"</code>, <code>cap</code>, <code>submitted</code></td></tr>
<tr><td>401</td><td>Missing / invalid key</td><td><code>message</code></td></tr>
<tr><td>403</td><td>Plan gate</td><td><code>error.code: "plan_upgrade_required"</code>, <code>required_plan</code>, <code>upgrade_url</code></td></tr>
<tr><td>403</td><td>Needs Apizie Finance</td><td><code>error.code: "finance_plan_required"</code>, <code>upgrade_url</code> (not billed)</td></tr>
<tr><td>403</td><td>Key is read-only</td><td><code>error.code: "key_read_only"</code>, <code>required_access</code> (not billed)</td></tr>
<tr><td>403</td><td>Outside the key's categories</td><td><code>error.code: "key_scope"</code>, <code>allowed_categories</code> (not billed)</td></tr>
<tr><td>403</td><td>Bulk not enabled</td><td><code>error.code: "bulk_not_enabled"</code></td></tr>
<tr><td>404</td><td>Unknown scraper / endpoint</td><td><code>message</code></td></tr>
<tr><td>405</td><td>Wrong HTTP verb</td><td><code>content.expected</code> + <code>Allow</code> header</td></tr>
<tr><td>422</td><td>Idempotency key reused with another body</td><td><code>error.code: "idempotency_key_reuse"</code></td></tr>
<tr><td>429</td><td>Rate or monthly limit</td><td><code>content: { limit, used, window, retryAfterSec }</code> + <code>Retry-After</code></td></tr>
<tr><td>501</td><td>Endpoint listed but not live yet</td><td><code>content.status: "planned"</code></td></tr>
<tr><td>503</td><td>Disabled or not configured</td><td><code>message</code></td></tr>
<tr><td>504</td><td>Source timed out</td><td><code>message</code> (refunded)</td></tr></table>`,
      },
      {
        slug: "rate-limits",
        title: "Rate limits & quota",
        body: () => `<p>Each account has a per-minute limit and a monthly quota (see <a href="/pricing">Pricing</a>). Usage is shared across all keys of the account.</p><ul><li>5xx responses are refunded; 4xx are counted.</li><li>The monthly quota resets on the 1st at 00:00 UTC.</li><li>On <code>429</code>, wait <code>Retry-After</code> seconds. <code>content.window</code> tells you whether it was the minute or month limit.</li><li>Retry only <code>429</code>, <code>502</code>, <code>503</code>, <code>504</code> and network errors, with exponential backoff.</li></ul>`,
      },
      {
        slug: "bulk",
        title: "Bulk jobs",
        body: (api) => `<p>Ultra and Max can submit many inputs for one endpoint in a single request (if the endpoint supports bulk). For Apizie Finance endpoints, such as <code>official:company/profile</code> for a list of tickers, Finance Growth and Business can do the same against the Finance quota.</p>
${c(`curl -X POST "${api}/v1/finance:coingecko/simple-price/bulk" \\\n  -H "x-api-key: apz_xxx" -H "content-type: application/json" \\\n  -H "Idempotency-Key: 7f0c…" \\\n  -d '{"items":[{"ids":"bitcoin"},{"ids":"ethereum"}]}'`)}
<p>The response contains <code>jobId</code>, <code>status</code> (<code>COMPLETED</code> / <code>FAILED</code>), per-item <code>items[]</code> and a <code>pollUrl</code>. Fetch it again later with <code>GET /v1/bulk/{jobId}</code> (kept for 7 days). Each item costs one request; failed 5xx items are refunded. Re-sending the same <code>Idempotency-Key</code> returns the same job.</p>`,
      },
      {
        slug: "webhooks",
        title: "Webhooks",
        body: () => `<p>Pro and above, and every Apizie Finance plan, can register up to 5 HTTPS endpoints in <a href="/dashboard/webhooks">Dashboard → Webhooks</a>.</p>
<p>Events: <code>data.changed</code> (a <a href="/docs/alerts">data alert</a> fired), <code>key.blocked</code> (a call was refused by a key's permissions), <code>quota.warning</code> (80%), <code>quota.exceeded</code>, <code>request.error</code>, <code>bulk.completed</code>, <code>bulk.failed</code>, <code>key.created</code>, <code>key.disabled</code>, <code>plan.changed</code>, <code>webhook.test</code>.</p>
<p>Each delivery is a <code>POST</code> with body <code>{ id, event, data, deliveredAt }</code> and header <code>X-Apizie-Signature: sha256=&lt;hex&gt;</code>, an HMAC-SHA256 of the raw body using your webhook secret.</p>
${c(`import { createHmac, timingSafeEqual } from "node:crypto";\n\nfunction verify(rawBody, header, secret) {\n  const want = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");\n  return header && want.length === header.length &&\n    timingSafeEqual(Buffer.from(want), Buffer.from(header));\n}`, "javascript")}`,
      },
      {
        slug: "permissions",
        title: "Key permissions",
        body: (api) => `<p class="lead">API keys and MCP connections are read-only by default, and can be limited to the categories they need.</p>
<h2>Read and write</h2><p>Every endpoint is labelled <code>read</code> or <code>write</code> (see <code>access</code> in <code>get_scraper_schema</code>, <code>x-apizie-access</code> in the OpenAPI spec and the “write” tag in the catalog). Apizie's official sources only read. Bring-your-own-key endpoints that create, change or delete something at a provider are <code>write</code>.</p>
<table class="doc-table"><tr><th>Key access</th><th>What it can call</th></tr><tr><td><code>read</code> (default for new keys)</td><td>Every read endpoint. Write endpoints answer <code>403 key_read_only</code> and are not billed.</td></tr><tr><td><code>read_write</code></td><td>Everything, including write endpoints on your own provider accounts.</td></tr></table>
<p>Keys created before permissions existed keep full access. The dashboard shows when a key last wrote anything and offers to make keys that never write read-only.</p>
<h2>Category limits</h2><p>Limit a key to categories such as <code>official</code> or <code>finance</code>. Calls elsewhere answer <code>403 key_scope</code>, and MCP search only lists what the key may use.</p>
${c(`curl -X POST "${api}/api/me/keys" -H "cookie: …" -H "x-zie-csrf: 1" \\\n  -H "content-type: application/json" \\\n  -d '{"name":"research-agent","access":"read","categories":["official","finance"]}'`)}
<h2>MCP connections</h2><p>When Claude or ChatGPT connects with OAuth, the consent screen asks for read-only or read and write, and which categories. Change it later in <a href="/dashboard/keys">Dashboard → API keys</a>.</p>
<h2>Watching for refusals</h2><p>Refused calls appear in your logs (filter “Blocked”) and send a <code>key.blocked</code> webhook.</p>`,
      },
      {
        slug: "alerts",
        title: "Data alerts",
        body: () => `<p class="lead">Watch an official source and get a signed <code>data.changed</code> webhook and a dashboard notification when it publishes something new.</p>
<table class="doc-table"><tr><th>Alert</th><th>Fires when</th></tr><tr><td>New SEC filings</td><td>A company files a new form (optionally only some forms, e.g. 10-K, 8-K)</td></tr><tr><td>New FRED observation</td><td>A FRED series gets a new or revised latest value</td></tr><tr><td>New Treasury yield curve</td><td>The U.S. Treasury publishes a new daily par yield curve</td></tr><tr><td>ECB policy rate change</td><td>The ECB changes a key interest rate</td></tr><tr><td>New World Bank value</td><td>An indicator gets a newer year for a country</td></tr></table>
<p>Data alerts are part of <a href="/finance">Apizie Finance</a>. Create them in <a href="/dashboard/alerts">Dashboard → Data alerts</a>. Finance Starter includes 5, Growth 50 and Business 200. Alerts are checked about once a day and whenever you press <b>Check now</b>; checks do not use your request quota.</p>
${c(`{\n  "id": "01J…",\n  "event": "data.changed",\n  "data": {\n    "alert": "al_…",\n    "name": "New SEC filings: AAPL",\n    "summary": "Apple Inc. filed 8-K on 2026-11-03",\n    "previous": "Apple Inc. filed 10-K on 2026-10-31",\n    "current": { "form": "8-K", "url": "https://www.sec.gov/Archives/…" },\n    "source": { "publisher": "U.S. Securities and Exchange Commission", "url": "…", "retrievedAt": "…" },\n    "detectedAt": "2026-11-03T06:17:02.000Z"\n  },\n  "deliveredAt": "2026-11-03T06:17:02.400Z"\n}`, "json")}
<p>Verify the <code>X-Apizie-Signature</code> header as described in <a href="/docs/webhooks">Webhooks</a>.</p>`,
      },
      {
        slug: "catalog",
        title: "Catalog API",
        body: (api) => `<p>The catalog is public. No key needed.</p><table class="doc-table">
<tr><td><code>GET /api/public/categories</code></td><td>Categories with counts</td></tr>
<tr><td><code>GET /api/scrapers/list?q=&amp;cat=&amp;cursor=&amp;limit=&amp;sort=</code></td><td>Search scrapers</td></tr>
<tr><td><code>GET /api/scrapers/{category:slug}</code></td><td>Scraper detail with endpoints</td></tr>
<tr><td><code>GET /api/public/scrapers/{slug}/endpoints/{endpoint}/schema</code></td><td>Parameter schema</td></tr>
<tr><td><code>GET /api/public/scrapers/{slug}/stats</code></td><td>Requests and success rate</td></tr></table>
<p>Catalog responses use <code>{ content, message, errors }</code>.</p>${c(`curl "${api}/api/scrapers/list?q=weather&limit=5"`)}
<p>Extra filters: <code>origin=native|directory</code> and <code>auth=none|byok</code>. Each global API also has its own spec at <code>/api/{category}/{slug}/openapi.json</code>.</p>`,
      },
      {
        slug: "byok",
        title: "Global APIs & your own key",
        body: (api) => `<p>Next to the official sources, Apizie includes more than a thousand global APIs as a convenience on the same key (payments, messaging, developer tools, media, open data and more). They are imported from public OpenAPI specs in the <a href="https://github.com/APIs-guru/openapi-directory" rel="noopener">APIs.guru OpenAPI Directory</a> and called through the same <code>/v1</code> pattern, envelope, quotas and MCP tools.</p>
<h2>Two kinds of global API</h2>
<table class="doc-table"><tr><th>Badge</th><th>Meaning</th></tr><tr><td><span class="badge badge-live">Live</span></td><td>The provider needs no key. Call it with just your Apizie key.</td></tr><tr><td><span class="badge badge-byok">Your key</span></td><td>The provider needs credentials. Bring your own key (BYOK).</td></tr></table>
<h2>Sending your provider key</h2>
<p>Add one of these headers next to your Apizie key. Apizie places it where the provider expects (header, query or basic auth) and forwards the call.</p>
<table class="doc-table"><tr><td><code>x-upstream-key</code></td><td>The raw key or token. For basic auth send <code>username:password</code>.</td></tr><tr><td><code>x-upstream-authorization</code></td><td>A full <code>Authorization</code> header value, sent as is.</td></tr></table>
${c(`curl "${api}/v1/finance:stripe/get-balance" \\\n  -H "x-api-key: $APIZIE_KEY" \\\n  -H "x-upstream-key: $STRIPE_SECRET_KEY"`)}
<p>Your provider key is used for that request only. It is never stored, logged or shown in the dashboard, and responses fetched with it are cached per account and per key so they are never served to anyone else.</p>
<p>Without a key, a BYOK endpoint answers <code>401</code> with <code>error.code = "upstream_key_required"</code> and tells you where the key goes. That request is not billed as a success.</p>
<h2>Server-side keys (self-hosting)</h2>
<p>Operators can set a shared key per API with an env var named <code>APIZIE_UPSTREAM_KEY_</code> plus the API key in upper case, for example <code>APIZIE_UPSTREAM_KEY_FINANCE_STRIPE</code>. A caller's own header always wins. Check each provider's terms before sharing a key with your users.</p>
<h2>Via MCP</h2><p><code>run_scraper</code> accepts an optional <code>upstream_key</code> argument. <code>get_scraper_schema</code> returns the auth type.</p>
<h2>Refreshing the directory</h2>${c(`npm i --no-save openapi-directory\nnode scripts/import-openapi.js node_modules/openapi-directory/api`)}`,
      },
    ],
  },
  {
    group: "AI & tools",
    pages: [
      {
        slug: "mcp",
        title: "MCP server",
        body: (api) => `<p>Apizie runs a stateless MCP server (Streamable HTTP) at <code>${esc(api)}/mcp</code>. Authenticate with the same API key. See <a href="/mcp">the MCP page</a> for client-specific setup.</p>
<table class="doc-table"><tr><th>Tool</th><th>What it does</th></tr><tr><td>search_scrapers</td><td>Search the catalog</td></tr><tr><td>get_scraper_schema</td><td>Endpoints of an API (omit endpoint), or the parameters, verb and path of one endpoint</td></tr><tr><td>list_categories</td><td>Categories with counts</td></tr><tr><td>run_scraper</td><td>Run any endpoint (billed like REST)</td></tr><tr><td>get_account</td><td>Plan and key info</td></tr><tr><td>get_usage</td><td>Minute and month usage</td></tr><tr><td>bulk_submit</td><td>Bulk job (Growth and Business)</td></tr><tr><td>bulk_status</td><td>Fetch a bulk job</td></tr></table>`,
      },
      {
        slug: "self-hosting",
        title: "Self-hosting",
        body: () => `<p>Apizie is open source and has zero runtime dependencies.</p>${c(`git clone https://github.com/nafadza14/zieapi\ncd zieapi\nnpm start`)}
<h2>Deploy to Vercel with Supabase</h2><ol><li>In Supabase, open the SQL editor and run <code>supabase/migrations/0001_apizie.sql</code> once. It creates one locked table (<code>apizie_kv</code>) and two functions only the server can call.</li><li>Supabase → Authentication → Sign In / Providers → enable <b>Google</b> with your Google OAuth client. In Google Cloud the authorized redirect URI is <code>https://&lt;project&gt;.supabase.co/auth/v1/callback</code>.</li><li>Supabase → Authentication → URL Configuration: add <code>https://&lt;your-domain&gt;/auth/supabase/callback</code> to Redirect URLs.</li><li>Vercel → Settings → Environment Variables: <code>SUPABASE_PROJECT_ID</code>, <code>SUPABASE_PUBLISHABLE_KEY</code>, <code>SUPABASE_SECRET_KEY</code> (Supabase → Project Settings → API Keys → secret key), <code>APIZIE_SESSION_SECRET</code>, <code>APIZIE_ADMIN_EMAILS</code>, <code>APIZIE_PUBLIC_URL</code>.</li><li>Deploy. <code>/healthz</code> shows <code>"storage":"SupabaseKV"</code> when the database is connected.</li></ol>
<p>Upstash Redis (<code>KV_REST_API_URL</code>/<code>KV_REST_API_TOKEN</code>) also works instead of Supabase. Without either, data lives in memory and is lost on restart.</p>
<h2>Upstream adapter</h2><p>Endpoints that are in the catalog but not implemented locally can be forwarded to a compatible gateway with <code>APIZIE_UPSTREAM_URL</code>, <code>APIZIE_UPSTREAM_KEY</code> and <code>APIZIE_UPSTREAM_HEADER</code>. Check that provider's terms before reselling access.</p>`,
      },
    ],
  },
];

const FLAT = DOCS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.group })));

export function docsPage({ user, slug = "", apiUrl }) {
  const page = FLAT.find((p) => p.slug === slug);
  if (!page) return null;
  const i = FLAT.indexOf(page);
  const prev = FLAT[i - 1];
  const next = FLAT[i + 1];
  const side = DOCS.map((g) => `<div class="doc-group"><h4>${g.group}</h4>${g.pages.map((p) => `<a href="/docs${p.slug ? "/" + p.slug : ""}" class="${p.slug === slug ? "on" : ""}">${p.title}</a>`).join("")}</div>`).join("");
  const body = `<main class="docs wrap">
<aside class="doc-side" aria-label="Documentation">${side}</aside>
<article class="doc-body prose"><span class="eyebrow">${page.group}</span><h1 class="display-3">${page.title}</h1>${page.body(apiUrl)}
<nav class="doc-pager">${prev ? `<a href="/docs${prev.slug ? "/" + prev.slug : ""}">← ${prev.title}</a>` : "<span></span>"}${next ? `<a href="/docs/${next.slug}">${next.title} →</a>` : ""}</nav></article>
</main>`;
  const html0 = page.body(apiUrl);
  const firstP = (/<p[^>]*>([\s\S]*?)<\/p>/.exec(html0)?.[1] ?? "").replace(/<[^>]+>/g, "");
  const description = firstP || `${page.title}: Apizie documentation for the REST API, MCP server, bulk jobs and webhooks.`;
  const jsonLd = [
    webPageLd({ name: `${page.title} | Apizie Docs`, description, type: "TechArticle", extra: { headline: page.title, articleSection: page.group, author: { "@id": absUrl("/") + "#org" } } }),
    breadcrumb([["Home", "/"], ["Docs", "/docs"], ...(page.slug ? [[page.title, `/docs/${page.slug}`]] : [])]),
  ];
  return layout({ fullTitle: page.slug ? `${page.title} | Apizie Docs` : "Apizie Docs: REST API, MCP server and SDK guide", active: "docs", user, body, description, jsonLd, markdown: true });
}

export const DOC_SLUGS = FLAT.map((p) => p.slug);
export const DOC_PAGES = FLAT;
