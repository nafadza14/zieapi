#!/usr/bin/env node
// Build the global API directory from the APIs.guru OpenAPI Directory (CC0 / fair use),
// as packaged by the `openapi-directory` npm package (MIT), plus extra directories of OpenAPI 3
// specs published by the providers themselves (see docs/API-SOURCES.md for the list and URLs).
//
//   npm i --no-save openapi-directory@1.3.17
//   python3 scripts/prepare-extra-specs.py <kind> <src> <out>     (Azure, Google Discovery, Konfig; see that file)
//   APIZIE_AWS_META=<aws-sdk-js>/apis node scripts/import-openapi.js node_modules/openapi-directory/api [extra-spec-dir ...]
//
// An extra spec whose server URL matches an APIs.guru entry replaces it and keeps its key,
// so existing catalog URLs stay the same while the operations come from the newer spec.
// A later directory never replaces an earlier extra directory (list provider-published specs first).
//
// Writes:
//   src/catalog/openapi/index.json        one compact summary per API (loaded at start-up)
//   src/catalog/openapi/apis/<id>.json    compact operations per API (loaded on first use)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2];
const EXTRA = process.argv.slice(3).filter((d) => existsSync(d));
if (!ROOT || !existsSync(ROOT)) {
  console.error("usage: node scripts/import-openapi.js <path-to-openapi-directory/api>");
  process.exit(1);
}
const OUT = process.env.APIZIE_IMPORT_OUT || new URL("../src/catalog/openapi/", import.meta.url).pathname;
const MAX_OPS = 400;
const AWS_META = process.env.APIZIE_AWS_META && existsSync(process.env.APIZIE_AWS_META) ? process.env.APIZIE_AWS_META : null;

// Private deployments and infrastructure control planes are not data APIs; skip them.
// AWS is signed with SigV4 by the connector (needs aws-sdk-js metadata, APIZIE_AWS_META). Azure Resource Manager comes
// merged per service from prepare-extra-specs.py (arm), so the per-file APIs.guru copies are skipped here.
// Azure Storage (windows.net) needs SharedKey request signing, which the connector does not do.
const EXCLUDE_PROVIDERS = new Set(["kubernetes.io", "autotask.net", "windows.net", ...(AWS_META ? [] : ["amazonaws.com"])]);
const isControlPlane = (base, extra) => (!extra && /^https:\/\/management\.(azure|core\.windows)\./.test(base)) || /\.azurestack\.external(\/|$)/.test(base);
// Provider specs that do not declare their auth scheme (checked by hand against each provider's docs).
const AUTH_OVERRIDE = { "docusign": { t: "bearer" }, "docusign-click": { t: "bearer" }, "docusign-rooms": { t: "bearer" } };
// Mailchimp Transactional takes its key inside the JSON body, which the connector does not support yet.
// Provider specs without a security scheme whose APIs really are open (checked against the provider docs).
const KEYLESS_EXTRA = new Set(["github", "discourse", "jikan", "pokeapi"]);
const SKIP_SOURCES = new Set(["mailchimp-tx", "azure-arm-azsadmin"]); // azsadmin: Azure Stack Hub admin (private deployments)
const SKIP_IDS = new Set(["google.home"]); // local-network device API, not reachable over the internet
const OK_AUTH = new Set(["apiKey:header", "apiKey:query", "http:basic", "http:bearer", "oauth2:", "openIdConnect:"]);

const CATEGORY_MAP = {
  financial: "finance", payment: "payments", ecommerce: "ecommerce", open_data: "open-data", analytics: "analytics",
  developer_tools: "dev-tools", tools: "web-tools", entertainment: "entertainment", media: "media", messaging: "communication",
  telecom: "communication", email: "communication", text: "ai", machine_learning: "ai", location: "places", transport: "transport",
  social: "social-media", collaboration: "business", project_management: "business", enterprise: "business", customer_relation: "business",
  marketing: "business", support: "business", forms: "business", cloud: "cloud", hosting: "cloud", backend: "cloud", storage: "cloud",
  monitoring: "cloud", security: "security", iot: "iot", search: "search-tools", education: "education",
};

const slug = (s, max = 60) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "") || "x";
const clip = (s, n) => {
  const t = String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t;
};
const T = { integer: "integer", number: "number", boolean: "boolean", array: "array", object: "object" };

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (f.endsWith(".json")) out.push(p);
  }
  return out;
}

function resolveRef(spec, obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return obj;
  if (obj.$ref && typeof obj.$ref === "string" && obj.$ref.startsWith("#/")) {
    const target = obj.$ref.slice(2).split("/").reduce((o, k) => o?.[k.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
    return resolveRef(spec, target, depth + 1);
  }
  return obj;
}

/**
 * Pick the server: https first. Variables with a plain default are filled in; variables the caller must choose
 * (no default, or a fixed list such as an AWS region) stay as {name} in the base and become "host" fields.
 * A variable that starts the URL and holds the whole origin (an Azure resource endpoint) is marked full.
 */
function serverInfo(spec) {
  const list = (spec.servers ?? []).filter((s) => typeof s?.url === "string");
  // Production over sandbox/staging/mock servers, then https over http.
  const rank = (u) => (/sandbox|staging|\bmock|\.test\b|-test\.|\bdemo\b|\bdev\./i.test(u) ? 0 : 2) + (/^https:/i.test(u) ? 1 : 0);
  list.sort((a, b) => rank(b.url) - rank(a.url));
  for (const s of list) {
    let u = s.url.trim();
    const hv = [];
    for (const [k, v0] of Object.entries(s.variables ?? {})) {
      const v = v0 ?? {};
      if (!u.includes(`{${k}}`)) continue;
      const choose = v.default === undefined || v.default === "" || (Array.isArray(v.enum) && v.enum.length > 1) || v["x-apizie-full-url"];
      if (!choose) { u = u.replaceAll(`{${k}}`, String(v.default)); continue; }
      const h = { n: k };
      if (v.default !== undefined && v.default !== "") h.d = String(v.default);
      if (Array.isArray(v.enum) && v.enum.length && v.enum.length <= 60) h.e = v.enum.map(String);
      if (v.description) h.x = clip(v.description, 140);
      if (v["x-apizie-full-url"] || u.startsWith(`{${k}}`)) h.full = 1;
      hv.push(h);
    }
    // Placeholder hosts written as text ("your-domain.atlassian.net", "ALGOLIA_APPLICATION_ID.algolia.net",
    // "example.com" for self-hosted products) become caller-chosen variables too.
    u = u.replace(/^(https?:\/\/)([^/:]+)/, (m, scheme, host) => {
      if (/(^|\.)example\.(com|org)$/i.test(host)) return "{server}";
      return scheme + host.split(".").map((l, i) => (i === 0 && /^(your[-_][a-z-]+|[A-Z][A-Z0-9_]{5,})$/.test(l) ? `{${l.toLowerCase().replace(/^your[-_]/, "").replace(/[^a-z0-9]+/g, "_")}}` : l)).join(".");
    });
    // Undeclared variables in the URL (some specs forget them) are caller-chosen too.
    for (const m of u.matchAll(/\{([^}]+)\}/g)) if (!hv.some((h) => h.n === m[1])) hv.push({ n: m[1], ...(u.startsWith(`{${m[1]}}`) ? { full: 1 } : {}) });
    const probe = hv.reduce((x, h) => x.replaceAll(`{${h.n}}`, h.full ? "https://example.com" : "example"), u);
    if (!/^https?:\/\//.test(probe) || /[{}<>\s]/.test(probe)) continue;
    return { base: u.replace(/\/+$/, ""), probe: probe.replace(/\/+$/, ""), hv };
  }
  return null;
}

function privateHost(u) {
  try {
    const h = new URL(u).hostname;
    return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".");
  } catch {
    return true;
  }
}

function pickAuth(spec) {
  const schemes = spec.components?.securitySchemes ?? {};
  const req = (spec.security ?? []).flatMap((o) => Object.keys(o));
  const names = req.length ? req : Object.keys(schemes);
  const list = names.map((n) => ({ n, s: resolveRef(spec, schemes[n]) })).filter((x) => x.s);
  if (!list.length) return { auth: null, ok: true };
  const usable = list.filter((x) => OK_AUTH.has(`${x.s.type}:${x.s.type === "apiKey" ? x.s.in : x.s.type === "http" ? String(x.s.scheme).toLowerCase() : ""}`));
  if (!usable.length) return { auth: null, ok: false };
  // prefer apiKey > bearer > basic > oauth2
  const rank = (x) => (x.s.type === "apiKey" ? 0 : x.s.type === "http" && /bearer/i.test(x.s.scheme) ? 1 : x.s.type === "http" ? 2 : 3);
  usable.sort((a, b) => rank(a) - rank(b));
  const s = usable[0].s;
  if (s.type === "apiKey") return { ok: true, auth: { t: "key", in: s.in, name: s.name } };
  if (s.type === "http" && /basic/i.test(s.scheme)) return { ok: true, auth: { t: "basic" } };
  return { ok: true, auth: { t: "bearer" } };
}

function fieldFrom(spec, p) {
  p = resolveRef(spec, p);
  if (!p?.name || !["query", "path", "header", "x-json"].includes(p.in)) return null; // x-json: one top-level field of a JSON body
  if (p.in === "header" && /^(authorization|accept|content-type|user-agent|x-api-key|api-key)$/i.test(p.name)) return null;
  const sc = resolveRef(spec, p.schema ?? {}) ?? {};
  const f = [p.name, T[sc.type] ?? "string", p.in === "path" || p.required ? 1 : 0, p.in === "x-json" ? "j" : p.in[0]];
  const extra = {};
  if (sc.default !== undefined && typeof sc.default !== "object") extra.d = sc.default;
  if (Array.isArray(sc.enum) && sc.enum.length && sc.enum.length <= 40 && sc.enum.every((v) => typeof v !== "object")) extra.e = sc.enum;
  const desc = clip(p.description ?? sc.description, 140);
  if (desc) extra.x = desc;
  if (p.example !== undefined && typeof p.example !== "object") extra.ex = p.example;
  return Object.keys(extra).length ? [...f, extra] : f;
}

/** AWS signing metadata from aws-sdk-js (apis/<uid>.min.json), matched through the spec's x-origin URL. */
function awsMeta(info) {
  if (!AWS_META) return null;
  const url = info["x-origin"]?.[0]?.url ?? "";
  const uid = /apis\/([^/]+?)\.normal\.json$/.exec(url)?.[1];
  if (!uid || !existsSync(join(AWS_META, `${uid}.min.json`))) return null;
  const m = JSON.parse(readFileSync(join(AWS_META, `${uid}.min.json`), "utf8")).metadata ?? {};
  if (!["json", "rest-json", "query", "rest-xml", "ec2"].includes(m.protocol)) return null;
  return {
    auth: { t: "aws", svc: m.signingName || m.endpointPrefix, ...(m.globalEndpoint ? { g: 1 } : {}), ...(m.protocol === "rest-xml" && m.endpointPrefix === "s3" ? { s3: 1 } : {}) },
    version: m.apiVersion,
    ct: m.protocol === "json" ? `application/x-amz-json-${m.jsonVersion || "1.0"}` : null,
  };
}

// Specs without APIs.guru categories (Konfig, Google): a keyword guess from the title and description.
const GUESS = [
  ["payment", /\b(payment|payout|checkout|invoice|billing|card issuing|acquir)/i], ["financial", /\b(bank|banking|finance|financial|accounting|trading|stock|crypto|ledger|tax|payroll|loan|lending)/i],
  ["messaging", /\b(sms|email|e-mail|messag|chat|voice|telephon|whatsapp|notification|push)/i], ["security", /\b(security|identity|auth|fraud|vulnerab|password|secret|compliance|kyc)/i],
  ["machine_learning", /\b(\bai\b|machine learning|llm|model|vision|speech|nlp|language|translat|ocr|embedding)/i], ["ecommerce", /\b(e-?commerce|shop|store|order|retail|product catalog|marketplace|shipping|logistic)/i],
  ["analytics", /\b(analytics|metrics|monitoring|observab|logs?\b|insight)/i], ["location", /\b(map|geo|location|address|places|weather)/i],
  ["transport", /\b(travel|flight|hotel|transit|vehicle|fleet|ride|airline)/i], ["media", /\b(video|image|photo|audio|music|media|stream)/i],
  ["developer_tools", /\b(developer|devops|ci\/cd|repository|deploy|api management|code|git)/i], ["cloud", /\b(cloud|hosting|server|storage|database|cdn|kubernetes|container)/i],
  ["education", /\b(education|school|learning|course|student)/i], ["customer_relation", /\b(crm|customer|sales|lead|support|ticket|helpdesk)/i],
  ["enterprise", /\b(hr\b|human resources|recruit|employee|workforce|erp|project|task|calendar|document|sign)/i], ["iot", /\b(iot|device|sensor|smart home)/i],
];
function guessCategories(info) {
  const t = `${info.title ?? ""} ${info.description ?? ""}`.slice(0, 600);
  const hit = GUESS.find(([, re]) => re.test(t));
  return hit ? [hit[0]] : [];
}

const index = [];
const used = new Set();
const skipped = {};
const byBase = new Map(); // base URL -> index positions, so a provider's own spec can replace an older copy
const pathsOf = []; // index position -> Set of paths
const byId = new Map(); // APIs.guru id (provider/service) -> index position
const byTitle = new Map(); // "host|normalized title" -> index position
const files = [...walk(ROOT).sort().map((f) => [ROOT, f]), ...EXTRA.flatMap((d) => walk(d).sort().map((f) => [d, f]))];
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(join(OUT, "apis"), { recursive: true });

for (const [root, file] of files) {
  const extra = root !== ROOT;
  const id = relative(root, file).replace(/\.json$/, "");
  let spec;
  try {
    spec = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  const info = spec.info ?? {};
  const provider = info["x-providerName"] ?? id.split("/")[0];
  const skip = (why) => (skipped[why] = (skipped[why] ?? 0) + 1);
  if (EXCLUDE_PROVIDERS.has(provider) || provider.endsWith(".local")) { skip("infra/private provider"); continue; }
  if (provider === "github.com" && !id.endsWith("api.github.com")) { skip("github enterprise variant"); continue; }
  if (SKIP_IDS.has(id.split("/")[0])) { skip("local device api"); continue; }
  const srv = serverInfo(spec);
  if (!srv) { skip("no absolute server"); continue; }
  const base = srv.base;
  if (privateHost(srv.probe)) { skip("private server"); continue; }
  if (/polls\.apiblueprint\.org|virtserver\.swaggerhub\.com|stoplight\.io\/mocks/i.test(srv.probe)) { skip("mock server only"); continue; }
  if (isControlPlane(base, extra)) { skip("cloud control plane"); continue; }
  const aws = provider === "amazonaws.com" ? awsMeta(info) : null;
  if (provider === "amazonaws.com" && !aws) { skip("aws without signing metadata"); continue; }
  if (SKIP_SOURCES.has(info["x-apizie-source"])) { skip("key in request body"); continue; }
  const declared = info["x-apizie-auth-detail"] ? { ok: true, auth: info["x-apizie-auth-detail"] } : info["x-apizie-auth"] ? { ok: true, auth: { t: info["x-apizie-auth"] } } : null; // spec omits it; set by prepare-extra-specs.py from the provider docs
  const picked = aws ? { ok: true, auth: aws.auth } : declared ?? pickAuth(spec);
  const auth = AUTH_OVERRIDE[info["x-apizie-source"]] ?? picked.auth;
  const ok = picked.ok || !!AUTH_OVERRIDE[info["x-apizie-source"]];
  if (!ok) { skip("unsupported auth"); continue; }
  // An extra spec that declares no security at all is only trusted as keyless for providers checked by hand;
  // Azure data plane falls back to a Microsoft Entra token, the rest are left out rather than shown as "live".
  let auth2 = auth;
  if (!auth && !aws && provider === "azure.com") auth2 = { t: "bearer" }; // every Azure API needs a Microsoft Entra token
  else if (extra && !auth && !aws && !KEYLESS_EXTRA.has(info["x-apizie-source"])) { skip("extra spec without declared auth"); continue; }

  const ops = [];
  const seen = new Set();
  for (const [path, item0] of Object.entries(spec.paths ?? {})) {
    const item = resolveRef(spec, item0) ?? {};
    // AWS-style paths carry the operation in a fragment: "/#X-Amz-Target=Svc.Op", "/#Action=Op", "/{Bucket}#uploads".
    const [cleanPath, frag = ""] = path.split("#");
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item[method];
      if (!op || op.deprecated) continue;
      if (ops.length >= MAX_OPS) break;
      const fixed = op["x-apizie-fixed"] ? { ...op["x-apizie-fixed"] } : {};
      const fm = op["x-apizie-fixed"] ? null : /^([A-Za-z-]+)=(.+)$/.exec(frag);
      if (fm && /^x-amz-target$/i.test(fm[1])) fixed.h = { "x-amz-target": fm[2] };
      else if (fm && fm[1] === "Action") fixed.q = { Action: fm[2], ...(aws?.version ? { Version: aws.version } : {}) };
      else if (frag && !op["x-apizie-fixed"]) {
        // "?uploads" / "?list-type=2" sub-resources (from AWS requestUri). A fragment naming a declared query
        // parameter (e.g. "#uploadId") only tells operations apart, so it adds nothing.
        const declared = new Set([...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => resolveRef(spec, p)).filter((p) => p?.in === "query").map((p) => p.name));
        for (const part of frag.split("&")) {
          const [k, v = ""] = part.split("=");
          if (k && !declared.has(k) && /^[A-Za-z0-9_.-]+$/.test(k)) (fixed.q ??= {})[k] = decodeURIComponent(v);
        }
      }
      if (aws && method === "post" && fixed.q && item.get) continue; // the GET form of a Query-protocol action is enough
      let s = slug(op.operationId || `${method}-${path}`);
      if (seen.has(s)) {
        let i = 2;
        while (seen.has(`${s}-${i}`)) i++;
        s = `${s}-${i}`;
      }
      seen.add(s);
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])];
      const byName = new Map();
      for (const p of params) {
        const f = fieldFrom(spec, p);
        if (!f) continue;
        if (/^x-amz-(content-sha256|date|algorithm|credential|security-token|signature|signedheaders|target)$/i.test(f[0])) continue; // set by the signer
        if (fixed.q && f[3] === "q" && f[0] in fixed.q) continue;
        // Azure needs api-version on every call; specs rarely give it a default.
        if (f[0] === "api-version" && f[3] === "q" && info.version) {
          const x = f[4] ?? {};
          if (x.d === undefined) f[4] = { ...x, d: String(x.e?.[0] ?? info.version) };
          f[2] = 0;
        }
        byName.set(`${f[0]}|${f[3]}`, f);
      }
      const fields = [...byName.values()];
      const rb = resolveRef(spec, op.requestBody);
      let body = 0;
      if (rb?.content) {
        const ct = Object.keys(rb.content)[0] ?? "";
        body = ct.includes("json") ? (rb.required ? 2 : 1) : ct.includes("form") ? (rb.required ? 4 : 3) : ct.includes("xml") ? (rb.required ? 6 : 5) : 0;
      }
      if (aws?.ct) {
        // AWS JSON protocol: everything goes in the JSON body (the converted specs list pagination members as query).
        for (const f of fields) if (f[3] === "q") { f[3] = "j"; if (/^(Limit|MaxResults|MaxItems|MaxRecords|PageSize|MaxResultsPerPage)$/.test(f[0])) f[1] = "integer"; }
        if (body === 2) body = 1;
      }
      const row = [s, method.toUpperCase(), cleanPath, clip(op.summary || op.description || `${method.toUpperCase()} ${path}`, 110), fields, body];
      if (fixed.h || fixed.q) row.push(fixed);
      ops.push(row);
    }
  }
  if (!ops.length) { skip("no operations"); continue; }

  const cats = info["x-apisguru-categories"]?.length || !extra ? (info["x-apisguru-categories"] ?? []) : guessCategories(info);
  const category = CATEGORY_MAP[cats[0]] ?? "open-data";
  let key;
  // Same server and mostly the same paths = the same API (many Azure services share one server, so the base alone is not enough).
  const myPaths = new Set(ops.map((o) => o[2].replace(/\{\+/g, "{") + (o[6] ? JSON.stringify(o[6]) : "")));
  const overlap = (i) => { const o = pathsOf[i]; let n = 0; for (const p of myPaths) if (o.has(p)) n++; return n / Math.max(1, Math.min(o.size, myPaths.size)); };
  // The same API under the same host and title from a second collection is a duplicate, whatever its paths.
  const titleKey = `${(() => { try { return new URL(srv.probe).hostname; } catch { return base; } })()}|${String(info.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  const named = info["x-apizie-replaces"];
  const byName = named ? [...byId.entries()].filter(([gid]) => gid === named || gid.startsWith(named + ":") || gid.startsWith(named + "/")).map(([, i]) => i) : [];
  const prev = byName[0] ?? (byBase.get(base) ?? []).find((i) => overlap(i) >= 0.2) ?? (String(info["x-apizie-source"]).startsWith("konfig-") && byTitle.has(titleKey) ? byTitle.get(titleKey) : null); // Konfig re-collects specs listed elsewhere
  // Same server already imported: a provider spec replaces the APIs.guru copy; between extra directories the first wins.
  if (extra && prev !== null && index[prev].s) { skip("duplicate of an earlier provider spec"); continue; }
  const replaces = extra ? prev : null;
  if (replaces !== null) key = index[replaces].k;
  else {
    const base0 = slug(id.replace(/^www\./, "").replace(/\.(com|org|net|io|dev|co|gov|ai|app)(?=\/|:|$)/g, "").replace(/[/:]/g, "-"), 64);
    key = `${category}:${base0}`;
    for (let i = 2; used.has(key); i++) key = `${category}:${base0}-${i}`;
    used.add(key);
  }

  const fileId = slug(key.replace(":", "--"), 90);
  const raw = { base, auth: auth2, ops };
  if (srv.hv.length) raw.hv = srv.hv;
  if (srv.hv.some((h) => h.full) && Array.isArray(info["x-apizie-host-suffixes"])) raw.hs = info["x-apizie-host-suffixes"];
  if (aws?.ct) raw.ct = aws.ct;
  writeFileSync(join(OUT, "apis", `${fileId}.json`), JSON.stringify(raw));
  const entry = {
    k: key,
    f: fileId,
    n: clip(info.title ?? provider, 70),
    d: clip(info.description, 220),
    p: provider,
    o: ops.length,
    a: auth2 ? auth2.t : null,
    g: (cats ?? []).slice(0, 3),
    w: info.contact?.url && /^https?:/.test(info.contact.url) ? info.contact.url : `https://${provider}`,
    v: info.version ? String(info.version).slice(0, 20) : null,
    ...(extra ? { s: "provider" } : {}),
    ...(srv.hv.length ? { h: srv.hv.map((h) => h.n) } : {}),
  };
  if (replaces !== null) {
    if (index[replaces].f !== fileId) rmSync(join(OUT, "apis", `${index[replaces].f}.json`), { force: true });
    index[replaces] = entry;
    pathsOf[replaces] = myPaths;
    skip("replaced by provider spec");
  } else {
    if (!extra) byId.set(id, index.length);
    byTitle.set(titleKey, index.length);
    byBase.set(base, [...(byBase.get(base) ?? []), index.length]);
    pathsOf.push(myPaths);
    index.push(entry);
  }
}

writeFileSync(join(OUT, "index.json"), JSON.stringify({ source: `APIs.guru OpenAPI Directory via openapi-directory@1.3.17${EXTRA.length ? " + provider-published OpenAPI specs" : ""}`, generatedAt: new Date().toISOString(), apis: index }));
const totalOps = index.reduce((n, a) => n + a.o, 0);
console.log(`wrote ${index.length} APIs, ${totalOps} operations (${index.filter((a) => !a.a).length} keyless)`);
console.log("skipped:", skipped);
