// Request signing for Tencent Cloud (TC3-HMAC-SHA256) and Alibaba Cloud (ACS3-HMAC-SHA256), bring-your-own-key.
// https://www.tencentcloud.com/document/api/213/33224   https://www.alibabacloud.com/help/en/sdk/product-overview/v3-request-structure-and-signature
// The caller's keys are used for this one request only: never stored, never logged.

import { createHash, createHmac, randomUUID } from "node:crypto";

const sha256hex = (d) => createHash("sha256").update(d ?? "").digest("hex");
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** "ID:SECRET" -> { id, secret }, or null. */
export function parseKeyPair(value) {
  const i = String(value ?? "").indexOf(":");
  if (i < 8) return null;
  const id = value.slice(0, i).trim(), secret = value.slice(i + 1).trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(id) && secret.length >= 8 ? { id, secret } : null;
}

/** Tencent Cloud API 3.0: POST JSON to https://<svc>.tencentcloudapi.com/ with an X-TC-Action header. */
export function signTc3({ url, headers, body, service, credentials, now = new Date() }) {
  const u = new URL(url);
  const ts = Math.floor(now.getTime() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const ct = "application/json"; // same headers as Tencent's own SDKs sign
  const canonical = ["POST", "/", "", `content-type:${ct}\nhost:${u.host}\n`, "content-type;host", sha256hex(body ?? "")].join("\n");
  const scope = `${date}/${service}/tc3_request`;
  const toSign = ["TC3-HMAC-SHA256", String(ts), scope, sha256hex(canonical)].join("\n");
  const key = hmac(hmac(hmac("TC3" + credentials.secret, date), service), "tc3_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...headers,
    "content-type": ct,
    "x-tc-timestamp": String(ts),
    authorization: `TC3-HMAC-SHA256 Credential=${credentials.id}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
  };
}

/** Alibaba Cloud V3 signature, for both RPC (parameters in the query) and ROA (REST path + JSON body) APIs. */
export function signAcs3({ method, url, headers, body, credentials, now = new Date(), nonce = randomUUID() }) {
  const u = new URL(url);
  const h = { ...headers, host: u.host, "x-acs-date": now.toISOString().replace(/\.\d{3}Z$/, "Z"), "x-acs-signature-nonce": nonce, "x-acs-content-sha256": sha256hex(body ?? "") };
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const signed = Object.keys(lower).filter((k) => k === "host" || k === "content-type" || k.startsWith("x-acs-")).sort();
  const q = [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const canonicalUri = u.pathname.split("/").map((s) => enc(safeDecode(s))).join("/") || "/";
  const canonical = [method, canonicalUri, q.map(([k, v]) => `${k}=${v}`).join("&"), signed.map((k) => `${k}:${lower[k]}\n`).join(""), signed.join(";"), lower["x-acs-content-sha256"]].join("\n");
  const toSign = "ACS3-HMAC-SHA256\n" + sha256hex(canonical);
  const signature = createHmac("sha256", credentials.secret).update(toSign).digest("hex");
  h.authorization = `ACS3-HMAC-SHA256 Credential=${credentials.id},SignedHeaders=${signed.join(";")},Signature=${signature}`;
  delete h.host;
  return h;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Akamai EdgeGrid (EG1-HMAC-SHA256). Credentials: "CLIENT_TOKEN:CLIENT_SECRET:ACCESS_TOKEN" from an Akamai API client.
 * https://techdocs.akamai.com/developer/docs/authenticate-with-edgegrid
 */
export function parseEdgegrid(value) {
  const parts = String(value ?? "").trim().split(":");
  if (parts.length !== 3 || parts.some((p) => p.length < 8)) return null;
  const [clientToken, clientSecret, accessToken] = parts;
  return { clientToken, clientSecret, accessToken };
}

const b64hmac = (key, data) => createHmac("sha256", key).update(data).digest("base64");
export function signEdgegrid({ method, url, headers, body, credentials, now = new Date(), nonce = randomUUID(), maxBody = 131072 }) {
  const u = new URL(url);
  const ts = now.toISOString().replace(/[-]/g, "").replace(/\.\d{3}Z$/, "+0000"); // 20240102T03:04:05+0000
  const authHeader = `EG1-HMAC-SHA256 client_token=${credentials.clientToken};access_token=${credentials.accessToken};timestamp=${ts};nonce=${nonce};`;
  const contentHash = method === "POST" && body ? createHash("sha256").update(Buffer.from(body).subarray(0, maxBody)).digest("base64") : "";
  const data = [method, u.protocol.replace(":", ""), u.host, u.pathname + u.search, "", contentHash, authHeader].join("\t");
  const signingKey = b64hmac(credentials.clientSecret, ts);
  return { ...headers, authorization: authHeader + "signature=" + b64hmac(signingKey, data) };
}
