// Generic OpenAPI connector: turns one operation from the API directory into a
// Apizie endpoint handler. The upstream server is fixed by the spec; callers can
// only fill parameters. Credentials for keyed APIs come from the caller
// (x-upstream-key / x-upstream-authorization, "bring your own key") or from a
// server env var APIZIE_UPSTREAM_KEY_<API_SLUG> (legacy ZIE_UPSTREAM_KEY_<API_SLUG> also works).

import { HttpError } from "./envelope.js";
import { ScraperError } from "./errors.js";
import { assertPublicUrl } from "../scrapers/ssrf.js";
import { signAws, parseAwsCredentials, awsRegionFromHost } from "./aws-sigv4.js";
import { signTc3, signAcs3, parseKeyPair, signEdgegrid, parseEdgegrid } from "./cloud-signers.js";

const MAX_BYTES = 1_500_000;
const UA = "apizie-connector/1 (+https://github.com/nafadza14/zieapi)";
const hostOk = new Map(); // host -> expiry (SSRF check cache)

export class UpstreamAuthRequired extends HttpError {
  constructor(api, auth) {
    const how = auth.t === "edgegrid" ? 'Send "CLIENT_TOKEN:CLIENT_SECRET:ACCESS_TOKEN" from an Akamai API client in the x-upstream-key header, and your API client host in the hostname field.' : auth.t === "tc3" ? 'Send "SECRET_ID:SECRET_KEY" from a Tencent Cloud CAM sub-user with only the permissions you need in the x-upstream-key header.' : auth.t === "acs3" ? 'Send "ACCESS_KEY_ID:ACCESS_KEY_SECRET" from an Alibaba Cloud RAM user with only the permissions you need in the x-upstream-key header.' : auth.t === "aws" ? 'Send "ACCESS_KEY_ID:SECRET_ACCESS_KEY" (or "ACCESS_KEY_ID:SECRET_ACCESS_KEY:SESSION_TOKEN") in the x-upstream-key header. Use an IAM user or role with only the permissions you need.' : auth.t === "basic" ? 'Send "username:password" in the x-upstream-key header.' : auth.t === "bearer" ? "Send your access token in the x-upstream-key header (or a full x-upstream-authorization header)." : `Send your ${api} API key in the x-upstream-key header.`;
    super(401, { error: { code: "upstream_key_required", message: `${api} needs your own credentials. ${how}` }, auth: { type: auth.t, in: auth.in ?? "header", name: auth.name ?? "Authorization" } });
  }
}

export function envKeyName(apiKey) {
  return "APIZIE_UPSTREAM_KEY_" + apiKey.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
}

function credentialFor(api, ctx) {
  const env = typeof process !== "undefined" ? process.env : {};
  const name = envKeyName(api.key);
  const fromEnv = env[name] ?? env[name.replace(/^APIZIE_/, "ZIE_")];
  const u = ctx.upstreamAuth ?? {};
  if (u.authorization) return { raw: u.authorization };
  if (u.key) return { value: u.key };
  if (fromEnv) return { value: fromEnv };
  return null;
}

async function checkHost(url, lookup, apiName) {
  const u = new URL(url);
  const exp = hostOk.get(u.host);
  if (exp && exp > Date.now()) return;
  try {
    await assertPublicUrl(url, lookup ?? undefined);
  } catch (e) {
    // The host comes from the provider's spec (or its redirect), never from the caller, so these are upstream failures
    // (502, not billed), not invalid input.
    if (/could not be resolved/i.test(e?.message ?? "")) throw new HttpError(502, { content: { upstreamHost: u.host }, message: `${apiName ?? u.host} is unreachable (DNS lookup failed)`, errors: [] });
    // Blocked by the SSRF guard (private address, unusual port, or a redirect to one): still not the caller's fault.
    throw new HttpError(502, { content: { upstreamHost: u.host }, message: `${apiName ?? u.host} cannot be called through Apizie: ${e?.message ?? "blocked"}`, errors: [] });
  }
  hostOk.set(u.host, Date.now() + 10 * 60_000);
}

function readBody(res) {
  const type = res.headers.get("content-type") ?? "";
  return res.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    const truncated = bytes.length > MAX_BYTES;
    const slice = truncated ? bytes.subarray(0, MAX_BYTES) : bytes;
    if (/json/.test(type)) {
      const text = new TextDecoder().decode(slice);
      try {
        return truncated ? { truncated: true, text } : JSON.parse(text);
      } catch {
        return { text };
      }
    }
    if (/^text\/|xml|javascript|csv|yaml|html/.test(type) || !type) {
      const text = new TextDecoder().decode(slice);
      if (!type) {
        try {
          return JSON.parse(text);
        } catch {}
      }
      return { contentType: type || "text/plain", text, ...(truncated ? { truncated: true } : {}) };
    }
    let bin = "";
    for (let i = 0; i < slice.length; i++) bin += String.fromCharCode(slice[i]);
    return { contentType: type, size: bytes.length, base64: btoa(bin), ...(truncated ? { truncated: true } : {}) };
  });
}

const LABELS = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Fill the caller-chosen parts of the server URL (tenant subdomain, region, or a whole resource endpoint).
 * A part inside the host may only hold hostname labels, so the fixed domain after it always stays in place.
 * A whole-origin part must be a public https URL, and, when the provider lists its domains, under one of them.
 */
export function resolveBase(api, params) {
  let base = api.base;
  for (const h of api.hv ?? []) {
    const raw = params[h.n] ?? h.d;
    if (raw === undefined || raw === null || raw === "") throw new ScraperError(`${h.n} is required: ${h.full ? "the full https URL of your resource" : "it is part of the server address"}`);
    let v = String(raw).trim();
    if (h.e && !h.e.includes(v)) throw new ScraperError(`${h.n} must be one of: ${h.e.slice(0, 20).join(", ")}`);
    if (h.full) {
      if (!/^[a-z]+:\/\//i.test(v)) v = "https://" + v;
      let u;
      try { u = new URL(v); } catch { throw new ScraperError(`${h.n} must be a URL such as https://myresource.example.com`); }
      if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) throw new ScraperError(`${h.n} must be a plain https URL`);
      const host = u.hostname.toLowerCase();
      if (api.hs?.length && !api.hs.some((d) => host === d || host.endsWith("." + d))) throw new ScraperError(`${h.n} must be on one of the provider's domains (${api.hs.slice(0, 6).join(", ")}…)`);
      v = u.origin + u.pathname.replace(/\/+$/, "");
    } else if (base.indexOf(`{${h.n}}`) < base.indexOf("/", base.indexOf("//") + 2) || !base.slice(base.indexOf("//") + 2).includes("/")) {
      if (!LABELS.test(v)) throw new ScraperError(`${h.n} must be a hostname part (letters, digits, dots and dashes)`);
    } else v = encodeURIComponent(v);
    base = base.replaceAll(`{${h.n}}`, v);
  }
  return base;
}

/**
 * api = { key, name, base, hv?, hs?, ct?, auth: null | {t:"key",in,name} | {t:"bearer"} | {t:"basic"} | {t:"aws",svc,g?,s3?} }
 * op  = { method, path, fields: [{name, src: "path"|"query"|"header"|"host"}], body: 0..6, fixed?: {q?, h?} }
 */
export function makeHandler(api, op) {
  return async (params, ctx) => {
    // ---- URL -----------------------------------------------------------------
    let path = op.path;
    const base = resolveBase(api, params);
    const query = new URLSearchParams();
    const headers = { "user-agent": UA, accept: "application/json, */*;q=0.8" };
    for (const [k, v] of Object.entries(op.fixed?.q ?? {})) query.set(k, v);
    for (const [k, v] of Object.entries(op.fixed?.h ?? {})) headers[k] = v;
    const jsonBody = {};
    for (const f of op.fields) {
      const v = params[f.name];
      if (v === undefined || v === null || v === "") continue;
      if (f.src === "host") continue;
      if (f.src === "json") {
        jsonBody[f.name] = typeof v === "string" && (f.type === "object" || f.type === "array") ? safeJson(v) : typeof v === "string" && (f.type === "integer" || f.type === "number") && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
        continue;
      }
      if (f.src === "path") {
        // {+name}: reserved expansion keeps "/" (Google resource names such as projects/p/locations/l), never ".." segments.
        if (path.includes(`{+${f.name}}`)) {
          const segs = String(v).split("/");
          if (segs.some((x) => x === ".." || x === ".")) throw new ScraperError(`${f.name} must not contain "." or ".." segments`);
          path = path.replaceAll(`{+${f.name}}`, segs.map(encodeURIComponent).join("/"));
        }
        path = path.replaceAll(`{${f.name}}`, encodeURIComponent(String(v)));
      }
      else if (f.src === "header") headers[f.name.toLowerCase()] = String(v);
      else if (Array.isArray(v)) v.forEach((x) => query.append(f.name, typeof x === "object" ? JSON.stringify(x) : String(x)));
      else query.set(f.name, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    if (/\{[^}]+\}/.test(path)) throw new ScraperError(`Missing path parameter for ${op.path}`);

    // ---- credentials ------------------------------------------------------------
    let aws = null, pair = null, edge = null;
    if (api.auth?.t === "aws") {
      const cred = credentialFor(api, ctx);
      aws = cred && parseAwsCredentials(cred.value ?? "");
      if (!aws) throw new UpstreamAuthRequired(api.name, api.auth);
    } else if (api.auth?.t === "edgegrid") {
      const cred = credentialFor(api, ctx);
      edge = cred && parseEdgegrid(cred.value ?? "");
      if (!edge) throw new UpstreamAuthRequired(api.name, api.auth);
    } else if (api.auth?.t === "tc3" || api.auth?.t === "acs3") {
      const cred = credentialFor(api, ctx);
      pair = cred && parseKeyPair(cred.value ?? "");
      if (!pair) throw new UpstreamAuthRequired(api.name, api.auth);
    } else if (api.auth) {
      const cred = credentialFor(api, ctx);
      if (!cred) throw new UpstreamAuthRequired(api.name, api.auth);
      if (cred.raw) headers.authorization = cred.raw;
      else if (api.auth.t === "key") {
        if (api.auth.in === "query") query.set(api.auth.name, cred.value);
        else headers[api.auth.name.toLowerCase()] = cred.value;
      } else if (api.auth.t === "basic") headers.authorization = "Basic " + btoa(cred.value);
      else headers.authorization = /^bearer\s/i.test(cred.value) ? cred.value : `Bearer ${cred.value}`;
    } else {
      // Some specs omit their security scheme. If the caller still sends credentials, pass them on.
      const u = ctx.upstreamAuth ?? {};
      if (u.authorization) headers.authorization = u.authorization;
      else if (u.key) headers.authorization = /^bearer\s/i.test(u.key) ? u.key : `Bearer ${u.key}`;
    }

    // ---- body ---------------------------------------------------------------------
    let body;
    if (op.body >= 5 && params.body !== undefined) {
      headers["content-type"] = "application/xml";
      body = typeof params.body === "string" ? params.body : String(params.body);
    } else if (op.body && params.body !== undefined) {
      const b = typeof params.body === "string" ? safeJson(params.body) : params.body;
      if (op.body >= 3) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(Object.entries(b ?? {}).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])).toString();
      } else {
        headers["content-type"] = api.ct ?? "application/json";
        body = JSON.stringify(isObj(b) && Object.keys(jsonBody).length ? { ...b, ...jsonBody } : b);
      }
    } else if (Object.keys(jsonBody).length || api.auth?.t === "tc3") {
      headers["content-type"] = "application/json";
      body = JSON.stringify({ ...(isObj(params.body) ? params.body : typeof params.body === "string" ? safeJson(params.body) : {}), ...jsonBody });
    } else if (api.ct && op.method !== "GET") {
      headers["content-type"] = api.ct; // AWS JSON protocol: an empty object when there is nothing to send
      body = "{}";
    }

    let url = base + path + (query.toString() ? (path.includes("?") ? "&" : "?") + query : "");
    let res;
    for (let hop = 0; hop <= 3; hop++) {
      await checkHost(url, ctx.lookup, api.name);
      const sendBody = op.method === "GET" || op.method === "HEAD" ? undefined : body;
      const sent = edge ? signEdgegrid({ method: op.method, url, headers, body: sendBody, credentials: edge })
        : pair && api.auth.t === "tc3" ? signTc3({ url, headers, body: sendBody, service: api.auth.svc, credentials: pair })
        : pair ? signAcs3({ method: op.method, url, headers, body: sendBody, credentials: pair })
        : aws ? signAws({ method: op.method, url, headers, body: sendBody, service: api.auth.svc, region: api.auth.g ? "us-east-1" : awsRegionFromHost(new URL(url).hostname), credentials: aws, s3: !!api.auth.s3 }) : headers;
      try {
        res = await ctx.fetch(url, { method: op.method, headers: sent, body: op.method === "GET" || op.method === "HEAD" ? undefined : body, redirect: "manual", signal: ctx.signal });
      } catch (e) {
        if (e?.name === "AbortError" || e?.name === "ZieTimeout") throw e;
        throw new HttpError(502, { content: null, message: `${api.name} is unreachable`, errors: [] });
      }
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      url = new URL(loc, url).toString();
      if (op.method !== "GET") break;
    }

    const data = await readBody(res);
    if (res.ok) return data;
    const snippet = typeof data === "object" ? data : { text: String(data).slice(0, 500) };
    if (res.status >= 500) throw new HttpError(502, { content: { upstreamStatus: res.status }, message: `${api.name} returned ${res.status}`, errors: [] });
    if (res.status === 429) throw new HttpError(429, { content: { upstreamStatus: 429, window: "upstream" }, message: `${api.name} rate-limited this request. Try again later.`, errors: [] }, { "Retry-After": res.headers.get("retry-after") ?? "60" });
    throw new ScraperError(`${api.name} returned ${res.status}`, { context: { upstreamStatus: res.status, body: trim(snippet) } });
  };
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    throw new ScraperError("body must be valid JSON");
  }
}
function trim(v) {
  const s = JSON.stringify(v);
  return s.length > 1500 ? s.slice(0, 1500) + "…" : v;
}
