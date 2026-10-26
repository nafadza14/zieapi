/* zieapi dashboard + admin (client-rendered) */
(() => {
  const { $, $$, esc, toast, api } = window.zie;
  const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
  const idr = (n) => "Rp" + Number(n ?? 0).toLocaleString("id-ID");
  const ago = (iso) => {
    if (!iso) return "never";
    const s = (Date.now() - Date.parse(iso)) / 1000;
    return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
  };
  const date = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
  const badge = (s) => `<span class="badge badge-${esc(s)}">${esc(String(s).replace(/_/g, " "))}</span>`;
  const bar = (used, limit) => `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${used}"><i style="width:${Math.min(100, (used / Math.max(1, limit)) * 100).toFixed(1)}%"></i></div>`;
  const chart = (days) => {
    const max = Math.max(1, ...days.map((d) => d.requests));
    return `<div class="chart" role="img" aria-label="Requests per day">${days.map((d) => `<div style="height:${Math.max(2, (d.requests / max) * 100)}%" data-tip="${d.date}: ${fmt(d.requests)}"></div>`).join("")}</div><div class="chart-axis"><span>${days[0]?.date ?? ""}</span><span>${days.at(-1)?.date ?? ""}</span></div>`;
  };
  const table = (head, rows, empty = "Nothing here yet.") => (rows.length ? `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : `<div class="card empty"><p>${empty}</p></div>`);
  const secretBox = (key) => `<div class="secret"><code style="background:none;border:0">${esc(key)}</code><button class="pill pill-white pill-sm" data-copy="${esc(key)}">Copy</button></div><p class="small muted">Copy it now. For your security we only store a hash and can't show it again.</p>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (b) navigator.clipboard?.writeText(b.dataset.copy).then(() => toast("Copied"));
  });

  const root = $("[data-dash]") || $("[data-admin]");
  if (!root) return;
  const D = JSON.parse($("#dash-data")?.textContent ?? "{}");
  const set = (html) => (root.innerHTML = html);
  const fail = (e) => set(`<div class="card"><p class="form-error">${esc(e.message)}</p></div>`);

  // ======================= DASHBOARD =======================
  const dash = {
    async overview() {
      const { content: o } = await api("/api/me/overview");
      const u = o.usage;
      set(`<div class="dash-head"><h1>Overview</h1><a class="pill pill-white pill-sm" href="/scrapers">Browse scrapers</a></div>
        ${o.keys.length ? "" : `<div class="notice">You don't have an API key yet. <a href="/dashboard/keys">Create your first key →</a></div>`}
        <div class="grid-3">
          <div class="card metric"><span>This month</span><b>${fmt(u.month.used)} <small class="muted" style="font-size:15px">/ ${fmt(u.month.limit)}</small></b>${bar(u.month.used, u.month.limit)}<span>Resets in ${Math.ceil(u.month.resetsInSec / 86400)} days</span></div>
          <div class="card metric"><span>This minute</span><b>${fmt(u.minute.used)} <small class="muted" style="font-size:15px">/ ${fmt(u.minute.limit)}</small></b>${bar(u.minute.used, u.minute.limit)}<span>Per-minute limit</span></div>
          <div class="card metric"><span>Plan</span><b style="text-transform:capitalize">${esc(o.plan.id)}</b><span>${o.planExpiresAt && o.plan.id !== "free" ? `Renews / expires ${date(o.planExpiresAt)}` : "Free forever"}</span><a class="small" href="/dashboard/billing">Upgrade →</a></div>
        </div>
        <div class="card"><h3>Requests, last 14 days</h3>${chart(o.days)}</div>
        <div class="grid-2">
          <div class="card"><h3>Top scrapers this month</h3>${o.top.length ? `<ul class="checks">${o.top.map((t) => `<li><a href="/api/${esc(t.project.replace(":", "/"))}">${esc(t.project)}</a>: ${fmt(t.requests)}</li>`).join("")}</ul>` : '<p class="muted">No calls yet.</p>'}</div>
          <div class="card"><h3>Recent requests</h3>${o.recent.length ? `<ul class="checks">${o.recent.map((l) => `<li>${badge(l.status)} ${esc(l.project)}/${esc(l.endpoint)} <span class="muted small">${ago(l.at)}</span></li>`).join("")}</ul>` : '<p class="muted">No calls yet.</p>'}<a class="small" href="/dashboard/logs">All logs →</a></div>
        </div>
        <div class="card"><h3>Quick start</h3><pre class="out">curl "${esc(D.apiUrl)}/v1/indonesia:bmkg/gempa-terkini" \\\n  -H "x-api-key: ${o.keys[0] ? esc(o.keys[0].preview) : "zie_…"}"</pre></div>`);
    },

    async keys() {
      const { content: keys } = await api("/api/me/keys");
      const { content: me } = await api("/api/me");
      const canIp = me.plan.webhooks;
      set(`<div class="dash-head"><h1>API keys</h1></div>
        <form class="card inline-form" data-new-key><input name="name" placeholder="Key name, e.g. production" maxlength="60" aria-label="Key name"><button class="pill pill-white">Create key</button></form>
        <div data-new-secret></div>
        ${table(["Name", "Key", "Status", "Last used", "Created", ""], keys.map((k) => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.preview)}</code>${k.ipAllowlist?.length ? `<div class="small muted">IPs: ${esc(k.ipAllowlist.join(", "))}</div>` : ""}</td><td>${badge(k.status)}</td><td>${ago(k.lastUsedAt)}</td><td>${date(k.createdAt)}</td><td><div class="row-actions"><button class="pill pill-outline pill-sm" data-act="rename" data-id="${k.id}">Rename</button><button class="pill pill-outline pill-sm" data-act="${k.status === "active" ? "disable" : "enable"}" data-id="${k.id}">${k.status === "active" ? "Disable" : "Enable"}</button>${canIp ? `<button class="pill pill-outline pill-sm" data-act="ip" data-id="${k.id}">IP allowlist</button>` : ""}<button class="pill pill-danger pill-sm" data-act="delete" data-id="${k.id}">Delete</button></div></td></tr>`), "No keys yet. Create one above.")}
        <p class="small muted">Send the key as <code>x-api-key</code>, <code>Authorization: Bearer</code> or <code>api-key</code>. ${canIp ? "" : "IP allowlists are available on Pro and above."}</p>`);
      $("[data-new-key]").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const r = await api("/api/me/keys", { method: "POST", body: { name: e.target.name.value || "New key" } });
          await dash.keys();
          $("[data-new-secret]").innerHTML = secretBox(r.content.key);
        } catch (err) { toast(err.message); }
      });
      root.onclick = async (e) => {
        const b = e.target.closest("[data-act]");
        if (!b) return;
        const id = b.dataset.id;
        try {
          if (b.dataset.act === "delete") { if (!confirm("Delete this key? Apps using it will stop working.")) return; await api(`/api/me/keys/${id}`, { method: "DELETE" }); }
          if (b.dataset.act === "disable" || b.dataset.act === "enable") await api(`/api/me/keys/${id}`, { method: "PATCH", body: { status: b.dataset.act === "disable" ? "disabled" : "active" } });
          if (b.dataset.act === "rename") { const n = prompt("New name"); if (!n) return; await api(`/api/me/keys/${id}`, { method: "PATCH", body: { name: n } }); }
          if (b.dataset.act === "ip") { const v = prompt("Allowed IPs (comma separated, empty = any)"); if (v === null) return; await api(`/api/me/keys/${id}`, { method: "PATCH", body: { ipAllowlist: v } }); }
          root.onclick = null;
          await dash.keys();
        } catch (err) { toast(err.message); }
      };
    },

    async usage() {
      const { content: u } = await api("/api/me/usage");
      set(`<div class="dash-head"><h1>Usage</h1></div>
        <div class="grid-2"><div class="card metric"><span>Month</span><b>${fmt(u.month.used)} / ${fmt(u.month.limit)}</b>${bar(u.month.used, u.month.limit)}<span>${fmt(u.month.remaining)} left · resets in ${Math.ceil(u.month.resetsInSec / 86400)} days (1st, UTC)</span></div>
        <div class="card metric"><span>Minute</span><b>${fmt(u.minute.used)} / ${fmt(u.minute.limit)}</b>${bar(u.minute.used, u.minute.limit)}<span>Server errors (5xx) are never counted.</span></div></div>
        <div class="card"><h3>Requests per day (30 days)</h3>${chart(u.days)}</div>
        <div class="card"><h3>By scraper this month</h3>${table(["Scraper", "Requests"], u.scrapers.map((s) => `<tr><td><a href="/api/${esc(s.project.replace(":", "/"))}">${esc(s.project)}</a></td><td>${fmt(s.requests)}</td></tr>`), "No requests this month.")}</div>`);
    },

    async logs(offset = 0) {
      const { content: l } = await api(`/api/me/logs?limit=50&offset=${offset}`);
      set(`<div class="dash-head"><h1>Request logs</h1><span class="muted small">Kept ${l.retentionDays} days on your plan</span></div>
        ${table(["Time", "Endpoint", "Status", "Latency", "Source", "Key", "IP"], l.items.map((x) => `<tr><td>${date(x.at)}</td><td><code>${esc(x.project)}/${esc(x.endpoint)}</code></td><td>${badge(x.status)}</td><td>${x.ms} ms</td><td>${esc(x.source)}</td><td><code>${esc(x.key ?? "")}</code></td><td>${esc(x.ip ?? "")}</td></tr>`), "No requests logged yet.")}
        <div class="row-actions">${offset ? '<button class="pill pill-outline pill-sm" data-page="-50">← Newer</button>' : ""}${l.items.length === 50 ? '<button class="pill pill-outline pill-sm" data-page="50">Older →</button>' : ""}</div>`);
      $$("[data-page]").forEach((b) => b.addEventListener("click", () => dash.logs(Math.max(0, offset + Number(b.dataset.page)))));
    },

    async bulk() {
      const { content: jobs } = await api("/api/me/bulk");
      set(`<div class="dash-head"><h1>Bulk jobs</h1><a class="pill pill-outline pill-sm" href="/docs/bulk">How bulk works</a></div>
        ${table(["Job", "Endpoint", "Status", "Items", "Created"], jobs.map((j) => `<tr><td><button class="pill pill-outline pill-sm" data-job="${esc(j.jobId)}">${esc(j.jobId.slice(-8))}</button></td><td><code>${esc(j.scraperSlug)}/${esc(j.endpointSlug)}</code></td><td>${badge(j.status)}</td><td>${j.succeeded}/${j.total}${j.failed ? ` · ${j.failed} failed` : ""}</td><td>${date(j.createdAt)}</td></tr>`), "No bulk jobs yet. Bulk is available on Ultra and Max.")}
        <pre class="out" data-job-out hidden></pre>`);
      $$("[data-job]").forEach((b) => b.addEventListener("click", async () => {
        const { content } = await api(`/api/me/bulk/${b.dataset.job}`);
        const out = $("[data-job-out]");
        out.hidden = false;
        out.textContent = JSON.stringify(content, null, 2);
      }));
    },

    async webhooks() {
      const { content: w } = await api("/api/me/webhooks");
      if (!w.enabled) return set(`<div class="dash-head"><h1>Webhooks</h1></div><div class="card"><p>Webhooks are available on Pro and above.</p><a class="pill pill-white pill-sm" href="/dashboard/billing?plan=pro" style="margin-top:12px">Upgrade</a></div>`);
      const rows = w.hooks.length ? w.hooks : [];
      const evOpts = (sel = ["*"]) => ["*", ...w.events].map((e) => `<label style="display:inline-flex;gap:6px;align-items:center;margin-right:12px"><input type="checkbox" value="${e}" ${sel.includes(e) ? "checked" : ""} style="width:auto"> ${e === "*" ? "all events" : e}</label>`).join("");
      set(`<div class="dash-head"><h1>Webhooks</h1><button class="pill pill-outline pill-sm" data-test>Send test event</button></div>
        <form data-hooks class="grid-1" style="display:grid;gap:14px">
          ${[...rows, { url: "", events: ["*"] }].map((h, i) => `<div class="card" data-hook><label class="small muted">Endpoint URL<input name="url" value="${esc(h.url)}" placeholder="https://example.com/zieapi-webhook"></label><div class="small" style="margin-top:10px">${evOpts(h.events)}</div>${h.secretPreview ? `<p class="small muted">Secret: <code>${esc(h.secretPreview)}</code></p>` : ""}</div>`).join("")}
          <button class="pill pill-white">Save webhooks</button>
        </form><div data-secrets></div>
        <p class="small muted">Deliveries are signed with <code>X-Zie-Signature: sha256=…</code> (HMAC of the raw body). <a href="/docs/webhooks">Verify signatures</a>.</p>`);
      $("[data-hooks]").addEventListener("submit", async (e) => {
        e.preventDefault();
        const hooks = $$("[data-hook]").map((c) => ({ url: $("input[name=url]", c).value.trim(), events: $$("input[type=checkbox]:checked", c).map((x) => x.value) })).filter((h) => h.url);
        try {
          const r = await api("/api/me/webhooks", { method: "PUT", body: { webhooks: hooks } });
          await dash.webhooks();
          const fresh = r.content.filter((h) => !rows.some((x) => x.id === h.id));
          if (fresh.length) $("[data-secrets]").innerHTML = `<div class="card"><h3>New signing secrets</h3>${fresh.map((h) => `<p class="small">${esc(h.url)}</p>${secretBox(h.secret)}`).join("")}</div>`;
          toast("Saved");
        } catch (err) { toast(err.message); }
      });
      $("[data-test]").addEventListener("click", async () => {
        try {
          const r = await api("/api/me/webhooks/test", { method: "POST" });
          toast(r.content.length ? r.content.map((x) => `${x.ok ? "✓" : "✗"} ${x.status}`).join("  ") : "No webhooks saved");
        } catch (err) { toast(err.message); }
      });
    },

    async billing() {
      const { content: b } = await api("/api/me/billing");
      const want = new URLSearchParams(location.search).get("plan");
      set(`<div class="dash-head"><h1>Billing</h1></div>
        <div class="card metric"><span>Current plan</span><b style="text-transform:capitalize">${esc(b.plan.id)}</b><span>${b.planExpiresAt && b.plan.id !== "free" ? `Active until ${date(b.planExpiresAt)}` : "Free plan, no expiry"}</span></div>
        <div class="card"><h3>Upgrade or renew</h3><form class="inline-form" data-checkout>
          <select name="plan" aria-label="Plan">${b.plans.filter((p) => p.id !== "free").map((p) => `<option value="${p.id}"${p.id === want ? " selected" : ""}>${p.id[0].toUpperCase() + p.id.slice(1)}: ${idr(p.priceIdr)}/month · ${fmt(p.monthly)} req</option>`).join("")}</select>
          <select name="months" aria-label="Months">${[1, 3, 6, 12].map((m) => `<option value="${m}">${m} month${m > 1 ? "s" : ""}</option>`).join("")}</select>
          <button class="pill pill-white">Create invoice</button></form>
          <p class="small muted" style="margin-top:12px">Pay by bank transfer to the account below, using the exact amount (it includes a 3-digit code so we can match your payment). Then submit your transfer reference.</p>
          <div class="card" style="margin-top:10px"><div class="bank">${esc(b.bank)}</div></div></div>
        <h3 style="margin:10px 0 0">Invoices</h3>
        ${table(["Invoice", "Plan", "Amount", "Status", "Created", ""], b.invoices.map((i) => `<tr><td><code>${esc(i.id)}</code></td><td style="text-transform:capitalize">${esc(i.plan)} · ${i.months} mo</td><td><b>${idr(i.amount)}</b></td><td>${badge(i.status)}${i.reference ? `<div class="small muted">Ref: ${esc(i.reference)}</div>` : ""}</td><td>${date(i.createdAt)}</td><td>${i.status === "pending" ? `<div class="row-actions"><button class="pill pill-white pill-sm" data-confirm="${esc(i.id)}">I've paid</button><button class="pill pill-outline pill-sm" data-cancel="${esc(i.id)}">Cancel</button></div>` : ""}</td></tr>`), "No invoices yet.")}`);
      $("[data-checkout]").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await api("/api/me/invoices", { method: "POST", body: { plan: e.target.plan.value, months: Number(e.target.months.value) } });
          history.replaceState(null, "", "/dashboard/billing");
          await dash.billing();
          toast("Invoice created. Transfer the exact amount");
        } catch (err) { toast(err.message); }
      });
      $$("[data-confirm]").forEach((x) => x.addEventListener("click", async () => {
        const ref = prompt("Transfer reference or sender account name");
        if (!ref) return;
        try { await api(`/api/me/invoices/${x.dataset.confirm}/confirm`, { method: "POST", body: { reference: ref } }); await dash.billing(); toast("Thanks, we'll verify it shortly"); } catch (err) { toast(err.message); }
      }));
      $$("[data-cancel]").forEach((x) => x.addEventListener("click", async () => {
        try { await api(`/api/me/invoices/${x.dataset.cancel}/cancel`, { method: "POST" }); await dash.billing(); } catch (err) { toast(err.message); }
      }));
    },

    async settings() {
      const { content: me } = await api("/api/me");
      set(`<div class="dash-head"><h1>Settings</h1></div>
        <form class="card form" data-profile><label>Name<input name="name" value="${esc(me.user.name)}" maxlength="60"></label><label>Email<input value="${esc(me.user.email ?? "")}" disabled></label><button class="pill pill-white">Save profile</button></form>
        <form class="card form" data-password><h3 class="full" style="margin:0">${me.user.hasPassword ? "Change password" : "Set a password"}</h3>${me.user.hasPassword ? '<label>Current password<input type="password" name="currentPassword" autocomplete="current-password"></label>' : ""}<label>New password<input type="password" name="newPassword" minlength="8" autocomplete="new-password" required></label><button class="pill pill-white">Update password</button></form>
        <div class="card"><h3>Connected sign-in</h3><p class="muted">${me.providers.length ? me.providers.map(esc).join(", ") : "Email & password only"}</p></div>`);
      $("[data-profile]").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("/api/me", { method: "PATCH", body: { name: e.target.name.value } }); toast("Saved"); } catch (err) { toast(err.message); } });
      $("[data-password]").addEventListener("submit", async (e) => {
        e.preventDefault();
        try { await api("/api/me", { method: "PATCH", body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast("Password updated"); } catch (err) { toast(err.message); }
      });
    },
  };

  // ======================= ADMIN =======================
  const admin = {
    async overview() {
      const { content: o } = await api("/api/admin/overview");
      set(`<div class="dash-head"><h1>Admin</h1></div>
        <div class="grid-4"><div class="card metric"><span>Users</span><b>${fmt(o.users)}</b><span>${Object.entries(o.byPlan).map(([k, v]) => `${k}: ${v}`).join(" · ")}</span></div><div class="card metric"><span>Requests (all time)</span><b>${fmt(o.requests)}</b></div><div class="card metric"><span>Invoices to review</span><b>${o.pendingInvoices}</b><a class="small" href="/admin/invoices">Review →</a></div><div class="card metric"><span>Revenue this month</span><b>${idr(o.revenueThisMonth)}</b></div></div>
        <div class="card"><h3>Requests per day (all users)</h3>${chart(o.days)}</div>
        <div class="grid-2"><div class="card metric"><span>Catalog</span><b>${fmt(o.catalog.scrapers)} scrapers</b><span>${fmt(o.catalog.liveEndpoints)} / ${fmt(o.catalog.endpoints)} endpoints live</span></div><div class="card metric"><span>Open reports</span><b>${o.openReports}</b><a class="small" href="/admin/reports">View →</a></div></div>`);
    },
    async users(q = "") {
      const { content: users } = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
      set(`<div class="dash-head"><h1>Users</h1><input data-uq placeholder="Search email or name" value="${esc(q)}" style="max-width:280px"></div>
        ${table(["User", "Plan", "Used (month)", "Role", "Status", "Joined", ""], users.map((u) => `<tr><td><b>${esc(u.name)}</b><div class="small muted">${esc(u.email ?? "")}</div></td><td>${badge(u.effectivePlan)}${u.planExpiresAt ? `<div class="small muted">until ${date(u.planExpiresAt)}</div>` : ""}</td><td>${fmt(u.usedThisMonth)}</td><td>${esc(u.role)}</td><td>${badge(u.status)}</td><td>${date(u.createdAt)}</td><td><div class="row-actions"><select data-plan="${u.id}" aria-label="Set plan" style="width:auto;padding:6px 10px"><option value="">Set plan…</option>${["free", "pro", "ultra", "max"].map((p) => `<option>${p}</option>`).join("")}</select><button class="pill pill-outline pill-sm" data-ustatus="${u.id}" data-to="${u.status === "active" ? "suspended" : "active"}">${u.status === "active" ? "Suspend" : "Restore"}</button><button class="pill pill-outline pill-sm" data-urole="${u.id}" data-to="${u.role === "admin" ? "user" : "admin"}">${u.role === "admin" ? "Revoke admin" : "Make admin"}</button></div></td></tr>`))}`);
      $("[data-uq]").addEventListener("change", (e) => admin.users(e.target.value));
      $$("[data-plan]").forEach((s) => s.addEventListener("change", async () => { if (!s.value) return; const days = s.value === "free" ? 0 : Number(prompt("Days of access", "30")) || 30; await api(`/api/admin/users/${s.dataset.plan}`, { method: "PATCH", body: { plan: s.value, days } }); toast("Plan updated"); admin.users(q); }));
      $$("[data-ustatus]").forEach((b) => b.addEventListener("click", async () => { await api(`/api/admin/users/${b.dataset.ustatus}`, { method: "PATCH", body: { status: b.dataset.to } }); admin.users(q); }));
      $$("[data-urole]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Change role?")) return; await api(`/api/admin/users/${b.dataset.urole}`, { method: "PATCH", body: { role: b.dataset.to } }); admin.users(q); }));
    },
    async invoices() {
      const { content: inv } = await api("/api/admin/invoices");
      set(`<div class="dash-head"><h1>Invoices</h1></div>${table(["Invoice", "Customer", "Plan", "Amount", "Status", "Created", ""], inv.map((i) => `<tr><td><code>${esc(i.id)}</code></td><td>${esc(i.email ?? i.userId)}</td><td>${esc(i.plan)} · ${i.months} mo</td><td><b>${idr(i.amount)}</b><div class="small muted">code ${i.uniqueCode}</div></td><td>${badge(i.status)}${i.reference ? `<div class="small muted">Ref: ${esc(i.reference)}</div>` : ""}</td><td>${date(i.createdAt)}</td><td>${["pending", "awaiting_review"].includes(i.status) ? `<div class="row-actions"><button class="pill pill-white pill-sm" data-approve="${esc(i.id)}">Approve</button><button class="pill pill-danger pill-sm" data-reject="${esc(i.id)}">Reject</button></div>` : ""}</td></tr>`))}`);
      $$("[data-approve]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Mark as paid and activate the plan?")) return; await api(`/api/admin/invoices/${b.dataset.approve}/approve`, { method: "POST" }); toast("Activated"); admin.invoices(); }));
      $$("[data-reject]").forEach((b) => b.addEventListener("click", async () => { const note = prompt("Reason (optional)") ?? ""; await api(`/api/admin/invoices/${b.dataset.reject}/reject`, { method: "POST", body: { note } }); admin.invoices(); }));
    },
    async scrapers() {
      const { content: list } = await api("/api/admin/scrapers");
      set(`<div class="dash-head"><h1>Scrapers</h1><div class="row-actions"><input data-sq placeholder="Filter" style="max-width:220px"><label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-nologo style="width:auto"> no logo only</label></div></div><input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/x-icon" data-file hidden><div data-stable></div>`);
      const mono = (s) => esc(s.displayName.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase());
      const draw = () => {
        const f = $("[data-sq]").value.toLowerCase();
        const only = $("[data-nologo]").checked;
        $("[data-stable]").innerHTML = table(["Logo", "Scraper", "Status", "Live / total", "Requests", "Success", ""], list.filter((s) => (!f || s.key.includes(f) || s.displayName.toLowerCase().includes(f)) && (!only || !s.iconUrl)).map((s) => `<tr><td>${s.iconUrl ? `<img class="adm-icon" src="${esc(s.iconUrl)}" alt="">` : `<span class="sc-icon" style="width:28px;height:28px;border-radius:8px;font-size:10px">${mono(s)}</span>`}</td><td><a href="/api/${esc(s.key.replace(":", "/"))}">${esc(s.displayName)}</a><div class="small muted"><code>${esc(s.key)}</code>${s.sourceUrl ? ` · <a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener nofollow">${esc(s.sourceUrl.replace("https://", ""))}</a>` : ""}</div></td><td>${badge(s.enabled ? s.status : "disabled")}</td><td>${s.live}/${s.endpoints}</td><td>${fmt(s.requests)}</td><td>${s.successRate ?? "-"}${s.successRate !== null ? "%" : ""}</td><td><div class="row-actions"><button class="pill pill-outline pill-sm" data-logo="${esc(s.key)}">Set logo</button><button class="pill pill-outline pill-sm" data-toggle="${esc(s.key)}" data-to="${!s.enabled}">${s.enabled ? "Disable" : "Enable"}</button></div></td></tr>`));
      };
      const saveIcon = async (key, url) => {
        const r = await api(`/api/admin/scrapers/${encodeURIComponent(key)}/icon`, { method: "POST", body: { url } });
        list.find((x) => x.key === key).iconUrl = r.content.iconUrl;
        draw();
        toast(url ? "Logo saved" : "Logo removed");
      };
      const fileToDataUrl = (file) => new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); const s = Math.min(128 / img.width, 128 / img.height); x.drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s); res(c.toDataURL("image/png")); };
        img.onerror = rej;
        img.src = URL.createObjectURL(file);
      });
      let pending = null;
      $("[data-file]").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file || !pending) return;
        try { await saveIcon(pending, await fileToDataUrl(file)); } catch (err) { toast(err.message || "Could not read that image"); }
      });
      draw();
      $("[data-sq]").addEventListener("input", draw);
      $("[data-nologo]").addEventListener("change", draw);
      root.addEventListener("click", async (e) => {
        const lg = e.target.closest("[data-logo]");
        if (lg) {
          const v = prompt("Paste a logo image URL (https://...). Leave empty and press OK to upload a file instead. Type 'reset' to go back to the default.");
          if (v === null) return;
          try {
            if (v.trim().toLowerCase() === "reset") return await saveIcon(lg.dataset.logo, "");
            if (v.trim()) return await saveIcon(lg.dataset.logo, v.trim());
            pending = lg.dataset.logo;
            $("[data-file]").click();
          } catch (err) { toast(err.message); }
          return;
        }
        const b = e.target.closest("[data-toggle]");
        if (!b) return;
        await api(`/api/admin/scrapers/${encodeURIComponent(b.dataset.toggle)}`, { method: "POST", body: { enabled: b.dataset.to === "true" } });
        list.find((x) => x.key === b.dataset.toggle).enabled = b.dataset.to === "true";
        draw();
      });
    },
    async reports() {
      const { content: list } = await api("/api/admin/reports");
      set(`<div class="dash-head"><h1>Reports</h1></div>${table(["When", "Type", "From", "Scraper", "Message", "Status", ""], list.map((r) => `<tr><td>${date(r.createdAt)}</td><td>${esc(r.type)}</td><td>${esc(r.email)}</td><td>${esc(r.scraper)}</td><td style="max-width:360px">${esc(r.message)}${r.requestId ? `<div class="small muted">req ${esc(r.requestId)}</div>` : ""}</td><td>${badge(r.status)}</td><td><button class="pill pill-outline pill-sm" data-rep="${esc(r.id)}" data-to="${r.status === "open" ? "closed" : "open"}">${r.status === "open" ? "Close" : "Reopen"}</button></td></tr>`))}`);
      $$("[data-rep]").forEach((b) => b.addEventListener("click", async () => { await api(`/api/admin/reports/${b.dataset.rep}`, { method: "PATCH", body: { status: b.dataset.to } }); admin.reports(); }));
    },
    async showcase() {
      const { content: list } = await api("/api/admin/showcases");
      set(`<div class="dash-head"><h1>Showcase submissions</h1></div>${table(["Project", "URL", "Description", "Status", ""], list.map((s) => `<tr><td>${esc(s.name)}</td><td><a href="${esc(s.url)}" rel="noopener nofollow" target="_blank">${esc(s.url)}</a></td><td>${esc(s.description)}</td><td>${badge(s.status)}</td><td><div class="row-actions"><button class="pill pill-white pill-sm" data-sc="${esc(s.id)}" data-to="approved">Approve</button><button class="pill pill-danger pill-sm" data-sc="${esc(s.id)}" data-to="rejected">Reject</button></div></td></tr>`))}`);
      $$("[data-sc]").forEach((b) => b.addEventListener("click", async () => { await api(`/api/admin/showcases/${b.dataset.sc}`, { method: "PATCH", body: { status: b.dataset.to } }); admin.showcase(); }));
    },
  };

  const isAdmin = root.hasAttribute("data-admin");
  const section = isAdmin ? root.dataset.admin : root.dataset.dash;
  const fn = (isAdmin ? admin : dash)[section] ?? (isAdmin ? admin.overview : dash.overview);
  fn().catch(fail);
})();
