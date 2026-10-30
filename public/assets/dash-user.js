/* Apizie dashboard sections for signed-in users. Each section renders into ctx.root and wires
   its buttons through apz.setHandlers (every clickable element carries data-act). */
(() => {
  const apz = window.apz;
  if (!apz) return;
  const { setHandlers, setActions } = apz;
  const S = apz.sections;

  const firstName = (n) => String(n ?? "").split(/\s+/)[0] || "there";
  const keyLabel = (l) => (l.keyName ? `${l.keyName}` : l.key ?? "–");
  const sampleUrl = (c) => `${c.D.apiUrl}/v1/official:company/profile?company=AAPL`;

  // ===== Dashboard ============================================================================
  S.dashboard = async (c) => {
    const { h, esc, num, api, D } = c;
    let keys = [];
    const load = async () => {
      c.root.innerHTML = `<div class="grid-dash">${h.skeleton(4)}</div>`;
      try {
        const { content: o } = await api(`/api/me/overview?range=${c.state.range}&key=${c.state.key}&tz=${c.tz}`);
        keys = o.keys;
        header();
        render(o);
      } catch (err) {
        if (err.status === 403 && err.data?.required_plan) {
          c.state.range = "7d";
          return load();
        }
        c.root.innerHTML = h.error(err);
      }
    };
    const range = c.rangeControl(load);
    const keySel = () => c.keyControl(keys, load);
    const header = () => setActions(`${range.html}${keySel().html}<a class="btn btn-ghost" href="/docs">Docs</a><button class="btn btn-primary" data-act="newKey">New key</button>`);

    let breakdown = "endpoints";
    let last = null;
    const eyeIcon = `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const copyIcon = `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`;
    const breakdownHtml = (s) => {
      if (breakdown === "categories") return c.hbars(s.categories.slice(0, 8), { total: s.total, href: (x) => `/category/${encodeURIComponent(x.name)}`, empty: "No requests in this range." });
      if (breakdown === "errors") return c.hbars(s.statuses.map((x) => ({ name: String(x.status), count: x.count })), { total: s.errors, href: (x) => `/dashboard/logs?status=error&q=${x.name}&range=${c.state.range}`, empty: "No errors in this range." });
      return c.hbars(s.endpoints.slice(0, 8), { total: s.total, href: (x) => `/api/${x.name.split("/")[0].replace(":", "/")}?endpoint=${encodeURIComponent(x.name.split("/")[1] ?? "")}`, empty: `No endpoint calls in this range. <a href="/scrapers">Browse APIs</a>` });
    };
    const render = (o) => {
      last = o;
      const rangeWord = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days" }[c.state.range];
      const s = o.summary;
      const q = o.quota;
      const sub = c.$("[data-sub]");
      if (sub) sub.innerHTML = `<span>Welcome back, ${esc(firstName(D.user.name))}</span><span aria-hidden="true">·</span><span class="sys">${o.system.state === "operational" ? '<span class="pulse ok" aria-hidden="true"></span>All systems operational' : '<span class="pulse warn" aria-hidden="true"></span>Some sources are returning errors'}</span>`;
      const resets = new Date(q.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
      const usedPct = q.month.limit ? Math.round((q.month.used / q.month.limit) * 100) : 0;
      const k = o.key;
      c.root.innerHTML = `
      <section class="ds-card kpis" aria-label="Key numbers, ${rangeWord}">
        <div class="kpi kpi-lead"><span class="stat-label">Requests · ${rangeWord}${c.state.key !== "all" ? " · one key" : ""}</span><b class="hero-num">${c.compact(s.total)}</b></div>
        <div class="kpi"><span class="stat-label">Today</span><b class="stat-value">${num(o.today)}</b><span class="stat-sub">since midnight, your time</span></div>
        <div class="kpi"><span class="stat-label">Success rate</span><b class="stat-value">${c.pct(s.successRate)}</b><span class="stat-sub">${s.total ? `${num(s.success)} of ${num(s.total)}` : "no requests yet"}</span></div>
        <div class="kpi"><span class="stat-label">Latency p95</span><b class="stat-value">${s.p95Ms === null ? "–" : `≤ ${c.ms(s.p95Ms)}`}</b><span class="stat-sub">${s.avgMs !== null ? `average ${c.ms(s.avgMs)}` : "no requests yet"}</span></div>
        <div class="kpi"><span class="stat-label">Errors · 24h</span><b class="stat-value">${num(o.errors24h)}</b><span class="stat-sub">${o.errors24h ? `<a href="/dashboard/logs?status=error&range=24h">See them in logs</a>` : "4xx and 5xx responses"}</span></div>
      </section>
      <div class="ov-row">
        <section class="ds-card" aria-labelledby="ot-h"><div class="card-top"><h2 id="ot-h">Requests over time</h2><span class="meta push">${s.granularity === "hour" ? "Hourly" : "Daily"}</span></div>${s.total ? c.lineChart(s.series, { gran: s.granularity }) : h.empty("No requests in this range", "Make your first call and this chart fills in within seconds.", `<a class="btn btn-primary btn-sm" href="/scrapers">Try an API</a>`)}</section>
        <div class="stack">
          <section class="ds-card key-card" aria-labelledby="key-h">
            <div class="card-top"><h2 id="key-h">API key</h2>${k ? `<span class="meta">${esc(k.name)}</span>` : ""}<a class="link-sm" href="/dashboard/keys">${o.activeKeys} active</a></div>
            ${
              k
                ? `<div class="secret-row"><code data-secret data-id="${esc(k.id)}">${esc(k.preview)}</code>${k.canReveal ? `<button class="ds-icon-btn" data-act="reveal" data-id="${esc(k.id)}" aria-label="Show key" aria-pressed="false">${eyeIcon}</button><button class="ds-icon-btn" data-act="copyKey" data-id="${esc(k.id)}" aria-label="Copy key">${copyIcon}</button>` : ""}</div>
                   <p class="meta">Created ${c.day(k.createdAt)} · ${k.lastUsedAt ? `used ${c.ago(k.lastUsedAt)}` : "never used"}</p>`
                : h.empty("No active key", "Create one to start calling APIs.", `<button class="btn btn-primary btn-sm" data-act="newKey">Create key</button>`)
            }
          </section>
          <section class="ds-card" aria-labelledby="q-h">
            <div class="card-top"><h2 id="q-h">Monthly quota</h2><span class="meta push">${c.planName(q.plan.id)} plan</span></div>
            <div class="row-between"><b class="stat-value">${usedPct}%</b><span class="meta">${num(q.month.used)} / ${num(q.month.limit)}</span></div>
            ${h.bar(q.month.used, q.month.limit)}
            <p class="meta">Resets ${resets}${q.projectedPercent !== null ? ` · on pace for ${q.projectedPercent}%` : ""}${o.balance > 0 ? ` · balance ${c.usd(o.balance)}` : ""}</p>
            ${usedPct >= 80 ? `<a class="btn btn-ghost btn-sm" href="/dashboard/billing#plans">Raise your limit</a>` : ""}
            ${q.finance ? `<div class="quota-block"><div class="row-between"><span>Apizie Finance · ${esc(q.finance.plan.name.replace("Finance ", ""))}</span><span class="meta">${num(q.finance.month.used)} / ${num(q.finance.month.limit)}</span></div>${h.bar(q.finance.month.used, q.finance.month.limit)}</div>` : ""}
          </section>
        </div>
      </div>
      <div class="ov-row">
        <section class="ds-card" aria-labelledby="rr-h"><div class="card-top"><h2 id="rr-h">Recent requests</h2><a class="link-sm" href="/dashboard/logs">All logs</a></div>
          ${
            o.recent.length
              ? `<ul class="recent">${o.recent.map((l) => `<li><a href="/dashboard/logs?q=${encodeURIComponent(l.id ?? "")}&range=7d">${h.status(l.status)}<span class="rc-ep">${esc(l.project)}/${esc(l.endpoint)}</span><span class="rc-meta">${c.ms(l.ms)} · ${c.ago(l.at)}</span></a></li>`).join("")}</ul>`
              : `<p class="muted-sm">No requests yet. Try this with your key:</p>${h.code(`curl "${sampleUrl(c)}" \\\n  -H "x-api-key: ${k ? k.preview : "YOUR_KEY"}"`, "cURL")}`
          }
        </section>
        <section class="ds-card" aria-labelledby="bd-h"><div class="card-top"><h2 id="bd-h">Breakdown</h2><div class="push">${h.seg("breakdown", [["endpoints", "Endpoints"], ["categories", "Categories"], ["errors", "Errors"]], breakdown)}</div></div><div data-breakdown>${breakdownHtml(s)}</div></section>
      </div>
      <section class="ds-card" aria-labelledby="hm-h"><div class="card-top"><h2 id="hm-h">When you call</h2><span class="meta push">Requests by weekday and hour, your timezone</span></div>${c.heatmap(s.heatmap)}</section>`;
    };

    setHandlers({
      range: range.handler,
      keyFilter: (el) => keySel().handler(el),
      newKey: () => newKeyFlow(c, load),
      reveal: (el) => revealKey(c, el),
      copyKey: (el) => copyKey(c, el),
      breakdown: (el) => {
        breakdown = el.dataset.v;
        c.$$('[data-act="breakdown"]', c.root).forEach((b) => {
          b.classList.toggle("on", b === el);
          b.setAttribute("aria-pressed", String(b === el));
        });
        c.$("[data-breakdown]", c.root).innerHTML = breakdownHtml(last.summary);
      },
      retry: load,
    });
    await load();
  };

  // shared key helpers ----------------------------------------------------------------------
  async function revealKey(c, el) {
    const code = c.$(`[data-secret][data-id="${el.dataset.id}"]`, c.root);
    if (!code) return;
    if (code.dataset.full) {
      code.textContent = code.dataset.preview;
      delete code.dataset.full;
      el.setAttribute("aria-pressed", "false");
      el.setAttribute("aria-label", "Show key");
      return;
    }
    const { content } = await c.api(`/api/me/keys/${el.dataset.id}/reveal`, { method: "POST" });
    code.dataset.preview = code.textContent;
    code.dataset.full = "1";
    code.textContent = content.key;
    el.setAttribute("aria-pressed", "true");
    el.setAttribute("aria-label", "Hide key");
  }
  async function copyKey(c, el) {
    try {
      const { content } = await c.api(`/api/me/keys/${el.dataset.id}/reveal`, { method: "POST" });
      await navigator.clipboard.writeText(content.key);
      c.toast("Key copied");
    } catch (err) {
      c.toast(err.status === 409 ? "This older key can't be shown again. Create a new key to copy it." : err.status ? err.message : "Your browser blocked copying. Show the key and copy it by hand.");
    }
  }
  // ---- key permissions (shared by keys and connected apps) -----------------------------------
  const PERM_CATS = [["official", "Official data"], ["finance", "Finance"], ["open-data", "Open data"], ["news", "News"], ["research", "Research"], ["ai", "AI"], ["dev-tools", "Dev tools"], ["cloud", "Cloud"]];
  const permFields = (c, cur = {}) => {
    const rw = cur.access === "read_write";
    const cats = cur.categories ?? [];
    return `<fieldset class="field perm-set"><legend>Access</legend>
        <label class="perm-opt"><input type="radio" name="access" value="read" ${rw ? "" : "checked"}> <span><b>Read-only</b> (recommended)<br><small class="meta">Fetch data. Endpoints that create, change or delete things at a provider are refused.</small></span></label>
        <label class="perm-opt"><input type="radio" name="access" value="read_write" ${rw ? "checked" : ""}> <span><b>Read and write</b><br><small class="meta">Also allow bring-your-own-key endpoints that change data in your own accounts.</small></span></label></fieldset>
      <fieldset class="field perm-set"><legend>Allowed categories <small class="meta">(none ticked = all)</small></legend><div class="checks">${PERM_CATS.map(([v, l]) => `<label><input type="checkbox" name="cat" value="${v}" ${cats.includes(v) ? "checked" : ""}> ${c.esc(l)}</label>`).join("")}</div></fieldset>`;
  };
  const readPerms = (form) => ({ access: form.querySelector("input[name=access]:checked")?.value ?? "read", categories: [...form.querySelectorAll("input[name=cat]:checked")].map((x) => x.value) });
  const permLabel = (x) => `${x.access === "read_write" ? '<span class="chip warn-chip">Read and write</span>' : '<span class="chip ok-chip">Read-only</span>'}${x.categories?.length ? x.categories.map((cat) => `<span class="chip">${cat}</span>`).join("") : '<span class="chip">All categories</span>'}`;

  async function newKeyFlow(c, after) {
    const created = await c.openModal({
      title: "Create an API key",
      body: `<label class="field">Name<input name="name" maxlength="60" placeholder="e.g. production, staging, research-agent" autofocus></label>${permFields(c)}<p class="hint">Use one key per environment or agent, so you can revoke one without touching the others.</p>`,
      submit: "Create key",
      onSubmit: async (form) => (await c.api("/api/me/keys", { method: "POST", body: { name: form.name.value, ...readPerms(form) } })).content,
    });
    if (!created) return;
    await c.openModal({
      title: "Your new key",
      cancel: "Done",
      body: `<p class="modal-text">Copy it now and keep it on your server. ${created.record.canReveal ? "You can reveal it again later from API keys." : "For safety it won't be shown again."}</p><div class="secret-row big"><code>${c.esc(created.key)}</code>${c.h.copyBtn(created.key)}</div>${c.h.code(`curl "${sampleUrl(c)}" \\\n  -H "x-api-key: ${created.key}"`, "Try it")}`,
    });
    await after();
  }

  // ===== Usage ================================================================================
  S.usage = async (c) => {
    const { h, esc, num, api } = c;
    let keys = [];
    const load = async () => {
      c.root.innerHTML = h.skeleton(3);
      try {
        const [{ content: u }, { content: k }] = await Promise.all([api(`/api/me/usage?range=${c.state.range}&key=${c.state.key}&tz=${c.tz}`), api("/api/me/keys")]);
        keys = k.items;
        setActions(`${range.html}${c.keyControl(keys, load).html}`);
        render(u);
      } catch (err) {
        c.root.innerHTML = h.error(err);
      }
    };
    const range = c.rangeControl(load);
    const render = (u) => {
      const s = u.summary;
      const q = u.quota;
      c.root.innerHTML = `
      <div class="ds-card strip">
        <div><span class="stat-label">Total requests</span><b class="stat-value">${num(s.total)}</b><span class="stat-sub">selected range</span></div>
        <div><span class="stat-label">Requests · 24h</span><b class="stat-value">${num(u.last24h.total)}</b></div>
        <div><span class="stat-label">Success rate · 24h</span><b class="stat-value">${c.pct(u.last24h.successRate)}</b></div>
        <div><span class="stat-label">Errors · 24h</span><b class="stat-value">${num(u.last24h.errors)}</b></div>
      </div>
      <section class="ds-card" aria-labelledby="ch-h"><div class="card-top"><h2 id="ch-h">Requests and errors</h2><span class="meta">${s.granularity === "hour" ? "Hourly" : "Daily"}${c.state.key !== "all" ? " · one key" : ""}</span></div>
        ${s.total ? c.lineChart(s.series, { gran: s.granularity }) : h.empty(`No requests in this range`, "Your charts fill in after your key makes its first call. Pick any API and press Send request, it takes a few seconds.", `<a class="btn btn-primary btn-sm" href="/scrapers">Try an API</a><a class="btn btn-ghost btn-sm" href="/dashboard/keys">View API keys</a>`)}
      </section>
      <div class="grid-main">
        <section class="ds-card" aria-labelledby="uk-h"><div class="card-top"><h2 id="uk-h">Usage by API key</h2></div>
          <p class="meta">Monthly quota · ${num(q.month.limit)} requests (${c.planName(q.plan.id)})</p>
          ${h.bar(q.month.used, q.month.limit)}
          <div class="row-between meta"><b>${num(q.month.used)} used</b><span>${num(q.month.remaining)} left · resets ${new Date(q.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span></div>
          ${
            u.perKey.some((x) => x.requests) || u.otherRequests
              ? h.table(["Key", "Requests", "Errors", "Share"], [
                  ...u.perKey.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="meta"><code>${esc(x.preview)}</code>${x.status !== "active" ? " · revoked" : ""}</div></td><td>${num(x.requests)}</td><td>${num(x.errors)}</td><td class="share">${s.total || x.requests ? h.bar(x.requests, Math.max(1, u.perKey.reduce((n, y) => n + y.requests, 0) + u.otherRequests), "thin") : ""}</td></tr>`),
                  ...(u.otherRequests ? [`<tr><td><b>Dashboard and MCP sign-in</b><div class="meta">calls without an API key</div></td><td>${num(u.otherRequests)}</td><td>–</td><td></td></tr>`] : []),
                ])
              : h.empty("No key traffic yet", "None of your keys made requests in this range.")
          }
        </section>
        <section class="ds-card" aria-labelledby="ue-h"><div class="card-top"><h2 id="ue-h">Where requests came from</h2></div>${c.hbars(s.sources.map((x) => ({ ...x, name: { rest: "REST API", mcp: "MCP", bulk: "Bulk jobs", playground: "Dashboard playground" }[x.name] ?? x.name })), { total: s.total, empty: "No requests in this range." })}
          <h3 class="sub-h">Top endpoints</h3>${c.hbars(s.endpoints.slice(0, 8), { total: s.total, empty: "No requests in this range." })}</section>
      </div>`;
    };
    setHandlers({ range: range.handler, keyFilter: (el) => c.keyControl(keys, load).handler(el), retry: load });
    await load();
  };

  // ===== Logs =================================================================================
  S.logs = async (c) => {
    const { h, esc, num, api, $ } = c;
    const p = new URLSearchParams(location.search);
    const f = { q: p.get("q") ?? "", status: p.get("status") ?? "all", range: p.get("range") && c.rangeAllowed(p.get("range")) ? p.get("range") : "24h", key: c.state.key, page: 1 };
    let data = null;
    let keys = [];
    let selected = null;
    const query = () => `range=${f.range}&status=${f.status}&q=${encodeURIComponent(f.q)}&key=${f.key}&page=${f.page}&size=25`;
    const exportHref = () => `/api/me/logs/export?${query()}`;
    setActions(`<a class="btn btn-ghost" data-export href="${exportHref()}" download>Export CSV</a>`);
    c.root.innerHTML = `
      <div class="ds-card filterbar">
        <label class="search-box"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="visually-hidden">Filter logs</span><input data-input="q" data-q value="${esc(f.q)}" placeholder="Filter: 401, instagram, a request ID…"><kbd>/</kbd></label>
        <div data-seg-status></div><div data-seg-range></div>
        <label class="select-wrap"><span class="visually-hidden">API key</span><select data-change="key" data-keysel aria-label="Filter by API key"><option value="all">All API keys</option></select></label>
        <span class="meta" data-counts aria-live="polite"></span>
      </div>
      <div class="split">
        <section class="ds-card list-card" aria-label="Requests"><div data-list>${h.skeleton(6)}</div></section>
        <aside class="ds-card detail-card" aria-label="Request details" data-detail>${h.empty("Request details show up here", "Pick a request on the left.")}</aside>
      </div>`;
    const segs = () => {
      $("[data-seg-status]", c.root).innerHTML = h.seg("status", [["all", "All"], ["success", "Success"], ["error", "Errors"], ["write", "Writes"], ["blocked", "Blocked"]], f.status);
      $("[data-seg-range]", c.root).innerHTML = h.seg("logRange", [["24h", "24h"], ["7d", "7d"], ["30d", "30d", c.rangeAllowed("30d") ? "" : "Starter"], ["90d", "90d", c.rangeAllowed("90d") ? "" : "Growth"]], f.range);
      c.$("[data-export]")?.setAttribute("href", exportHref());
    };
    const sync = () => {
      const u = new URL(location.href);
      for (const k of ["q", "status", "range"]) f[k] && f[k] !== "all" ? u.searchParams.set(k, f[k]) : u.searchParams.delete(k);
      history.replaceState(null, "", u);
    };
    const row = (l, i) => `<tr class="${selected === i ? "on" : ""}"><td><button type="button" class="row-btn" data-act="pick" data-i="${i}" aria-label="Details for ${esc(l.project)}/${esc(l.endpoint)} at ${c.time(l.at)}">${c.dt(l.at, { second: "2-digit" })}</button></td><td>${h.status(l.status)}</td><td class="ep"><span class="m">${esc(l.method ?? "GET")}</span> ${esc(l.project)}/${esc(l.endpoint)}${l.access === "write" ? ' <span class="chip warn-chip">write</span>' : ""}${l.code === "key_read_only" || l.code === "key_scope" ? ' <span class="chip">blocked</span>' : ""}</td><td>${c.ms(l.ms)}</td><td class="hide-sm">${esc(keyLabel(l))}</td><td class="hide-sm">${esc(l.source ?? "rest")}</td></tr>`;
    const detail = (l) => {
      const curl = l.source === "mcp" ? null : `curl "${c.D.apiUrl}/v1/${l.project}/${l.endpoint}" \\\n  -H "x-api-key: $APIZIE_KEY"`;
      return `<div class="card-top"><h2>${h.status(l.status)} ${esc(l.project)}/${esc(l.endpoint)}</h2></div>
        <dl class="kv">
          <dt>Request ID</dt><dd><code>${esc(l.id ?? "–")}</code> ${l.id ? h.copyBtn(l.id) : ""}</dd>
          <dt>Time</dt><dd>${new Date(l.at).toLocaleString("en-GB")}</dd>
          <dt>Method</dt><dd>${esc(l.method ?? "GET")}</dd>
          <dt>Latency</dt><dd>${c.ms(l.ms)}${l.cache ? ` · cache ${esc(l.cache)}` : ""}</dd>
          <dt>Key</dt><dd>${esc(keyLabel(l))}${l.key && l.keyName ? ` <code>${esc(l.key)}</code>` : ""}</dd>
          <dt>Source</dt><dd>${esc(l.source ?? "rest")}</dd>
          <dt>Access</dt><dd>${l.access === "write" ? "Write (changes data at the provider)" : l.access === "read" ? "Read" : "–"}${l.code === "key_read_only" ? " · refused: key is read-only" : l.code === "key_scope" ? " · refused: outside the key's categories" : ""}</dd>
          <dt>IP</dt><dd>${esc(l.ip ?? "–")}</dd>
          <dt>Billed</dt><dd>${l.billed ? "Yes" : "No"}${l.status >= 500 ? " (5xx is refunded)" : ""}</dd>
          ${l.error ? `<dt>Error</dt><dd class="err-text">${esc(l.error)}${l.code ? ` <code>${esc(l.code)}</code>` : ""}</dd>` : ""}
        </dl>
        ${curl ? h.code(curl, "Replay") : ""}
        <div class="ds-row"><a class="btn btn-ghost btn-sm" href="/api/${esc(l.project.replace(":", "/"))}?endpoint=${encodeURIComponent(l.endpoint)}">Open endpoint docs</a>${l.status >= 400 ? `<a class="btn btn-ghost btn-sm" href="/dashboard/support?req=${encodeURIComponent(l.id ?? "")}">Ask support</a>` : ""}</div>`;
    };
    const draw = () => {
      const listEl = $("[data-list]", c.root);
      $("[data-counts]", c.root).textContent = `${num(data.counts.requests)} req · ${num(data.counts.errors)} err · since ${c.dt(data.since)}`;
      if (!data.items.length) {
        listEl.innerHTML = data.counts.requests || f.q || f.status !== "all"
          ? h.empty("Nothing matches these filters", "Clear the search or widen the range.", `<button class="btn btn-ghost btn-sm" data-act="clear">Clear filters</button>`)
          : h.empty("No requests yet", "Send your first call and it shows up here within a second.", "") + h.code(`curl "${sampleUrl(c)}" \\\n  -H "x-api-key: $APIZIE_KEY"`, "cURL");
      } else {
        const from = (data.page - 1) * data.size + 1;
        const to = from + data.items.length - 1;
        listEl.innerHTML = `${h.table(["Time", "Status", "Endpoint", "Latency", "<span class=hide-sm>Key</span>", "<span class=hide-sm>Source</span>"], data.items.map(row), "logs")}
          <div class="pager"><span class="meta">Showing ${num(from)}–${num(to)} of ${num(data.total)}</span><div class="ds-row"><button class="btn btn-ghost btn-sm" data-act="prev" ${data.page <= 1 ? "disabled" : ""}>← Prev</button><button class="btn btn-ghost btn-sm" data-act="next" ${to >= data.total ? "disabled" : ""}>Next →</button></div></div>`;
      }
      const note = data.retentionDays < 90 ? `<p class="retention"><span>Logs older than ${data.retentionDays} days are hidden on your plan.</span> <a href="/dashboard/billing?plan=ultra#plans">Ultra keeps 90 days</a></p>` : "";
      listEl.insertAdjacentHTML("beforeend", note);
    };
    const load = async () => {
      segs();
      sync();
      $("[data-list]", c.root).innerHTML = h.skeleton(6);
      try {
        data = (await api(`/api/me/logs?${query()}`)).content;
        selected = null;
        draw();
      } catch (err) {
        $("[data-list]", c.root).innerHTML = h.error(err);
      }
    };
    try {
      keys = (await api("/api/me/keys")).content.items;
      $("[data-keysel]", c.root).insertAdjacentHTML("beforeend", keys.map((k) => `<option value="${esc(k.id)}"${k.id === f.key ? " selected" : ""}>${esc(k.name)}</option>`).join(""));
    } catch {}
    let t;
    setHandlers({
      q: (el) => {
        clearTimeout(t);
        t = setTimeout(() => {
          f.q = el.value.trim();
          f.page = 1;
          load();
        }, 250);
      },
      status: (el) => ((f.status = el.dataset.v), (f.page = 1), load()),
      logRange: (el) => ((f.range = el.dataset.v), (f.page = 1), load()),
      key: (el) => ((f.key = el.value), (f.page = 1), load()),
      prev: () => ((f.page = Math.max(1, f.page - 1)), load()),
      next: () => ((f.page += 1), load()),
      clear: () => {
        f.q = "";
        f.status = "all";
        f.page = 1;
        $("[data-q]", c.root).value = "";
        load();
      },
      pick: (el) => {
        selected = Number(el.dataset.i);
        const l = data.items[selected];
        c.$$("tr.on", c.root).forEach((r) => r.classList.remove("on"));
        el.closest("tr").classList.add("on");
        if (matchMedia("(max-width: 1100px)").matches) c.openModal({ title: "Request details", body: detail(l), cancel: "Close", wide: true });
        else $("[data-detail]", c.root).innerHTML = detail(l);
      },
      retry: load,
    });
    addEventListener("keydown", (e) => {
      if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        e.preventDefault();
        $("[data-q]", c.root)?.focus();
      }
    });
    await load();
  };

  // ===== API keys =============================================================================
  S.keys = async (c) => {
    const { h, esc, num, api, $ } = c;
    let data;
    let apps = [];
    const f = { q: "", tab: "all" };
    setActions(`<button class="btn btn-primary" data-act="newKey">New key</button>`);
    const langs = {
      cURL: (k) => `curl "${sampleUrl(c)}" \\\n  -H "x-api-key: ${k}"`,
      JavaScript: (k) => `const res = await fetch("${sampleUrl(c)}", {\n  headers: { "x-api-key": "${k}" },\n});\nconst { data, source } = await res.json(); // source: publisher, url, retrievedAt`,
      Python: (k) => `import requests\n\nr = requests.get(\n    "${c.D.apiUrl}/v1/official:company/profile",\n    params={"company": "AAPL"},\n    headers={"x-api-key": "${k}"},\n)\nbody = r.json()\nprint(body["data"]["name"], body["source"]["attribution"])`,
      Go: (k) => `req, _ := http.NewRequest("GET", "${sampleUrl(c)}", nil)\nreq.Header.Set("x-api-key", "${k}")\nres, _ := http.DefaultClient.Do(req)`,
      PHP: (k) => `$ch = curl_init("${sampleUrl(c)}");\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ["x-api-key: ${k}"]);\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n$data = json_decode(curl_exec($ch), true)["data"];`,
      MCP: (k) => `claude mcp add --transport http apizie ${c.D.apiUrl}/mcp \\\n  --header "x-api-key: ${k}"`,
    };
    let lang = "cURL";
    const load = async () => {
      try {
        const [k, a] = await Promise.all([api("/api/me/keys"), api("/api/me/apps").catch(() => ({ content: [] }))]);
        data = k.content;
        apps = a.content;
        render();
      } catch (err) {
        c.root.innerHTML = h.error(err);
      }
    };
    const card = (k) => `<article class="ds-card keycard ${k.status !== "active" ? "revoked" : ""}" aria-labelledby="k-${esc(k.id)}">
      <div class="card-top"><h2 id="k-${esc(k.id)}">${esc(k.name)}</h2>${h.badge(k.status, k.status === "active" ? "Active" : "Revoked")}<span class="meta push">created ${c.day(k.createdAt)} · ${k.lastUsedAt ? `used ${c.ago(k.lastUsedAt)}` : "never used"}</span></div>
      <div class="keycard-row">
        <div class="secret-row"><code data-secret data-id="${esc(k.id)}">${esc(k.preview)}</code>${k.status === "active" && k.canReveal ? `<button class="ds-icon-btn" data-act="reveal" data-id="${esc(k.id)}" aria-label="Show key" aria-pressed="false"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button><button class="ds-icon-btn" data-act="copyKey" data-id="${esc(k.id)}" aria-label="Copy key"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg></button>` : ""}</div>
        <div class="kc-usage"><span class="stat-label">Requests · 30d</span><b>${num(k.requests30d)}</b></div>
        ${c.spark(k.spark)}
      </div>
      <div class="keycard-perm"><span class="stat-label">Permissions</span><div class="chips">${permLabel(k)}</div>
        ${k.status === "active" && k.access === "read_write" && (!k.lastWriteAt || Date.now() - Date.parse(k.lastWriteAt) > 30 * 864e5) ? `<p class="perm-tip">This key has not changed data at any provider in the last 30 days.${k.legacyAccess ? " It was created before read-only keys existed." : ""} <button class="btn btn-ghost btn-sm" data-act="makeReadOnly" data-id="${esc(k.id)}">Make it read-only</button></p>` : ""}
        ${k.lastWriteAt ? `<p class="meta">Last write ${c.ago(k.lastWriteAt)}</p>` : ""}</div>
      <div class="keycard-foot">
        <div><span class="stat-label">IP allowlist</span><p class="meta">${k.ipAllowlist.length ? k.ipAllowlist.map((x) => `<code>${esc(x)}</code>`).join(" ") : "Any IP (no restriction)"}</p></div>
        <div class="ds-row push">
          ${k.status === "active" ? `<button class="btn btn-ghost btn-sm" data-act="rename" data-id="${esc(k.id)}">Rename</button><button class="btn btn-ghost btn-sm" data-act="perms" data-id="${esc(k.id)}">Permissions</button><button class="btn btn-ghost btn-sm" data-act="allowlist" data-id="${esc(k.id)}"${data.allowlist ? "" : ' data-locked="Starter"'}>Edit allowlist${data.allowlist ? "" : ' <span class="lock-tag">Starter</span>'}</button><button class="btn btn-danger-ghost btn-sm" data-act="revoke" data-id="${esc(k.id)}">Revoke</button>` : `<span class="meta">Revoked ${c.day(k.revokedAt)}</span><button class="btn btn-danger-ghost btn-sm" data-act="del" data-id="${esc(k.id)}">Delete</button>`}
        </div>
      </div>
    </article>`;
    const render = () => {
      const items = data.items.filter((k) => (f.tab === "all" || (f.tab === "active" ? k.status === "active" : k.status !== "active")) && (!f.q || `${k.name} ${k.preview}`.toLowerCase().includes(f.q)));
      const revoked = data.items.length - data.active;
      const example = data.items.find((k) => k.status === "active")?.preview ?? "YOUR_KEY";
      c.root.innerHTML = `<div class="split keys-split">
        <div class="stack">
          <div class="ds-card filterbar">
            <label class="search-box"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="visually-hidden">Filter keys</span><input data-input="q" value="${esc(f.q)}" placeholder="Filter keys…"></label>
            ${h.seg("tab", [["all", "All"], ["active", "Active"], ["revoked", "Revoked"]], f.tab)}
            <span class="meta push">${data.active} active · ${revoked} revoked · max ${data.max} active on your plan</span>
          </div>
          ${items.length ? items.map(card).join("") : `<div class="ds-card">${data.items.length ? h.empty("No keys match", "Try another filter.") : h.empty("No API keys yet", "Create your first key to call any API in the catalog.", `<button class="btn btn-primary btn-sm" data-act="newKey">Create key</button>`)}</div>`}
          <section class="ds-card" aria-labelledby="apps-h"><div class="card-top"><h2 id="apps-h">Connected MCP apps</h2><a class="link-sm" href="/mcp">How to connect →</a></div>
            ${apps.length ? h.table(["App", "Returns to", "Permissions", ""], apps.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td class="meta">${esc(a.redirect ? a.redirect.replace(/^(https?:\/\/[^/]+).*$/, "$1") : "")}</td><td><div class="chips">${permLabel(a)}</div></td><td class="ds-row"><button class="btn btn-ghost btn-sm" data-act="appPerms" data-id="${esc(a.clientId)}">Permissions</button><button class="btn btn-danger-ghost btn-sm" data-act="disconnect" data-id="${esc(a.clientId)}">Disconnect</button></td></tr>`)) : `<p class="muted-sm">Apps you connect with OAuth (Claude, ChatGPT) appear here and don't need an API key. You choose read-only or read and write when you connect them.</p>`}
          </section>
        </div>
        <aside class="stack">
          <section class="ds-card" aria-labelledby="auth-h"><h2 id="auth-h">Authenticate</h2><p class="meta">Send your key in the <code>x-api-key</code> header. Every endpoint uses the same key and returns <code>{ project, data, source, timestamp }</code>, where <code>source</code> cites the official publisher and URL.</p>
            ${h.seg("lang", Object.keys(langs).map((l) => [l, l]), lang)}
            <div data-sample>${h.code(langs[lang](example), lang)}</div></section>
          <section class="ds-card" aria-labelledby="safe-h"><h2 id="safe-h">Key safety</h2><ul class="tips">
            <li><b>Read-only by default.</b> New keys can only fetch data. Allow writes only on keys that call your own bring-your-own-key accounts.</li>
            <li><b>One key per environment or agent.</b> Revoke a leaked key without downtime elsewhere, and limit each key to the categories it needs.</li>
            <li><b>Restrict by IP.</b> Allow only your server IPs or an IPv4 range for production keys (Starter and up).</li>
            <li><b>Never ship keys to browsers.</b> Call Apizie from your backend or a serverless function.</li>
            <li><b>Watch the logs.</b> A burst of 401s usually means a key leaked or was revoked.</li></ul></section>
        </aside></div>`;
    };
    const keyById = (id) => data.items.find((k) => k.id === id);
    setHandlers({
      newKey: () => newKeyFlow(c, load),
      reveal: (el) => revealKey(c, el),
      copyKey: (el) => copyKey(c, el),
      q: (el) => {
        f.q = el.value.toLowerCase();
        const pos = el.selectionStart;
        render();
        const i = $("[data-input=q]", c.root);
        i.focus();
        i.setSelectionRange(pos, pos);
      },
      tab: (el) => ((f.tab = el.dataset.v), render()),
      lang: (el) => {
        lang = el.dataset.v;
        c.$$("[data-act=lang]", c.root).forEach((b) => {
          b.classList.toggle("on", b === el);
          b.setAttribute("aria-pressed", String(b === el));
        });
        $("[data-sample]", c.root).innerHTML = h.code(langs[lang](data.items.find((k) => k.status === "active")?.preview ?? "YOUR_KEY"), lang);
      },
      rename: async (el) => {
        const k = keyById(el.dataset.id);
        const ok = await c.openModal({ title: "Rename key", body: `<label class="field">Name<input name="name" value="${esc(k.name)}" maxlength="60" required autofocus></label>`, submit: "Save", onSubmit: (form) => api(`/api/me/keys/${k.id}`, { method: "PATCH", body: { name: form.name.value } }) });
        if (ok) await load();
      },
      allowlist: async (el) => {
        const k = keyById(el.dataset.id);
        const ok = await c.openModal({
          title: "IP allowlist",
          body: `<label class="field">Allowed IPs<textarea name="ips" rows="4" placeholder="203.0.113.7&#10;198.51.100.0/24" autofocus>${esc(k.ipAllowlist.join("\n"))}</textarea></label><p class="hint">One per line: an IPv4 or IPv6 address, or an IPv4 range like 198.51.100.0/24. Leave empty to allow any IP. Requests from other IPs get 403.</p>`,
          submit: "Save allowlist",
          onSubmit: (form) => api(`/api/me/keys/${k.id}`, { method: "PATCH", body: { ipAllowlist: form.ips.value } }),
        });
        if (ok) {
          c.toast("Allowlist saved");
          await load();
        }
      },
      revoke: async (el) => {
        const k = keyById(el.dataset.id);
        if (!(await c.confirmModal({ title: `Revoke “${esc(k.name)}”?`, text: "Apps using this key start getting 401 right away. Revoked keys can't be restored.", confirm: "Revoke key" }))) return;
        await api(`/api/me/keys/${k.id}/revoke`, { method: "POST" });
        c.toast("Key revoked");
        await load();
      },
      del: async (el) => {
        const k = keyById(el.dataset.id);
        if (!(await c.confirmModal({ title: `Delete “${esc(k.name)}”?`, text: "This removes the revoked key from your list. Its past requests stay in your logs.", confirm: "Delete" }))) return;
        await api(`/api/me/keys/${k.id}`, { method: "DELETE" });
        await load();
      },
      perms: async (el) => {
        const k = keyById(el.dataset.id);
        const ok = await c.openModal({ title: `Permissions for “${esc(k.name)}”`, body: permFields(c, k), submit: "Save", onSubmit: (form) => api(`/api/me/keys/${k.id}`, { method: "PATCH", body: readPerms(form) }) });
        if (ok) {
          c.toast("Permissions saved");
          await load();
        }
      },
      makeReadOnly: async (el) => {
        await api(`/api/me/keys/${el.dataset.id}`, { method: "PATCH", body: { access: "read" } });
        c.toast("Key is now read-only");
        await load();
      },
      appPerms: async (el) => {
        const a = apps.find((x) => x.clientId === el.dataset.id);
        const ok = await c.openModal({ title: `Permissions for ${esc(a.name)}`, body: permFields(c, a), submit: "Save", onSubmit: (form) => api(`/api/me/apps/${encodeURIComponent(a.clientId)}`, { method: "PATCH", body: readPerms(form) }) });
        if (ok) {
          c.toast("Permissions saved");
          await load();
        }
      },
      disconnect: async (el) => {
        if (!(await c.confirmModal({ title: "Disconnect this app?", text: "It loses access immediately and will ask you to sign in again next time.", confirm: "Disconnect" }))) return;
        await api(`/api/me/apps/${encodeURIComponent(el.dataset.id)}`, { method: "DELETE" });
        await load();
      },
      retry: load,
    });
    c.root.innerHTML = h.skeleton(4);
    await load();
  };

  // ===== Bulk jobs ============================================================================
  S.bulk = async (c) => {
    const { h, esc, num, api, $ } = c;
    let data;
    let current = null;
    const f = { q: "", tab: "all" };
    const example = `POST ${c.D.apiUrl}/v1/finance:coingecko/simple-price/bulk\nx-api-key: $APIZIE_KEY\nIdempotency-Key: prices-2026-10-27\n\n{\n  "items": [\n    { "ids": "bitcoin", "vsCurrencies": "usd" },\n    { "ids": "ethereum", "vsCurrencies": "usd" }\n  ]\n}`;
    const kind = (j) => (j.status === "RUNNING" ? "running" : j.status === "FAILED" ? "failed" : j.failed ? "partial" : "completed");
    const load = async () => {
      try {
        data = (await api("/api/me/bulk")).content;
        setActions(data.enabled ? `<button class="btn btn-primary" data-act="newJob">New bulk job</button>` : `<button class="btn btn-ghost" data-act="newJob" data-locked="Growth">New bulk job <span class="lock-tag">Growth</span></button>`);
        render();
      } catch (err) {
        c.root.innerHTML = h.error(err);
      }
    };
    const render = () => {
      const st = data.stats;
      const jobs = data.items.filter((j) => (f.tab === "all" || kind(j) === f.tab) && (!f.q || `${j.jobId} ${j.scraperSlug} ${j.endpointSlug}`.toLowerCase().includes(f.q)));
      const locked = !data.enabled;
      c.root.innerHTML = `
      <div class="ds-card strip">
        <div><span class="stat-label">Jobs · 30d</span><b class="stat-value">${num(st.jobs30d)}</b></div>
        <div><span class="stat-label">Items processed</span><b class="stat-value">${num(st.items30d)}</b></div>
        <div><span class="stat-label">Success rate</span><b class="stat-value">${c.pct(st.successRate)}</b></div>
        <div><span class="stat-label">Running now</span><b class="stat-value">${num(st.running)}</b></div>
      </div>
      <div class="split">
        <div class="stack">
          <div class="ds-card filterbar"><label class="search-box"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="visually-hidden">Filter jobs</span><input data-input="q" value="${esc(f.q)}" placeholder="Filter jobs or paste a job ID"></label>${h.seg("tab", [["all", "All"], ["running", "Running"], ["completed", "Completed"], ["partial", "Partial"], ["failed", "Failed"]], f.tab)}</div>
          <section class="ds-card ${locked ? "locked-card" : ""}" aria-label="Jobs">
            ${
              locked
                ? `<div class="lock-panel"><b>Bulk jobs are on Ultra</b><p>Run one endpoint over up to 500 inputs (2,000 on Max) in a single request. Failed items that return 5xx are never billed.</p><a class="btn btn-primary btn-sm" href="/dashboard/billing?plan=ultra#plans">Upgrade to Growth</a></div>`
                : jobs.length
                ? h.table(["Job", "Endpoint", "Status", "Items", "Created"], jobs.map((j) => `<tr><td><button class="row-btn" data-act="open" data-id="${esc(j.jobId)}">${esc(j.jobId.slice(-10))}</button></td><td><code>${esc(j.scraperSlug)}/${esc(j.endpointSlug)}</code></td><td>${h.badge(kind(j))}</td><td>${num(j.succeeded)}/${num(j.total)}${j.failed ? ` · ${num(j.failed)} failed` : ""}</td><td>${c.dt(j.createdAt)}</td></tr>`))
                : h.empty(data.items.length ? "No jobs match" : "No bulk jobs yet", data.items.length ? "Try another filter." : "Submit one from here or with POST /v1/{api}/{endpoint}/bulk.", data.items.length ? "" : `<button class="btn btn-primary btn-sm" data-act="newJob">New bulk job</button>`)
            }
          </section>
          <div data-job></div>
        </div>
        <aside class="stack"><section class="ds-card"><h2>Submit with the API</h2>${h.code(example, "HTTP")}<p class="meta">Each item is the params object for one call. Results come back in the same order, and a webhook <code>bulk.completed</code> fires when the job ends.</p><a class="link-sm" href="/docs/bulk">Bulk guide →</a></section></aside>
      </div>`;
      if (current) showJob(current);
    };
    const showJob = (job) => {
      current = job;
      $("[data-job]", c.root).innerHTML = `<section class="ds-card" aria-labelledby="job-h"><div class="card-top"><h2 id="job-h">Job ${esc(job.jobId)}</h2>${h.badge(kind(job))}<div class="ds-row push"><button class="btn btn-ghost btn-sm" data-act="download">Download JSON</button><button class="btn btn-ghost btn-sm" data-act="closeJob">Close</button></div></div>
        <p class="meta"><code>${esc(job.scraperSlug)}/${esc(job.endpointSlug)}</code> · ${num(job.succeeded)} succeeded · ${num(job.failed)} failed · ${c.dt(job.createdAt)}</p>
        ${h.table(["#", "Params", "Status", "Latency", "Result"], job.items.slice(0, 200).map((it, i) => `<tr><td>${i + 1}</td><td><code>${esc(JSON.stringify(it.params)).slice(0, 120)}</code></td><td>${h.badge(it.status.toLowerCase())}</td><td>${c.ms(it.latencyMs)}</td><td class="meta clip" title="${esc(it.error ? it.error.message ?? "" : JSON.stringify(it.data ?? null).slice(0, 300))}">${it.error ? esc(`${it.error.status} ${it.error.message ?? ""}`) : esc(JSON.stringify(it.data ?? null).slice(0, 120))}</td></tr>`))}
        ${job.items.length > 200 ? `<p class="meta">Showing the first 200 of ${num(job.items.length)} items. Download the JSON for all of them.</p>` : ""}</section>`;
      $("[data-job]", c.root).scrollIntoView({ behavior: "smooth", block: "start" });
    };
    setHandlers({
      q: (el) => {
        f.q = el.value.toLowerCase();
        render();
        const i = $("[data-input=q]", c.root);
        i.focus();
        i.setSelectionRange(i.value.length, i.value.length);
      },
      tab: (el) => ((f.tab = el.dataset.v), render()),
      open: async (el) => showJob((await api(`/api/me/bulk/${el.dataset.id}`)).content),
      closeJob: () => {
        current = null;
        $("[data-job]", c.root).innerHTML = "";
      },
      download: () => {
        const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `apizie-bulk-${current.jobId}.json` });
        a.click();
        URL.revokeObjectURL(a.href);
      },
      newJob: async () => {
        const job = await c.openModal({
          title: "New bulk job",
          wide: true,
          body: `<label class="field">API<input name="project" list="bulk-apis" placeholder="e.g. finance:coingecko" required autofocus autocomplete="off" data-bulk-api></label><datalist id="bulk-apis"></datalist>
            <label class="field">Endpoint<select name="endpoint" required data-bulk-ep><option value="">Pick an API first</option></select></label>
            <label class="field">Items (JSON array of params)<textarea name="items" rows="7" required placeholder='[{ "ids": "bitcoin", "vsCurrencies": "usd" }]'></textarea></label>
            <label class="field">Idempotency key (optional)<input name="idem" maxlength="100" placeholder="Reuse it to avoid running the same job twice"></label>
            <p class="hint">Up to ${num(data.cap)} items on your plan. Each item counts as one request; 5xx results are refunded.</p>`,
          submit: "Run job",
          onOpen: (dlg) => wireEndpointPicker(c, dlg),
          onSubmit: async (form) => {
            let items;
            try {
              items = JSON.parse(form.items.value);
            } catch {
              throw new Error("Items must be valid JSON, for example [{ \"q\": \"hello\" }]");
            }
            if (!Array.isArray(items) || !items.length) throw new Error("Items must be a non-empty JSON array");
            return (await api("/api/me/bulk", { method: "POST", body: { project: form.project.value.trim(), endpoint: form.endpoint.value, items, idempotencyKey: form.idem.value.trim() || undefined } })).content;
          },
        });
        if (job) {
          c.toast(`Job finished: ${job.succeeded} ok, ${job.failed} failed`);
          await load();
          showJob(job);
        }
      },
      retry: load,
    });
    c.root.innerHTML = h.skeleton(4);
    await load();
  };

  async function wireEndpointPicker(c, dlg) {
    const input = c.$("[data-bulk-api]", dlg);
    const sel = c.$("[data-bulk-ep]", dlg);
    const list = c.$("#bulk-apis", dlg);
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) return;
        if (q.includes(":")) return loadEps(q);
        const r = await c.api(`/api/scrapers/list?q=${encodeURIComponent(q)}&limit=8&bulk=1`).catch(() => null);
        list.innerHTML = (r?.content.items ?? []).map((s) => `<option value="${c.esc(s.key)}">${c.esc(s.displayName)}</option>`).join("");
      }, 200);
    });
    input.addEventListener("change", () => loadEps(input.value.trim()));
    async function loadEps(key) {
      if (!key.includes(":")) return;
      try {
        const { content: s } = await c.api(`/api/scrapers/${encodeURIComponent(key)}`);
        const eps = s.endpoints.filter((e) => e.bulkEnabled);
        sel.innerHTML = eps.length ? eps.map((e) => `<option value="${c.esc(e.slug)}">${c.esc(e.displayName)} (${c.esc(e.slug)})</option>`).join("") : `<option value="">No bulk endpoints on this API</option>`;
      } catch {
        sel.innerHTML = `<option value="">Unknown API key</option>`;
      }
    }
  }

  const LICENCE = { internal: "Commercial use inside your company", product: "Use in your own product, with attribution" };

  // ===== Data alerts ==========================================================================
  S.alerts = async (c) => {
    const { h, esc, api } = c;
    let data;
    const load = async () => {
      try {
        data = (await api("/api/me/alerts")).content;
        setActions(data.limit ? `<a class="btn btn-ghost" href="/dashboard/webhooks">Webhooks</a><button class="btn btn-primary" data-act="add" ${data.items.length >= data.limit ? "disabled" : ""}>New alert</button>` : `<a class="btn btn-primary" href="/dashboard/billing?plan=pro#plans">Upgrade to Starter</a>`);
        render();
      } catch (err) {
        c.root.innerHTML = h.error(err);
      }
    };
    const row = (w) => `<li class="hook ${w.enabled ? "" : "off"}"><div class="hook-main"><b>${esc(w.name)}</b><span class="meta">${esc(w.typeLabel)}</span>
        ${w.lastSummary ? `<span>${esc(w.lastSummary)}</span>` : ""}
        ${w.lastError ? `<span class="meta" style="color:var(--danger,#f87171)">${esc(w.lastError)}</span>` : ""}
        <span class="meta">Checked ${w.lastCheckedAt ? c.ago(w.lastCheckedAt) : "never"}${w.lastChangedAt ? ` · last change ${c.ago(w.lastChangedAt)}` : ""} · ${w.changes ?? 0} alert${w.changes === 1 ? "" : "s"} sent</span>
        ${w.lastSource?.url ? `<span class="meta">Source: <a href="${esc(w.lastSource.url)}" target="_blank" rel="noopener">${esc(w.lastSource.publisher ?? w.lastSource.provider)}</a></span>` : ""}</div>
      <div class="ds-row"><label class="toggle"><input type="checkbox" data-change="toggleAlert" data-id="${esc(w.id)}" ${w.enabled ? "checked" : ""}><span>${w.enabled ? "On" : "Off"}</span></label><button class="btn btn-ghost btn-sm" data-act="checkNow" data-id="${esc(w.id)}">Check now</button><button class="btn btn-danger-ghost btn-sm" data-act="remove" data-id="${esc(w.id)}">Delete</button></div></li>`;
    const render = () => {
      const payload = `{\n  "event": "data.changed",\n  "data": {\n    "name": "New SEC filings: AAPL",\n    "summary": "Apple Inc. filed 8-K on 2026-11-03",\n    "current": { "form": "8-K", "url": "https://www.sec.gov/Archives/..." },\n    "source": { "publisher": "U.S. Securities and Exchange Commission", "url": "https://www.sec.gov/...", "retrievedAt": "…" }\n  }\n}`;
      c.root.innerHTML = `<div class="split"><div class="stack">
        <section class="ds-card ${data.limit ? "" : "locked-card"}" aria-labelledby="al-h"><div class="card-top"><h2 id="al-h">Your alerts</h2><span class="meta">${data.items.length} of ${data.limit}</span></div>
          ${
            !data.limit
              ? `<div class="lock-panel"><b>Data alerts are part of Apizie Finance</b><p>Get a signed <code>data.changed</code> webhook and a notification when a company files with the SEC, a FRED series updates, the Treasury publishes a new yield curve or the ECB moves rates. Finance runs next to your current plan.</p><a class="btn btn-primary btn-sm" href="/dashboard/billing?plan=fin_starter#finance">Add Apizie Finance</a></div>`
              : data.items.length
              ? `<ul class="hooks">${data.items.map(row).join("")}</ul>`
              : h.empty("No alerts yet", "Watch an official source and get told the moment it publishes something new.", `<button class="btn btn-primary btn-sm" data-act="add">New alert</button>`)
          }
          <p class="meta">${esc(data.schedule)} Changes are sent to your <a href="/dashboard/webhooks">webhooks</a> as <code>data.changed</code> and to the bell. Alert checks are included in your Finance plan and do not use your request quota.</p>
        </section></div>
        <aside class="stack"><section class="ds-card"><h2>What you can watch</h2><ul class="plain-list">${data.types.map((t) => `<li><b>${esc(t.label)}</b><br><span class="meta">${esc(t.help)}</span></li>`).join("")}</ul></section>
        <section class="ds-card"><h2>Webhook payload</h2><p class="meta">Every change arrives with its source, so your agent can cite it.</p>${h.code(payload, "application/json")}</section></aside></div>`;
    };
    const fieldsFor = (type) => (data.types.find((t) => t.id === type)?.fields ?? []).map((f) => `<label class="field">${esc(f.label)}<input name="p_${esc(f.name)}" ${f.required ? "required" : ""} placeholder="${esc(f.example ?? "")}"></label>`).join("") || `<p class="meta">No settings needed.</p>`;
    setHandlers({
      add: async () => {
        const first = data.types[0].id;
        const w = await c.openModal({
          title: "New data alert",
          body: `<label class="field">What to watch<select name="type" data-alert-type>${data.types.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join("")}</select></label><div data-alert-fields>${fieldsFor(first)}</div><label class="field">Name (optional)<input name="name" maxlength="80" placeholder="e.g. Apple filings"></label>`,
          submit: "Create alert",
          onOpen: (dlg) => {
            const sel = dlg.querySelector("[data-alert-type]");
            sel.addEventListener("change", () => (dlg.querySelector("[data-alert-fields]").innerHTML = fieldsFor(sel.value)));
          },
          onSubmit: async (form) => {
            const params = Object.fromEntries([...form.querySelectorAll("input[name^=p_]")].map((i) => [i.name.slice(2), i.value.trim()]));
            const r = await api("/api/me/alerts", { method: "POST", body: { type: form.type.value, params, name: form.name.value.trim() } });
            return r;
          },
        });
        if (w) {
          c.toast(w.message ?? "Alert saved");
          await load();
        }
      },
      checkNow: async (el) => {
        el.disabled = true;
        el.textContent = "Checking…";
        try {
          const r = (await api(`/api/me/alerts/${el.dataset.id}/check`, { method: "POST", body: {} })).content;
          c.toast(r.error ? `Check failed: ${r.error}` : r.changed ? "Something new: alert sent" : "No change since the last check");
          await load();
        } catch (err) {
          c.toast(err.message);
          el.disabled = false;
          el.textContent = "Check now";
        }
      },
      toggleAlert: async (el) => {
        await api(`/api/me/alerts/${el.dataset.id}`, { method: "PATCH", body: { enabled: el.checked } });
        await load();
      },
      remove: async (el) => {
        if (!(await c.confirmModal({ title: "Delete this alert?", text: "It stops checking right away.", confirm: "Delete" }))) return;
        await api(`/api/me/alerts/${el.dataset.id}`, { method: "DELETE" });
        await load();
      },
    });
    await load();
  };

  // ===== Webhooks =============================================================================
  S.webhooks = async (c) => {
    const { h, esc, num, api } = c;
    let data;
    const verify = `import { createHmac, timingSafeEqual } from "node:crypto";\n\nfunction verify(rawBody, header, secret) {\n  const want = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");\n  return header?.length === want.length &&\n    timingSafeEqual(Buffer.from(want), Buffer.from(header));\n}\n\n// header: req.headers["x-apizie-signature"]`;
    const payload = `{\n  "id": "01J…",\n  "event": "quota.warning",\n  "data": { "used": 480, "limit": 600, "percent": 80 },\n  "deliveredAt": "2026-10-27T08:00:00.000Z"\n}`;
    const load = async () => {
      try {
        data = (await api("/api/me/webhooks")).content;
        setActions(data.enabled ? `<button class="btn btn-ghost" data-act="test" ${data.hooks.length ? "" : "disabled"}>Send test</button><button class="btn btn-primary" data-act="add">Add endpoint</button>` : `<button class="btn btn-ghost" data-act="add" data-locked="Starter">Add endpoint <span class="lock-tag">Starter</span></button>`);
        render();
      } catch (err) {
        c.root.innerHTML = h.error(err);
      }
    };
    const render = () => {
      const locked = !data.enabled;
      c.root.innerHTML = `<div class="split"><div class="stack">
        <section class="ds-card ${locked ? "locked-card" : ""}" aria-labelledby="ep-h"><div class="card-top"><h2 id="ep-h">Endpoints</h2><span class="meta">${data.hooks.length} of 5</span></div>
          ${
            locked
              ? `<div class="lock-panel"><b>Webhooks are on Pro</b><p>Get quota, key, balance and error events pushed to your server, signed with your secret. Apizie Finance plans include them too.</p><a class="btn btn-primary btn-sm" href="/dashboard/billing?plan=pro#plans">Upgrade to Starter</a></div>`
              : data.hooks.length
              ? `<ul class="hooks">${data.hooks.map((w) => `<li class="hook ${w.enabled ? "" : "off"}"><div class="hook-main"><b>${esc(w.url)}</b>${w.description ? `<span class="meta">${esc(w.description)}</span>` : ""}<div class="chips">${w.events.map((e) => `<span class="chip">${e === "*" ? "all events" : esc(e)}</span>`).join("")}</div><span class="meta">Secret <code>${esc(w.secretPreview)}</code></span></div>
                  <div class="ds-row"><label class="toggle"><input type="checkbox" data-change="toggleHook" data-id="${esc(w.id)}" ${w.enabled ? "checked" : ""}><span>${w.enabled ? "On" : "Off"}</span></label><button class="btn btn-ghost btn-sm" data-act="testOne" data-id="${esc(w.id)}">Test</button><button class="btn btn-ghost btn-sm" data-act="edit" data-id="${esc(w.id)}">Edit</button><button class="btn btn-ghost btn-sm" data-act="rotate" data-id="${esc(w.id)}">Rotate secret</button><button class="btn btn-danger-ghost btn-sm" data-act="remove" data-id="${esc(w.id)}">Delete</button></div></li>`).join("")}</ul>`
              : h.empty("No webhook yet", "Get pinged when quota runs low, keys change or requests fail.", `<button class="btn btn-primary btn-sm" data-act="add">Add endpoint</button>`)
          }
        </section>
        <section class="ds-card" aria-labelledby="dl-h"><div class="card-top"><h2 id="dl-h">Recent deliveries</h2></div>
          ${data.deliveries.length ? h.table(["Time", "Event", "Endpoint", "Result", "Attempts", ""], data.deliveries.map((d) => `<tr><td>${c.dt(d.at)}</td><td><code>${esc(d.event)}</code></td><td class="meta clip">${esc(d.url)}</td><td>${d.ok ? h.badge("ok", `${d.status} OK`) : h.badge("failed", d.status ? `HTTP ${d.status}` : "No response")}${d.error && !d.ok ? `<div class="meta">${esc(d.error)}</div>` : ""}</td><td>${d.attempts} · ${c.ms(d.ms)}</td><td class="ds-row"><button class="btn btn-ghost btn-sm" data-act="payload" data-id="${esc(d.id)}">Payload</button>${data.enabled ? `<button class="btn btn-ghost btn-sm" data-act="redeliver" data-id="${esc(d.id)}">Redeliver</button>` : ""}</td></tr>`)) : h.empty("Nothing delivered yet", "Add an endpoint, then press Send test. Every delivery and its response shows up here.")}
          <p class="meta">Failed deliveries are retried twice with backoff. Redeliver any event by hand.</p>
        </section></div>
        <aside class="stack"><section class="ds-card"><h2>Example payload</h2><p class="meta">Your endpoint receives a POST with exactly this shape.</p>${h.code(payload, "application/json")}<p class="meta">Events: ${data.events.map((e) => `<code>${esc(e)}</code>`).join(" ")}</p></section>
        <section class="ds-card"><h2>Verifying signatures</h2><p class="meta">Every delivery carries <code>X-Apizie-Signature</code>: an HMAC-SHA256 of the raw body using your signing secret.</p>${h.code(verify, "Node.js")}</section></aside></div>`;
    };
    const hookForm = (w = {}) => `<label class="field">Endpoint URL<input name="url" type="url" required value="${esc(w.url ?? "")}" placeholder="https://example.com/apizie-webhook" autofocus></label>
      <label class="field">Description (optional)<input name="description" maxlength="80" value="${esc(w.description ?? "")}" placeholder="e.g. Production alerts"></label>
      <fieldset class="field"><legend>Events</legend><div class="checks"><label><input type="checkbox" name="ev" value="*" ${!w.events || w.events.includes("*") ? "checked" : ""}> All events</label>${data.events.map((e) => `<label><input type="checkbox" name="ev" value="${esc(e)}" ${w.events?.includes(e) ? "checked" : ""}> ${esc(e)}</label>`).join("")}</div></fieldset>`;
    const events = (form) => {
      const v = [...form.querySelectorAll("input[name=ev]:checked")].map((x) => x.value);
      return v.includes("*") || !v.length ? ["*"] : v;
    };
    const showSecret = (secret) => c.openModal({ title: "Signing secret", cancel: "Done", body: `<p class="modal-text">Copy it now and store it with your server config. It's shown once.</p><div class="secret-row big"><code>${esc(secret)}</code>${h.copyBtn(secret)}</div>` });
    const testResult = (r) => c.toast(r.map((x) => (x.ok ? `Delivered (${x.status})` : `Failed: ${x.error ?? x.status}`)).join(" · "));
    setHandlers({
      add: async () => {
        const w = await c.openModal({ title: "Add endpoint", body: hookForm(), submit: "Add endpoint", onSubmit: async (form) => (await api("/api/me/webhooks", { method: "POST", body: { url: form.url.value.trim(), description: form.description.value, events: events(form) } })).content });
        if (w) {
          await load();
          await showSecret(w.secret);
        }
      },
      edit: async (el) => {
        const w = data.hooks.find((x) => x.id === el.dataset.id);
        if (await c.openModal({ title: "Edit endpoint", body: hookForm(w), submit: "Save", onSubmit: (form) => api(`/api/me/webhooks/${w.id}`, { method: "PATCH", body: { url: form.url.value.trim(), description: form.description.value, events: events(form) } }) })) await load();
      },
      toggleHook: async (el) => {
        await api(`/api/me/webhooks/${el.dataset.id}`, { method: "PATCH", body: { enabled: el.checked } });
        await load();
      },
      rotate: async (el) => {
        if (!(await c.confirmModal({ title: "Rotate signing secret?", text: "The old secret stops working for new deliveries right away. Update your server first.", confirm: "Rotate", danger: false }))) return;
        const { content } = await api(`/api/me/webhooks/${el.dataset.id}/rotate`, { method: "POST" });
        await load();
        await showSecret(content.secret);
      },
      remove: async (el) => {
        if (!(await c.confirmModal({ title: "Delete this endpoint?", text: "It stops receiving events immediately.", confirm: "Delete" }))) return;
        await api(`/api/me/webhooks/${el.dataset.id}`, { method: "DELETE" });
        await load();
      },
      test: async (el) => {
        el.disabled = true;
        try {
          testResult((await api("/api/me/webhooks/test", { method: "POST", body: {} })).content);
          await load();
        } finally {
          el.disabled = false;
        }
      },
      testOne: async (el) => {
        el.disabled = true;
        el.textContent = "Sending…";
        try {
          testResult((await api("/api/me/webhooks/test", { method: "POST", body: { hookId: el.dataset.id } })).content);
          await load();
        } finally {
          el.disabled = false;
        }
      },
      payload: (el) => {
        const d = data.deliveries.find((x) => x.id === el.dataset.id);
        c.openModal({ title: `Payload · ${esc(d.event)}`, cancel: "Close", wide: true, body: h.code(JSON.stringify(d.payload, null, 2), "application/json") });
      },
      redeliver: async (el) => {
        el.disabled = true;
        el.textContent = "Sending…";
        try {
          const { content } = await api(`/api/me/webhooks/deliveries/${el.dataset.id}/redeliver`, { method: "POST" });
          c.toast(content.ok ? `Delivered (${content.status})` : `Failed: ${content.error ?? content.status}`);
        } finally {
          await load();
        }
      },
      retry: load,
    });
    c.root.innerHTML = h.skeleton(4);
    await load();
  };

  // ===== Billing ==============================================================================
  S.billing = async (c) => {
    const { h, esc, num, api, usd } = c;
    let b;
    let tab = "all";
    let autoOpened = false;
    const qs = new URLSearchParams(location.search);
    const want = qs.get("plan");
    const returned = qs.get("invoice") && qs.get("checkout") ? { id: qs.get("invoice"), result: qs.get("checkout") } : null;
    const load = async () => {
      try {
        b = (await api("/api/me/billing")).content;
        render();
      } catch (err) {
        c.root.innerHTML = h.error(err);
      }
    };
    const statusTag = (s) => h.badge(s, { failed: "Payment failed", pending: "Waiting for payment", awaiting_review: "Checking payment", paid: "Paid", cancelled: "Cancelled", rejected: "Rejected", settled: "Settled" }[s] ?? s);
    // Apizie Finance: a premium add-on with its own plan, quota and expiry, next to the general plan.
    const financeSection = () => {
      const f = b.finance;
      if (!f) return "";
      const cur = f.plan;
      const fq = b.quota.finance;
      const rank = (id) => f.plans.findIndex((y) => y.id === id);
      return `<section class="ds-card finance-card" id="finance" aria-labelledby="fin-h"><div class="card-top"><h2 id="fin-h">Apizie Finance <span class="badge badge-live">Premium</span></h2><span class="meta">SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF and World Bank, cited on every answer · <a href="/finance">What's included</a></span></div>
        ${cur ? `<div class="quota-block"><div class="row-between"><span>${esc(cur.name)} · active until ${c.day(f.expiresAt)}</span><b>${num(fq?.month.used ?? 0)} / ${num(cur.monthly)}</b></div>${h.bar(fq?.month.used ?? 0, cur.monthly)}</div>` : `<p class="meta">Not active. The six official sources, the combined <code>official:*</code> endpoints and data alerts need a Finance plan. It runs next to your ${c.planName(b.plan.id)} plan with its own quota.</p>`}
        <div class="plans">${f.plans.map((x) => `<div class="plan ${cur?.id === x.id ? "current" : ""} ${x.id === want ? "wanted" : ""}"><div class="row-between"><b class="plan-title">${esc(x.name.replace("Finance ", ""))}</b>${cur?.id === x.id ? `<button class="btn btn-ghost btn-sm" data-act="upgrade" data-plan="${x.id}" title="Adds time on top of your current period">Renew</button>` : cur && rank(x.id) < rank(cur.id) ? `<span class="muted-sm">Included in ${esc(cur.name)}</span>` : `<button class="btn btn-primary btn-sm" data-act="upgrade" data-plan="${x.id}">${cur ? "Upgrade" : "Add"}</button>`}</div>
          <p class="plan-price">$${x.priceUsd} <small>/ month</small></p><p class="meta">$${x.priceUsd * 10} / year (2 months free)</p>
          <ul class="tips small"><li>${num(x.monthly)} Finance requests / month</li><li>${LICENCE[x.licence] ?? ""}</li><li>${num(x.alerts)} data alerts</li><li>${num(x.perMinute)} requests / minute</li>${x.bulk ? `<li>Bulk jobs up to ${num(x.bulkCap)} items</li>` : ""}<li>Signed webhooks</li></ul></div>`).join("")}</div>
        <p class="meta">Above the Finance quota, pay-as-you-go uses the same balance at $${f.usdPer1k.toFixed(2)} per 1,000 Finance requests. Redistribution, resale or an SLA with credits: <a href="/dashboard/support?type=billing">contact us for Enterprise</a>.</p>
      </section>`;
    };
    const allPlans = () => [...b.plans, ...(b.finance?.plans ?? [])];
    const render = () => {
      const p = b.plan;
      const q = b.quota;
      const rows = b.transactions.filter((t) => tab === "all" || t.kind === tab);
      c.root.innerHTML = `${b.cardEnabled ? "" : `<div class="ds-banner warn" role="status">Checkout is temporarily unavailable. Plans and top-ups will be back shortly; your current plan keeps working.</div>`}
      <div class="grid-hero">
        <section class="ds-card hero-card plan-hero" aria-labelledby="cp-h">
          <div class="hero-left"><p class="card-label">Current plan</p><h2 id="cp-h" class="plan-name">${c.planName(p.id)} <small>$${p.priceUsd} / month</small></h2>
            <p class="meta">${b.planExpiresAt && p.id !== "free" ? `Active until ${c.day(b.planExpiresAt)}. Renew any time; time is added on top.` : "Free forever. Upgrade any time: one-time payment, no subscription."}</p>
            <div class="quota-block"><div class="row-between"><span>Monthly requests</span><b>${num(q.month.used)} / ${num(q.month.limit)}</b></div>${h.bar(q.month.used, q.month.limit)}</div></div>
          <div class="hero-right">${p.id === "free" ? `<a class="btn btn-primary" href="#plans">Upgrade</a>` : `<button class="btn btn-primary" data-act="upgrade" data-plan="${p.id}">Renew ${c.planName(p.id)}</button>`}</div>
        </section>
        <section class="ds-card" aria-labelledby="bal-h">
          <div class="card-top"><h2 id="bal-h">Pay-as-you-go balance</h2><button class="btn btn-primary btn-sm push" data-act="topupCustom">Top up</button></div>
          <b class="hero-num sm">${usd(b.balance)}</b><p class="meta">≈ ${num(b.balanceRequests)} requests over your plan quota, at $${b.payg.usdPer1k.toFixed(2)} per 1,000</p>
          <label class="switch-row"><span><b>Use balance when the plan quota runs out</b><small>Your API keeps working past 100% instead of returning 429.</small></span><input type="checkbox" role="switch" data-change="pref" data-pref="payg" ${b.payg.enabled ? "checked" : ""}></label>
          <label class="switch-row"><span><b>Low-balance alert</b><small>Notify me (and send <code>balance.low</code>) below ${usd(b.payg.lowBalanceUsd)}.</small></span><input type="checkbox" role="switch" data-change="pref" data-pref="lowBalanceAlert" ${b.payg.lowBalanceAlert ? "checked" : ""}></label>
        </section>
      </div>
      <section class="ds-card" aria-labelledby="tu-h"><div class="card-top"><h2 id="tu-h">Top up balance</h2><span class="meta">Secure checkout by Dodo Payments · card, Apple Pay, Google Pay</span></div>
        <div class="topups">${b.payg.topupsUsd.map((t) => `<div class="topup"><b>$${t.usd}</b><span class="meta">≈ ${num(t.requests)} requests</span><button class="btn btn-ghost btn-sm" data-act="topupUsd" data-usd="${t.usd}"${b.cardEnabled ? "" : " disabled"}>Top up $${t.usd}</button></div>`).join("")}
          <form class="topup custom" data-topup-form><b>Custom</b><label class="visually-hidden" for="tu-amt">Amount in US dollars</label><input id="tu-amt" name="amount" type="number" inputmode="decimal" min="${b.payg.minTopupUsd}" max="${b.payg.maxTopupUsd}" step="1" placeholder="$"><span class="meta">min $${b.payg.minTopupUsd}</span><button class="btn btn-ghost btn-sm" data-act="topupForm"${b.cardEnabled ? "" : " disabled"}>Top up</button></form></div>
      </section>
      <section class="ds-card" id="plans" aria-labelledby="pl-h"><div class="card-top"><h2 id="pl-h">Plans</h2><span class="meta">Each plan includes a monthly quota; your balance covers anything above it</span></div>
        <div class="plans">${b.plans.map((x) => `<div class="plan ${x.id === p.id ? "current" : ""} ${x.id === want ? "wanted" : ""}"><div class="row-between"><b class="plan-title">${c.planName(x.id)}</b>${x.id === p.id ? (p.id === "free" ? h.badge("current", "Current plan") : `<button class="btn btn-ghost btn-sm" data-act="upgrade" data-plan="${x.id}" title="Adds time on top of your current period">Renew</button>`) : x.id === "free" ? "" : b.plans.findIndex((y) => y.id === x.id) < b.plans.findIndex((y) => y.id === p.id) ? `<span class="muted-sm">Included in ${c.planName(p.id)}</span>` : `<button class="btn btn-primary btn-sm" data-act="upgrade" data-plan="${x.id}">Upgrade</button>`}</div>
          <p class="plan-price">$${x.priceUsd} <small>/ month</small></p>${x.priceUsd ? `<p class="meta">$${x.priceUsd * 10} / year (2 months free)</p>` : ""}
          <ul class="tips small"><li>${num(x.monthly)} requests / month</li><li>${num(x.perMinute)} requests / minute</li><li>${x.logDays}-day log history</li>${x.webhooks ? "<li>Webhooks and IP allowlists</li>" : ""}${x.bulk ? `<li>Bulk jobs up to ${num(x.bulkCap)} items</li>` : ""}<li>${num(x.maxKeys)} active API keys</li></ul></div>`).join("")}</div>
        <p class="meta">Every plan includes the whole public catalog and the MCP server. Official financial data is the separate Apizie Finance add-on below.</p>
      </section>
      ${financeSection()}
      <section class="ds-card" aria-labelledby="tx-h"><div class="card-top"><h2 id="tx-h">Transactions</h2>${h.seg("tab", [["all", "All"], ["plan", "Plans"], ["topup", "Top-ups"], ["usage", "Usage"]], tab)}</div>
        ${rows.length ? h.table(["Order ID", "Date", "Item", "Method", "Subtotal", "Tax", "Total", "Status", ""], rows.map((t) => `<tr><td><code>${esc(t.id)}</code></td><td>${c.day(t.date)}</td><td>${esc(t.item)}</td><td>${esc(t.method)}</td><td>${c.money(t.subtotal, t.currency)}</td><td>${t.kind === "usage" ? "–" : `<span class="meta">at checkout</span>`}</td><td><b>${c.money(t.total, t.currency)}</b></td><td>${statusTag(t.status)}${t.reference ? `<div class="meta">Ref: ${esc(t.reference)}</div>` : ""}</td><td>${t.status === "pending" ? `<div class="ds-row"><button class="btn btn-primary btn-sm" data-act="pay" data-id="${esc(t.id)}">Pay</button><button class="btn btn-ghost btn-sm" data-act="cancel" data-id="${esc(t.id)}">Cancel</button></div>` : ""}</td></tr>`)) : h.empty("No transactions yet", "Invoices for plans and top-ups, and pay-as-you-go usage, show up here.")}
      </section>`;
      if (want) document.getElementById(want.startsWith("fin_") || want === "finance" ? "finance" : "plans")?.scrollIntoView({ block: "start" });
      if (want && !autoOpened && allPlans().some((x) => x.id === want && x.id !== "free")) {
        // Came from the pricing page: open the checkout step for that plan straight away.
        autoOpened = true;
        history.replaceState(null, "", location.pathname);
        setTimeout(() => c.$(`[data-act=upgrade][data-plan="${want}"]`)?.click(), 0);
      }
    };
    const goCheckout = async (inv) => {
      const url = inv.checkoutUrl ?? (await api(`/api/me/invoices/${inv.id}/checkout`, { method: "POST" })).content.checkoutUrl;
      c.toast("Opening secure checkout…");
      location.assign(url);
    };
    const payModal = (inv) => (inv.provider === "dodo" ? goCheckout(inv) : c.toast("This older invoice can't be paid online. Cancel it and choose the plan again."));
    // Every purchase goes to Dodo Payments checkout (US dollars).
    const createInvoice = async (body) => {
      if (!b.cardEnabled) return c.toast("Checkout is temporarily unavailable. Please try again soon.");
      const { content: inv } = await api("/api/me/invoices", { method: "POST", body: { ...body, method: "card" } });
      return goCheckout(inv);
    };
    setHandlers({
      pref: async (el) => {
        el.disabled = true;
        try {
          await api("/api/me/prefs", { method: "PATCH", body: { [el.dataset.pref]: el.checked } });
          c.toast(el.checked ? "Turned on" : "Turned off");
        } catch (err) {
          el.checked = !el.checked;
          c.toast(err.message);
        } finally {
          el.disabled = false;
        }
      },
      topupUsd: (el) => createInvoice({ type: "topup", usd: Number(el.dataset.usd) }),
      topupForm: (el) => {
        const v = Number(el.closest("form").amount.value);
        if (!v || v < b.payg.minTopupUsd) return c.toast(`Enter at least $${b.payg.minTopupUsd}`);
        if (v > b.payg.maxTopupUsd) return c.toast(`The most you can add at once is $${b.payg.maxTopupUsd.toLocaleString("en-US")}`);
        return createInvoice({ type: "topup", usd: v });
      },
      topupCustom: () => {
        const i = c.$("#tu-amt");
        i.scrollIntoView({ block: "center" });
        i.focus();
      },
      upgrade: async (el) => {
        const plan = allPlans().find((x) => x.id === el.dataset.plan);
        const isFin = plan.id.startsWith("fin_");
        const current = isFin ? b.finance?.plan?.id : b.plan.id;
        const months = await c.openModal({
          title: isFin ? `Apizie ${c.planName(plan.id)}` : `${c.planName(plan.id)} plan`,
          body: `<label class="field">How many months?<select name="months" autofocus>${[1, 3, 6, 12].map((m) => { const paid = m === 12 ? 10 : m; return `<option value="${m}">${m === 12 ? "12 months (2 free)" : `${m} month${m > 1 ? "s" : ""}`} · $${plan.priceUsd * paid}</option>`; }).join("")}</select></label><p class="hint">You'll continue to a secure checkout by Dodo Payments (card, Apple Pay or Google Pay, in US dollars). ${isFin ? "Apizie Finance runs next to your general plan, with its own quota. " : ""}The plan is active as soon as the payment goes through${current === plan.id ? " and the time is added to your current period" : ""}. No automatic renewal.</p>`,
          submit: "Continue to checkout",
          onSubmit: (form) => Number(form.months.value),
        });
        if (months) await createInvoice({ type: "plan", plan: plan.id, months });
      },
      pay: async (el) => {
        const inv = b.invoices.find((i) => i.id === el.dataset.id);
        await payModal(inv);
        await load();
      },
      cancel: async (el) => {
        if (!(await c.confirmModal({ title: "Cancel this invoice?", text: "Don't cancel it if you already paid at checkout.", confirm: "Cancel invoice" }))) return;
        await api(`/api/me/invoices/${el.dataset.id}/cancel`, { method: "POST" });
        await load();
      },
      tab: (el) => ((tab = el.dataset.v), render()),
      retry: load,
    });
    c.root.addEventListener("submit", (e) => {
      if (e.target.matches("[data-topup-form]")) {
        e.preventDefault();
        c.$("[data-act=topupForm]", e.target).click();
      }
    });
    c.root.innerHTML = h.skeleton(4);
    if (returned) {
      // Back from Dodo checkout: ask the server to check the payment now (the webhook may still be on its way).
      history.replaceState(null, "", location.pathname);
      if (returned.result === "done") {
        try {
          const { content: inv } = await api(`/api/me/invoices/${encodeURIComponent(returned.id)}/sync`, { method: "POST" });
          c.toast(inv.status === "paid" ? (inv.type === "topup" ? "Payment received. Your balance is topped up" : "Payment received. Your plan is active") : "Payment is being processed. This page updates once it's confirmed");
        } catch (err) {
          c.toast(err.message);
        }
      } else c.toast("Checkout cancelled. The invoice stays open if you want to pay later");
    }
    await load();
  };

  // ===== Affiliate ============================================================================
  S.affiliate = async (c) => {
    const { h, esc, num, api, usd } = c;
    let a;
    const load = async () => {
      try {
        a = (await api("/api/me/affiliate")).content;
        render();
      } catch (err) {
        c.root.innerHTML = h.error(err);
      }
    };
    const render = () => {
      c.root.innerHTML = `<div class="grid-hero">
        <section class="ds-card hero-card" aria-labelledby="ref-h"><div class="hero-left"><h2 id="ref-h">Your referral link</h2><p class="meta">Share it. When someone signs up through it and pays for a plan or a top-up, you earn ${a.percent}% of what they pay (before VAT), for as long as they stay.</p>
          <div class="secret-row big"><code>${esc(a.link)}</code>${h.copyBtn(a.link, "Copy link")}</div><p class="meta">Code <code>${esc(a.code)}</code> · the link remembers a visitor for 30 days</p></div></section>
        <section class="ds-card" aria-labelledby="earn-h"><h2 id="earn-h">Earnings</h2><b class="hero-num sm">${usd(a.available)}</b><p class="meta">available · ${usd(a.earned)} earned in total</p>
          <div class="ds-row"><button class="btn btn-primary btn-sm" data-act="move" ${a.available > 0 ? "" : "disabled"}>Move to balance</button><button class="btn btn-ghost btn-sm" data-act="payout" ${a.available >= a.minPayout ? "" : "disabled"}>Request payout</button></div>
          <p class="meta">Moving to your pay-as-you-go balance is instant. Payouts (PayPal or international bank transfer) start at ${usd(a.minPayout)}.</p></section>
      </div>
      <div class="grid-4">${h.stat("Link clicks", num(a.clicks))}${h.stat("Sign-ups", num(a.signups))}${h.stat("Paying customers", num(a.paying))}${h.stat("Commission", `${a.percent}%`, "of each paid invoice")}</div>
      <div class="grid-main">
        <section class="ds-card" aria-labelledby="ce-h"><h2 id="ce-h">Commission history</h2>${a.earnings.length ? h.table(["Date", "Invoice", "Amount"], a.earnings.map((e) => `<tr><td>${c.day(e.at)}</td><td><code>${esc(e.invoiceId)}</code></td><td>${usd(e.amount)}</td></tr>`)) : h.empty("No commission yet", "It appears here when someone you referred pays an invoice.")}</section>
        <section class="ds-card" aria-labelledby="po-h"><h2 id="po-h">Payout requests</h2>${a.payouts.length ? h.table(["Date", "Amount", "Status"], a.payouts.map((p) => `<tr><td>${c.day(p.createdAt)}</td><td>${p.currency === "USD" ? usd(p.amount) : c.idr(p.amount)}</td><td>${h.badge(p.status)}</td></tr>`)) : h.empty("No payouts yet")}</section>
      </div>`;
    };
    setHandlers({
      move: async () => {
        const { content } = await api("/api/me/affiliate/move", { method: "POST" });
        c.toast(`${usd(content.moved)} moved to your balance`);
        await load();
      },
      payout: async () => {
        const r = await c.openModal({ title: `Request a payout of ${usd(Math.floor(a.available * 100) / 100)}`, body: `<label class="field">Where should we send it?<input name="account" required maxlength="200" placeholder="PayPal email, or bank name + SWIFT + account number + holder" autofocus></label><p class="hint">We transfer it manually, usually within a few business days, and notify you when it's sent.</p>`, submit: "Request payout", onSubmit: (form) => api("/api/me/affiliate/payout", { method: "POST", body: { account: form.account.value } }) });
        if (r) {
          c.toast("Payout requested");
          await load();
        }
      },
      retry: load,
    });
    c.root.innerHTML = h.skeleton(3);
    await load();
  };

  // ===== Showcase =============================================================================
  S.showcase = async (c) => {
    const { h, esc, api } = c;
    let list = [];
    const load = async () => {
      try {
        list = (await api("/api/me/showcase")).content;
        render();
      } catch (err) {
        c.root.innerHTML = h.error(err);
      }
    };
    const render = () => {
      c.root.innerHTML = `<div class="grid-main">
        <section class="ds-card" aria-labelledby="sub-h"><h2 id="sub-h">Submit a project</h2><p class="meta">Approved projects appear on the public <a href="/showcase">Showcase</a> page.${c.D.plan.bulk ? " Growth and Business projects also get their logo on the strip." : ""}</p>
          <form class="form-grid" data-show-form novalidate><label class="field">Project name<input name="name" required maxlength="80"></label><label class="field">URL<input name="url" type="url" required placeholder="https://"></label><label class="field full">What does it do?<textarea name="description" rows="3" maxlength="280" required></textarea></label><p class="form-error full" data-show-err role="alert" hidden></p><div class="full"><button class="btn btn-primary">Submit for review</button></div></form></section>
        <section class="ds-card" aria-labelledby="mine-h"><h2 id="mine-h">Your submissions</h2>${list.length ? h.table(["Project", "Status", ""], list.map((s) => `<tr><td><b>${esc(s.name)}</b><div class="meta"><a href="${esc(s.url)}" target="_blank" rel="noopener nofollow">${esc(s.url)}</a></div></td><td>${h.badge(s.status)}</td><td>${s.status === "pending" || s.status === "approved" ? `<button class="btn btn-danger-ghost btn-sm" data-act="withdraw" data-id="${esc(s.id)}">Withdraw</button>` : ""}</td></tr>`)) : h.empty("Nothing submitted yet", "Built something with Apizie? Share it.")}</section></div>`;
      c.$("[data-show-form]", c.root).addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.target;
        const err = c.$("[data-show-err]", form);
        err.hidden = true;
        try {
          await api("/api/showcase", { method: "POST", body: Object.fromEntries(new FormData(form)) });
          c.toast("Submitted. We'll review it shortly");
          await load();
        } catch (x) {
          err.textContent = x.message;
          err.hidden = false;
        }
      });
    };
    setHandlers({
      withdraw: async (el) => {
        if (!(await c.confirmModal({ title: "Withdraw this project?", text: "It's removed from the public showcase.", confirm: "Withdraw" }))) return;
        await api(`/api/me/showcase/${el.dataset.id}`, { method: "DELETE" });
        await load();
      },
      retry: load,
    });
    c.root.innerHTML = h.skeleton(2);
    await load();
  };

  // ===== Settings =============================================================================
  S.settings = async (c) => {
    const { h, esc, num, api } = c;
    let me;
    let sessions = [];
    const prefsList = [
      ["quotaWarning", "Quota reaches 80%"],
      ["quotaExceeded", "Quota used up"],
      ["balance", "Balance alerts"],
      ["affiliate", "Affiliate earnings"],
      ["dataAlerts", "Data alerts (new filings, rate changes)"],
      ["product", "Product updates"],
    ];
    const load = async () => {
      try {
        const [m, s] = await Promise.all([api("/api/me"), api("/api/me/sessions")]);
        me = m.content;
        sessions = s.content;
        render();
      } catch (err) {
        c.root.innerHTML = h.error(err);
      }
    };
    const render = () => {
      const u = me.user;
      c.root.innerHTML = `<div class="settings">
        <nav class="settings-nav" aria-label="Settings sections"><a href="#profile">Profile</a><a href="#security">Security</a><a href="#notifications">Notifications</a><a href="#sessions">Sessions</a><a href="#danger" class="danger">Danger zone</a></nav>
        <div class="stack">
          <section class="ds-card" id="profile" aria-labelledby="pr-h"><h2 id="pr-h">Profile</h2>
            <form class="profile" data-profile novalidate>
              <div class="avatar-edit">${u.avatar ? `<img src="${esc(u.avatar)}" alt="Your profile photo" width="88" height="88" referrerpolicy="no-referrer">` : `<span class="ds-avatar xl" aria-hidden="true">${esc(u.name[0]?.toUpperCase() ?? "?")}</span>`}
                <label class="btn btn-ghost btn-sm">Change photo<input type="file" accept="image/png,image/jpeg,image/webp" data-change="avatar" class="visually-hidden"></label>${u.avatar ? `<button type="button" class="btn-link" data-act="removeAvatar">Remove</button>` : ""}</div>
              <div class="form-grid"><label class="field">Display name<input name="name" value="${esc(u.name)}" maxlength="60" required></label><label class="field">Email<input value="${esc(u.email ?? "")}" disabled><small>Used to sign in. It can't be changed here.</small></label>
                <p class="meta full">Plan <b>${esc(c.planName(me.plan.id))}</b> · <a href="/dashboard/billing">Manage billing →</a></p><p class="form-error full" data-err-profile role="alert" hidden></p><div class="full"><button class="btn btn-primary">Save</button></div></div>
            </form></section>
          <section class="ds-card" id="security" aria-labelledby="se-h"><h2 id="se-h">Security</h2>
            <p class="meta">${me.providers.length ? `You sign in with ${me.providers.map((p) => (p === "supabase" ? "Google" : c.cap(p))).join(", ")}${u.hasPassword ? " or your password" : ""}.` : "You sign in with email and password."} Changing your password signs you out everywhere else.</p>
            <form class="form-grid" data-password novalidate>${u.hasPassword ? `<label class="field">Current password<input type="password" name="currentPassword" autocomplete="current-password" required></label>` : ""}<label class="field">${u.hasPassword ? "New password" : "Set a password"}<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required></label><label class="field">Repeat it<input type="password" name="repeat" autocomplete="new-password" minlength="8" required></label><p class="form-error full" data-err-pw role="alert" hidden></p><div class="full"><button class="btn btn-ghost">${u.hasPassword ? "Change password" : "Set password"}</button></div></form></section>
          <section class="ds-card" id="notifications" aria-labelledby="no-h"><h2 id="no-h">Notifications</h2><p class="meta">Shown under the bell in the dashboard${me.emailEnabled ? " and sent to your email" : ""}. Payment and account messages always go out.</p>
            ${prefsList.map(([k, label]) => `<label class="switch-row"><span><b>${label}</b></span><input type="checkbox" role="switch" data-change="pref" data-pref="${k}" ${me.prefs[k] ? "checked" : ""}></label>`).join("")}</section>
          <section class="ds-card" id="sessions" aria-labelledby="ss-h"><div class="card-top"><h2 id="ss-h">Active sessions</h2></div>
            <ul class="sessions">${sessions.map((s) => `<li><span><b>${esc(s.device)}</b><small>${s.current ? "This device" : `Active ${c.ago(s.lastSeenAt)}`}${s.ip ? ` · ${esc(s.ip)}` : ""} · signed in ${c.day(s.createdAt)}</small></span>${s.current ? h.badge("current", "Current") : `<button class="btn btn-danger-ghost btn-sm" data-act="endSession" data-id="${esc(s.id)}">Sign out</button>`}</li>`).join("") || `<li class="meta">Only this device.</li>`}</ul>
            <button class="btn btn-ghost btn-block" data-act="endOthers" ${sessions.length > 1 ? "" : "disabled"}>Sign out all other sessions</button></section>
          <section class="ds-card danger-card" id="danger" aria-labelledby="dz-h"><h2 id="dz-h">Danger zone</h2><p class="meta">Deleting your account removes your profile, all API keys, logs and webhooks for good. Paid invoices are kept for accounting.</p><button class="btn btn-danger" data-act="deleteAccount">Delete account</button></section>
        </div>
        <aside class="stack"><section class="ds-card" aria-labelledby="ac-h"><h2 id="ac-h">Account</h2><dl class="kv">
          <dt>User ID</dt><dd><code>${esc(u.id)}</code> ${h.copyBtn(u.id)}</dd><dt>Member since</dt><dd>${c.day(u.createdAt)}</dd><dt>Plan</dt><dd>${esc(c.planName(me.plan.id))}</dd><dt>API keys</dt><dd>${num(me.keys.active)} active · ${num(me.keys.revoked)} revoked</dd><dt>Sign-in</dt><dd>${me.providers.length ? me.providers.map((p) => (p === "supabase" ? "Google" : c.cap(p))).join(", ") : "Email"}</dd></dl></section></aside>
      </div>`;
      c.$("[data-profile]", c.root).addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = c.$("[data-err-profile]", c.root);
        err.hidden = true;
        try {
          const { content } = await api("/api/me", { method: "PATCH", body: { name: e.target.name.value } });
          const side = document.querySelector("[data-user-name]");
          if (side) side.textContent = content.user.name;
          c.D.user.name = content.user.name;
          c.toast("Profile saved");
          await load();
        } catch (x) {
          err.textContent = x.message;
          err.hidden = false;
        }
      });
      c.$("[data-password]", c.root).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        const err = c.$("[data-err-pw]", c.root);
        err.hidden = true;
        try {
          if (f.newPassword.value.length < 8) throw new Error("Use at least 8 characters.");
          if (f.newPassword.value !== f.repeat.value) throw new Error("The two passwords don't match.");
          const r = await api("/api/me", { method: "PATCH", body: { currentPassword: f.currentPassword?.value, newPassword: f.newPassword.value } });
          f.reset();
          c.toast(r.content.signedOutOthers ? "Password updated. Other sessions were signed out" : "Password updated");
          await load();
        } catch (x) {
          err.textContent = x.message;
          err.hidden = false;
        }
      });
    };
    const resize = (file) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = cv.height = 128;
          const s = Math.max(128 / img.width, 128 / img.height);
          cv.getContext("2d").drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s);
          res(cv.toDataURL("image/jpeg", 0.86));
        };
        img.onerror = () => rej(new Error("That file isn't an image we can read."));
        img.src = URL.createObjectURL(file);
      });
    setHandlers({
      avatar: async (el) => {
        const file = el.files[0];
        if (!file) return;
        try {
          await api("/api/me", { method: "PATCH", body: { avatar: await resize(file) } });
          c.toast("Photo updated");
          location.reload();
        } catch (err) {
          c.toast(err.message);
        }
      },
      removeAvatar: async () => {
        await api("/api/me", { method: "PATCH", body: { avatar: null } });
        location.reload();
      },
      pref: async (el) => {
        try {
          await api("/api/me/prefs", { method: "PATCH", body: { [el.dataset.pref]: el.checked } });
          c.toast("Saved");
        } catch (err) {
          el.checked = !el.checked;
          c.toast(err.message);
        }
      },
      endSession: async (el) => {
        await api(`/api/me/sessions/${el.dataset.id}`, { method: "DELETE" });
        c.toast("Signed out that session");
        await load();
      },
      endOthers: async () => {
        if (!(await c.confirmModal({ title: "Sign out other sessions?", text: "Every other browser and device has to sign in again. This one stays signed in.", confirm: "Sign out others", danger: false }))) return;
        const { content } = await api("/api/me/sessions/revoke-others", { method: "POST" });
        c.toast(`Signed out ${content.signedOut} session${content.signedOut === 1 ? "" : "s"}`);
        await load();
      },
      deleteAccount: async () => {
        if (!(await c.confirmModal({ title: "Delete your account?", text: "This permanently deletes your profile, API keys, logs and webhooks. There is no undo.", confirm: "Delete account", typeToConfirm: "DELETE" }))) return;
        await api("/api/me/delete", { method: "POST", body: { confirm: "DELETE" } });
        location.href = "/?deleted=1";
      },
      retry: load,
    });
    c.root.innerHTML = h.skeleton(4);
    await load();
  };

  // ===== Support ==============================================================================
  S.support = async (c) => {
    const { h, esc, api } = c;
    const reqId = new URLSearchParams(location.search).get("req") ?? "";
    let data;
    const load = async () => {
      try {
        data = (await api("/api/me/support")).content;
        render();
      } catch (err) {
        c.root.innerHTML = h.error(err);
      }
    };
    const msg = (l) => `**Endpoint:** ${l.method ?? "GET"} /v1/${l.project}/${l.endpoint}\n**Request ID:** ${l.id ?? "-"}\n**Status:** ${l.status}${l.code ? ` (${l.code})` : ""}\n**Time:** ${l.at}\n**Error:** ${l.error ?? "-"}\n**Expected:** `;
    const render = () => {
      const pre = data.errors.find((l) => l.id === reqId);
      const ct = data.contacts;
      c.root.innerHTML = `<div class="grid-main">
        <section class="ds-card hero-card" aria-labelledby="ask-h"><div class="hero-left"><h2 id="ask-h">Tell us what's wrong</h2><p class="meta">Include the endpoint, the request ID and what you expected. We reply by email.</p>
          <form class="form-grid" data-support novalidate>
            <label class="field">Type<select name="type"><option value="issue">Something is broken</option><option value="request">Request a new source or field</option><option value="billing">Billing question</option><option value="other">Other</option></select></label>
            <label class="field">Request ID (optional)<input name="requestId" value="${esc(reqId)}" maxlength="64"></label>
            <label class="field">API (optional)<input name="scraper" value="${esc(pre?.project ?? "")}" placeholder="e.g. finance:binance"></label>
            <label class="field">Reply to<input name="email" type="email" value="${esc(c.D.user.email ?? "")}" required></label>
            <label class="field full">Message<textarea name="message" rows="5" required>${pre ? esc(msg(pre)) : ""}</textarea></label>
            <p class="form-error full" data-sup-err role="alert" hidden></p><div class="full"><button class="btn btn-primary">Send</button></div>
          </form></div></section>
        <aside class="stack">
          ${ct.email || ct.discord ? `<section class="ds-card"><h2>Contact</h2>${ct.email ? `<div class="secret-row"><code>${esc(ct.email)}</code>${h.copyBtn(ct.email)}</div><a class="btn btn-ghost btn-sm" href="mailto:${esc(ct.email)}">Write an email</a>` : ""}${ct.discord ? `<a class="btn btn-ghost btn-sm" href="${esc(ct.discord)}" target="_blank" rel="noopener">Open Discord</a>` : ""}</section>` : ""}
          <section class="ds-card"><h2>Answers before you ask</h2><ul class="links">
            <li><a href="/docs/errors">Error codes<small>What every status and code means</small></a></li>
            <li><a href="/docs/quickstart">Quickstart<small>Your first call in a minute</small></a></li>
            <li><a href="/docs/bulk">Bulk guide<small>One endpoint over many inputs</small></a></li>
            <li><a href="/docs/webhooks">Webhooks and signatures<small>Verify X-Apizie-Signature</small></a></li>
            <li><a href="/mcp">MCP server<small>Use Apizie from Claude, ChatGPT, Cursor</small></a></li>
          </ul></section>
        </aside></div>
        <section class="ds-card" aria-labelledby="le-h"><h2 id="le-h">Paste this when you ask</h2><p class="meta">Your latest errors, ready to copy into a message.</p>
          ${data.errors.length ? h.table(["Request ID", "Endpoint", "Status", "Error", "Time", ""], data.errors.map((l) => `<tr><td><code>${esc((l.id ?? "–").slice(-12))}</code></td><td><code>${esc(l.project)}/${esc(l.endpoint)}</code></td><td>${h.status(l.status)}</td><td class="meta clip">${esc(l.error ?? "")}</td><td>${c.dt(l.at)}</td><td><button class="btn btn-ghost btn-sm" data-copy="${esc(msg(l))}">Copy</button> <button class="btn btn-ghost btn-sm" data-act="useIt" data-id="${esc(l.id ?? "")}">Use</button></td></tr>`)) : h.empty("No recent errors", "Nice. If something still looks off, describe it above.")}
        </section>`;
      c.$("[data-support]", c.root).addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = c.$("[data-sup-err]", c.root);
        err.hidden = true;
        try {
          const body = Object.fromEntries(new FormData(e.target));
          if (!body.message.trim()) throw new Error("Write a short description first.");
          await api("/api/report", { method: "POST", body });
          e.target.message.value = "";
          c.toast("Sent. We'll reply by email");
        } catch (x) {
          err.textContent = x.message;
          err.hidden = false;
        }
      });
    };
    setHandlers({
      useIt: (el) => {
        const l = data.errors.find((x) => (x.id ?? "") === el.dataset.id);
        const f = c.$("[data-support]", c.root);
        f.requestId.value = l.id ?? "";
        f.scraper.value = l.project;
        f.message.value = msg(l);
        f.message.focus();
      },
      retry: load,
    });
    c.root.innerHTML = h.skeleton(3);
    await load();
  };
})();
