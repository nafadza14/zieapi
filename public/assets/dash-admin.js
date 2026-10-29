/* Apizie admin sections: setup checks, customers, payments, payouts, sources, reports, showcase.
   Registered on window.apz.admin and rendered by the router in dash.js. */
(() => {
  const apz = window.apz;
  if (!apz) return;
  const { setHandlers, setActions } = apz;
  const A = apz.admin;
  const PAGE = 50;

  const planOptions = (cur) => ["free", "pro", "ultra", "max"].map((p) => `<option value="${p}"${p === cur ? " selected" : ""}>${p}</option>`).join("");

  // ===== Shared monitoring helpers ===========================================================
  const RW = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days" };
  const usdShort = (n) => { const v = Number(n ?? 0); return v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 }); };
  // Payout amounts: US dollars; requests made before October 2026 were in rupiah.
  const payoutAmt = (c, p) => (p.currency === "USD" ? c.usd(p.amount) : c.idr(p.amount));
  const usd = (n) => "$" + Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const deltaTag = (v, { goodUp = true } = {}) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return "";
    const up = v >= 0;
    const good = goodUp ? up : !up;
    const txt = Math.abs(v) >= 10 ? ">999%" : `${Math.abs(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;
    return `<span class="delta ${Math.abs(v) < 0.005 ? "flat" : good ? "good" : "bad"}" title="Compared with the previous period">${up ? "▲" : "▼"} ${txt}</span>`;
  };
  /** Simple bar chart for counts or money per day. */
  const barChart = (c, series, { fmt = c.num, label = "value", height = 150 } = {}) => {
    const max = Math.max(1, ...series.map((p) => p.v));
    const n = series.length;
    const every = Math.max(1, Math.ceil(n / 6));
    return `<div class="bars" style="--h:${height}px" role="img" aria-label="${c.esc(label)} per day, highest ${c.esc(fmt(max))}">${series
      .map((p, i) => `<div class="bar-col" title="${c.esc(new Date(p.t + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }))}: ${c.esc(fmt(p.v))}"><i style="height:${p.v ? Math.max(3, (p.v / max) * 100) : 0}%"></i><span>${i % every === 0 || i === n - 1 ? new Date(p.t + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span></div>`)
      .join("")}</div>`;
  };
  const loadAnalytics = (c) => c.api(`/api/admin/analytics?range=${c.state.range}&tz=${c.tz}`).then((r) => r.content);
  const sysLine = (c, o) => {
    const sub = c.$("[data-sub]");
    if (!sub) return;
    const s = o.system;
    sub.innerHTML = `<span class="sys">${s.state === "operational" ? '<span class="pulse ok" aria-hidden="true"></span>All systems operational' : '<span class="pulse warn" aria-hidden="true"></span>Elevated server errors in the last hour'}</span><span aria-hidden="true">·</span><span>${c.esc(s.storage)}${s.region ? ` · ${c.esc(s.region)}` : ""}</span><span aria-hidden="true">·</span><span>Updated ${c.time(o.generatedAt)}</span>`;
  };
  /** Source logo (or a lettered tile when the source has none) + name + key. */
  const mono = (name) => (String(name).replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
  const hue = (k) => [...String(k)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 360, 7);
  const srcCell = (c, x, { link = true } = {}) => {
    const key = x.key ?? x.project;
    const name = x.displayName || x.name || key;
    const logo = x.iconUrl
      ? `<img src="${c.esc(x.iconUrl)}" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'src-mono',textContent:'${mono(name)}'}))">`
      : `<span class="src-mono" style="--hue:${hue(key)}" aria-hidden="true">${c.esc(mono(name))}</span>`;
    const title = link && x.status !== "planned" ? `<a href="/api/${c.esc(key.replace(":", "/"))}"><b>${c.esc(name)}</b></a>` : `<b>${c.esc(name)}</b>`;
    return `<span class="src-cell">${logo}<span class="src-txt">${title}<span class="muted-sm mono">${c.esc(key)}</span></span></span>`;
  };
  const STATUS_LABEL = { live: "Live", byok: "BYOK", planned: "Planned", upstream: "Upstream", disabled: "Off" };
  const statusBadge = (c, s) => (s.enabled === false || s.disabled ? c.h.badge("disabled", "Off") : c.h.badge(s.status ?? "live", STATUS_LABEL[s.status] ?? s.status));
  const customerCell = (c, x) => `${x.email ? `<a href="/admin/users?q=${encodeURIComponent(x.email)}"><b>${c.esc(x.name ?? x.email)}</b></a><br><span class="muted-sm">${c.esc(x.email)}</span>` : `<b>${c.esc(x.name ?? "Unknown")}</b>`}`;
  const sourceRows = (c, list) =>
    list.map(
      (x) => `<tr>
        <td>${srcCell(c, x)}</td>
        <td class="num">${c.num(x.requests)}</td>
        <td class="num">${c.num(x.errors)}</td>
        <td class="num">${x.serverErrors ? `<b class="t-bad">${c.num(x.serverErrors)}</b>` : "0"}</td>
        <td class="num">${c.pct(Math.round(x.errorRate * 1000) / 10)}</td>
        <td>${x.disabled ? c.h.badge("disabled", "off") : x.requests >= 5 && x.serverErrors / x.requests >= 0.2 ? c.h.badge("failed", "failing") : c.h.badge("ok", "healthy")}</td>
      </tr>`
    );

  // ===== Overview ===========================================================================
  A.overview = async (c) => {
    const { h, esc, num, idr } = c;
    let last = null;
    let breakdown = "endpoints";
    const range = c.rangeControl(() => load());
    const header = () => setActions(`${range.html}<button class="btn btn-ghost" data-act="retry">Refresh</button>`);
    const bd = (t) => {
      if (breakdown === "categories") return c.hbars(t.categories.slice(0, 8), { total: t.total, href: (x) => `/category/${encodeURIComponent(x.name)}` });
      if (breakdown === "sources") return c.hbars(t.sources.map((x) => ({ ...x, name: x.name === "mcp" ? "MCP (AI agents)" : x.name === "rest" ? "REST API" : x.name })), { total: t.total });
      if (breakdown === "errors") return c.hbars(t.statuses.map((x) => ({ name: String(x.status), count: x.count })), { total: t.errors, empty: "No errors in this range." });
      return c.hbars(t.endpoints.slice(0, 8), { total: t.total });
    };
    const render = (o) => {
      last = o;
      sysLine(c, o);
      const t = o.traffic, cu = o.customers, rv = o.revenue, at = o.attention;
      const rw = RW[o.range];
      const todo = [
        [at.invoicesToReview, "invoice", "to confirm", "/admin/invoices"],
        [at.payoutsRequested, "payout request", at.payoutAmount ? `· ${c.usd(at.payoutAmount)}` : "", "/admin/payouts"],
        [at.openReports, "open report", "", "/admin/reports"],
        [at.showcasePending, "showcase submission", "to review", "/admin/showcase"],
        [at.failingSources, "failing source", "≥20% server errors", "/admin/health"],
        [at.disabledSources, "source", "switched off", "/admin/scrapers"],
      ].filter(([n]) => n > 0);
      c.root.innerHTML = `
        <div data-setup-banner></div>
        <section class="ds-card kpis" aria-label="Key numbers, ${rw}">
          <div class="kpi kpi-lead"><span class="stat-label">Requests · ${rw}</span><b class="hero-num">${c.compact(t.total)}</b><span class="stat-sub">${deltaTag(t.change?.total)} ${num(t.allTime)} all time</span></div>
          <div class="kpi"><span class="stat-label">Active customers</span><b class="stat-value">${num(t.activeCustomers)}</b><span class="stat-sub">made a call · ${rw}</span></div>
          <div class="kpi"><span class="stat-label">New sign-ups</span><b class="stat-value">${num(cu.newInRange)}</b><span class="stat-sub">${cu.newPrevious !== null ? deltaTag(cu.newPrevious ? (cu.newInRange - cu.newPrevious) / cu.newPrevious : null) : ""} ${num(cu.total)} total</span></div>
          <div class="kpi"><span class="stat-label">Revenue · ${rw}</span><b class="stat-value" title="${c.usd(rv.inRange)}">${usdShort(rv.inRange)}</b><span class="stat-sub">${deltaTag(rv.change)} ${num(rv.paidCount)} paid invoices</span></div>
          <div class="kpi"><span class="stat-label">Success rate</span><b class="stat-value">${c.pct(t.successRate)}</b><span class="stat-sub">p95 ${t.p95Ms === null ? "–" : "≤ " + c.ms(t.p95Ms)} · ${num(t.serverErrors)} server errors</span></div>
        </section>
        <div class="ov-row">
          <section class="ds-card"><div class="card-top"><h2>Platform traffic</h2><span class="meta push">${t.granularity === "hour" ? "Hourly" : "Daily"}</span></div>${t.total ? c.lineChart(t.series, { gran: t.granularity }) : h.empty("No traffic in this range", "Requests from every customer, REST and MCP, show up here.")}</section>
          <div class="stack">
            <section class="ds-card"><div class="card-top"><h2>Needs attention</h2></div>${
              todo.length
                ? `<ul class="todo">${todo.map(([n, w, sub, href]) => `<li><a href="${href}"><b>${num(n)}</b><span>${c.plural(n, w).replace(/^[\d,]+ /, "")} ${esc(sub)}</span>${icoArrow}</a></li>`).join("")}</ul>`
                : `<p class="all-clear"><span class="pulse ok" aria-hidden="true"></span>Nothing waiting. Invoices, payouts, reports and sources are all clear.</p>`
            }</section>
            <section class="ds-card"><div class="card-top"><h2>Customers</h2><a class="link-sm push" href="/admin/users">All</a></div>
              <div class="row-between"><b class="stat-value">${num(cu.paying)}</b><span class="meta">paying of ${num(cu.total)} · ${c.pct(cu.conversion === null ? null : Math.round(cu.conversion * 1000) / 10)} conversion</span></div>
              <div class="planmix">${["free", "pro", "ultra", "max"].map((p) => `<span class="pm-seg pm-${p}" style="flex:${cu.byPlan[p] || 0}" title="${c.cap(p)}: ${num(cu.byPlan[p])}"></span>`).join("")}</div>
              <ul class="pm-legend">${["free", "pro", "ultra", "max"].map((p) => `<li><i class="pm-${p}"></i>${c.cap(p)} <b>${num(cu.byPlan[p])}</b></li>`).join("")}</ul>
              <p class="meta">MRR ${usd(rv.mrrUsd)} at list price · ARPU ${usd(rv.arpuUsd)}${cu.suspended ? ` · ${num(cu.suspended)} suspended` : ""}</p>
            </section>
          </div>
        </div>
        <div class="ov-row">
          <section class="ds-card"><div class="card-top"><h2>Top customers</h2><span class="meta push">by requests · ${rw}</span></div>${
            cu.top.length ? h.table(["Customer", "Plan", "Requests", "Share"], cu.top.slice(0, 7).map((x) => `<tr><td>${customerCell(c, x)}</td><td>${x.plan ? h.badge(x.plan) : ""}</td><td class="num">${num(x.requests)}</td><td class="num">${c.pct(Math.round(x.usedShare * 1000) / 10)}</td></tr>`)) : h.empty("No customer traffic yet")
          }</section>
          <section class="ds-card"><div class="card-top"><h2>Breakdown</h2><div class="push">${h.seg("breakdown", [["endpoints", "Endpoints"], ["categories", "Categories"], ["sources", "REST vs MCP"], ["errors", "Errors"]], breakdown)}</div></div><div data-breakdown>${bd(t)}</div></section>
        </div>
        <div class="ov-row">
          <section class="ds-card"><div class="card-top"><h2>Source health</h2><a class="link-sm push" href="/admin/health">All sources</a></div>${
            o.sources.top.length ? h.table(["Source", "Requests", "Errors", "5xx", "Error rate", ""], sourceRows(c, o.sources.top.slice(0, 6))) : h.empty("No source traffic yet")
          }</section>
          <div class="stack">
            <section class="ds-card"><div class="card-top"><h2>New sign-ups</h2><span class="meta push">${num(cu.newInRange)} · ${rw}</span></div>${barChart(c, cu.signups.map((x) => ({ t: x.t, v: x.count })), { label: "Sign-ups", height: 90 })}
              <ul class="mini-list">${cu.recent.slice(0, 5).map((u) => `<li><a href="/admin/users?q=${encodeURIComponent(u.email ?? "")}"><span>${esc(u.email ?? u.name)}</span>${h.badge(u.plan)}<small>${c.ago(u.createdAt)}</small></a></li>`).join("") || '<li class="muted-sm">No customers yet.</li>'}</ul>
            </section>
            <section class="ds-card"><div class="card-top"><h2>Latest payments</h2><a class="link-sm push" href="/admin/revenue">Revenue</a></div>${
              rv.recentPaid.length ? `<ul class="mini-list">${rv.recentPaid.slice(0, 5).map((i) => `<li><span>${esc(i.email ?? i.id)}</span><b>${c.money(i.amount, i.currency)}</b><small>${c.ago(i.paidAt)}</small></li>`).join("")}</ul>` : `<p class="muted-sm">No paid invoices yet.</p>`
            }</section>
          </div>
        </div>
        <section class="ds-card"><div class="card-top"><h2>When customers call</h2><span class="meta push">Requests by weekday and hour, your timezone</span></div>${c.heatmap(t.heatmap)}</section>`;
    };
    const load = async () => {
      header();
      if (!last) c.root.innerHTML = `<div class="grid-dash">${h.skeleton(5)}</div>`;
      render(await loadAnalytics(c));
      // Setup problems are fetched separately: the checks call Supabase and can be slower.
      c.api("/api/admin/setup").then(({ content: setup }) => {
        const failing = setup.checks.filter((x) => x.status === "fail");
        const el = c.$("[data-setup-banner]", c.root);
        if (el && failing.length) el.innerHTML = `<div class="ds-banner" role="alert"><b>${c.plural(failing.length, "setup check")} failing.</b> ${failing.map((x) => esc(x.label)).join(", ")}. <a href="/admin/setup">Fix them</a></div>`;
      }).catch(() => {});
    };
    setHandlers({
      range: range.handler,
      retry: load,
      breakdown: (el) => {
        breakdown = el.dataset.v;
        c.$$('[data-act="breakdown"]', c.root).forEach((b) => { b.classList.toggle("on", b === el); b.setAttribute("aria-pressed", String(b === el)); });
        c.$("[data-breakdown]", c.root).innerHTML = bd(last.traffic);
      },
    });
    await load();
  };
  const icoArrow = `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>`;

  // ===== Traffic ============================================================================
  A.traffic = async (c) => {
    const { h, num } = c;
    const range = c.rangeControl(() => load());
    const load = async () => {
      setActions(range.html);
      c.root.innerHTML = h.skeleton(5);
      const o = await loadAnalytics(c);
      sysLine(c, o);
      const t = o.traffic;
      const rw = RW[o.range];
      const by = (name) => t.sources.find((x) => x.name === name)?.requests ?? 0;
      c.root.innerHTML = `
        <section class="ds-card kpis" aria-label="Traffic, ${rw}">
          <div class="kpi kpi-lead"><span class="stat-label">Requests · ${rw}</span><b class="hero-num">${c.compact(t.total)}</b><span class="stat-sub">${deltaTag(t.change?.total)}${t.previous ? ` vs ${num(t.previous.total)} before` : ""}</span></div>
          <div class="kpi"><span class="stat-label">Errors</span><b class="stat-value">${num(t.errors)}</b><span class="stat-sub">${deltaTag(t.change?.errors, { goodUp: false })} ${num(t.serverErrors)} server (5xx)</span></div>
          <div class="kpi"><span class="stat-label">Success rate</span><b class="stat-value">${c.pct(t.successRate)}</b><span class="stat-sub">${t.previous?.successRate !== null && t.previous ? `was ${c.pct(t.previous.successRate)}` : ""}</span></div>
          <div class="kpi"><span class="stat-label">Latency p95</span><b class="stat-value">${t.p95Ms === null ? "–" : "≤ " + c.ms(t.p95Ms)}</b><span class="stat-sub">${t.avgMs !== null ? `average ${c.ms(t.avgMs)}` : ""}</span></div>
          <div class="kpi"><span class="stat-label">REST / MCP</span><b class="stat-value">${num(by("rest"))} / ${num(by("mcp"))}</b><span class="stat-sub">${num(by("bulk"))} bulk · ${num(by("dashboard") + by("playground"))} dashboard</span></div>
        </section>
        <section class="ds-card"><div class="card-top"><h2>Requests and errors</h2><span class="meta push">${t.granularity === "hour" ? "Hourly" : "Daily"}</span></div>${t.total ? c.lineChart(t.series, { gran: t.granularity, height: 300, maxW: 1200 }) : h.empty("No traffic in this range")}</section>
        <div class="grid-2">
          <section class="ds-card"><div class="card-top"><h2>Top endpoints</h2></div>${c.hbars(t.endpoints, { total: t.total })}</section>
          <section class="ds-card"><div class="card-top"><h2>Categories</h2></div>${c.hbars(t.categories, { total: t.total, href: (x) => `/category/${encodeURIComponent(x.name)}` })}</section>
          <section class="ds-card"><div class="card-top"><h2>Errors by status</h2></div>${c.hbars(t.statuses.map((x) => ({ name: String(x.status), count: x.count })), { total: t.errors, empty: "No errors in this range." })}</section>
          <section class="ds-card"><div class="card-top"><h2>Channels</h2></div>${c.hbars(t.sources.map((x) => ({ ...x, name: x.name === "mcp" ? "MCP (AI agents)" : x.name === "rest" ? "REST API" : x.name })), { total: t.total })}</section>
        </div>
        <section class="ds-card"><div class="card-top"><h2>When customers call</h2><span class="meta push">Your timezone</span></div>${c.heatmap(t.heatmap)}</section>`;
    };
    setHandlers({ range: range.handler, retry: load });
    await load();
  };

  // ===== Live requests ======================================================================
  A.live = async (c) => {
    const { h, esc, num } = c;
    let filter = "all", auto = true, timer = null, rows = [], shown = 50;
    const draw = () => {
      const all = rows.filter((r) => filter === "all" || (filter === "error" ? r.status >= 400 : r.source === filter));
      const list = all.slice(0, shown);
      $list.innerHTML = list.length
        ? h.table(["Time", "Customer", "Endpoint", "Status", "Latency", "Channel"], list.map((r) => `<tr class="${r.status >= 500 ? "row-bad" : ""}">
            <td class="mono">${c.time(r.at)}</td>
            <td>${r.email ? `<a href="/admin/users?q=${encodeURIComponent(r.email)}">${esc(r.email)}</a>` : `<span class="muted-sm">${esc(r.owner ?? "–")}</span>`}</td>
            <td><span class="mono">${esc(r.project)}/${esc(r.endpoint)}</span>${r.error ? `<br><span class="muted-sm">${esc(r.error)}</span>` : ""}</td>
            <td>${h.status(r.status)}${r.cache === "HIT" ? ' <span class="muted-sm">cache</span>' : ""}</td>
            <td class="num">${c.ms(r.ms)}</td>
            <td>${h.badge(r.source ?? "rest", r.source === "mcp" ? "MCP" : r.source ?? "rest")}</td>
          </tr>`))
        : h.empty("No requests yet", "Calls from every customer appear here within a second.");
      if (all.length > shown) $list.insertAdjacentHTML("beforeend", `<div class="pager"><button class="btn btn-ghost btn-sm" data-act="more">Show ${num(Math.min(50, all.length - shown))} more</button></div>`);
      $count.textContent = `${num(list.length)} of ${num(all.length)} latest · ${auto ? "auto-refresh every 5 s" : "paused"}`;
    };
    const load = async () => {
      const { content } = await c.api("/api/admin/live?limit=200");
      rows = content.items;
      draw();
    };
    const tick = () => {
      clearTimeout(timer);
      if (!auto || !document.body.contains($list)) return;
      timer = setTimeout(async () => { if (!document.hidden) await load().catch(() => {}); tick(); }, 5000);
    };
    const controls = () => setActions(`${h.seg("filter", [["all", "All"], ["error", "Errors"], ["mcp", "MCP"], ["rest", "REST"]], filter)}<button class="btn btn-ghost" data-act="toggle">${auto ? "Pause" : "Resume"}</button>`);
    c.root.innerHTML = `<p class="muted-sm" data-count></p><div data-list>${h.skeleton(8)}</div>`;
    const $list = c.$("[data-list]", c.root);
    const $count = c.$("[data-count]", c.root);
    controls();
    setHandlers({
      retry: load,
      filter: (el) => { filter = el.dataset.v; shown = 50; controls(); draw(); },
      more: () => { shown += 50; draw(); },
      toggle: () => { auto = !auto; controls(); draw(); tick(); },
    });
    await load();
    tick();
  };

  // ===== Source health ======================================================================
  A.health = async (c) => {
    const { h, num, esc } = c;
    const range = c.rangeControl(() => load());
    let show = "all", q = "", page = 0;
    let o = null, rows = [];
    const counts = () => ({
      all: rows.length,
      problems: rows.filter((x) => x.errors > 0 || !x.enabled).length,
      live: rows.filter((x) => x.status === "live" && x.enabled).length,
      byok: rows.filter((x) => x.status === "byok" && x.enabled).length,
      planned: rows.filter((x) => x.status === "planned").length,
      off: rows.filter((x) => !x.enabled).length,
    });
    const seg = () => {
      const n = counts();
      return h.seg("show", [["all", `All ${num(n.all)}`], ["problems", `Problems ${num(n.problems)}`], ["live", `Live ${num(n.live)}`], ["byok", `BYOK ${num(n.byok)}`], ["planned", `Planned ${num(n.planned)}`], ["off", `Off ${num(n.off)}`]], show);
    };
    const health = (x) => {
      if (!x.enabled) return h.badge("disabled", "switched off");
      if (x.status === "planned") return h.badge("pending", "not built");
      if (!x.requests) return `<span class="muted-sm">no traffic</span>`;
      if (x.requests >= 5 && x.serverErrors / x.requests >= 0.2) return h.badge("failed", "failing");
      if (x.serverErrors) return h.badge("pending", "some 5xx");
      return h.badge("ok", "healthy");
    };
    const draw = () => {
      const list = rows.filter((x) =>
        (show === "all" || (show === "problems" ? x.errors > 0 || !x.enabled : show === "off" ? !x.enabled : x.status === show && (show === "planned" || x.enabled))) &&
        (!q || `${x.key} ${x.displayName} ${x.category}`.toLowerCase().includes(q))
      );
      const pageRows = list.slice(page * PAGE, (page + 1) * PAGE).map((x) => `<tr class="${!x.enabled ? "off" : x.requests >= 5 && x.serverErrors / x.requests >= 0.2 ? "row-bad" : ""}">
          <td>${srcCell(c, x)}</td>
          <td>${statusBadge(c, x)}</td>
          <td class="num hide-sm">${x.status === "planned" ? `<span class="muted-sm">${num(x.endpoints)} planned</span>` : `${num(x.live)}/${num(x.endpoints)}`}</td>
          <td class="num">${num(x.requests)}</td>
          <td class="num">${num(x.errors)}</td>
          <td class="num">${x.serverErrors ? `<b class="t-bad">${num(x.serverErrors)}</b>` : "0"}</td>
          <td class="num">${x.requests ? c.pct(Math.round((x.errors / x.requests) * 1000) / 10) : "–"}</td>
          <td>${health(x)}</td>
        </tr>`);
      c.$("[data-seg]", c.root).innerHTML = seg();
      c.$("[data-list]", c.root).innerHTML = list.length
        ? `${h.table(["Source", "Status", '<span class="hide-sm">Endpoints</span>', "Requests", "Errors", "5xx", "Error rate", "Health"], pageRows)}${list.length > PAGE ? `<div class="pager"><button class="btn btn-ghost btn-sm" data-act="prev"${page ? "" : " disabled"}>Previous</button><span>${page * PAGE + 1}–${Math.min(list.length, (page + 1) * PAGE)} of ${num(list.length)}</span><button class="btn btn-ghost btn-sm" data-act="next"${(page + 1) * PAGE < list.length ? "" : " disabled"}>Next</button></div>` : ""}`
        : h.empty("No sources match", show === "problems" ? "No source returned errors in this range." : "Clear the search or pick another filter.");
    };
    const load = async () => {
      setActions(range.html);
      c.root.innerHTML = h.skeleton(5);
      const [an, { content: all }] = await Promise.all([loadAnalytics(c), c.api("/api/admin/scrapers")]);
      o = an;
      sysLine(c, o);
      const traffic = new Map(o.sources.all.map((x) => [x.project, x]));
      rows = all
        .map((s) => { const t = traffic.get(s.key); return { ...s, requests: t?.requests ?? 0, errors: t?.errors ?? 0, serverErrors: t?.serverErrors ?? 0 }; })
        .sort((a, b) => b.serverErrors - a.serverErrors || b.requests - a.requests || (a.status === "planned") - (b.status === "planned") || a.displayName.localeCompare(b.displayName));
      const n = counts();
      const cat = o.system.catalog;
      c.root.innerHTML = `
        <section class="ds-card kpis">
          <div class="kpi kpi-lead"><span class="stat-label">System</span><b class="stat-value">${o.system.state === "operational" ? '<span class="pulse ok" aria-hidden="true"></span> Operational' : '<span class="pulse warn" aria-hidden="true"></span> Degraded'}</b><span class="stat-sub">${c.plural(o.system.requests, "request")}, ${c.plural(o.system.serverErrors, "server error")} in the last hour</span></div>
          <div class="kpi"><span class="stat-label">Failing sources</span><b class="stat-value">${num(o.sources.failing.length)}</b><span class="stat-sub">≥20% server errors · ${RW[o.range]}</span></div>
          <div class="kpi"><span class="stat-label">Visible to users</span><b class="stat-value">${num(cat.scrapers)}</b><span class="stat-sub">${num(n.live)} live · ${num(n.byok)} BYOK</span></div>
          <div class="kpi"><span class="stat-label">Planned (admin only)</span><b class="stat-value">${num(cat.plannedScrapers)}</b><span class="stat-sub">${num(cat.plannedEndpoints)} endpoints hidden from users</span></div>
          <div class="kpi"><span class="stat-label">Switched off</span><b class="stat-value">${num(n.off)}</b><span class="stat-sub"><a href="/admin/scrapers">Manage catalog</a></span></div>
        </section>
        <section class="ds-card">
          <div class="filterbar"><label class="search-box"><span class="visually-hidden">Search sources</span><input type="search" placeholder="Search name, key or category" data-input="search" aria-label="Search sources" value="${esc(q)}"></label><div data-seg></div></div>
          <div data-list></div>
          <p class="muted-sm">Every source in the catalog, ${RW[o.range]}. 4xx errors are usually bad input from the caller; 5xx means the source failed or timed out. Planned sources are listed here only: users never see them in the catalog, docs, search or MCP.</p>
        </section>
        <section class="ds-card"><div class="card-top"><h2>Platform</h2></div><div class="grid-4">
          <div class="kv"><span>Storage</span><b>${esc(o.system.storage)}</b></div>
          <div class="kv"><span>Region</span><b>${esc(o.system.region ?? "local")}</b></div>
          <div class="kv"><span>Version</span><b>${esc(o.system.version)}</b></div>
          <div class="kv"><span>Setup checks</span><b><a href="/admin/setup">Open</a></b></div>
        </div></section>`;
      draw();
    };
    setHandlers({
      range: range.handler,
      retry: load,
      show: (el) => { show = el.dataset.v; page = 0; draw(); },
      search: (el) => { q = el.value.trim().toLowerCase(); page = 0; draw(); },
      prev: () => { page--; draw(); },
      next: () => { page++; draw(); },
    });
    await load();
  };

  // ===== Revenue ============================================================================
  A.revenue = async (c) => {
    const { h, esc, num, idr } = c;
    const range = c.rangeControl(() => load());
    const load = async () => {
      setActions(`${range.html}<a class="btn btn-ghost" href="/admin/invoices">Invoices</a>`);
      c.root.innerHTML = h.skeleton(5);
      const o = await loadAnalytics(c);
      sysLine(c, o);
      const rv = o.revenue, cu = o.customers;
      const rw = RW[o.range];
      c.root.innerHTML = `
        <section class="ds-card kpis">
          <div class="kpi kpi-lead"><span class="stat-label">Revenue · ${rw}</span><b class="hero-num" title="${c.usd(rv.inRange)}">${usdShort(rv.inRange)}</b><span class="stat-sub">${deltaTag(rv.change)}${rv.previous !== null ? ` vs ${usdShort(rv.previous)} before` : ""}</span></div>
          <div class="kpi"><span class="stat-label">MRR</span><b class="stat-value">${usd(rv.mrrUsd)}</b><span class="stat-sub">active paid plans at list price</span></div>
          <div class="kpi"><span class="stat-label">Paying customers</span><b class="stat-value">${num(cu.paying)}</b><span class="stat-sub">${c.pct(cu.conversion === null ? null : Math.round(cu.conversion * 1000) / 10)} of ${num(cu.total)}</span></div>
          <div class="kpi"><span class="stat-label">ARPU</span><b class="stat-value">${usd(rv.arpuUsd)}</b><span class="stat-sub">per paying customer / month</span></div>
          <div class="kpi"><span class="stat-label">To confirm</span><b class="stat-value">${num(o.attention.invoicesToReview)}</b><span class="stat-sub">${num(rv.pending)} checkouts not completed</span></div>
        </section>
        <div class="ov-row">
          <section class="ds-card"><div class="card-top"><h2>Paid per day</h2><span class="meta push">${num(rv.paidCount)} invoices · ${rw}</span></div>${rv.inRange ? barChart(c, rv.series.map((x) => ({ t: x.t, v: x.amount })), { fmt: c.usd, label: "Revenue" }) : h.empty("No payments in this range", "Approved invoices count on the day they are marked paid.")}</section>
          <section class="ds-card"><div class="card-top"><h2>Plan mix</h2></div>
            <div class="planmix">${["free", "pro", "ultra", "max"].map((p) => `<span class="pm-seg pm-${p}" style="flex:${cu.byPlan[p] || 0}"></span>`).join("")}</div>
            <ul class="pm-legend">${["free", "pro", "ultra", "max"].map((p) => `<li><i class="pm-${p}"></i>${c.cap(p)} <b>${num(cu.byPlan[p])}</b></li>`).join("")}</ul>
          </section>
        </div>
        <div class="grid-2">
          <section class="ds-card"><div class="card-top"><h2>Waiting for your confirmation</h2><a class="link-sm push" href="/admin/invoices">Review</a></div>${
            rv.awaitingReview.length ? `<ul class="mini-list">${rv.awaitingReview.map((i) => `<li><a href="/admin/invoices"><span>${esc(i.email ?? i.id)} · ${i.type === "topup" ? "top-up" : `${c.cap(i.plan)} × ${i.months} mo`}</span><b>${c.money(i.amount, i.currency)}</b><small>${c.ago(i.createdAt)}</small></a></li>`).join("")}</ul>` : `<p class="all-clear"><span class="pulse ok" aria-hidden="true"></span>Nothing to confirm.</p>`
          }</section>
          <section class="ds-card"><div class="card-top"><h2>Latest payments</h2></div>${
            rv.recentPaid.length ? `<ul class="mini-list">${rv.recentPaid.map((i) => `<li><span>${esc(i.email ?? i.id)} · ${i.type === "topup" ? "top-up" : c.cap(i.plan ?? "plan")}</span><b>${c.money(i.amount, i.currency)}</b><small>${c.day(i.paidAt)}</small></li>`).join("")}</ul>` : `<p class="muted-sm">No paid invoices yet.</p>`
          }</section>
        </div>`;
    };
    setHandlers({ range: range.handler, retry: load });
    await load();
  };

  // ===== Setup checks ======================================================================
  A.setup = async (c) => {
    const { h, esc, api } = c;
    const load = async () => {
      c.root.innerHTML = h.skeleton(5);
      const { content: r } = await api("/api/admin/setup");
      const icon = { ok: "Ready", warn: "Review", fail: "Action needed" };
      c.root.innerHTML = `
        <div class="ds-card setup-head ${r.ready ? "ok" : "fail"}"><b>${r.ready ? "Apizie is ready for real users." : "Apizie is not ready for real users yet."}</b><p>Storage: ${esc(r.storage.backend)}${r.storage.serverless ? " on serverless" : ""}. ${r.ready ? "Every required check passes." : "Fix the checks marked Action needed, then redeploy and reload this page. Checks marked Review are recommended, not required."}</p></div>
        <ul class="checks-list">${r.checks
          .map(
            (x) => `<li class="ds-card check check-${x.status}">
              <div class="check-top"><b>${esc(x.label)}</b>${h.badge(x.status === "ok" ? "active" : x.status === "warn" ? "pending" : "rejected", icon[x.status])}</div>
              <p>${esc(x.detail)}</p>
              ${x.fix ? `<p class="hint"><b>How to fix:</b> ${esc(x.fix)}</p>` : ""}
            </li>`
          )
          .join("")}</ul>`;
    };
    setActions(`<button class="btn btn-ghost" data-act="reload">Run checks again</button>`);
    setHandlers({ reload: load, retry: load });
    await load();
  };

  // ===== Users ===============================================================================
  A.users = async (c) => {
    const { h, esc, num, api, day } = c;
    let users = [];
    let q = (new URLSearchParams(location.search).get("q") ?? "").trim().toLowerCase();
    let page = 0;
    const draw = () => {
      const list = users.filter((u) => !q || `${u.email} ${u.name}`.toLowerCase().includes(q));
      const rows = list.slice(page * PAGE, (page + 1) * PAGE).map(
        (u) => `<tr>
          <td><b>${esc(u.name)}</b><br><span class="muted-sm">${esc(u.email)}</span></td>
          <td>${h.badge(u.effectivePlan)}${u.planExpiresAt && u.plan !== "free" ? `<br><span class="muted-sm">until ${day(u.planExpiresAt)}</span>` : ""}</td>
          <td class="num">${num(u.usedThisMonth)}</td>
          <td>${u.role === "admin" ? h.badge("admin") : ""}${h.badge(u.status ?? "active")}</td>
          <td class="hide-sm">${day(u.createdAt)}</td>
          <td><button class="btn btn-ghost btn-sm" data-act="edit" data-id="${esc(u.id)}">Edit</button></td>
        </tr>`
      );
      $list.innerHTML = list.length
        ? `${h.table(["Customer", "Plan", "Used this month", "Status", '<span class="hide-sm">Joined</span>', ""], rows)}${pager(list.length)}`
        : h.empty(q ? "No customers match" : "No customers yet", q ? "Try part of the email or name." : "People who sign up appear here.");
    };
    const pager = (n) => (n > PAGE ? `<div class="pager"><button class="btn btn-ghost btn-sm" data-act="prev"${page ? "" : " disabled"}>Previous</button><span>${page * PAGE + 1}–${Math.min(n, (page + 1) * PAGE)} of ${num(n)}</span><button class="btn btn-ghost btn-sm" data-act="next"${(page + 1) * PAGE < n ? "" : " disabled"}>Next</button></div>` : "");
    const load = async () => {
      $list.innerHTML = h.skeleton(6);
      users = (await api("/api/admin/users")).content;
      draw();
    };
    c.root.innerHTML = `<div class="filterbar"><label class="search-box"><span class="visually-hidden">Search customers</span><input type="search" placeholder="Search email or name" data-input="search" aria-label="Search customers" value="${esc(q)}"></label></div><div data-list></div>`;
    const $list = c.$("[data-list]", c.root);
    setActions("");
    setHandlers({
      retry: load,
      search: (el) => {
        q = el.value.trim().toLowerCase();
        page = 0;
        draw();
      },
      prev: () => {
        page--;
        draw();
      },
      next: () => {
        page++;
        draw();
      },
      edit: async (el) => {
        const u = users.find((x) => x.id === el.dataset.id);
        const saved = await c.openModal({
          title: `Edit ${esc(u.email)}`,
          body: `<div class="form-grid">
            <label class="field">Plan<select name="plan">${planOptions(u.plan)}</select></label>
            <label class="field">Days active<input name="days" type="number" min="1" max="3650" value="30"><span class="hint">Only used when the plan changes to a paid plan.</span></label>
            <label class="field">Role<select name="role"><option value="user"${u.role !== "admin" ? " selected" : ""}>user</option><option value="admin"${u.role === "admin" ? " selected" : ""}>admin</option></select></label>
            <label class="field">Status<select name="status"><option value="active"${u.status !== "suspended" ? " selected" : ""}>active</option><option value="suspended"${u.status === "suspended" ? " selected" : ""}>suspended</option></select></label>
          </div>`,
          submit: "Save",
          onSubmit: async (f) => {
            const body = { role: f.role.value, status: f.status.value };
            if (f.plan.value !== u.plan) Object.assign(body, { plan: f.plan.value, days: Number(f.days.value) });
            await api(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: "PATCH", body });
            return true;
          },
        });
        if (saved) {
          c.toast("Customer updated");
          await load();
        }
      },
    });
    await load();
  };

  // ===== Invoices ============================================================================
  A.invoices = async (c) => {
    const { h, esc, idr, api, dt } = c;
    let all = [];
    let filter = "awaiting_review";
    const draw = () => {
      const list = all.filter((i) => filter === "all" || i.status === filter || (filter === "awaiting_review" && i.status === "pending"));
      const what = (i) => (i.type === "topup" ? `Top-up ${c.money(i.subtotal, i.currency)}` : `${c.cap(i.plan)} × ${i.months} mo`);
      $list.innerHTML = list.length
        ? h.table(
            ["Invoice", "Customer", "For", "Amount", "Status", ""],
            list.map(
              (i) => `<tr>
                <td><b>${esc(i.id)}</b><br><span class="muted-sm">${dt(i.createdAt)}</span></td>
                <td>${esc(i.email ?? i.userId)}</td>
                <td>${what(i)}</td>
                <td class="num"><b>${c.money(i.amount, i.currency)}</b><br><span class="muted-sm">${i.provider === "dodo" ? `Card via Dodo Payments${i.paymentId ? ` · ${esc(i.paymentId)}` : ""}` : `Bank transfer (older invoice) · ${c.idr(i.amount)}`}</span></td>
                <td>${h.badge(i.status)}${i.reference ? `<br><span class="muted-sm">Ref: ${esc(i.reference)}</span>` : ""}</td>
                <td>${["pending", "awaiting_review"].includes(i.status) && i.provider !== "dodo" ? `<div class="ds-row"><button class="btn btn-primary btn-sm" data-act="approve" data-id="${esc(i.id)}">Mark paid</button><button class="btn btn-danger-ghost btn-sm" data-act="reject" data-id="${esc(i.id)}">Reject</button></div>` : ""}</td>
              </tr>`
            )
          )
        : h.empty(filter === "awaiting_review" ? "Nothing to review" : "No invoices here", "Invoices appear here when customers start a checkout.");
    };
    const load = async () => {
      $list.innerHTML = h.skeleton(5);
      all = (await api("/api/admin/invoices")).content.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      bar();
      draw();
    };
    const bar = () => {
      const n = all.filter((i) => ["pending", "awaiting_review"].includes(i.status)).length;
      $bar.innerHTML = h.seg("filter", [["awaiting_review", `Open (${n})`], ["paid", "Paid"], ["rejected", "Rejected"], ["cancelled", "Cancelled"], ["all", "All"]], filter);
    };
    c.root.innerHTML = `<div class="filterbar" data-bar></div><p class="muted-sm">Card payments through Dodo Payments activate plans and top-ups automatically. Older bank-transfer invoices can still be marked paid or rejected here. Plans activate and top-ups are credited immediately.</p><div data-list></div>`;
    const $list = c.$("[data-list]", c.root);
    const $bar = c.$("[data-bar]", c.root);
    setActions("");
    setHandlers({
      retry: load,
      filter: (el) => {
        filter = el.dataset.v;
        bar();
        draw();
      },
      approve: async (el) => {
        const i = all.find((x) => x.id === el.dataset.id);
        const ok = await c.confirmModal({ title: `Mark ${esc(i.id)} paid?`, text: `Only do this after ${c.money(i.amount, i.currency)} reached your account. ${i.type === "topup" ? `${c.money(i.subtotal, i.currency)} is added to the customer's balance.` : `The ${esc(i.plan)} plan is activated for ${i.months} month${i.months > 1 ? "s" : ""}.`}`, confirm: "Mark paid", danger: false });
        if (!ok) return;
        await api(`/api/admin/invoices/${encodeURIComponent(i.id)}/approve`, { method: "POST" });
        c.toast("Invoice paid");
        await load();
      },
      reject: async (el) => {
        const id = el.dataset.id;
        const ok = await c.openModal({
          title: `Reject ${esc(id)}?`,
          body: `<label class="field">Note for the customer<textarea name="note" rows="3" maxlength="200" placeholder="For example: no transfer found for this amount"></textarea></label>`,
          submit: "Reject invoice",
          danger: true,
          onSubmit: async (f) => {
            await api(`/api/admin/invoices/${encodeURIComponent(id)}/reject`, { method: "POST", body: { note: f.note.value } });
            return true;
          },
        });
        if (ok) {
          c.toast("Invoice rejected");
          await load();
        }
      },
    });
    await load();
  };

  // ===== Affiliate payouts ===================================================================
  A.payouts = async (c) => {
    const { h, esc, idr, api, dt } = c;
    let all = [];
    const load = async () => {
      c.root.innerHTML = h.skeleton(4);
      all = (await api("/api/admin/payouts")).content.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      c.root.innerHTML = all.length
        ? h.table(
            ["Payout", "Affiliate", "Send to", "Amount", "Status", ""],
            all.map(
              (p) => `<tr>
                <td><b>${esc(p.id)}</b><br><span class="muted-sm">${dt(p.createdAt)}</span></td>
                <td>${esc(p.email)}</td>
                <td class="clip">${esc(p.account)}</td>
                <td class="num"><b>${payoutAmt(c, p)}</b></td>
                <td>${h.badge(p.status)}${p.reference ? `<br><span class="muted-sm">Ref: ${esc(p.reference)}</span>` : ""}</td>
                <td>${p.status === "requested" ? `<div class="ds-row"><button class="btn btn-primary btn-sm" data-act="paid" data-id="${esc(p.id)}">Mark sent</button><button class="btn btn-danger-ghost btn-sm" data-act="reject" data-id="${esc(p.id)}">Return</button></div>` : ""}</td>
              </tr>`
            )
          )
        : h.empty("No payout requests", "Affiliates can request a payout once they have $10 available.");
    };
    const act = (kind) => async (el) => {
      const id = el.dataset.id;
      const p = all.find((x) => x.id === id);
      const ok = await c.openModal({
        title: kind === "paid" ? `Mark ${esc(id)} sent` : `Return ${esc(id)}`,
        body:
          kind === "paid"
            ? `<p class="modal-text">Send ${payoutAmt(c, p)} to <b>${esc(p.account)}</b> first (PayPal or international transfer).</p><label class="field">Transfer reference<input name="v" maxlength="200" required autofocus></label>`
            : `<p class="modal-text">${payoutAmt(c, p)} goes back to the affiliate's available earnings.</p><label class="field">Reason<textarea name="v" rows="3" maxlength="200"></textarea></label>`,
        submit: kind === "paid" ? "Mark sent" : "Return payout",
        danger: kind !== "paid",
        onSubmit: async (f) => {
          if (kind === "paid" && !f.v.value.trim()) throw new Error("Add the PayPal or transfer reference so the affiliate can trace it.");
          await api(`/api/admin/payouts/${encodeURIComponent(id)}/${kind}`, { method: "POST", body: kind === "paid" ? { reference: f.v.value.trim() } : { note: f.v.value.trim() } });
          return true;
        },
      });
      if (ok) {
        c.toast(kind === "paid" ? "Payout marked sent" : "Payout returned");
        await load();
      }
    };
    setActions("");
    setHandlers({ retry: load, paid: act("paid"), reject: act("reject") });
    await load();
  };

  // ===== Sources (scrapers) =================================================================
  A.scrapers = async (c) => {
    const { h, esc, num, pct, api } = c;
    let all = [];
    let q = "";
    let only = "all";
    let page = 0;
    const draw = () => {
      const list = all.filter((s) => (only === "all" || (only === "off" ? !s.enabled : s.status === only)) && (!q || `${s.key} ${s.displayName}`.toLowerCase().includes(q)));
      const rows = list.slice(page * PAGE, (page + 1) * PAGE).map(
        (s) => `<tr class="${s.enabled ? "" : "off"}">
          <td>${srcCell(c, s)}</td>
          <td>${statusBadge(c, { ...s, enabled: true })}</td>
          <td class="num hide-sm">${num(s.live)}/${num(s.endpoints)}</td>
          <td class="num">${num(s.requests)}<br><span class="muted-sm">${s.successRate === null ? "no traffic" : pct(s.successRate) + " ok"}</span></td>
          <td><label class="toggle"><input type="checkbox" data-change="toggle" data-key="${esc(s.key)}"${s.enabled ? " checked" : ""}><span>${s.enabled ? "On" : "Off"}</span></label></td>
          <td><button class="btn btn-ghost btn-sm" data-act="logo" data-key="${esc(s.key)}">Logo</button></td>
        </tr>`
      );
      $list.innerHTML = list.length
        ? `${h.table(["Source", "Status", '<span class="hide-sm">Live endpoints</span>', "Requests", "Enabled", ""], rows)}${list.length > PAGE ? `<div class="pager"><button class="btn btn-ghost btn-sm" data-act="prev"${page ? "" : " disabled"}>Previous</button><span>${page * PAGE + 1}–${Math.min(list.length, (page + 1) * PAGE)} of ${num(list.length)}</span><button class="btn btn-ghost btn-sm" data-act="next"${(page + 1) * PAGE < list.length ? "" : " disabled"}>Next</button></div>` : ""}`
        : h.empty("No sources match", "Clear the search or pick another filter.");
    };
    const load = async () => {
      $list.innerHTML = h.skeleton(8);
      all = (await api("/api/admin/scrapers")).content.sort((a, b) => b.requests - a.requests || a.displayName.localeCompare(b.displayName));
      draw();
    };
    c.root.innerHTML = `<div class="filterbar"><label class="search-box"><span class="visually-hidden">Search sources</span><input type="search" placeholder="Search sources" data-input="search" aria-label="Search sources"></label><div data-seg>${h.seg("only", [["all", "All"], ["live", "Live"], ["byok", "BYOK"], ["planned", "Planned"], ["off", "Disabled"]], only)}</div></div><div data-list></div>`;
    const $list = c.$("[data-list]", c.root);
    const $seg = c.$("[data-seg]", c.root);
    setActions("");
    setHandlers({
      retry: load,
      search: (el) => {
        q = el.value.trim().toLowerCase();
        page = 0;
        draw();
      },
      only: (el) => {
        only = el.dataset.v;
        page = 0;
        $seg.innerHTML = h.seg("only", [["all", "All"], ["live", "Live"], ["byok", "BYOK"], ["planned", "Planned"], ["off", "Disabled"]], only);
        draw();
      },
      prev: () => {
        page--;
        draw();
      },
      next: () => {
        page++;
        draw();
      },
      toggle: async (el) => {
        const s = all.find((x) => x.key === el.dataset.key);
        el.disabled = true;
        try {
          await api(`/api/admin/scrapers/${encodeURIComponent(s.key)}`, { method: "POST", body: { enabled: el.checked } });
          s.enabled = el.checked;
          c.toast(`${s.displayName} ${s.enabled ? "enabled" : "disabled"}`);
        } catch (err) {
          el.checked = !el.checked;
          c.toast(err.message);
        }
        draw();
      },
      logo: async (el) => {
        const s = all.find((x) => x.key === el.dataset.key);
        const saved = await c.openModal({
          title: `Logo for ${esc(s.displayName)}`,
          body: `<div class="logo-edit"><img data-preview src="${esc(s.iconUrl ?? "")}" alt="" width="56" height="56"${s.iconUrl ? "" : " hidden"}>
            <div class="stack"><label class="field">Image URL<input name="url" value="${esc(s.iconUrl?.startsWith("data:") ? "" : s.iconUrl ?? "")}" placeholder="https://… or /assets/sources/…"></label>
            <label class="field">Or upload (PNG, SVG, WebP, JPEG, up to 150 KB)<input name="file" type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg"></label>
            <span class="hint">Leave the URL empty and save to go back to the default logo.</span></div></div>`,
          submit: "Save logo",
          onOpen: (m) => {
            const f = c.$("form", m);
            f.file.addEventListener("change", () => {
              const file = f.file.files[0];
              if (!file) return;
              if (file.size > 150_000) return c.toast("That image is over 150 KB.");
              const r = new FileReader();
              r.onload = () => {
                f.url.value = r.result;
                const img = c.$("[data-preview]", m);
                img.src = r.result;
                img.hidden = false;
              };
              r.readAsDataURL(file);
            });
          },
          onSubmit: async (f) => {
            const { content } = await api(`/api/admin/scrapers/${encodeURIComponent(s.key)}/icon`, { method: "POST", body: { url: f.url.value.trim() } });
            s.iconUrl = content.iconUrl ?? s.iconUrl;
            return true;
          },
        });
        if (saved) {
          c.toast("Logo saved");
          await load();
        }
      },
    });
    await load();
  };

  // ===== Reports and showcase moderation ======================================================
  const moderation = (kind, { statuses, title, empty, render }) => async (c) => {
    const { h, esc, api } = c;
    let all = [];
    let filter = statuses[0];
    const draw = () => {
      const list = all.filter((x) => filter === "all" || x.status === filter);
      $bar.innerHTML = h.seg("filter", [...statuses.map((s) => [s, c.cap(s)]), ["all", "All"]], filter);
      $list.innerHTML = list.length ? `<ul class="stack">${list.map((x) => `<li class="ds-card mod-item">${render(x, c)}<div class="ds-row">${statuses.filter((s) => s !== x.status).map((s) => `<button class="btn btn-ghost btn-sm" data-act="set" data-id="${esc(x.id)}" data-v="${s}">${title(s)}</button>`).join("")}</div></li>`).join("")}</ul>` : h.empty(empty);
    };
    const load = async () => {
      $list.innerHTML = h.skeleton(4);
      all = (await api(`/api/admin/${kind}s`)).content.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      draw();
    };
    c.root.innerHTML = `<div class="filterbar" data-bar></div><div data-list></div>`;
    const $list = c.$("[data-list]", c.root);
    const $bar = c.$("[data-bar]", c.root);
    setActions("");
    setHandlers({
      retry: load,
      filter: (el) => {
        filter = el.dataset.v;
        draw();
      },
      set: async (el) => {
        await api(`/api/admin/${kind}s/${encodeURIComponent(el.dataset.id)}`, { method: "PATCH", body: { status: el.dataset.v } });
        all.find((x) => x.id === el.dataset.id).status = el.dataset.v;
        c.toast("Updated");
        draw();
      },
    });
    await load();
  };

  A.reports = moderation("report", {
    statuses: ["open", "closed"],
    title: (s) => (s === "closed" ? "Close" : "Reopen"),
    empty: "No reports in this list",
    render: (r, c) => `<div class="check-top"><b>${c.esc(c.cap(r.type))}${r.scraper ? ` · ${c.esc(r.scraper)}` : ""}</b>${c.h.badge(r.status)}</div>
      <p class="pre">${c.esc(r.message)}</p>
      <p class="muted-sm">${c.esc(r.email)} · ${c.dt(r.createdAt)}${r.requestId ? ` · request <code>${c.esc(r.requestId)}</code>` : ""}</p>`,
  });
  A.showcase = moderation("showcase", {
    statuses: ["pending", "approved", "rejected"],
    title: (s) => ({ pending: "Back to pending", approved: "Approve", rejected: "Reject" })[s],
    empty: "Nothing here",
    render: (s, c) => `<div class="check-top"><b>${c.esc(s.name)}</b>${c.h.badge(s.status)}</div>
      <p><a href="${c.esc(s.url)}" target="_blank" rel="noopener nofollow">${c.esc(s.url)}</a></p>
      ${s.description ? `<p>${c.esc(s.description)}</p>` : ""}<p class="muted-sm">${c.dt(s.createdAt)}</p>`,
  });
})();
