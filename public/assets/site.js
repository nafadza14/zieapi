/* zieapi website behaviour: vanilla JS, no build step */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const toast = (msg) => {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  };
  window.zie = { $, $$, esc, store, toast, api };

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, { method, headers: { "x-zie-csrf": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = data?.errors?.[0]?.message ? `${data.errors[0].path ? data.errors[0].path + ": " : ""}${data.errors[0].message}` : data?.message ?? data?.error?.message ?? (typeof data?.error === "string" ? data.error : `Request failed (${res.status})`);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- nav ----------
  const nav = $("#nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", scrollY > 20);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    $("[data-nav-toggle]")?.addEventListener("click", (e) => {
      const open = nav.classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", String(open));
    });
  }

  // ---------- hero video: fade in once ready, skip on reduced motion ----------
  const vid = $("[data-hero-video]");
  if (vid) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) vid.remove();
    else {
      const ready = () => { vid.classList.add("ready"); vid.play().catch(() => {}); };
      if (vid.readyState >= 2) ready();
      else vid.addEventListener("loadeddata", ready, { once: true });
    }
  }

  // ---------- copy buttons ----------
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy-code]");
    if (!b) return;
    const card = b.closest(".code-card");
    const code = $$("pre", card).find((p) => !p.hidden) ?? $("pre", card);
    navigator.clipboard?.writeText(code.innerText).then(() => toast("Copied"));
  });

  // ---------- generic tabs (MCP page) ----------
  $$("[data-tabs]").forEach((box) => {
    box.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (!t) return;
      $$("[data-tab]", box).forEach((x) => x.classList.toggle("on", x === t));
      $$("[data-panel]", box).forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
    });
  });

  // ---------- code samples ----------
  function sample(lang, { api: base, key, ep, method = "GET", params = {}, pathParams = [] }) {
    let path = `/v1/${key}/${ep}`;
    const q = { ...params };
    for (const n of pathParams) if (q[n] !== undefined) { path += "/" + encodeURIComponent(q[n]); delete q[n]; }
    const qs = new URLSearchParams(q).toString();
    const url = `${base}${path}${method === "GET" && qs ? "?" + qs : ""}`;
    const bodyJson = JSON.stringify(q);
    if (lang === "cURL") return method === "GET" ? `curl "${url}" \\\n  -H "x-api-key: $ZIE_KEY"` : `curl -X POST "${url}" \\\n  -H "x-api-key: $ZIE_KEY" \\\n  -H "content-type: application/json" \\\n  -d '${bodyJson}'`;
    if (lang === "JavaScript") return method === "GET" ? `const res = await fetch("${url}", {\n  headers: { "x-api-key": process.env.ZIE_KEY },\n});\nconst { data } = await res.json();\nconsole.log(data);` : `const res = await fetch("${url}", {\n  method: "POST",\n  headers: { "x-api-key": process.env.ZIE_KEY, "content-type": "application/json" },\n  body: JSON.stringify(${bodyJson}),\n});\nconst { data } = await res.json();`;
    if (lang === "Python") return method === "GET" ? `import os, requests\n\nr = requests.get(\n    "${base}${path}",\n    params=${JSON.stringify(q)},\n    headers={"x-api-key": os.environ["ZIE_KEY"]},\n)\nprint(r.json()["data"])` : `import os, requests\n\nr = requests.post(\n    "${base}${path}",\n    json=${bodyJson},\n    headers={"x-api-key": os.environ["ZIE_KEY"]},\n)\nprint(r.json()["data"])`;
    if (lang === "Go") return `req, _ := http.NewRequest("${method}", "${url}", ${method === "GET" ? "nil" : `strings.NewReader(\`${bodyJson}\`)`})\nreq.Header.Set("x-api-key", os.Getenv("ZIE_KEY"))${method === "GET" ? "" : '\nreq.Header.Set("content-type", "application/json")'}\nres, err := http.DefaultClient.Do(req)\nif err != nil { log.Fatal(err) }\ndefer res.Body.Close()\nbody, _ := io.ReadAll(res.Body)\nfmt.Println(string(body))`;
    if (lang === "MCP") return `// Ask your agent, or call the tool directly:\n{\n  "name": "run_scraper",\n  "arguments": {\n    "scraper": "${key}",\n    "endpoint": "${ep}",\n    "params": ${JSON.stringify({ ...params })}\n  }\n}`;
    return "";
  }

  // home "change one word" card
  const card = $("[data-codecard]");
  if (card) {
    let cur = JSON.parse($(".swap.on")?.dataset.swap ?? "{}");
    let lang = "cURL";
    const render = () => {
      const params = Object.fromEntries(new URLSearchParams(cur.qs || ""));
      $("[data-code]", card).textContent = sample(lang, { api: card.dataset.api, key: cur.key, ep: cur.ep, params });
    };
    $$(".swap").forEach((b) => b.addEventListener("click", () => {
      $$(".swap").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); });
      cur = JSON.parse(b.dataset.swap);
      render();
    }));
    $$(".code-tabs [data-lang]", card).forEach((b) => b.addEventListener("click", () => {
      $$(".code-tabs [data-lang]", card).forEach((x) => x.classList.toggle("on", x === b));
      lang = b.dataset.lang;
      render();
    }));
    render();
  }

  // ---------- catalog ----------
  const cat = $("[data-catalog]");
  if (cat) {
    const { items, initialCat } = JSON.parse($("#catalog-data").textContent);
    const grid = $("[data-grid]");
    let state = { q: $("[data-q]").value.toLowerCase(), cat: initialCat || "", filter: "", sort: "popular", shown: 18 };
    const badge = (s) => ({ live: "Live", upstream: "Upstream", planned: "Planned", disabled: "Off" })[s] ?? "";
    const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));
    const cardHtml = (s) => `<a class="card scraper-card" href="/api/${esc(s.category)}/${esc(s.slug)}"><div class="sc-top"><span class="sc-icon" style="--c:#8b8ba7">${esc(s.displayName.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?")}</span><span class="badge badge-${esc(s.status)}">${badge(s.status)}</span></div><h3>${esc(s.displayName)}</h3><p class="sc-key">${esc(s.category)}:${esc(s.slug)}</p><div class="sc-meta"><span>${s.endpointCount} endpoint${s.endpointCount === 1 ? "" : "s"}</span>${s.totalRequests ? `<span>${fmt(s.totalRequests)} calls</span>` : ""}${s.hasBulk ? "<span>Bulk</span>" : ""}</div></a>`;
    const colors = Object.fromEntries($$(".cat-item[data-cat]").map((b) => [b.dataset.cat, getComputedStyle(b).getPropertyValue("--c")]));
    const render = () => {
      let rows = items.filter((s) => {
        if (state.cat && s.category !== state.cat) return false;
        if (state.filter === "live" && s.status !== "live") return false;
        if (state.filter === "bulk" && !s.hasBulk) return false;
        if (state.filter === "indonesian" && !s.indonesian) return false;
        if (state.q && !`${s.key} ${s.displayName} ${(s.tags || []).join(" ")} ${s.description ?? ""}`.toLowerCase().includes(state.q)) return false;
        return true;
      });
      if (state.sort === "name") rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
      else if (state.sort === "endpoints") rows.sort((a, b) => b.endpointCount - a.endpointCount);
      grid.innerHTML = rows.slice(0, state.shown).map(cardHtml).join("") || '<div class="card empty"><h3>No scrapers match.</h3><p>Try another word, or <a href="/report?type=request">request a source</a>.</p></div>';
      $$(".sc-icon", grid).forEach((el, i) => { const c = colors[rows[i]?.category]; if (c) el.style.setProperty("--c", c); });
      $("[data-count]").textContent = `${rows.length} scraper${rows.length === 1 ? "" : "s"}`;
      $("[data-more]").hidden = rows.length <= state.shown;
      $$("[data-cat]").forEach((b) => b.classList.toggle("on", b.dataset.cat === state.cat));
      const u = new URL(location.href);
      state.q ? u.searchParams.set("q", state.q) : u.searchParams.delete("q");
      state.cat ? u.searchParams.set("cat", state.cat) : u.searchParams.delete("cat");
      history.replaceState(null, "", u);
    };
    $("[data-q]").addEventListener("input", (e) => { state.q = e.target.value.toLowerCase().trim(); state.shown = 18; render(); });
    $("[data-sort]").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
    $$("[data-cat]").forEach((b) => b.addEventListener("click", () => { state.cat = b.dataset.cat; state.shown = 18; render(); }));
    $$("[data-filter]").forEach((b) => b.addEventListener("click", () => { $$("[data-filter]").forEach((x) => x.classList.toggle("on", x === b)); state.filter = b.dataset.filter; render(); }));
    $("[data-more]").addEventListener("click", () => { state.shown += 18; render(); });
    addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("[data-q]").focus(); } });
    render();
  }

  // ---------- scraper detail ----------
  const detail = $("[data-detail]");
  if (detail) {
    const D = JSON.parse($("#detail-data").textContent);
    const main = $("[data-ep-main]");
    let lang = "cURL";
    const draw = (slug) => {
      const ep = D.endpoints.find((e) => e.slug === slug) ?? D.endpoints[0];
      D.current = ep.slug;
      $$("[data-ep]").forEach((a) => a.classList.toggle("on", a.dataset.ep === ep.slug));
      $("[data-ep-select]").value = ep.slug;
      const pathParams = ep.fields.filter((f) => f.in === "path").map((f) => f.name);
      const path = `/v1/${D.scraper.key}/${ep.slug}${ep.pathTemplate ? "/" + ep.pathTemplate : ""}`;
      const ex = Object.fromEntries(ep.fields.filter((f) => f.example !== undefined || f.required).map((f) => [f.name, f.example ?? (f.enum ? f.enum[0] : f.type === "string" ? "…" : 1)]));
      const notLive = ep.status !== "live" && ep.status !== "upstream";
      main.innerHTML = `
        <div class="ep-title"><span class="m m-${ep.method.toLowerCase()}">${ep.method}</span><h2>${esc(ep.displayName)}</h2><span class="badge badge-${ep.status}">${ep.status}</span>${ep.minPlan ? `<span class="badge badge-plan">${esc(ep.minPlan)}+</span>` : ""}${ep.bulkEnabled ? '<span class="badge">bulk</span>' : ""}</div>
        ${ep.description ? `<p class="muted" style="margin:0">${esc(ep.description)}</p>` : ""}
        <div class="ep-path">${esc(D.apiUrl)}${esc(path)}</div>
        ${notLive ? '<p class="notice">This endpoint is in the catalog but not live on this server yet. Calls return 501 until it is implemented or an upstream is configured.</p>' : ""}
        <section><h3>Parameters</h3>${ep.fields.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>In</th><th>Description</th></tr></thead><tbody>${ep.fields.map((f) => `<tr><td><code>${esc(f.name)}</code>${f.required ? ' <span class="badge badge-pending">required</span>' : ""}</td><td>${esc(f.type)}${f.enum ? `<div class="small muted">${f.enum.map(esc).join(" · ")}</div>` : ""}</td><td>${esc(f.in)}</td><td class="muted">${esc(f.description ?? "")}${f.default !== undefined ? ` <span class="small">Default <code>${esc(JSON.stringify(f.default))}</code></span>` : ""}${f.min !== undefined || f.max !== undefined ? ` <span class="small">Range ${f.min ?? "…"}–${f.max ?? "…"}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">No parameters.</p>'}</section>
        <section class="card try"><h3 style="margin:0">Try it</h3>
          <div class="try-fields">${ep.fields.map((f) => `<label><span><b>${esc(f.name)}</b>${f.required ? " *" : " · optional"}</span>${f.enum ? `<select data-p="${esc(f.name)}">${f.required ? "" : '<option value=""></option>'}${f.enum.map((v) => `<option${v === f.default ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>` : f.type === "boolean" ? `<select data-p="${esc(f.name)}"><option value=""></option><option>true</option><option>false</option></select>` : `<input data-p="${esc(f.name)}" placeholder="${esc(f.example ?? f.default ?? "")}" value="${esc(f.example ?? "")}">`}</label>`).join("")}</div>
          <div class="row">${D.loggedIn ? '<span class="small muted">Runs with your account (counts against your quota).</span>' : `<input type="password" data-key placeholder="Your API key (zie_…)" style="max-width:320px" value="${esc(store.get("zie_key") || "")}" aria-label="API key"><span class="small muted">or <a href="/login?next=${encodeURIComponent(location.pathname)}">sign in</a></span>`}<button class="pill pill-white" data-run>Send request</button></div>
          <div data-resp hidden><div class="resp-meta" data-resp-meta></div><pre class="out" data-out></pre></div>
        </section>
        <section><h3>Code</h3><div class="code-card"><div class="code-tabs">${D.langs.map((l) => `<button class="${l === lang ? "on" : ""}" data-l="${l}">${l}</button>`).join("")}<button class="copy" data-copy-code>Copy</button></div><pre class="code"><code data-sample></code></pre></div></section>
        <section><h3>Errors</h3><div class="table-wrap"><table><tbody>${D.errors.map(([s, t]) => `<tr><td><code>${s}</code></td><td class="muted">${esc(t)}</td></tr>`).join("")}</tbody></table></div></section>`;
      const renderSample = () => ($("[data-sample]", main).textContent = sample(lang, { api: D.apiUrl, key: D.scraper.key, ep: ep.slug, method: ep.method, params: ex, pathParams }));
      renderSample();
      $$("[data-l]", main).forEach((b) => b.addEventListener("click", () => { lang = b.dataset.l; $$("[data-l]", main).forEach((x) => x.classList.toggle("on", x === b)); renderSample(); }));
      $("[data-key]", main)?.addEventListener("input", (e) => store.set("zie_key", e.target.value.trim()));
      $("[data-run]", main).addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const params = {};
        $$("[data-p]", main).forEach((el) => { if (el.value !== "") params[el.dataset.p] = el.value; });
        btn.disabled = true;
        btn.textContent = "Sending…";
        const t0 = performance.now();
        let res, data, headers = {};
        try {
          if (D.loggedIn) {
            res = await fetch("/api/me/run", { method: "POST", headers: { "content-type": "application/json", "x-zie-csrf": "1" }, body: JSON.stringify({ project: D.scraper.key, endpoint: ep.slug, params }) });
          } else {
            const key = $("[data-key]", main).value.trim();
            if (!key) { toast("Paste an API key or sign in first"); return; }
            let p = `/v1/${D.scraper.key}/${ep.slug}`;
            const q = { ...params };
            for (const n of pathParams) if (q[n] !== undefined) { p += "/" + encodeURIComponent(q[n]); delete q[n]; }
            const init = { method: ep.method, headers: { "x-api-key": key } };
            if (ep.method === "GET") { const qs = new URLSearchParams(q).toString(); if (qs) p += "?" + qs; } else { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(q); }
            res = await fetch(p, init);
          }
          headers = { cache: res.headers.get("x-cache"), left: res.headers.get("x-ratelimit-remaining-month"), id: res.headers.get("x-request-id") };
          const t = await res.text();
          try { data = JSON.stringify(JSON.parse(t), null, 2); } catch { data = t; }
        } catch (err) {
          data = String(err);
        } finally {
          btn.disabled = false;
          btn.textContent = "Send request";
        }
        if (!res) return;
        $("[data-resp]", main).hidden = false;
        $("[data-resp-meta]", main).innerHTML = `<span class="st-${String(res.status)[0]}">${res.status}</span><span>${Math.round(performance.now() - t0)} ms</span>${headers.cache ? `<span>cache ${esc(headers.cache)}</span>` : ""}${headers.left ? `<span>${esc(headers.left)} left this month</span>` : ""}${headers.id ? `<span>id ${esc(headers.id)}</span>` : ""}`;
        $("[data-out]", main).textContent = data;
      });
    };
    $$("[data-ep]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); draw(a.dataset.ep); history.replaceState(null, "", `?endpoint=${a.dataset.ep}`); }));
    $("[data-ep-select]").addEventListener("change", (e) => { draw(e.target.value); history.replaceState(null, "", `?endpoint=${e.target.value}`); });
    $("[data-mcp-open]")?.addEventListener("click", () => $("[data-mcp-modal]").showModal());
    draw(D.current);
  }

  // ---------- pricing toggle ----------
  $$("[data-quota]").forEach((b) => b.addEventListener("click", () => {
    $$("[data-quota]").forEach((x) => x.classList.toggle("on", x === b));
    $$("[data-plan]").forEach((c) => c.classList.toggle("hl", c.dataset.plan === b.dataset.quota));
  }));

  // ---------- generic JSON forms ----------
  $$("[data-form]").forEach((f) => f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $(".form-msg", f);
    const body = Object.fromEntries(new FormData(f));
    msg.className = "form-msg";
    msg.textContent = "Sending…";
    try {
      await api(f.dataset.form, { method: "POST", body });
      msg.classList.add("ok");
      msg.textContent = f.dataset.success || "Saved.";
      f.reset();
    } catch (err) {
      msg.classList.add("err");
      msg.textContent = err.message;
    }
  }));

  // ---------- auth ----------
  $$("[data-auth]").forEach((f) => f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $(".form-msg", f);
    msg.className = "form-msg";
    msg.textContent = "…";
    try {
      await api(`/auth/${f.dataset.auth}`, { method: "POST", body: Object.fromEntries(new FormData(f)) });
      const plan = f.dataset.plan;
      location.href = plan && plan !== "free" ? `/dashboard/billing?plan=${encodeURIComponent(plan)}` : f.dataset.next || "/dashboard";
    } catch (err) {
      msg.classList.add("err");
      msg.textContent = err.message;
    }
  }));
  $$("[data-logout]").forEach((b) => b.addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/";
  }));
})();
