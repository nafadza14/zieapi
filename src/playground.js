// Browser playground served at GET / (Accept: text/html) and /playground.
// Kept as a JS string so serverless bundlers (Vercel) always include it.

export const PLAYGROUND_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zieapi playground</title>
<meta name="description" content="Try every zieapi endpoint from the browser.">
<style>
:root{--bg:#f7f7f8;--panel:#fff;--line:#e4e4e7;--text:#18181b;--muted:#71717a;--accent:#2563eb;--accent-ink:#fff;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;--code:#f4f4f5;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0e0e10;--panel:#17171a;--line:#2a2a2f;--text:#ececf1;--muted:#9a9aa3;--accent:#60a5fa;--accent-ink:#0b1220;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--code:#111114}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--panel)}
.brand{font-weight:700;font-size:16px}.brand small{color:var(--muted);font-weight:400;margin-left:8px}
.keybox{display:flex;gap:8px;align-items:center;flex:1;max-width:520px;min-width:240px}
input,select,textarea{width:100%;font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:9px 16px;background:var(--accent);color:var(--accent-ink);cursor:pointer}
button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line);font-weight:500;padding:8px 10px}
main{display:grid;grid-template-columns:300px 1fr;min-height:calc(100vh - 62px)}
aside{border-right:1px solid var(--line);background:var(--panel);padding:14px;overflow:auto;max-height:calc(100vh - 62px)}
.list{list-style:none;margin:10px 0 0;padding:0}.list li{padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;gap:8px}
.list li:hover{background:var(--bg)}.list li.active{background:var(--accent);color:var(--accent-ink)}.list li .cat{font-size:12px;opacity:.7}
section.work{padding:20px;display:grid;gap:16px;align-content:start;min-width:0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}
h2{margin:0 0 4px;font-size:18px}.muted{color:var(--muted)}.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.tag{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted)}
.eps{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}.eps button{background:var(--bg);color:var(--text);border:1px solid var(--line);font-weight:500}
.eps button.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
label{display:grid;gap:4px;font-size:13px}label .req{color:var(--bad)}label .hint{font-size:12px;color:var(--muted)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px}
code,pre{font-family:var(--mono);font-size:12.5px}pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;margin:0;max-height:480px;white-space:pre-wrap;word-break:break-word}
.status{font-weight:700}.s2{color:var(--ok)}.s4{color:var(--warn)}.s5{color:var(--bad)}
.meta{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin-bottom:10px}
.empty{color:var(--muted);padding:40px 0;text-align:center}
@media (max-width:820px){main{grid-template-columns:1fr}aside{max-height:none;border-right:0;border-bottom:1px solid var(--line)}.list{max-height:240px;overflow:auto}section.work{padding:16px}header{padding:12px 16px}}
</style>
</head>
<body>
<header>
  <div class="brand">zieapi <small id="totals">loading…</small></div>
  <div class="keybox">
    <input id="key" type="password" placeholder="Paste your API key (zie_…)" autocomplete="off" aria-label="API key">
    <button class="ghost" id="toggle" type="button" aria-label="Show or hide key">Show</button>
  </div>
</header>
<main>
  <aside>
    <input id="q" type="search" placeholder="Search scrapers…" aria-label="Search scrapers">
    <ul class="list" id="list"></ul>
  </aside>
  <section class="work">
    <div class="card" id="detail"><div class="empty">Pick a scraper on the left.</div></div>
    <div class="card" id="result" hidden>
      <div class="meta" id="meta"></div>
      <pre id="out"></pre>
      <p class="muted" style="margin:12px 0 6px">cURL</p>
      <pre id="curl"></pre>
    </div>
  </section>
</main>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k) } catch { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch {} } };
const keyEl = $("#key");
keyEl.value = store.get("zie_key") || "";
keyEl.addEventListener("input", () => store.set("zie_key", keyEl.value.trim()));
$("#toggle").onclick = () => { keyEl.type = keyEl.type === "password" ? "text" : "password"; $("#toggle").textContent = keyEl.type === "password" ? "Show" : "Hide"; };

let all = [], current = null, endpoint = null;

async function getJson(u) { const r = await fetch(u, { headers: { accept: "application/json" } }); return r.json(); }

async function boot() {
  const info = await getJson("/api/info");
  const c = info.content || {};
  $("#totals").textContent = c.scrapers + " scrapers · " + c.endpoints + " endpoints · v" + c.version;
  const list = await getJson("/api/scrapers/list?limit=100");
  all = list.content.items;
  renderList();
}

function renderList() {
  const q = $("#q").value.toLowerCase();
  const rows = all.filter((s) => !q || (s.displayName + " " + s.slug + " " + s.category + " " + s.tags.join(" ") + " " + (s.description || "")).toLowerCase().includes(q));
  $("#list").innerHTML = rows.map((s) => '<li data-k="' + esc(s.category + ":" + s.slug) + '" class="' + (current && current.category + ":" + current.slug === s.category + ":" + s.slug ? "active" : "") + '"><span>' + esc(s.displayName) + '</span><span class="cat">' + esc(s.category) + "</span></li>").join("") || '<li class="muted">No match</li>';
}
$("#q").addEventListener("input", renderList);
$("#list").addEventListener("click", (e) => { const li = e.target.closest("li[data-k]"); if (li) select(li.dataset.k); });

async function select(k) {
  const d = await getJson("/api/scrapers/" + encodeURIComponent(k));
  current = d.content; endpoint = null; renderList();
  const s = current;
  $("#detail").innerHTML =
    "<h2>" + esc(s.displayName) + ' <span class="muted" style="font-weight:400;font-size:14px">' + esc(s.category + ":" + s.slug) + "</span></h2>" +
    '<div class="muted">' + esc(s.description || "") + "</div>" +
    '<div class="tags">' + s.tags.map((t) => '<span class="tag">' + esc(t) + "</span>").join("") + "</div>" +
    '<div class="eps">' + s.endpoints.map((e, i) => '<button type="button" data-i="' + i + '">' + esc(e.method + " " + e.slug) + "</button>").join("") + "</div>" +
    '<form id="form"></form>';
  $("#detail .eps").onclick = (e) => { const b = e.target.closest("button[data-i]"); if (b) pickEndpoint(Number(b.dataset.i)); };
  pickEndpoint(0);
}

async function pickEndpoint(i) {
  endpoint = current.endpoints[i];
  document.querySelectorAll("#detail .eps button").forEach((b, j) => b.classList.toggle("active", j === i));
  const sch = await getJson("/api/public/scrapers/" + encodeURIComponent(current.category + ":" + current.slug) + "/endpoints/" + encodeURIComponent(endpoint.slug) + "/schema");
  endpoint.fields = sch.content.fields;
  const gate = endpoint.minPlan ? ' · requires <b>' + esc(endpoint.minPlan) + "</b> plan" : "";
  const bulk = endpoint.bulkEnabled ? " · bulk ✓" : "";
  $("#form").innerHTML =
    '<p class="muted" style="margin:0 0 12px">' + esc(endpoint.description || endpoint.displayName || "") + ' <br><code>' + esc(endpoint.method + " /v1/" + current.category + ":" + current.slug + "/" + endpoint.slug + (endpoint.pathTemplate ? "/" + endpoint.pathTemplate : "")) + "</code> · cache " + (endpoint.cacheTtl || 0) + "s" + gate + bulk + "</p>" +
    '<div class="fields">' + endpoint.fields.map(fieldHtml).join("") + "</div>" +
    '<div class="row"><button type="submit">Run</button><span class="muted" id="hint"></span></div>';
  $("#form").onsubmit = (e) => { e.preventDefault(); run(); };
}

function fieldHtml(f) {
  const id = "f_" + f.name;
  const label = '<span>' + esc(f.name) + (f.required ? ' <span class="req">*</span>' : "") + ' <span class="hint">' + esc(f.type + (f.in === "path" ? " · path" : "")) + "</span></span>";
  const hint = f.description ? '<span class="hint">' + esc(f.description) + "</span>" : "";
  let input;
  if (f.enum) input = '<select id="' + id + '">' + (f.required ? "" : '<option value=""></option>') + f.enum.map((v) => '<option' + (v === f.default ? " selected" : "") + ">" + esc(v) + "</option>").join("") + "</select>";
  else if (f.type === "boolean") input = '<select id="' + id + '"><option value="">' + (f.default === undefined ? "" : "default (" + f.default + ")") + '</option><option>true</option><option>false</option></select>';
  else if (f.type === "string" && (f.max || 0) > 2048) input = '<textarea id="' + id + '" rows="3" placeholder="' + esc(f.example ?? "") + '"></textarea>';
  else input = '<input id="' + id + '" ' + (f.type === "number" || f.type === "integer" ? 'inputmode="decimal"' : "") + ' placeholder="' + esc(f.example ?? f.default ?? "") + '" value="' + esc(f.example ?? "") + '">';
  return "<label>" + label + input + hint + "</label>";
}

async function run() {
  const key = keyEl.value.trim();
  if (!key) { $("#hint").textContent = "Paste an API key first."; keyEl.focus(); return; }
  const params = {};
  for (const f of endpoint.fields) {
    const v = document.getElementById("f_" + f.name).value;
    if (v === "") continue;
    params[f.name] = f.type === "number" || f.type === "integer" ? Number(v) : f.type === "boolean" ? v === "true" : v;
  }
  let path = "/v1/" + current.category + ":" + current.slug + "/" + endpoint.slug;
  for (const f of endpoint.fields.filter((x) => x.in === "path")) { if (params[f.name] !== undefined) { path += "/" + encodeURIComponent(params[f.name]); delete params[f.name]; } }
  const init = { method: endpoint.method, headers: { "x-api-key": key } };
  let url = path;
  if (endpoint.method === "GET") { const qs = new URLSearchParams(params).toString(); if (qs) url += "?" + qs; }
  else { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(params); }
  $("#hint").textContent = "Running…";
  const t0 = performance.now();
  let res, text;
  try { res = await fetch(url, init); text = await res.text(); } catch (e) { $("#hint").textContent = "Network error: " + e.message; return; }
  const ms = Math.round(performance.now() - t0);
  $("#hint").textContent = "";
  let pretty = text; try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}
  const h = (n) => res.headers.get(n);
  const cls = "s" + String(res.status)[0];
  $("#meta").innerHTML = '<span class="status ' + cls + '">' + res.status + "</span><span>" + ms + " ms</span>" +
    (h("x-cache") ? "<span>cache: " + esc(h("x-cache")) + "</span>" : "") +
    (h("x-ratelimit-remaining") ? "<span>minute left: " + esc(h("x-ratelimit-remaining")) + "</span>" : "") +
    (h("x-ratelimit-remaining-month") ? "<span>month left: " + esc(h("x-ratelimit-remaining-month")) + "</span>" : "") +
    (h("x-request-id") ? "<span>id: " + esc(h("x-request-id")) + "</span>" : "");
  $("#out").textContent = pretty;
  const origin = location.origin;
  $("#curl").textContent = 'curl ' + (endpoint.method === "POST" ? "-X POST " : "") + '"' + origin + url + '" \\\\\\n  -H "x-api-key: zie_••••"' + (init.body ? ' \\\\\\n  -H "content-type: application/json" \\\\\\n  -d \\'' + init.body + "\\'" : "");
  $("#result").hidden = false;
}

boot().catch((e) => { $("#totals").textContent = "failed to load: " + e.message; });
</script>
</body>
</html>`;
