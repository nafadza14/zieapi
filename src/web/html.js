// Server-side HTML helpers: escaping, layout, nav, footer.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
export const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K" : String(n ?? 0));
export const idr = (n) => "Rp" + Number(n).toLocaleString("id-ID");

const LOGO_INNER = '<path fill="#FFFFFF" d="M82.68 45.82L41.95 197.82A20 20 0 0 0 80.59 208.18L121.32 56.18A20 20 0 0 0 82.68 45.82ZM146.68 45.82L105.95 197.82A20 20 0 0 0 144.59 208.18L185.32 56.18A20 20 0 0 0 146.68 45.82Z"/><circle fill="#FF9ECF" cx="191.98" cy="201" r="24"/><path fill="#FFFFFF" d="M269.236328125 186.0H333.982421875V170.30859375H292.92578125V170.080078125L333.525390625 119.654296875V105.5625H269.236328125V121.330078125H310.521484375V121.55859375L269.236328125 172.669921875Z"/><path fill="#FFFFFF" d="M344.75 186.0H363.9453125V105.5625H344.75ZM354.34765625 93.603515625C360.8984375 93.603515625 365.849609375 88.880859375 365.849609375 82.634765625C365.849609375 76.46484375 360.8984375 71.7421875 354.34765625 71.7421875C347.796875 71.7421875 342.845703125 76.46484375 342.845703125 82.634765625C342.845703125 88.880859375 347.796875 93.603515625 354.34765625 93.603515625Z"/><path fill="#FFFFFF" d="M411.50390625 187.828125C430.318359375 187.828125 445.248046875 176.935546875 448.294921875 161.16796875H430.318359375C428.109375 168.0234375 421.634765625 172.669921875 411.9609375 172.669921875C399.01171875 172.669921875 391.546875 163.91015625 391.08984375 150.80859375H449.28515625V145.552734375C449.28515625 120.873046875 433.8984375 103.734375 410.7421875 103.734375C388.1953125 103.734375 372.275390625 121.40625 372.275390625 145.857421875C372.275390625 170.232421875 387.357421875 187.828125 411.50390625 187.828125ZM391.2421875 137.5546875C392.537109375 126.052734375 399.92578125 118.96875 411.046875 118.96875C422.16796875 118.96875 429.6328125 126.052734375 430.8515625 137.5546875Z"/><path fill="#FFFFFF" d="M481.837890625 187.294921875C494.939453125 187.294921875 501.71875 181.810546875 505.52734375 174.650390625H505.83203125V186.0H524.72265625V131.15625C524.72265625 114.3984375 512.306640625 103.962890625 491.359375 103.962890625C470.3359375 103.962890625 457.234375 114.55078125 456.3203125 130.546875H474.830078125C475.36328125 123.767578125 481.609375 118.892578125 490.978515625 118.892578125C500.1953125 118.892578125 505.6796875 123.767578125 505.6796875 130.623046875V131.232421875C505.6796875 136.716796875 500.576171875 136.9453125 485.646484375 138.62109375C469.041015625 140.373046875 454.03515625 144.8671875 454.03515625 163.1484375C454.03515625 179.220703125 465.841796875 187.294921875 481.837890625 187.294921875ZM486.560546875 173.05078125C478.181640625 173.05078125 472.7734375 169.318359375 472.7734375 162.99609375C472.7734375 155.68359375 479.78125 152.712890625 488.0078125 151.494140625C495.9296875 150.275390625 503.39453125 149.056640625 505.755859375 147.533203125V156.216796875C505.755859375 165.5859375 499.12890625 173.05078125 486.560546875 173.05078125Z"/><path fill="#FFFFFF" d="M536.708984375 217.83984375H555.904296875V173.888671875H556.1328125C561.16015625 183.029296875 569.615234375 187.599609375 580.126953125 187.599609375C601.150390625 187.599609375 614.9375 170.765625 614.9375 145.705078125C614.9375 120.94921875 600.921875 103.962890625 580.203125 103.962890625C569.767578125 103.962890625 560.85546875 108.228515625 555.828125 116.759765625H555.599609375V105.5625H536.708984375ZM575.6328125 171.52734375C563.064453125 171.52734375 554.837890625 161.396484375 554.837890625 145.705078125C554.837890625 130.08984375 563.064453125 119.8828125 575.6328125 119.8828125C587.515625 119.8828125 595.513671875 129.099609375 595.513671875 145.705078125C595.513671875 162.38671875 587.515625 171.52734375 575.6328125 171.52734375Z"/><path fill="#FFFFFF" d="M623.267578125 186.0H642.462890625V105.5625H623.267578125Z"/><path fill="#FF9ECF" d="M632.865234375 93.603515625C639.416015625 93.603515625 644.3671875 88.880859375 644.3671875 82.634765625C644.3671875 76.46484375 639.416015625 71.7421875 632.865234375 71.7421875C626.314453125 71.7421875 621.36328125 76.46484375 621.36328125 82.634765625C621.36328125 88.880859375 626.314453125 93.603515625 632.865234375 93.603515625Z"/>';
export const logo = (cls = "") => `<span class="logo ${cls}"><svg viewBox="0 0 686 256" role="img" aria-label="zieapi" class="logo-svg">${LOGO_INNER}</svg></span>`;

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

export function layout({ title, description = "One API key for hundreds of public data sources, Indonesia first.", body, active = "", user = null, bodyClass = "", head = "", scripts = ["/assets/site.js"], publicUrl = "", noindex = false, bare = false }) {
  const fullTitle = title ? `${title} | zieapi` : "zieapi | One API key for hundreds of public data sources";
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
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/assets/site.webmanifest">
<meta property="og:image" content="/assets/icon-512.png">
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

/** Source logo tile: the source's own icon on a white tile, or a monogram when none is known. */
export function sourceIcon(s, { size = "", color = "#8b8ba7" } = {}) {
  const mono = esc((s.displayName ?? "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?");
  if (s.iconUrl) return `<span class="sc-icon has-img ${size}"><img src="${esc(s.iconUrl)}" alt="" loading="lazy" decoding="async" width="40" height="40" onerror="this.parentNode.classList.remove('has-img');this.parentNode.textContent='${mono}'"></span>`;
  return `<span class="sc-icon ${size}" style="--c:${esc(color)}">${mono}</span>`;
}
