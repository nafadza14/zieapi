// AWS Signature Version 4 for bring-your-own-key calls to AWS service APIs.
// https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
// The caller's credentials are used for this one request only: never stored, never logged.

import { createHash, createHmac } from "node:crypto";

const sha256hex = (data) => createHash("sha256").update(data ?? "").digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
// RFC 3986 encoding as AWS expects it (encodeURIComponent leaves !'()* alone).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** "AKID:SECRET" or "AKID:SECRET:SESSION_TOKEN" -> credentials, or null. */
export function parseAwsCredentials(value) {
  const parts = String(value ?? "").trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const [accessKeyId, secretAccessKey, sessionToken] = parts;
  if (!/^[A-Z0-9]{16,128}$/.test(accessKeyId) || secretAccessKey.length < 16) return null;
  return { accessKeyId, secretAccessKey, sessionToken: sessionToken || null };
}

/** Region for signing: from the host (svc.<region>.amazonaws.com), else us-east-1 for global endpoints. */
export function awsRegionFromHost(host) {
  const m = /(?:^|\.)((?:[a-z]{2}(?:-gov|-iso[a-z]*)?)-[a-z]+-\d+)\.amazonaws\.com(?:\.cn)?$/.exec(host);
  return m ? m[1] : "us-east-1";
}

/**
 * Sign a request in place: returns the headers to send (adds x-amz-date, x-amz-content-sha256 for S3,
 * x-amz-security-token and authorization).
 */
export function signAws({ method, url, headers, body, service, region, credentials, s3 = false, now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body ?? "");
  const h = { ...headers, host: u.host, "x-amz-date": amzDate };
  if (s3) h["x-amz-content-sha256"] = payloadHash; // S3 requires it; other services do not
  if (credentials.sessionToken) h["x-amz-security-token"] = credentials.sessionToken;

  // Canonical URI: each segment URI-encoded; non-S3 services encode the already-encoded path a second time.
  const segs = u.pathname.split("/").map((seg) => {
    const raw = safeDecode(seg);
    return s3 ? enc(raw) : enc(enc(raw));
  });
  const canonicalUri = segs.join("/") || "/";
  const q = [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const canonicalQuery = q.map(([k, v]) => `${k}=${v}`).join("&");
  const signed = Object.keys(h).map((k) => k.toLowerCase()).filter((k) => k === "host" || k.startsWith("x-amz-") || k === "content-type").sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
  const canonicalHeaders = signed.map((k) => `${k}:${lower[k]}\n`).join("");
  const signedHeaders = signed.join(";");
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kDate = hmac("AWS4" + credentials.secretAccessKey, date);
  const kSigning = hmac(hmac(hmac(kDate, region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  h.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete h.host; // fetch sets it from the URL
  return h;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
