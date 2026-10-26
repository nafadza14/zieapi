// Generic OpenAPI connector: turns one operation from the API directory into a
// Apizie endpoint handler. The upstream server is fixed by the spec; callers can
// only fill parameters. Credentials for keyed APIs come from the caller
// (x-upstream-key / x-upstream-authorization, "bring your own key") or from a
// server env var APIZIE_UPSTREAM_KEY_<API_SLUG> (legacy ZIE_UPSTREAM_KEY_<API_SLUG> also works).

import { HttpError } from "./envelope.js";
import { ScraperError } from "./errors.js";
import { assertPublicUrl } from "../scrapers/ssrf.js";

const MAX_BYTES = 1_500_000;
const UA = "apizie-connector/1 (+https://github.com/nafadza14/zieapi)";
const hostOk = new Map(); // host -> expiry (SSRF check cache)

export class UpstreamAuthRequired extends HttpError {
  constructor(api, auth) {
    const how = auth.t === "basic" ? 'Send "username:password" in the x-upstream-key header.' : auth.t === "bearer" ? "Send your access token in the x-upstream-key header (or a full x-upstream-authorization header)." : `Send your ${api} API key in the x-upstream-key header.`;
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

async function checkHost(url, lookup) {
  const u = new URL(url);
  const exp = hostOk.get(u.host);
  if (exp && exp > Date.now()) return;
  await assertPublicUrl(url, lookup ?? undefined);
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

/**
 * api = { key, name, base, auth: null | {t:"key",in,name} | {t:"bearer"} | {t:"basic"} }
 * op  = { method, path, fields: [{name, src: "path"|"query"|"header"}], body: 0|1|2|3|4 }
 */
export function makeHandler(api, op) {
  return async (params, ctx) => {
    // ---- URL -----------------------------------------------------------------
    let path = op.path;
    const query = new URLSearchParams();
    const headers = { "user-agent": UA, accept: "application/json, */*;q=0.8" };
    for (const f of op.fields) {
      const v = params[f.name];
      if (v === undefined || v === null || v === "") continue;
      if (f.src === "path") path = path.replaceAll(`{${f.name}}`, encodeURIComponent(String(v)));
      else if (f.src === "header") headers[f.name.toLowerCase()] = String(v);
      else if (Array.isArray(v)) v.forEach((x) => query.append(f.name, typeof x === "object" ? JSON.stringify(x) : String(x)));
      else query.set(f.name, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    if (/\{[^}]+\}/.test(path)) throw new ScraperError(`Missing path parameter for ${op.path}`);

    // ---- credentials ------------------------------------------------------------
    if (api.auth) {
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
    if (op.body && params.body !== undefined) {
      const b = typeof params.body === "string" ? safeJson(params.body) : params.body;
      if (op.body >= 3) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(Object.entries(b ?? {}).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])).toString();
      } else {
        headers["content-type"] = "application/json";
        body = JSON.stringify(b);
      }
    }

    let url = api.base + path + (query.toString() ? (path.includes("?") ? "&" : "?") + query : "");
    let res;
    for (let hop = 0; hop <= 3; hop++) {
      await checkHost(url, ctx.lookup);
      try {
        res = await ctx.fetch(url, { method: op.method, headers, body: op.method === "GET" || op.method === "HEAD" ? undefined : body, redirect: "manual", signal: ctx.signal });
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
