/* Apizie admin sections: setup checks, customers, payments, payouts, sources, reports, showcase.
   Registered on window.apz.admin and rendered by the router in dash.js. */
(() => {
  const apz = window.apz;
  if (!apz) return;
  const { setHandlers, setActions } = apz;
  const A = apz.admin;
  const PAGE = 50;

  const planOptions = (cur) => ["free", "pro", "ultra", "max"].map((p) => `<option value="${p}"${p === cur ? " selected" : ""}>${p}</option>`).join("");

  // ===== Overview ===========================================================================
  A.overview = async (c) => {
    const { h, num, idr, api } = c;
    setActions(`<a class="btn btn-ghost" href="/admin/setup">Setup checks</a>`);
    c.root.innerHTML = h.skeleton(4);
    const [{ content: o }, { content: setup }] = await Promise.all([api("/api/admin/overview"), api("/api/admin/setup")]);
    const failing = setup.checks.filter((x) => x.status === "fail");
    const series = o.days.map((d) => ({ t: d.day ?? d.date ?? d.t, requests: d.requests ?? d.count ?? 0, errors: 0 }));
    c.root.innerHTML = `
      ${failing.length ? `<div class="ds-banner" role="alert"><b>${c.plural(failing.length, "setup check")} failing.</b> ${failing.map((x) => c.esc(x.label)).join(", ")}. <a href="/admin/setup">Fix them</a></div>` : ""}
      <div class="grid-4">
        ${h.stat("Users", num(o.users), Object.entries(o.byPlan).map(([p, n]) => `${num(n)} ${p}`).join(" · "))}
        ${h.stat("Revenue this month", idr(o.revenueThisMonth), "Paid invoices, VAT included")}
        ${h.stat("Waiting for review", num(o.pendingInvoices), `<a href="/admin/invoices">Open invoices</a>`)}
        ${h.stat("Open reports", num(o.openReports), `<a href="/admin/reports">Open reports</a>`)}
      </div>
      <section class="ds-card"><div class="card-top"><h2>Requests, last 30 days</h2><span class="meta">${num(o.requests)} all time</span></div>${series.some((p) => p.requests) ? c.lineChart(series) : h.empty("No traffic yet", "Requests from every customer show up here.")}</section>
      <section class="ds-card"><h2>Catalog</h2><div class="grid-4">${Object.entries(o.catalog)
        .filter(([, v]) => typeof v === "number")
        .slice(0, 8)
        .map(([k, v]) => `<div class="kv"><span>${c.esc(k.replace(/([A-Z])/g, " $1").toLowerCase())}</span><b>${num(v)}</b></div>`)
        .join("")}</div></section>`;
    setHandlers({});
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
    let q = "";
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
    c.root.innerHTML = `<div class="filterbar"><label class="search-box"><span class="visually-hidden">Search customers</span><input type="search" placeholder="Search email or name" data-input="search" aria-label="Search customers"></label></div><div data-list></div>`;
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
      const what = (i) => (i.type === "topup" ? `Top-up ${idr(i.subtotal)}` : `${c.cap(i.plan)} × ${i.months} mo`);
      $list.innerHTML = list.length
        ? h.table(
            ["Invoice", "Customer", "For", "Amount", "Status", ""],
            list.map(
              (i) => `<tr>
                <td><b>${esc(i.id)}</b><br><span class="muted-sm">${dt(i.createdAt)}</span></td>
                <td>${esc(i.email ?? i.userId)}</td>
                <td>${what(i)}</td>
                <td class="num"><b>${idr(i.amount)}</b><br><span class="muted-sm">${idr(i.subtotal ?? i.base)} + VAT ${idr(i.vat ?? 0)} + code ${i.uniqueCode ?? 0}</span></td>
                <td>${h.badge(i.status)}${i.reference ? `<br><span class="muted-sm">Ref: ${esc(i.reference)}</span>` : ""}</td>
                <td>${["pending", "awaiting_review"].includes(i.status) ? `<div class="ds-row"><button class="btn btn-primary btn-sm" data-act="approve" data-id="${esc(i.id)}">Mark paid</button><button class="btn btn-danger-ghost btn-sm" data-act="reject" data-id="${esc(i.id)}">Reject</button></div>` : ""}</td>
              </tr>`
            )
          )
        : h.empty(filter === "awaiting_review" ? "Nothing to review" : "No invoices here", "Customers confirm their transfer and the invoice lands in this list.");
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
    c.root.innerHTML = `<div class="filterbar" data-bar></div><p class="muted-sm">Check your bank statement for the exact amount (the last digits are the unique code), then mark the invoice paid. Plans activate and top-ups are credited immediately.</p><div data-list></div>`;
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
        const ok = await c.confirmModal({ title: `Mark ${esc(i.id)} paid?`, text: `Only do this after ${idr(i.amount)} reached your account. ${i.type === "topup" ? `${idr(i.subtotal)} is added to the customer's balance.` : `The ${esc(i.plan)} plan is activated for ${i.months} month${i.months > 1 ? "s" : ""}.`}`, confirm: "Mark paid", danger: false });
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
                <td class="num"><b>${idr(p.amount)}</b></td>
                <td>${h.badge(p.status)}${p.reference ? `<br><span class="muted-sm">Ref: ${esc(p.reference)}</span>` : ""}</td>
                <td>${p.status === "requested" ? `<div class="ds-row"><button class="btn btn-primary btn-sm" data-act="paid" data-id="${esc(p.id)}">Mark sent</button><button class="btn btn-danger-ghost btn-sm" data-act="reject" data-id="${esc(p.id)}">Return</button></div>` : ""}</td>
              </tr>`
            )
          )
        : h.empty("No payout requests", "Affiliates can request a payout once they have Rp100.000 available.");
    };
    const act = (kind) => async (el) => {
      const id = el.dataset.id;
      const p = all.find((x) => x.id === id);
      const ok = await c.openModal({
        title: kind === "paid" ? `Mark ${esc(id)} sent` : `Return ${esc(id)}`,
        body:
          kind === "paid"
            ? `<p class="modal-text">Transfer ${idr(p.amount)} to <b>${esc(p.account)}</b> first.</p><label class="field">Transfer reference<input name="v" maxlength="200" required autofocus></label>`
            : `<p class="modal-text">${idr(p.amount)} goes back to the affiliate's available earnings.</p><label class="field">Reason<textarea name="v" rows="3" maxlength="200"></textarea></label>`,
        submit: kind === "paid" ? "Mark sent" : "Return payout",
        danger: kind !== "paid",
        onSubmit: async (f) => {
          if (kind === "paid" && !f.v.value.trim()) throw new Error("Add the transfer reference so the affiliate can trace it.");
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
          <td><span class="src-cell">${s.iconUrl ? `<img src="${esc(s.iconUrl)}" alt="" width="24" height="24" loading="lazy" referrerpolicy="no-referrer">` : '<span class="src-ph" aria-hidden="true"></span>'}<span><b>${esc(s.displayName)}</b><br><span class="muted-sm">${esc(s.key)}</span></span></span></td>
          <td>${h.badge(s.status)}</td>
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
    c.root.innerHTML = `<div class="filterbar"><label class="search-box"><span class="visually-hidden">Search sources</span><input type="search" placeholder="Search sources" data-input="search" aria-label="Search sources"></label><div data-seg>${h.seg("only", [["all", "All"], ["live", "Live"], ["beta", "Beta"], ["off", "Disabled"]], only)}</div></div><div data-list></div>`;
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
        $seg.innerHTML = h.seg("only", [["all", "All"], ["live", "Live"], ["beta", "Beta"], ["off", "Disabled"]], only);
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
