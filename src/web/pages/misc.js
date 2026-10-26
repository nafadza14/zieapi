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
    ["search_scrapers", "Find APIs and scrapers by name, source or the data they return."],
    ["get_scraper_schema", "Read an endpoint's parameters, verb, path and status."],
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
    <div class="card"><span class="step-n">02</span><h3>Ask in plain language</h3><p>“Latest BMKG earthquakes”, “Bitcoin price in rupiah”, “Search GitHub repos about MCP”. The agent picks the tools.</p></div>
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
  const description = "Connect Claude, ChatGPT, Cursor, VS Code and Gemini CLI to 1,600+ APIs with the Apizie MCP server. One-click OAuth or an API key, 8 tools, same quota as REST.";
  return layout({ fullTitle: "MCP Server: 1,600+ APIs for Claude, ChatGPT & Cursor | Apizie", active: "mcp", user, body, description, ogImage: "/assets/og/mcp.png", jsonLd: [webPageLd({ name: "Apizie MCP server", description, type: "TechArticle", extra: { headline: "Connect AI agents to 1,600+ APIs with MCP" } }), breadcrumb([["Home", "/"], ["MCP server", "/mcp"]])] });
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
  const body = `<main>
${pageHead("Showcase", "Built with Apizie.", "Bots, research pipelines and tools people have shipped on Apizie.")}
<section class="wrap section-tight">
  ${items.length ? `<div class="grid-3">${items.map((p) => `<a class="card show-card" href="${esc(p.url)}" rel="noopener nofollow" target="_blank"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><span class="muted small">${esc(new URL(p.url).hostname)}</span></a>`).join("")}</div>` : `<div class="empty card"><h3>No projects here yet.</h3><p>Shipped something on Apizie? Yours could be the first one.</p></div>`}
  <div class="card mt submit-card">
    <h2>Submit your project</h2>
    ${user ? `<form class="form" data-form="/api/showcase" data-success="Thanks! We'll review it shortly."><label>Project name<input name="name" required maxlength="80"></label><label>URL<input name="url" type="url" required placeholder="https://"></label><label class="full">What does it do?<textarea name="description" required maxlength="280" rows="3"></textarea></label><button class="pill pill-white">Submit</button><p class="form-msg" role="status"></p></form>` : `<p><a href="/login?next=/showcase">Sign in</a> to submit your project. Ultra and Max plans get their logo on the “Built with Apizie” strip.</p>`}
  </div>
</section></main>`;
  return layout({ title: "Showcase", active: "showcase", user, body });
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
${categories.map((c) => `<tr><td><a href="/category/${esc(c.slug)}">${esc(c.displayName)}</a></td><td>${c.scrapers}</td><td>${c.live}</td><td>${c.endpoints}</td><td>${c.live ? '<span class="badge badge-live">Operational</span>' : '<span class="badge badge-planned">Planned</span>'}</td></tr>`).join("")}
</tbody></table></div><p class="muted small">${totals.liveEndpoints} of ${totals.endpoints} endpoints are live on this deployment.</p></section></main>`;
  return layout({ title: "Status", user, body });
}

// ---------- Legal ----------------------------------------------------------------
const LEGAL = {
  terms: ["Terms of Service", [
    ["Agreement", "By creating an account or calling the Apizie API you agree to these terms. If you use Apizie for an organisation, you accept them on its behalf."],
    ["The service", "Apizie provides programmatic access to publicly available data through a unified API, a web dashboard and an MCP server. Sources may change or become unavailable; we work to keep endpoints running but do not guarantee any particular source."],
    ["Accounts and keys", "Keep your API keys secret. You are responsible for all activity on your keys. We may suspend keys that are leaked or abused."],
    ["Plans and payment", "Paid plans are billed in Indonesian Rupiah for 30-day periods and activated once payment is verified. Quotas reset on the 1st of each month (UTC)."],
    ["Acceptable use", "Your use must comply with the Acceptable Use Policy and applicable law, including Indonesia's Personal Data Protection Law (UU PDP No. 27/2022)."],
    ["Liability", "The service is provided “as is”. To the maximum extent permitted by law, Apizie is not liable for indirect or consequential losses. Our total liability is limited to the fees you paid in the previous three months."],
    ["Changes", "We may update these terms; material changes will be announced on the website at least 14 days in advance."],
    ["Governing law", "These terms are governed by the laws of the Republic of Indonesia."],
  ]],
  privacy: ["Privacy Policy", [
    ["What we collect", "Account data (name, email, avatar from your sign-in provider), API key hashes, request metadata (time, endpoint, status, latency, IP address) and billing records."],
    ["Why", "To operate the service, enforce limits, show you usage and logs, prevent abuse and handle billing."],
    ["Retention", "Request logs are kept according to your plan (7–90 days). Account data is kept while your account is active and deleted on request."],
    ["Sharing", "We do not sell personal data. Infrastructure providers (hosting, database) process data on our behalf."],
    ["Your rights", "Under UU PDP you may access, correct or delete your personal data. Email hello@zieads.com."],
  ]],
  cookies: ["Cookie Policy", [
    ["Essential cookies", "apz_session keeps you signed in. apz_oauth protects the sign-in flow. They are strictly necessary and set only when you sign in."],
    ["Preferences", "The website may store small preferences (like the API key you paste into the playground) in your browser's localStorage. It never leaves your device unless you send a request."],
    ["Analytics", "Apizie does not set advertising or third-party analytics cookies."],
  ]],
  aup: ["Acceptable Use Policy", [
    ["Allowed", "Building products, research and automation on the data Apizie returns, in line with each source's terms and the law."],
    ["Not allowed", "Collecting personal data for harassment, stalking, doxxing or discrimination; spam; credential stuffing; attacking or overloading third-party systems; bypassing paywalls or access controls; reselling raw API access without permission."],
    ["Personal data", "If you process personal data obtained through Apizie you are the data controller and must comply with UU PDP and other applicable laws."],
    ["Enforcement", "We may throttle, suspend or terminate accounts that violate this policy."],
  ]],
  refund: ["Refund Policy", [
    ["Failed requests", "Server-side failures (5xx) are never counted against your quota."],
    ["Plan payments", "If you were charged and the plan was not activated, or you cancel within 3 days without significant usage (under 10% of the quota), contact us for a full refund."],
    ["How", "Email hello@zieads.com with your invoice ID. Refunds are processed to the original bank account within 14 business days."],
  ]],
};

export function legalPage({ user, slug }) {
  const doc = LEGAL[slug];
  if (!doc) return null;
  const [title, sections] = doc;
  const body = `<main>${pageHead("Legal", title, "Last updated 26 October 2026. This template is a starting point. Have it reviewed by a lawyer before launch.")}
<article class="wrap narrow prose section-tight">${sections.map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join("")}</article></main>`;
  return layout({ title, user, body });
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
  <p class="muted">${isReg ? "600 free requests every month. No credit card." : "Sign in to continue."}</p>
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
const DASH_NAV = [
  ["", "Overview"],
  ["keys", "API keys"],
  ["usage", "Usage"],
  ["logs", "Request logs"],
  ["bulk", "Bulk jobs"],
  ["webhooks", "Webhooks"],
  ["billing", "Billing"],
  ["settings", "Settings"],
];

export function dashboardPage({ user, section, plan, apiUrl, bank }) {
  const side = DASH_NAV.map(([s, label]) => `<a href="/dashboard${s ? "/" + s : ""}" class="${s === section ? "on" : ""}">${label}</a>`).join("") + (user.role === "admin" ? `<a href="/admin" class="admin-link">Admin</a>` : "");
  const body = `<main class="dash wrap-wide">
<aside class="dash-side" aria-label="Dashboard"><div class="dash-user">${user.avatar ? `<img src="${esc(user.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${esc(user.name[0]?.toUpperCase() ?? "?")}</span>`}<div><b>${esc(user.name)}</b><span class="badge badge-plan">${esc(plan)}</span></div></div><nav>${side}</nav><button class="pill pill-outline pill-sm pill-block" data-logout>Sign out</button></aside>
<section class="dash-main" data-dash="${esc(section || "overview")}"><div class="loading">Loading…</div></section>
<script type="application/json" id="dash-data">${json({ section: section || "overview", apiUrl, user: { id: user.id, name: user.name, email: user.email, role: user.role }, bank })}</script>
</main>`;
  return layout({ title: "Dashboard", user, body, scripts: ["/assets/site.js", "/assets/dash.js"], noindex: true, bodyClass: "dash-body" });
}

const ADMIN_NAV = [["", "Overview"], ["users", "Users"], ["invoices", "Invoices"], ["scrapers", "Scrapers"], ["reports", "Reports"], ["showcase", "Showcase"]];
export function adminPage({ user, section }) {
  const side = ADMIN_NAV.map(([s, label]) => `<a href="/admin${s ? "/" + s : ""}" class="${s === section ? "on" : ""}">${label}</a>`).join("") + `<a href="/dashboard" class="admin-link">← Dashboard</a>`;
  const body = `<main class="dash wrap-wide"><aside class="dash-side"><div class="dash-user"><span class="avatar">A</span><div><b>Admin</b><span class="badge">${esc(user.email ?? "")}</span></div></div><nav>${side}</nav></aside>
<section class="dash-main" data-admin="${esc(section || "overview")}"><div class="loading">Loading…</div></section></main>`;
  return layout({ title: "Admin", user, body, scripts: ["/assets/site.js", "/assets/dash.js"], noindex: true, bodyClass: "dash-body" });
}
