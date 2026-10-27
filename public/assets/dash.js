/* Apizie dashboard runtime: helpers, charts, modals, filters and the section router.
   Sections live in dash-user.js and dash-admin.js and register themselves on window.apz.sections. */
(() => {
  const { $, $$, esc, toast, api, store } = window.zie;
  const root = $("[data-dash]") || $("[data-admin]");
  if (!root) return;
  const D = JSON.parse($("#dash-data")?.textContent ?? "{}");
  const actionsBar = $("[data-actions]");
  const modal = $("[data-modal]");

  // ---- formatting ---------------------------------------------------------------
  const num = (n) => Number(n ?? 0).toLocaleString("en-US");
  const compact = (n) => {
    const v = Number(n ?? 0);
    return v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M" : v >= 1e4 ? (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + "K" : num(v);
  };
  const idr = (n) => "Rp" + Math.round(Number(n ?? 0)).toLocaleString("id-ID");
  const pct = (v) => (v === null || v === undefined ? "–" : `${Number.isInteger(Number(v)) ? Number(v) : Number(v).toFixed(1)}%`);
  const ms = (v) => (v === null || v === undefined ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
  const ago = (iso) => {
    if (!iso) return "never";
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 45) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  const dt = (iso, opts = {}) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...opts }) : "–");
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–");
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const plural = (n, w) => `${num(n)} ${w}${Number(n) === 1 ? "" : "s"}`;
  const tz = -new Date().getTimezoneOffset();

  // ---- shared state (range + key filter live in the URL so links and reloads keep them) ---
  const qs = new URLSearchParams(location.search);
  const state = {
    range: qs.get("range") || store.get("apz_range") || "7d",
    key: qs.get("key") || "all",
  };
  const RANGES = [
    ["24h", "24H", 0],
    ["7d", "7D", 0],
    ["30d", "30D", 30],
    ["90d", "90D", 90],
  ];
  const rangeAllowed = (r) => (RANGES.find((x) => x[0] === r)?.[2] ?? 0) <= (D.plan?.logDays ?? 7);
  if (!rangeAllowed(state.range)) state.range = "7d";
  const syncUrl = () => {
    const u = new URL(location.href);
    u.searchParams.set("range", state.range);
    if (state.key && state.key !== "all") u.searchParams.set("key", state.key);
    else u.searchParams.delete("key");
    history.replaceState(null, "", u);
    store.set("apz_range", state.range);
  };
  const lockLabel = (days) => (days >= 90 ? "Ultra" : "Pro");

  // ---- small components ----------------------------------------------------------------
  const h = {
    loading: (label = "Loading") => `<div class="ds-loading" role="status"><span class="spinner" aria-hidden="true"></span> ${esc(label)}…</div>`,
    skeleton: (rows = 3) => `<div class="sk-wrap" aria-hidden="true">${Array.from({ length: rows }, () => '<span class="sk"></span>').join("")}</div>`,
    error: (err, retry = "retry") => `<div class="ds-card ds-state ds-error" role="alert"><b>Couldn't load this.</b><p>${esc(err?.message ?? "Something went wrong.")}</p><button class="btn btn-ghost btn-sm" data-act="${retry}">Try again</button></div>`,
    empty: (title, text = "", actions = "") => `<div class="ds-state"><span class="ds-state-dot" aria-hidden="true"></span><b>${title}</b>${text ? `<p>${text}</p>` : ""}${actions ? `<div class="ds-row">${actions}</div>` : ""}</div>`,
    badge: (s, label) => `<span class="tag tag-${esc(String(s).toLowerCase())}">${esc(label ?? String(s).replace(/_/g, " "))}</span>`,
    status: (code) => `<span class="code code-${code >= 500 ? "5" : code >= 400 ? "4" : "2"}">${code}</span>`,
    lock: (plan) => `<span class="lock-tag" title="Available on ${plan}">${plan}</span>`,
    stat: (label, value, sub = "", extra = "") => `<div class="ds-card stat"><span class="stat-label">${label}</span><b class="stat-value">${value}</b>${sub ? `<span class="stat-sub">${sub}</span>` : ""}${extra}</div>`,
    bar: (used, limit, cls = "") => {
      const p = limit ? Math.min(100, (used / limit) * 100) : 0;
      return `<div class="meter ${cls}${p >= 90 ? " meter-hot" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${used}" aria-label="${num(used)} of ${num(limit)}"><i style="width:${p.toFixed(2)}%"></i></div>`;
    },
    seg: (name, items, current) => `<div class="seg" role="group" aria-label="${name}">${items.map(([v, label, locked]) => `<button type="button" class="${v === current ? "on" : ""}" data-act="${name}" data-v="${v}" aria-pressed="${v === current}"${locked ? ` data-locked="${locked}"` : ""}>${label}${locked ? ` <span class="lock-tag">${locked}</span>` : ""}</button>`).join("")}</div>`,
    copyBtn: (text, label = "Copy") => `<button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(text)}" aria-label="${label}">${label}</button>`,
    code: (text, lang = "") => `<div class="codebox"><div class="codebox-bar"><span>${esc(lang)}</span><button type="button" class="btn-link" data-copy="${esc(text)}">Copy</button></div><pre><code>${esc(text)}</code></pre></div>`,
    table: (head, rows, cls = "") => `<div class="tbl-wrap"><table class="tbl ${cls}"><thead><tr>${head.map((x) => `<th scope="col">${x}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
  };

  /** Requests (area) and errors (line) over time, drawn as an SVG on one honest scale. */
  function lineChart(series, { gran = "day", height = 220, maxW = 640 } = {}) {
    // Narrow screens get a narrower drawing so axis labels stay readable after scaling.
    const W = Math.round(Math.max(340, Math.min(maxW, (root.clientWidth || 640) - 40)));
    const H = W < 500 ? Math.round(height * 0.85) : height;
    const pad = { l: 36, r: 12, t: 12, b: 26 };
    const max = Math.max(3, ...series.map((p) => p.requests));
    const top = niceMax(max);
    const x = (i) => pad.l + (series.length < 2 ? (W - pad.l - pad.r) / 2 : (i / (series.length - 1)) * (W - pad.l - pad.r));
    const y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
    const label = (p) => (gran === "hour" ? new Date(p.t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : new Date(p.t + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
    const pts = series.map((p, i) => [x(i), y(p.requests)]);
    const area = pts.length ? `M${pts[0][0]},${y(0)} ${pts.map(([a, b]) => `L${a},${b}`).join(" ")} L${pts.at(-1)[0]},${y(0)} Z` : "";
    const line = pts.map(([a, b], i) => `${i ? "L" : "M"}${a},${b}`).join(" ");
    const eline = series.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.errors)}`).join(" ");
    const ticks = [0, top / 3, (2 * top) / 3, top].map((v) => Math.round(v));
    const every = Math.max(1, Math.ceil(series.length / (W < 500 ? 4 : 6)));
    const totalReq = series.reduce((n, p) => n + p.requests, 0);
    const totalErr = series.reduce((n, p) => n + p.errors, 0);
    return `<figure class="chart-fig"><svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="${plural(totalReq, "request")} and ${plural(totalErr, "error")} over the selected range">
      <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9ecf" stop-opacity=".18"/><stop offset="1" stop-color="#ff9ecf" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((v) => `<g class="grid"><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text></g>`).join("")}
      <path d="${area}" fill="url(#chart-fill)"/>
      <path d="${line}" class="ln-req"/>
      <path d="${eline}" class="ln-err"/>
      ${series.map((p, i) => (i % every === 0 || i === series.length - 1 ? `<text class="xl" x="${x(i)}" y="${H - 6}" text-anchor="middle">${label(p)}</text>` : "")).join("")}
      ${series.map((p, i) => `<rect class="hit" x="${x(i) - (W - pad.l - pad.r) / Math.max(1, series.length - 1) / 2}" y="${pad.t}" width="${(W - pad.l - pad.r) / Math.max(1, series.length - 1)}" height="${H - pad.t - pad.b}"><title>${label(p)}: ${plural(p.requests, "request")}, ${plural(p.errors, "error")}</title></rect>`).join("")}
    </svg><figcaption class="legend"><span class="lg lg-req">Requests</span><span class="lg lg-err">Errors</span></figcaption></figure>`;
  }
  const niceMax = (v) => {
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 1.5, 2, 3, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  };

  /** 7 x 24 grid of requests by weekday and hour, in the viewer's timezone. */
  function heatmap(matrix) {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const max = Math.max(0, ...matrix.flat());
    const lvl = (v) => (!v ? 0 : max <= 1 ? 4 : Math.min(4, 1 + Math.floor((v / max) * 3.999)));
    return `<div class="heat" role="img" aria-label="Requests by weekday and hour, busiest hour has ${num(max)}">
      ${matrix.map((row, d) => `<span class="heat-day">${d % 3 === 0 || d === 6 ? days[d] : ""}</span>${row.map((v, hr) => `<i class="l${lvl(v)}" title="${days[d]} ${String(hr).padStart(2, "0")}:00 · ${plural(v, "request")}"></i>`).join("")}`).join("")}
      <span></span>${Array.from({ length: 24 }, (_, hr) => `<span class="heat-hr">${hr % 6 === 0 || hr === 23 ? String(hr).padStart(2, "0") : ""}</span>`).join("")}
    </div><p class="heat-legend"><span>less</span><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>more</span></p>`;
  }

  function hbars(items, { total, label = (x) => esc(x.name), href = null, empty = "Nothing in this range yet." } = {}) {
    if (!items.length) return `<p class="muted-sm">${empty}</p>`;
    const max = Math.max(...items.map((x) => x.requests ?? x.count));
    return `<ul class="hbars">${items
      .map((x) => {
        const v = x.requests ?? x.count;
        const inner = `<span class="hb-name">${label(x)}</span><span class="hb-val">${num(v)}${total ? ` <small>${((v / total) * 100).toFixed(v / total >= 0.1 ? 0 : 1)}%</small>` : ""}</span><span class="hb-bar" style="width:${Math.max(2, (v / max) * 100).toFixed(1)}%"></span>`;
        return `<li>${href ? `<a href="${href(x)}">${inner}</a>` : inner}</li>`;
      })
      .join("")}</ul>`;
  }

  function spark(values, { w = 120, h = 32 } = {}) {
    const max = Math.max(1, ...values);
    const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
  }

  // ---- modal ------------------------------------------------------------------------------
  /**
   * Open the shared dialog. `onSubmit(form, dialog)` may return false to keep it open;
   * throwing shows the message inside the dialog instead of a toast.
   */
  function openModal({ title, body, submit = null, danger = false, cancel = "Cancel", wide = false, onOpen = null, onSubmit = null }) {
    return new Promise((resolve) => {
      modal.className = `ds-modal${wide ? " wide" : ""}`;
      modal.innerHTML = `<form method="dialog" class="modal-form" novalidate>
        <div class="modal-head"><h2 id="modal-title">${title}</h2><button type="button" class="ds-icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
        <div class="modal-body">${body}</div>
        <p class="modal-error" role="alert" hidden></p>
        <div class="modal-foot">${cancel ? `<button type="button" class="btn btn-ghost" data-close>${cancel}</button>` : ""}${submit ? `<button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}">${submit}</button>` : ""}</div>
      </form>`;
      const form = $("form", modal);
      const errBox = $(".modal-error", modal);
      let done = false;
      const close = (v) => {
        if (done) return;
        done = true;
        modal.close();
        resolve(v);
      };
      $$("[data-close]", modal).forEach((b) => b.addEventListener("click", () => close(null)));
      modal.addEventListener("cancel", () => close(null), { once: true });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!submit) return close(true);
        const btn = $("button[type=submit]", form);
        btn.disabled = true;
        errBox.hidden = true;
        try {
          const r = onSubmit ? await onSubmit(form, modal) : true;
          if (r !== false) close(r ?? true);
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        } finally {
          btn.disabled = false;
        }
      });
      modal.showModal();
      onOpen?.(modal);
      ($("[autofocus]", modal) ?? $("input:not([type=hidden]),select,textarea,button[type=submit]", modal))?.focus();
    });
  }
  const confirmModal = ({ title, text, confirm = "Confirm", danger = true, typeToConfirm = null }) =>
    openModal({
      title,
      body: `<p class="modal-text">${text}</p>${typeToConfirm ? `<label class="field">Type <b>${typeToConfirm}</b> to confirm<input name="confirm" autocomplete="off" required autofocus></label>` : ""}`,
      submit: confirm,
      danger,
      onSubmit: (form) => {
        if (typeToConfirm && form.confirm.value.trim() !== typeToConfirm) throw new Error(`Type ${typeToConfirm} exactly to continue.`);
        return true;
      },
    });

  // ---- clipboard ----------------------------------------------------------------------------
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      toast("Copied");
    } catch {
      toast("Your browser blocked copying. Select the text and copy it by hand.");
    }
  });

  // ---- action routing: every [data-act] inside the page goes to the current section --------
  let handlers = {};
  const onAct = async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || !handlers[el.dataset.act]) return;
    if (el.tagName === "A" && !el.dataset.act) return;
    e.preventDefault();
    if (el.dataset.locked) return upgradePrompt(el.dataset.locked);
    try {
      await handlers[el.dataset.act](el, e);
    } catch (err) {
      toast(err.message);
    }
  };
  for (const el of [root, actionsBar]) el?.addEventListener("click", onAct);
  for (const el of [root, actionsBar]) {
    el?.addEventListener("change", (e) => {
      const t = e.target.closest("[data-change]");
      if (t && handlers[t.dataset.change]) handlers[t.dataset.change](t, e);
    });
    el?.addEventListener("input", (e) => {
      const t = e.target.closest("[data-input]");
      if (t && handlers[t.dataset.input]) handlers[t.dataset.input](t, e);
    });
  }

  function upgradePrompt(plan) {
    return openModal({
      title: `Available on ${plan}`,
      body: `<p class="modal-text">This needs the ${plan} plan or higher. Upgrading takes a minute: pick a plan in Billing, transfer the amount and it's active once the payment is confirmed.</p>`,
      submit: `See ${plan} in Billing`,
      onSubmit: () => {
        location.href = `/dashboard/billing?plan=${plan.toLowerCase()}#plans`;
      },
    });
  }

  // ---- header controls shared by several sections ------------------------------------------
  function rangeControl(onChange) {
    return {
      get html() {
        return h.seg("range", RANGES.map(([v, label, days]) => [v, label, rangeAllowed(v) ? "" : lockLabel(days)]), state.range);
      },
      handler: (el) => {
        state.range = el.dataset.v;
        syncUrl();
        onChange();
      },
    };
  }
  function keyControl(keys, onChange) {
    return {
      html: `<label class="select-wrap"><span class="visually-hidden">API key</span><select data-change="keyFilter" aria-label="Filter by API key"><option value="all">All API keys</option>${keys.map((k) => `<option value="${esc(k.id)}"${k.id === state.key ? " selected" : ""}>${esc(k.name)} (${esc(k.preview)})${k.status !== "active" ? " · revoked" : ""}</option>`).join("")}</select></label>`,
      handler: (el) => {
        state.key = el.value;
        syncUrl();
        onChange();
      },
    };
  }

  // ---- shell: popovers (notifications, account menu), mobile sheet ----------------------------
  const pops = [];
  const closeAll = (except) => {
    for (const p of pops) if (p !== except) p.close();
  };
  function popover(btn, panel, onOpen) {
    if (!btn || !panel) return null;
    const p = {
      open() {
        closeAll(p);
        panel.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        onOpen?.(panel);
      },
      close() {
        if (panel.hidden) return;
        panel.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      },
      get isOpen() {
        return !panel.hidden;
      },
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      p.isOpen ? p.close() : p.open();
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
    pops.push(p);
    return p;
  }
  document.addEventListener("click", () => closeAll());
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = pops.find((p) => p.isOpen);
    if (open) {
      open.close();
      open === sheet ? $("[data-sheet-btn]")?.focus() : null;
    }
  });

  popover($("[data-menu-btn]"), $("[data-menu]"), (panel) => $("a,button", panel)?.focus());

  // Mobile: the sidebar slides in over the page. On desktop it is always visible and this does nothing.
  const side = $("[data-sheet]");
  const sideBtn = $("[data-sheet-btn]");
  const scrim = $("[data-sheet-close]");
  const sheet = {
    get isOpen() {
      return !!side?.classList.contains("open");
    },
    open() {
      closeAll(sheet);
      side.classList.add("open");
      scrim.hidden = false;
      sideBtn.setAttribute("aria-expanded", "true");
      $(".ap-link.on", side)?.focus();
    },
    close() {
      if (!this.isOpen) return;
      side.classList.remove("open");
      scrim.hidden = true;
      sideBtn.setAttribute("aria-expanded", "false");
    },
  };
  if (side && sideBtn) {
    pops.push(sheet);
    sideBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      sheet.isOpen ? sheet.close() : sheet.open();
    });
    scrim.addEventListener("click", () => sheet.close());
    side.addEventListener("click", (e) => e.stopPropagation());
  }

  popover($("[data-bell]"), $("[data-bell-pop]"), async (panel) => {
    panel.innerHTML = `<div class="ap-pop-head">Notifications</div><p class="ap-pop-empty">Loading…</p>`;
    try {
      const { content: n } = await api("/api/me/notifications");
      panel.innerHTML = `<div class="ap-pop-head">Notifications</div>${
        n.items.length
          ? `<ul class="ap-notes">${n.items.map((x) => `<li class="${x.read || n.unread === 0 ? "" : "unread"}"><b>${esc(x.title)}</b>${x.text ? `<p>${esc(x.text)}</p>` : ""}<time datetime="${esc(x.at)}">${ago(x.at)}</time></li>`).join("")}</ul>`
          : `<p class="ap-pop-empty">Nothing yet. Quota alerts, payments and referral updates show up here.</p>`
      }`;
      if (n.unread) {
        await api("/api/me/notifications/read", { method: "POST" });
        $(".ds-dot")?.remove();
        $("[data-bell]")?.setAttribute("aria-label", "Notifications");
      }
    } catch (err) {
      panel.innerHTML = `<div class="ap-pop-head">Notifications</div><p class="ap-pop-empty">${esc(err.message)}</p>`;
    }
  });

  const palette = $("[data-palette]");
  if (palette) {
    const input = $("[data-pal-q]", palette);
    const list = $("[data-pal-list]", palette);
    let items = [];
    let sel = 0;
    let timer;
    const pages = (D.sections ?? []).map((s) => ({ label: s.label, hint: s.base === "/admin" ? "Admin" : "Dashboard", href: `${s.base ?? "/dashboard"}${s.slug ? "/" + s.slug : ""}` })).concat([{ label: "Docs", hint: "Guides", href: "/docs" }, { label: "MCP setup", hint: "Guides", href: "/mcp" }, { label: "Browse APIs", hint: "Catalog", href: "/scrapers" }]);
    const draw = () => {
      list.innerHTML = items.length ? items.map((it, i) => `<li role="option" aria-selected="${i === sel}"><a href="${esc(it.href)}" class="${i === sel ? "on" : ""}"><span>${esc(it.label)}</span><small>${esc(it.hint)}</small></a></li>`).join("") : `<li class="pal-empty">No matches</li>`;
    };
    const search = async () => {
      const q = input.value.trim().toLowerCase();
      items = pages.filter((p) => !q || p.label.toLowerCase().includes(q));
      sel = 0;
      draw();
      if (q.length < 2) return;
      try {
        const r = await api(`/api/scrapers/list?q=${encodeURIComponent(q)}&limit=6`);
        items = items.concat(r.content.items.map((s) => ({ label: s.displayName, hint: `${s.key} · ${s.status}`, href: `/api/${s.category}/${s.slug}` })));
        draw();
      } catch {}
    };
    const open = () => {
      palette.showModal();
      input.value = "";
      search();
      input.focus();
    };
    $$("[data-palette-open]").forEach((b) => b.addEventListener("click", open));
    addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        palette.open ? palette.close() : open();
      }
    });
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(search, 150);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length);
        draw();
      }
      if (e.key === "Enter" && items[sel]) location.href = items[sel].href;
    });
    palette.addEventListener("click", (e) => {
      if (e.target === palette) palette.close();
    });
  }

  // ---- router --------------------------------------------------------------------------------
  const ctx = { D, root, actionsBar, state, h, num, compact, idr, pct, ms, ago, dt, day, time, cap, plural, tz, lineChart, heatmap, hbars, spark, openModal, confirmModal, upgradePrompt, rangeControl, keyControl, rangeAllowed, api, esc, toast, $, $$, store };
  const setHandlers = (map) => {
    handlers = map;
  };
  const setActions = (html) => {
    if (actionsBar) actionsBar.innerHTML = html;
  };
  window.apz = { ctx, sections: {}, admin: {}, setHandlers, setActions };

  document.addEventListener("DOMContentLoaded", () => {
    const isAdmin = root.hasAttribute("data-admin");
    const name = isAdmin ? root.dataset.admin : root.dataset.dash;
    const table = isAdmin ? window.apz.admin : window.apz.sections;
    const fn = table[name] ?? table[isAdmin ? "overview" : "dashboard"];
    const run = async () => {
      try {
        await fn(ctx);
      } catch (err) {
        if (err.status === 401) return (location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        root.innerHTML = h.error(err, "retry-page");
        handlers = { "retry-page": run };
      }
    };
    run();
  });
})();
