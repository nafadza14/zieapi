import { SHOWCASE_EXAMPLES } from "../showcase-examples.js";
import { LEGAL_DOCS, COMPANY, LEGAL_UPDATED } from "../legal.js";
import { webPageLd, breadcrumb } from "../seo.js";
import { layout, esc, fmt, pageHead, logo, json } from "../html.js";

// ---------- MCP ----------------------------------------------------------------
export function mcpPage({ user, apiUrl, totals }) {
  const url = `${apiUrl}/mcp`;
  const key = "apz_xxxxxxxx";
  const oauthClients = [
    ["Claude.ai / Claude Desktop", `Settings → Connectors → Add custom connector\n\nName: Apizie\nURL:  ${url}\n\nClick Connect, sign in to Apizie, press Allow. No API key needed.`],
    ["ChatGPT", `Settings → Apps & Connectors → Advanced → Developer mode\nCreate → MCP server URL: ${url}\nAuthentication: OAuth\n\nSign in to Apizie and press Allow.`],
    ["Claude Code (OAuth)", `claude mcp add --transport http apizie ${url}\n# then run /mcp inside Claude Code and choose "Authenticate"`],
  ];
  const keyClients = [
    ["Claude Code", `claude mcp add --transport http apizie \\\n  ${url} \\\n  --header "x-api-key: ${key}"`],
    ["Cursor", `// .cursor/mcp.json\n` + JSON.stringify({ mcpServers: { apizie: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)],
    ["VS Code", `// .vscode/mcp.json\n` + JSON.stringify({ servers: { apizie: { type: "http", url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)],
    ["Gemini CLI", `// ~/.gemini/settings.json\n` + JSON.stringify({ mcpServers: { apizie: { httpUrl: url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)],
    ["Windsurf", `// ~/.codeium/windsurf/mcp_config.json\n` + JSON.stringify({ mcpServers: { apizie: { serverUrl: url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)],
    ["Claude Desktop (key)", `// claude_desktop_config.json\n` + JSON.stringify({ mcpServers: { apizie: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization:Bearer ${key}`] } } }, null, 2)],
    ["curl", `curl ${url} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "content-type: application/json" \\\n  -H "accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`],
  ];
  const tools = [
    ["search_scrapers", "Find APIs by name, source or the data they return. Pages through the whole catalog with a cursor."],
    ["get_scraper_schema", "List an API's endpoints, or read one endpoint's parameters, verb, path, auth and status."],
    ["list_categories", "Every category with its counts."],
    ["run_scraper", "Call any endpoint and get clean JSON. BYOK APIs take upstream_key."],
    ["get_account", "Plan, key status and limits."],
    ["get_usage", "Requests used this month and this minute."],
    ["bulk_submit", "Submit many inputs as one bulk job (Ultra/Max)."],
    ["bulk_status", "Poll a bulk job and fetch its results."],
  ];
  const tabs = (id, list) => `<div class="code-card tabs-card" data-tabs>
    <div class="code-tabs" role="tablist">${list.map(([n], i) => `<button role="tab" class="${i ? "" : "on"}" data-tab="${i}">${esc(n)}</button>`).join("")}<button class="copy" data-copy-code>Copy</button></div>
    ${list.map(([, code], i) => `<pre class="code" data-panel="${i}"${i ? " hidden" : ""}><code>${esc(code)}</code></pre>`).join("")}
  </div>`;
  const body = `<main>
${pageHead("MCP server", `Give your AI agent ${fmt(totals?.scrapers ?? 0)} APIs.`, "Claude, ChatGPT, Cursor, VS Code or Gemini CLI can search the catalog and call any API as a tool, with your account and your quota.")}
<section class="wrap section-tight">
  <div class="grid-4 kv-cards"><div class="card"><span class="muted">Endpoint</span><code class="big">${esc(url)}</code></div><div class="card"><span class="muted">Server</span><b>Apizie · Streamable HTTP</b></div><div class="card"><span class="muted">Sign-in</span><b>OAuth 2.1 (no key needed)</b></div><div class="card"><span class="muted">Or use a key</span><b>Bearer · x-api-key · api-key</b></div></div>
  <div class="steps-row mt">
    <div class="card"><span class="step-n">01</span><h3>Add the server</h3><p>Paste the URL into your app. Apps with OAuth (Claude.ai, ChatGPT) open a Apizie sign-in window. Others take an API key from <a href="${user ? "/dashboard/keys" : "/register"}">your dashboard</a>.</p></div>
    <div class="card"><span class="step-n">02</span><h3>Ask in plain language</h3><p>“Earthquakes in the last hour”, “Bitcoin price in euros”, “Search GitHub repos about MCP”. The agent picks the tools.</p></div>
    <div class="card"><span class="step-n">03</span><h3>Watch usage</h3><p>Every tool call shows up in your request logs and counts against your plan, exactly like REST.</p></div>
  </div>
  <h2 class="display-2 mt">Connect with one click (OAuth)</h2>
  ${tabs("oauth", oauthClients)}
  <h2 class="display-2 mt">Connect with an API key</h2>
  ${tabs("key", keyClients)}
  <h2 class="display-2 mt">8 tools</h2>
  <div class="table-wrap"><table class="doc-table">${tools.map(([n, d]) => `<tr><td><code>${n}</code></td><td>${d}</td></tr>`).join("")}</table></div>
  <div class="grid-3 mt"><div class="card"><h3>Rate limits</h3><p>Tool calls share your plan's per-minute and monthly limits with REST.</p></div><div class="card"><h3>Plan gating</h3><p>Bulk tools need Ultra or Max. Gated endpoints return <code>plan_upgrade_required</code>.</p></div><div class="card"><h3>Revoke access</h3><p>Connected apps are listed in <a href="/dashboard/keys">Dashboard → API keys</a>. Disconnect one and its tokens stop working at once.</p></div></div>
</section></main>`;
  const description = "Connect Claude, ChatGPT, Cursor, VS Code and Gemini CLI to 3,700+ APIs with the Apizie MCP server. One-click OAuth or an API key, 8 tools, same quota as REST.";
  return layout({ fullTitle: "MCP Server: 3,700+ APIs for Claude, ChatGPT & Cursor | Apizie", active: "mcp", user, body, description, ogImage: "/assets/og/mcp.png", jsonLd: [webPageLd({ name: "Apizie MCP server", description, type: "TechArticle", extra: { headline: "Connect AI agents to 3,700+ APIs with MCP" } }), breadcrumb([["Home", "/"], ["MCP server", "/mcp"]])] });
}

// ---------- OAuth consent ------------------------------------------------------
export function consentPage({ user, client, scope, tx, redirectHost }) {
  const body = `<main class="auth">
<div class="auth-glow" aria-hidden="true"></div>
<section class="auth-card card consent">
  <a href="/" class="auth-logo" aria-label="Apizie home">${logo()}</a>
  <h1>Connect ${esc(client.client_name)}?</h1>
  <p class="muted"><b>${esc(client.client_name)}</b> wants to use Apizie as <b>${esc(user.email ?? user.name)}</b>.</p>
  <ul class="consent-list">
    <li>Search the catalog and run APIs through MCP</li>
    <li>Use your plan's quota (calls appear in your logs)</li>
    <li>Read your plan and usage</li>
  </ul>
  <p class="muted small">After you allow, you will be sent back to <b>${esc(redirectHost)}</b>. It cannot see your password or API keys, and you can disconnect it any time in the dashboard.</p>
  <form method="post" action="/oauth/authorize" class="consent-actions">
    <input type="hidden" name="tx" value="${esc(tx)}">
    <button class="pill pill-outline" name="decision" value="deny">Cancel</button>
    <button class="pill pill-white" name="decision" value="approve" autofocus>Allow</button>
  </form>
  <p class="muted tiny">Scope: ${esc(scope)}</p>
</section></main>`;
  return layout({ title: "Authorize app", body, bare: true, bodyClass: "auth-body", noindex: true });
}

export function oauthErrorPage({ user, message }) {
  const body = `<main class="auth"><section class="auth-card card"><a href="/" class="auth-logo" aria-label="Apizie home">${logo()}</a><h1>Can't connect this app</h1><p class="form-error" role="alert">${esc(message)}</p><a class="pill pill-outline" href="/mcp">How to connect</a></section></main>`;
  return layout({ title: "Authorization error", user, body, bare: true, bodyClass: "auth-body", noindex: true });
}

// ---------- Showcase -----------------------------------------------------------
export function showcasePage({ user, items }) {
  const apiHref = (key, ep) => `/api/${esc(key.replace(":", "/"))}?endpoint=${encodeURIComponent(ep)}`;
  const example = (x, i) => `<article class="card sc-ex" id="${esc(x.slug)}">
    <div class="sc-ex-top"><span class="sc-ex-n">${String(i + 1).padStart(2, "0")}</span><span class="sc-ex-kind">${esc(x.kind)}</span></div>
    <h3>${esc(x.title)}</h3>
    <p>${esc(x.summary)}</p>
    <p class="sc-ex-who"><span>For</span> ${esc(x.who)}</p>
    <div class="sc-ex-uses"><span>Uses</span>${x.uses.map(([key, ep]) => `<a href="${apiHref(key, ep)}"><code>${esc(key)}/${esc(ep)}</code></a>`).join("")}</div>
    <details class="sc-ex-code"><summary>See the code <span>${esc(x.lang)}</span></summary><div class="code-card sm"><div class="code-tabs"><span>${esc(x.lang)}</span><button class="copy" data-copy-code type="button">Copy</button></div><pre class="code"><code>${esc(x.code)}</code></pre></div></details>
  </article>`;
  const community = items.length
    ? `<div class="grid-3">${items.map((p) => `<a class="card show-card" href="${esc(p.url)}" rel="noopener nofollow" target="_blank"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><span class="muted small">${esc(new URL(p.url).hostname)}</span></a>`).join("")}</div>`
    : `<p class="muted">No community projects yet. Ship one of the ideas above, or your own, and it could be the first one here.</p>`;
  const body = `<main>
${pageHead("Showcase", "Built with Apizie.", "Six things you can ship this week with one Apizie key. Each one is a working example from our team with the real endpoints and the code to copy.")}
<section class="wrap section-tight">
  <div class="sc-head"><h2 class="display-3">Example builds</h2><p class="muted">Made by the Apizie team to show what the API and the MCP server can do. Swap in your key and run them.</p></div>
  <div class="sc-grid">${SHOWCASE_EXAMPLES.map(example).join("")}</div>
  <div class="sc-cta card"><div><h3>Want to build one of these?</h3><p class="muted">Free plan: 1,000 requests a month, no card. Your first key takes a few seconds.</p></div><div class="row-links"><a class="pill pill-white" href="${user ? "/dashboard/keys" : "/register"}">${user ? "Get your API key" : "Create a free account"}</a><a class="pill pill-outline" href="/docs/quickstart">Quickstart</a></div></div>
</section>
<section class="wrap section-tight">
  <div class="sc-head"><h2 class="display-3">From the community</h2><p class="muted">Projects people have shipped on Apizie, reviewed by our team before they appear here.</p></div>
  ${community}
  <div class="card mt submit-card">
    <h2>Submit your project</h2>
    ${user ? `<form class="form" data-form="/api/showcase" data-success="Thanks! We'll review it shortly."><label>Project name<input name="name" required maxlength="80"></label><label>URL<input name="url" type="url" required placeholder="https://"></label><label class="full">What does it do?<textarea name="description" required maxlength="280" rows="3"></textarea></label><button class="pill pill-white">Submit</button><p class="form-msg" role="status"></p></form>` : `<p><a href="/login?next=/showcase">Sign in</a> to submit your project. Ultra and Max plans get their logo on the “Built with Apizie” strip.</p>`}
  </div>
</section></main>`;
  return layout({ title: "Showcase: example builds", description: "Six example projects built on Apizie: an earthquake alert bot, crypto prices in rupiah, a research agent for Claude, prayer times, a news digest and a checkout address picker, with code.", active: "showcase", user, body });
}

// ---------- Report -------------------------------------------------------------
export function reportPage({ user, type = "issue", scraper = "" }) {
  const body = `<main>
${pageHead("Support", type === "request" ? "Request a scraper" : "Report an issue", "Tell us what broke or what source you need. Include the x-request-id if you have one.")}
<section class="wrap narrow section-tight"><form class="card form" data-form="/api/report" data-success="Received, thank you. We'll follow up by email if needed.">
  <label>Type<select name="type"><option value="issue"${type === "issue" ? " selected" : ""}>Something is broken</option><option value="request"${type === "request" ? " selected" : ""}>Request a new source</option><option value="other">Other</option></select></label>
  <label>Email<input name="email" type="email" value="${esc(user?.email ?? "")}" required></label>
  <label>Scraper (optional)<input name="scraper" value="${esc(scraper)}" placeholder="e.g. finance:idx"></label>
  <label>Request ID (optional)<input name="requestId" placeholder="01H…"></label>
  <label class="full">Details<textarea name="message" required rows="6" maxlength="4000"></textarea></label>
  <button class="pill pill-white">Send</button><p class="form-msg" role="status"></p>
</form></section></main>`;
  return layout({ title: "Report an issue", user, body });
}

// ---------- Status -------------------------------------------------------------
export function statusPage({ user, categories, totals, uptimeSec, requests }) {
  const body = `<main>
${pageHead("Status", "All systems operational.", `Gateway up for ${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m on this instance · ${fmt(requests)} requests served.`)}
<section class="wrap section-tight"><div class="table-wrap"><table class="doc-table status-table"><thead><tr><th>Category</th><th>Scrapers</th><th>Live</th><th>Endpoints</th><th>Status</th></tr></thead><tbody>
${categories.map((c) => `<tr><td><a href="/category/${esc(c.slug)}">${esc(c.displayName)}</a></td><td>${c.scrapers}</td><td>${c.live}</td><td>${c.endpoints}</td><td>${c.live ? '<span class="badge badge-live">Operational</span>' : '<span class="badge badge-byok">Your key</span>'}</td></tr>`).join("")}
</tbody></table></div><p class="muted small">${totals.liveEndpoints} of ${totals.endpoints} endpoints are live on this deployment.</p></section></main>`;
  return layout({ title: "Status", user, body });
}

// ---------- Legal ----------------------------------------------------------------
const inline = (t) =>
  esc(t)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/|mailto:)[^)\s]*)\)/g, '<a href="$2">$1</a>');
const legalBlock = (b) => (Array.isArray(b) ? `<ul>${b[1].map((li) => `<li>${inline(li)}</li>`).join("")}</ul>` : `<p>${inline(b)}</p>`);
const slugify = (h) => h.toLowerCase().replace(/^\d+\.\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function legalPage({ user, slug }) {
  const doc = LEGAL_DOCS[slug];
  if (!doc) return null;
  const toc = doc.sections.length > 6 ? `<nav class="legal-toc" aria-label="On this page"><b>On this page</b><ol>${doc.sections.map((s) => `<li><a href="#${slugify(s.h)}">${esc(s.h.replace(/^\d+\.\s*/, ""))}</a></li>`).join("")}</ol></nav>` : "";
  const others = [["terms", "Terms"], ["privacy", "Privacy"], ["cookies", "Cookies"], ["aup", "Acceptable use"], ["refund", "Refunds"]].map(([k, l]) => `<a href="/${k}"${k === slug ? ' aria-current="page"' : ""}>${l}</a>`).join("");
  const body = `<main>${pageHead("Legal", esc(doc.title), `Last updated ${LEGAL_UPDATED}. ${esc(COMPANY.product)} is operated by ${esc(COMPANY.name)}.`)}
<div class="wrap section-tight legal-wrap">
  <article class="prose legal">
    <p class="lead">${inline(doc.lead)}</p>
    ${toc}
    ${doc.sections.map((s) => `<section id="${slugify(s.h)}"><h2>${esc(s.h)}</h2>${s.blocks.map(legalBlock).join("")}</section>`).join("")}
  </article>
  <aside class="legal-side">
    <div class="card legal-co"><span class="muted small">Operated by</span><b>${esc(COMPANY.name)}</b><p class="small">${esc(COMPANY.office)}</p><a class="small" href="mailto:${esc(COMPANY.email)}">${esc(COMPANY.email)}</a></div>
    <nav class="legal-links" aria-label="Legal documents">${others}</nav>
  </aside>
</div></main>`;
  return layout({ title: doc.title, user, body, description: `${doc.title} for ${COMPANY.product}, operated by ${COMPANY.name}. ${doc.lead.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")}`.slice(0, 300) });
}

// ---------- Auth -----------------------------------------------------------------
export function authPage({ mode, providers, next = "/dashboard", error = "", plan = "" }) {
  const isReg = mode === "register";
  const icons = {
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.2.8-.6v-2.2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 12 .5Z"/></svg>',
    google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8a6 6 0 0 1 0-12c1.9 0 3.1.8 3.8 1.5l2.6-2.5A9.6 9.6 0 0 0 12 2.4a9.6 9.6 0 1 0 0 19.2c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12Z"/></svg>',
    discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#8b9cff" d="M20 4.6A18 18 0 0 0 15.6 3l-.6 1.1a16 16 0 0 0-6 0L8.4 3A18 18 0 0 0 4 4.6C1.2 8.8.4 12.8.8 16.8A18 18 0 0 0 6.3 19.6l1.2-1.9a11 11 0 0 1-1.8-.9l.4-.3a12.8 12.8 0 0 0 11.8 0l.4.3c-.6.4-1.2.7-1.8.9l1.2 1.9a18 18 0 0 0 5.5-2.8c.5-4.6-.8-8.6-3.2-12.2ZM8.5 14.4c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.2-1.9 2.2Zm7 0c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.2-1.9 2.2Z"/></svg>',
  };
  const body = `<main class="auth">
<div class="auth-glow" aria-hidden="true"></div>
<section class="auth-card card">
  <a href="/" class="auth-logo" aria-label="Apizie home">${logo()}</a>
  <h1>${isReg ? "Create your account" : "Welcome back"}</h1>
  <p class="muted">${isReg ? "1,000 free requests every month. No credit card." : "Sign in to continue."}</p>
  ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ""}
  ${providers.length ? `<div class="oauth">${providers.map((p) => `<a class="pill pill-outline pill-block" href="/auth/${p.id}?next=${encodeURIComponent(next)}">${icons[p.id] ?? ""} Continue with ${p.label}</a>`).join("")}</div><div class="or"><span>or</span></div>` : ""}
  <form class="form stack" data-auth="${isReg ? "register" : "login"}" data-next="${esc(next)}" data-plan="${esc(plan)}">
    ${isReg ? '<label>Name<input name="name" autocomplete="name" required maxlength="60"></label>' : ""}
    <label>Email<input name="email" type="email" autocomplete="email" required></label>
    <label>Password<input name="password" type="password" autocomplete="${isReg ? "new-password" : "current-password"}" required minlength="8"></label>
    <button class="pill pill-white pill-block">${isReg ? "Create account" : "Sign in"}</button>
    <p class="form-msg" role="status"></p>
  </form>
  <p class="muted small">${isReg ? `Already have an account? <a href="/login?next=${encodeURIComponent(next)}">Sign in</a>` : `New to Apizie? <a href="/register?next=${encodeURIComponent(next)}">Create an account</a>`}</p>
  <p class="muted tiny">By continuing you agree to the <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
  <a href="/" class="muted small">← Back to site</a>
</section></main>`;
  return layout({ title: isReg ? "Sign up" : "Sign in", body, bare: true, bodyClass: "auth-body", noindex: true });
}

// ---------- 404 ----------------------------------------------------------------
export function notFoundPage({ user }) {
  return layout({ title: "Not found", user, noindex: true, body: `<main>${pageHead("404", "This page wandered off.", "Try the catalog, or head back home.")}<div class="center section-tight"><a class="pill pill-white" href="/scrapers">Browse scrapers</a> <a class="pill pill-outline" href="/">Home</a></div></main>` });
}

// ---------- Dashboard & admin shells (client-rendered by /assets/dash.js) ----------
// Icons are 24px strokes chosen for what each page holds (grid = overview, bars = usage, list = logs ...).
const I = {
  dashboard: '<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z"/>',
  usage: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  logs: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  keys: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  bulk: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  webhooks: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  billing: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  affiliate: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7ZM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z"/>',
  showcase: '<path d="M3 4h18v12H3zM8 20h8M12 16v4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  support: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  browse: '<path d="M7 17 17 7M8 7h9v9"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  health: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.2a3 3 0 0 1 0 5.6M17.5 14a5 5 0 0 1 3 5"/>',
  revenue: '<path d="M4 19V5M4 19h16"/><path d="m7 14 4-4 3 3 5-6"/>',
};
export const icon = (name, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[name] ?? ""}</svg>`;

export const DASH_SECTIONS = [
  { group: "Overview", items: [["", "dashboard", "Overview", "Your API usage at a glance"], ["usage", "usage", "Usage", "Traffic, errors and quota across every key"], ["logs", "logs", "Logs", "Request history across your keys. Metadata only, never payloads"]] },
  { group: "API", items: [["keys", "keys", "API keys", "One key per environment. Keep them secret, rotate any time"], ["bulk", "bulk", "Bulk jobs", "Run one endpoint over many inputs in a single request"], ["webhooks", "webhooks", "Webhooks", "Get notified when quota runs low, keys change or requests fail"]] },
  { group: "Account", items: [["billing", "billing", "Billing", "Plan, pay-as-you-go balance and invoices"], ["affiliate", "affiliate", "Affiliate", "Earn a share of what the people you refer pay"], ["showcase", "showcase", "Showcase", "Show what you built with Apizie"], ["settings", "settings", "Settings", "Profile, security, notifications and sessions"], ["support", "support", "Support", "Get help and send us what you're seeing"]] },
];
const SECTION_LIST = DASH_SECTIONS.flatMap((g) => g.items);
export const DASH_SLUGS = SECTION_LIST.map((x) => x[0]);

// Sidebar shell: one flat list of pages on the left, utilities (search, notifications, account) top right.
const ACCOUNT_SLUGS = ["billing", "affiliate", "showcase", "settings", "support"];

function shell({ user, title, subtitle, sideHtml, menuHtml, notice = "", bodyAttr, bell = true, unread = 0, data = "" }) {
  return `<div class="ap">
<aside class="ap-side" id="ap-side" data-sheet aria-label="Navigation">
  <div class="ap-side-top"><a class="ap-logo" href="/" aria-label="Apizie home">${logo()}</a></div>
  ${sideHtml}
</aside>
<div class="ap-scrim" data-sheet-close hidden></div>
<div class="ap-col">
  <header class="ap-top">
    <button class="ds-icon-btn ap-burger" type="button" data-sheet-btn aria-expanded="false" aria-controls="ap-side" aria-label="Open menu">${icon("menu")}</button>
    <a class="ap-logo ap-logo-m" href="/" aria-label="Apizie home">${logo()}</a>
    <div class="ap-tools">
      <button class="ap-search" type="button" data-palette-open aria-label="Search pages and APIs">${icon("search")}<span>Search</span><kbd>Ctrl K</kbd></button>
      ${bell ? `<div class="ap-pop-wrap"><button class="ds-icon-btn" type="button" data-bell aria-haspopup="true" aria-expanded="false" aria-label="Notifications${unread ? `, ${unread} unread` : ""}">${icon("bell")}${unread ? '<span class="ds-dot" aria-hidden="true"></span>' : ""}</button><div class="ap-pop" data-bell-pop hidden></div></div>` : ""}
      <div class="ap-pop-wrap"><button class="ds-icon-btn" type="button" data-menu-btn aria-haspopup="true" aria-expanded="false" aria-label="Account menu"><span class="ap-avatar" aria-hidden="true">${user.avatar ? `<img src="${esc(user.avatar)}" alt="" referrerpolicy="no-referrer">` : esc((user.name?.[0] ?? "?").toUpperCase())}</span></button>
        <div class="ap-pop ap-menu" data-menu hidden>${menuHtml}</div></div>
    </div>
  </header>
  ${notice}
  <main class="ap-main" id="main">
    <div class="ap-head"><div class="ap-head-text"><h1>${title}</h1><p data-sub>${subtitle}</p></div><div class="ds-actions" data-actions></div></div>
    <section class="ds-body" ${bodyAttr} aria-live="polite"><div class="ds-loading" role="status"><span class="spinner" aria-hidden="true"></span> Loading…</div></section>
  </main>
</div>
</div>
<dialog class="ds-modal" data-modal aria-labelledby="modal-title"></dialog>
<dialog class="ds-palette" data-palette aria-label="Search"><div class="pal-box"><label class="pal-input">${icon("search")}<input data-pal-q placeholder="Jump to a page or search APIs" autocomplete="off" aria-label="Search pages and APIs"></label><ul class="pal-list" data-pal-list role="listbox"></ul><p class="pal-hint">Enter to open · Esc to close</p></div></dialog>
${data}`;
}

const sideLink = (href, on, ic, label, tag = "") => `<a href="${href}" class="ap-link${on ? " on" : ""}"${on ? ' aria-current="page"' : ""}>${ic ? icon(ic) : ""}<span>${label}</span>${tag}</a>`;

export function dashboardPage({ user, section, plan, apiUrl, publicUrl, storage, quota, keyCount, unread }) {
  const me = SECTION_LIST.find((x) => x[0] === section) ?? SECTION_LIST[0];
  const lock = { bulk: !plan.bulk ? "Ultra" : "", webhooks: !plan.webhooks ? "Pro" : "" };
  const tag = (slug) => (slug === "keys" ? `<span class="ap-count" aria-label="${keyCount} active">${keyCount}</span>` : lock[slug] ? `<span class="ds-lock">${lock[slug]}</span>` : "");
  const href = (slug) => `/dashboard${slug ? "/" + slug : ""}`;
  const pct = quota.month.limit ? Math.min(100, (quota.month.used / quota.month.limit) * 100) : 0;
  const resets = new Date(quota.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const groups = DASH_SECTIONS.map((g) => `<nav class="ap-group" aria-label="${g.group}"><p class="ap-group-label">${g.group}</p>${g.items.map(([slug, ic, label]) => sideLink(href(slug), slug === me[0], ic, label, tag(slug))).join("")}</nav>`).join("");
  const sideHtml = `<div class="ap-side-nav">${groups}</div>
  <div class="ap-side-foot">
    ${sideLink("/scrapers", false, "browse", "Browse APIs")}${sideLink("/docs", false, "logs", "Docs")}${user.role === "admin" ? sideLink("/admin", false, "admin", "Admin") : ""}
    <a class="ap-quota" href="/dashboard/usage" aria-label="${Math.round(pct)}% of monthly quota used, resets ${resets}">
      <span class="row-between"><span>Monthly quota</span><b>${Math.round(pct)}%</b></span>
      <span class="ap-quota-bar${pct >= 90 ? " hot" : ""}" aria-hidden="true"><i style="width:${pct.toFixed(1)}%"></i></span>
      <small>${quota.month.used.toLocaleString("en-US")} of ${quota.month.limit.toLocaleString("en-US")} · resets ${resets}</small>
    </a>
  </div>`;
  const menuHtml = `<div class="ap-menu-user"><b data-user-name>${esc(user.name)}</b><small>${esc(user.email ?? "")} · ${esc(plan.id)} plan</small></div>
    <a href="${href("settings")}">${icon("settings")}Settings</a><a href="${href("billing")}">${icon("billing")}Billing</a><a href="${href("support")}">${icon("support")}Support</a>
    <hr><button type="button" data-logout>${icon("logout")}Sign out</button>`;
  const notice = storage.persistent ? "" : `<div class="ap-notice" role="status"><b>Storage is not connected.</b> <span>Accounts, keys and usage on this server are kept in memory and will be lost.</span> ${user.role === "admin" ? '<a href="/admin/setup">Open setup checks</a>' : "<span>Tell the site owner.</span>"}</div>`;
  const data = `<script type="application/json" id="dash-data">${json({ section: me[1], apiUrl, publicUrl, user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar ?? null }, plan, storage, sections: SECTION_LIST.map(([slug, ic, label]) => ({ slug, label })) })}</script>`;
  const body = shell({ user, title: me[2], subtitle: me[3], sideHtml, menuHtml, notice, bodyAttr: `data-dash="${esc(me[1])}"`, unread, data });
  return layout({ title: me[2], user, body, scripts: ["/assets/site.js", "/assets/dash.js", "/assets/dash-user.js"], noindex: true, bare: true, bodyClass: "ds-body-page", head: '<link rel="stylesheet" href="/assets/dash.css">' });
}

const ADMIN_GROUPS = [
  { group: "Monitor", items: [["", "Overview", "dashboard", "Everything that matters on one screen"], ["traffic", "Traffic", "usage", "Platform-wide requests, errors and latency"], ["live", "Live requests", "live", "The latest calls across every customer, refreshed automatically"], ["health", "Source health", "health", "Which upstream sources fail, slow down or are switched off"], ["revenue", "Revenue", "revenue", "Paid invoices, recurring revenue and plan mix"]] },
  { group: "Operate", items: [["users", "Customers", "users", "Find a customer, change a plan, suspend or promote"], ["invoices", "Invoices", "billing", "Confirm bank transfers and activate plans"], ["payouts", "Payouts", "affiliate", "Affiliate payout requests"], ["scrapers", "Catalog", "browse", "Switch sources on or off and set logos"], ["reports", "Reports", "support", "Issues reported by customers"], ["showcase", "Showcase", "showcase", "Review community submissions"], ["setup", "Setup checks", "settings", "Production readiness: database, sign-in, email, payments"]] },
];
const ADMIN_NAV = ADMIN_GROUPS.flatMap((g) => g.items);
export const ADMIN_SLUGS = ADMIN_NAV.map((x) => x[0]);
export function adminPage({ user, section }) {
  const cur = ADMIN_NAV.find((x) => x[0] === section) ?? ADMIN_NAV[0];
  const href = (s) => `/admin${s ? "/" + s : ""}`;
  const groups = ADMIN_GROUPS.map((g) => `<nav class="ap-group" aria-label="${g.group}"><p class="ap-group-label">${g.group}</p>${g.items.map(([s, label, ic]) => sideLink(href(s), s === cur[0], ic, label)).join("")}</nav>`).join("");
  const sideHtml = `<div class="ap-side-nav">${groups}</div><div class="ap-side-foot"><span class="ap-admin-badge">${icon("admin")}<span>Super admin</span></span>${sideLink("/dashboard", false, "dashboard", "My dashboard")}</div>`;
  const menuHtml = `<div class="ap-menu-user"><b>${esc(user.name ?? "Admin")}</b><small>${esc(user.email ?? "")}</small></div><a href="/dashboard">${icon("dashboard")}My dashboard</a><a href="/admin/setup">${icon("settings")}Setup checks</a><hr><button type="button" data-logout>${icon("logout")}Sign out</button>`;
  // Admins see every range (no plan locks) and the palette lists admin pages.
  const data = `<script type="application/json" id="dash-data">${json({ admin: true, user: { id: user.id, name: user.name, email: user.email, role: user.role }, plan: { id: "admin", logDays: 90 }, sections: ADMIN_NAV.map(([slug, label]) => ({ slug, label, base: "/admin" })) })}</script>`;
  const body = shell({ user, title: cur[1], subtitle: cur[3], sideHtml, menuHtml, bodyAttr: `data-admin="${esc(cur[0] || "overview")}"`, bell: false, data });
  return layout({ title: "Admin", user, body, scripts: ["/assets/site.js", "/assets/dash.js", "/assets/dash-admin.js"], noindex: true, bare: true, bodyClass: "ds-body-page", head: '<link rel="stylesheet" href="/assets/dash.css">' });
}
