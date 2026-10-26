// Server-side HTML helpers: escaping, layout, nav, footer.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
export const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K" : String(n ?? 0));
export const idr = (n) => "Rp" + Number(n).toLocaleString("id-ID");

export const logo = (cls = "") => `<span class="logo ${cls}"><svg viewBox="0 0 32 32" aria-hidden="true" class="logo-mark"><path d="M12 5 6 27M20 5l-6 22" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><circle cx="25.5" cy="23.5" r="3" fill="url(#lg)"/><defs><linearGradient id="lg" x1="0" x2="1"><stop stop-color="#ff9ecf"/><stop offset="1" stop-color="#b7a4ff"/></linearGradient></defs></svg><span>zieapi</span></span>`;

const NAV = [
  ["/", "Home", "home"],
  ["/scrapers", "Scrapers", "scrapers"],
  ["/pricing", "Pricing", "pricing"],
  ["/docs", "Docs", "docs"],
  ["/mcp", "MCP", "mcp"],
  ["/showcase", "Showcase", "showcase"],
];

export function nav({ active, user }) {
  const links = NAV.map(([href, label, key]) => `<a href="${href}" class="nav-link${active === key ? " active" : ""}"${active === key ? ' aria-current="page"' : ""}>${active === key ? '<span class="nav-dot" aria-hidden="true"></span>' : ""}${label}</a>`).join("");
  const right = user
    ? `<a class="pill pill-outline" href="/dashboard">Dashboard</a><a class="avatar" href="/dashboard/settings" title="${esc(user.name)}">${user.avatar ? `<img src="${esc(user.avatar)}" alt="" referrerpolicy="no-referrer">` : esc((user.name ?? "?")[0].toUpperCase())}</a>`
    : `<a class="pill pill-white" href="/register">Sign up</a><a class="pill pill-outline" href="/login">Log In</a>`;
  return `<header class="nav" id="nav">
  <a href="/" class="nav-brand" aria-label="zieapi home">${logo()}</a>
  <nav class="nav-links" aria-label="Primary">${links}</nav>
  <div class="nav-right">${right}<button class="nav-toggle" aria-label="Open menu" aria-expanded="false" data-nav-toggle><span></span><span></span></button></div>
</header>`;
}

export function footer() {
  return `<footer class="footer">
  <div class="footer-top">
    <div class="footer-brand">${logo()}<p>One key, one response shape. We keep the scrapers working.</p></div>
    <div class="footer-cols">
      <div><h4>Product</h4><a href="/scrapers">Scrapers</a><a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/mcp">MCP server</a><a href="/showcase">Showcase</a><a href="/status">Status</a></div>
      <div><h4>Developers</h4><a href="/docs/quickstart">Quickstart</a><a href="/openapi.json">OpenAPI spec</a><a href="/llms.txt">llms.txt</a><a href="https://github.com/nafadza14/zieapi" rel="noopener">GitHub</a></div>
      <div><h4>Support</h4><a href="/report">Report an issue</a><a href="/docs/errors">Error codes</a><a href="mailto:hello@zieads.com">Contact</a></div>
      <div><h4>Legal</h4><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/cookies">Cookies</a><a href="/aup">Acceptable use</a><a href="/refund">Refunds</a></div>
    </div>
  </div>
  <div class="footer-bottom"><span>© ${new Date().getFullYear()} zieapi · Zieads</span><span>Made in Indonesia</span></div>
</footer>`;
}

export function layout({ title, description = "One API key for hundreds of public data sources — Indonesia first.", body, active = "", user = null, bodyClass = "", head = "", scripts = ["/assets/site.js"], publicUrl = "", noindex = false, bare = false }) {
  const fullTitle = title ? `${title} — zieapi` : "zieapi — One API key for hundreds of public data sources";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#05050a">
<meta name="color-scheme" content="dark">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
${publicUrl ? `<meta property="og:url" content="${esc(publicUrl)}">` : ""}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300..700&family=Poppins:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
${head}
</head>
<body class="${esc(bodyClass)}">
${bare ? "" : nav({ active, user })}
${body}
${bare ? "" : footer()}
${scripts.map((s) => `<script src="${s}" defer></script>`).join("\n")}
</body>
</html>`;
}

export const pageHead = (eyebrow, title, sub = "") => `<section class="page-head"><div class="wrap"><span class="eyebrow">${eyebrow}</span><h1 class="display">${title}</h1>${sub ? `<p class="lead">${sub}</p>` : ""}</div></section>`;

export const statusBadge = (s) => `<span class="badge badge-${esc(s)}">${{ live: "Live", upstream: "Upstream", planned: "Planned", disabled: "Disabled" }[s] ?? esc(s)}</span>`;
