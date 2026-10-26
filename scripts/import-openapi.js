#!/usr/bin/env node
// Build the global API directory from the APIs.guru OpenAPI Directory (CC0 / fair use),
// as packaged by the `openapi-directory` npm package (MIT).
//
//   npm i --no-save openapi-directory@1.3.17
//   node scripts/import-openapi.js node_modules/openapi-directory/api
//
// Writes:
//   src/catalog/openapi/index.json        one compact summary per API (loaded at start-up)
//   src/catalog/openapi/apis/<id>.json    compact operations per API (loaded on first use)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2];
if (!ROOT || !existsSync(ROOT)) {
  console.error("usage: node scripts/import-openapi.js <path-to-openapi-directory/api>");
  process.exit(1);
}
const OUT = new URL("../src/catalog/openapi/", import.meta.url).pathname;
const MAX_OPS = 300;

// Infrastructure control planes and private deployments are not data APIs; skip them.
const EXCLUDE_PROVIDERS = new Set(["azure.com", "amazonaws.com", "microsoft.com", "kubernetes.io", "autotask.net", "windows.net"]);
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

function serverUrl(spec) {
  for (const s of spec.servers ?? []) {
    let u = s.url ?? "";
    for (const [k, v] of Object.entries(s.variables ?? {})) u = u.replaceAll(`{${k}}`, v.default ?? "");
    if (/^https?:\/\//.test(u) && !/[{}]/.test(u)) return u.replace(/\/+$/, "");
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
  if (!p?.name || !["query", "path", "header"].includes(p.in)) return null;
  if (p.in === "header" && /^(authorization|accept|content-type|user-agent|x-api-key|api-key)$/i.test(p.name)) return null;
  const sc = resolveRef(spec, p.schema ?? {}) ?? {};
  const f = [p.name, T[sc.type] ?? "string", p.in === "path" || p.required ? 1 : 0, p.in[0]];
  const extra = {};
  if (sc.default !== undefined && typeof sc.default !== "object") extra.d = sc.default;
  if (Array.isArray(sc.enum) && sc.enum.length && sc.enum.length <= 40 && sc.enum.every((v) => typeof v !== "object")) extra.e = sc.enum;
  const desc = clip(p.description ?? sc.description, 140);
  if (desc) extra.x = desc;
  if (p.example !== undefined && typeof p.example !== "object") extra.ex = p.example;
  return Object.keys(extra).length ? [...f, extra] : f;
}

const index = [];
const used = new Set();
const skipped = {};
const files = walk(ROOT);
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(join(OUT, "apis"), { recursive: true });

for (const file of files.sort()) {
  const id = relative(ROOT, file).replace(/\.json$/, "");
  let spec;
  try {
    spec = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  const info = spec.info ?? {};
  const provider = info["x-providerName"] ?? id.split("/")[0];
  const skip = (why) => (skipped[why] = (skipped[why] ?? 0) + 1);
  if (EXCLUDE_PROVIDERS.has(provider) || provider.endsWith(".local") || provider.includes("azure")) { skip("infra/private provider"); continue; }
  if (provider === "github.com" && !id.endsWith("api.github.com")) { skip("github enterprise variant"); continue; }
  const base = serverUrl(spec);
  if (!base) { skip("no absolute server"); continue; }
  if (privateHost(base)) { skip("private server"); continue; }
  const { auth, ok } = pickAuth(spec);
  if (!ok) { skip("unsupported auth"); continue; }

  const ops = [];
  const seen = new Set();
  for (const [path, item0] of Object.entries(spec.paths ?? {})) {
    const item = resolveRef(spec, item0) ?? {};
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item[method];
      if (!op || op.deprecated) continue;
      if (ops.length >= MAX_OPS) break;
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
        if (f) byName.set(`${f[0]}|${f[3]}`, f);
      }
      const fields = [...byName.values()];
      const rb = resolveRef(spec, op.requestBody);
      let body = 0;
      if (rb?.content) {
        const ct = Object.keys(rb.content)[0] ?? "";
        body = ct.includes("json") ? (rb.required ? 2 : 1) : ct.includes("form") ? (rb.required ? 4 : 3) : 0;
      }
      ops.push([s, method.toUpperCase(), path, clip(op.summary || op.description || `${method.toUpperCase()} ${path}`, 110), fields, body]);
    }
  }
  if (!ops.length) { skip("no operations"); continue; }

  const cats = info["x-apisguru-categories"] ?? [];
  const category = CATEGORY_MAP[cats[0]] ?? "open-data";
  let key;
  let base0 = slug(id.replace(/^www\./, "").replace(/\.(com|org|net|io|dev|co|gov|ai|app)(?=\/|:|$)/g, "").replace(/[/:]/g, "-"), 64);
  key = `${category}:${base0}`;
  for (let i = 2; used.has(key); i++) key = `${category}:${base0}-${i}`;
  used.add(key);

  const fileId = slug(key.replace(":", "--"), 90);
  writeFileSync(join(OUT, "apis", `${fileId}.json`), JSON.stringify({ base, auth, ops }));
  index.push({
    k: key,
    f: fileId,
    n: clip(info.title ?? provider, 70),
    d: clip(info.description, 220),
    p: provider,
    o: ops.length,
    a: auth ? auth.t : null,
    g: (cats ?? []).slice(0, 3),
    w: info.contact?.url && /^https?:/.test(info.contact.url) ? info.contact.url : `https://${provider}`,
    v: info.version ? String(info.version).slice(0, 20) : null,
  });
}

writeFileSync(join(OUT, "index.json"), JSON.stringify({ source: "APIs.guru OpenAPI Directory via openapi-directory@1.3.17", generatedAt: new Date().toISOString(), apis: index }));
const totalOps = index.reduce((n, a) => n + a.o, 0);
console.log(`wrote ${index.length} APIs, ${totalOps} operations (${index.filter((a) => !a.a).length} keyless)`);
console.log("skipped:", skipped);
