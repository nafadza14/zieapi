// Server-side HTML helpers: escaping, layout, nav, footer.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
export const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K" : String(n ?? 0));
export const idr = (n) => "Rp" + Number(n).toLocaleString("id-ID");

import { BRAND, seoCtx, absUrl, metaDescription, siteGraph, ldScript } from "./seo.js";

const LOGO_INNER = '<path fill="#FFFFFF" d="M82.68 45.82L41.95 197.82A20 20 0 0 0 80.59 208.18L121.32 56.18A20 20 0 0 0 82.68 45.82ZM146.68 45.82L105.95 197.82A20 20 0 0 0 144.59 208.18L185.32 56.18A20 20 0 0 0 146.68 45.82Z"/><circle fill="#FF9ECF" cx="191.98" cy="201" r="24"/><path fill="#FFFFFF" d="M262.990234375 186.0H284.623046875L293.916015625 158.8828125H337.943359375L347.0078125 186.0H369.173828125L328.802734375 72.50390625H303.513671875ZM299.552734375 142.353515625 305.037109375 126.357421875C308.46484375 115.921875 311.892578125 105.029296875 316.158203125 90.708984375C320.423828125 105.029296875 323.775390625 115.921875 327.126953125 126.357421875L332.458984375 142.353515625Z"/><path fill="#FFFFFF" d="M370.6484375 217.83984375H389.84375V173.888671875H390.072265625C395.099609375 183.029296875 403.5546875 187.599609375 414.06640625 187.599609375C435.08984375 187.599609375 448.876953125 170.765625 448.876953125 145.705078125C448.876953125 120.94921875 434.861328125 103.962890625 414.142578125 103.962890625C403.70703125 103.962890625 394.794921875 108.228515625 389.767578125 116.759765625H389.5390625V105.5625H370.6484375ZM409.572265625 171.52734375C397.00390625 171.52734375 388.77734375 161.396484375 388.77734375 145.705078125C388.77734375 130.08984375 397.00390625 119.8828125 409.572265625 119.8828125C421.455078125 119.8828125 429.453125 129.099609375 429.453125 145.705078125C429.453125 162.38671875 421.455078125 171.52734375 409.572265625 171.52734375Z"/><path fill="#FFFFFF" d="M457.20703125 186.0H476.40234375V105.5625H457.20703125ZM466.8046875 93.603515625C473.35546875 93.603515625 478.306640625 88.880859375 478.306640625 82.634765625C478.306640625 76.46484375 473.35546875 71.7421875 466.8046875 71.7421875C460.25390625 71.7421875 455.302734375 76.46484375 455.302734375 82.634765625C455.302734375 88.880859375 460.25390625 93.603515625 466.8046875 93.603515625Z"/><path fill="#FFFFFF" d="M487.169921875 186.0H551.916015625V170.30859375H510.859375V170.080078125L551.458984375 119.654296875V105.5625H487.169921875V121.330078125H528.455078125V121.55859375L487.169921875 172.669921875Z"/><path fill="#FFFFFF" d="M562.68359375 186.0H581.87890625V105.5625H562.68359375Z"/><path fill="#FF9ECF" d="M572.28125 93.603515625C578.83203125 93.603515625 583.783203125 88.880859375 583.783203125 82.634765625C583.783203125 76.46484375 578.83203125 71.7421875 572.28125 71.7421875C565.73046875 71.7421875 560.779296875 76.46484375 560.779296875 82.634765625C560.779296875 88.880859375 565.73046875 93.603515625 572.28125 93.603515625Z"/><path fill="#FFFFFF" d="M629.4375 187.828125C648.251953125 187.828125 663.181640625 176.935546875 666.228515625 161.16796875H648.251953125C646.04296875 168.0234375 639.568359375 172.669921875 629.89453125 172.669921875C616.9453125 172.669921875 609.48046875 163.91015625 609.0234375 150.80859375H667.21875V145.552734375C667.21875 120.873046875 651.83203125 103.734375 628.67578125 103.734375C606.12890625 103.734375 590.208984375 121.40625 590.208984375 145.857421875C590.208984375 170.232421875 605.291015625 187.828125 629.4375 187.828125ZM609.17578125 137.5546875C610.470703125 126.052734375 617.859375 118.96875 628.98046875 118.96875C640.1015625 118.96875 647.56640625 126.052734375 648.78515625 137.5546875Z"/>';
export const logo = (cls = "") => `<span class="logo ${cls}"><svg viewBox="0 0 707 256" role="img" aria-label="Apizie" class="logo-svg">${LOGO_INNER}</svg></span>`;

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
    : `<a class="nav-login" href="/login">Log in</a><a class="pill pill-white" href="/register">Get free API key</a>`;
  return `<header class="nav" id="nav">
  <a href="/" class="nav-brand" aria-label="Apizie home">${logo()}</a>
  <nav class="nav-links" aria-label="Primary">${links}${user ? "" : '<a href="/login" class="nav-link nav-link-login">Log in</a>'}</nav>
  <div class="nav-right">${right}<button class="nav-toggle" aria-label="Open menu" aria-expanded="false" data-nav-toggle><span></span><span></span></button></div>
</header>`;
}

export function footer() {
  return `<footer class="footer">
  <div class="footer-top">
    <div class="footer-brand">${logo()}<p>One key, one response shape. We keep the scrapers working.</p></div>
    <div class="footer-cols">
      <div><h4>Product</h4><a href="/scrapers">Scrapers</a><a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/mcp">MCP server</a><a href="/showcase">Showcase</a><a href="/status">Status</a></div>
      <div><h4>Developers</h4><a href="/docs/quickstart">Quickstart</a><a href="/mcp">MCP for AI agents</a><a href="/docs#machine-readable">For AI tools</a><a href="https://github.com/nafadza14/zieapi" rel="noopener">GitHub</a></div>
      <div><h4>Support</h4><a href="/report">Report an issue</a><a href="/docs/errors">Error codes</a><a href="mailto:support@zieads.com">Contact</a></div>
      <div><h4>Legal</h4><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/cookies">Cookies</a><a href="/aup">Acceptable use</a><a href="/refund">Refunds</a></div>
    </div>
  </div>
  <div class="footer-bottom"><span>© ${new Date().getFullYear()} Ziera Technology · Apizie</span><span>Built for developers and AI agents</span></div>
</footer>`;
}

export function layout({ title, description = BRAND.description, body, active = "", user = null, bodyClass = "", head = "", scripts = ["/assets/site.js"], noindex = false, bare = false, fullTitle: forcedTitle = null, ogImage = "/assets/og/home.png", ogType = "website", jsonLd = [], canonical = null, markdown = false }) {
  const { path } = seoCtx();
  const fullTitle = forcedTitle ?? (title ? `${title} | Apizie` : "Apizie: One API Key for 3,700+ Public Data APIs (REST + MCP)");
  const desc = metaDescription(description);
  const canon = absUrl(canonical ?? path ?? "/");
  const img = absUrl(ogImage) + (/\?/.test(ogImage) ? "" : "?v=5"); // bump to refresh link previews cached by social networks
  const v = "?v=3";
  const graph = noindex ? [] : [...siteGraph(), ...jsonLd];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">\n<link rel="canonical" href="' + esc(canon) + '">'}
<meta name="application-name" content="Apizie">
<meta name="apple-mobile-web-app-title" content="Apizie">
<meta name="theme-color" content="#05050a">
<meta name="color-scheme" content="dark">
<meta name="format-detection" content="telephone=no">
<meta property="og:site_name" content="Apizie">
<meta property="og:locale" content="${BRAND.locale}">
<meta property="og:locale:alternate" content="${BRAND.altLocale}">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canon)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:secure_url" content="${esc(img)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(fullTitle)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<link rel="icon" href="/favicon.ico${v}" sizes="48x48">
<link rel="icon" href="/favicon.svg${v}" type="image/svg+xml">
<link rel="icon" href="/assets/favicon-96x96.png${v}" type="image/png" sizes="96x96">
<link rel="icon" href="/assets/favicon-32x32.png${v}" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png${v}" sizes="180x180">
<link rel="manifest" href="/assets/site.webmanifest${v}">
${markdown && !noindex ? `<link rel="alternate" type="text/markdown" href="${esc(absUrl((path === "/" ? "/index" : path) + ".md"))}" title="Markdown version">` : ""}
<link rel="alternate" type="text/plain" href="${esc(absUrl("/llms.txt"))}" title="llms.txt">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300..700&family=Poppins:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
${graph.length ? ldScript(graph) : ""}
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

export const statusBadge = (s) => `<span class="badge badge-${esc(s)}">${{ live: "Live", byok: "Your key", upstream: "Upstream", planned: "Planned", disabled: "Disabled" }[s] ?? esc(s)}</span>`;

/** Source logo tile: the source's own icon on a white tile, or a monogram when none is known. */
export function sourceIcon(s, { size = "", color = "#8b8ba7" } = {}) {
  const mono = esc((s.displayName ?? "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?");
  if (s.iconUrl) return `<span class="sc-icon has-img ${size}"><img src="${esc(s.iconUrl)}" alt="" loading="lazy" decoding="async" width="40" height="40" onerror="this.parentNode.classList.remove('has-img');this.parentNode.textContent='${mono}'"></span>`;
  return `<span class="sc-icon ${size}" style="--c:${esc(color)}">${mono}</span>`;
}
