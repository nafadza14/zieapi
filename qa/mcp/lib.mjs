// Shared QA harness: boots the real Apizie app on a local port and connects the official MCP SDK client.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ROOT = process.env.APIZIE_ROOT ?? new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
export { ROOT };

export async function boot({ fetchMode = "stub", plan = "max", env = {}, lookup } = {}) {
  const { createApp } = await import(`${ROOT}/src/app.js`);
  const { MemoryKV } = await import(`${ROOT}/src/db/kv.js`);
  const upstreamCalls = [];
  const stub = async (u, init = {}) => {
    upstreamCalls.push({ url: String(u), method: init.method ?? "GET" });
    const s = String(u);
    const body = /pwnedpasswords/.test(s) ? "0018A45C4D1DEF81644B54AB7F969B88D65:1" : /proxy\.golang\.org.*\/@v\/list/.test(s) ? "v1.0.0" : /crt\.sh/.test(s) ? "[]" : "{}";
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };
  const real = async (u, init) => {
    upstreamCalls.push({ url: String(u), method: init?.method ?? "GET" });
    return globalThis.fetch(u, init);
  };
  const kv = new MemoryKV();
  const app = createApp({ quiet: true, logger: null, kv, env: { ZIE_SESSION_SECRET: "qa-secret-not-real", ...env }, apiUrl: "http://127.0.0.1", publicUrl: "http://127.0.0.1", fetch: fetchMode === "real" ? real : fetchMode === "stub" ? stub : fetchMode, supabaseAuth: null, ...(lookup !== undefined ? { lookup } : fetchMode === "stub" ? { lookup: async () => [{ address: "93.184.215.14", family: 4 }] } : {}) });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const mkUser = async (email, p = plan) => {
    let u = await app.repo.createUser({ email, name: email.split("@")[0], role: "user" });
    if (p !== "free") u = await app.repo.updateUser(u.id, { plan: p, planExpiresAt: new Date(Date.now() + 30 * 86400e3).toISOString() });
    const { secret } = await app.repo.createKey(u.id, { name: "qa" });
    return { user: u, key: secret };
  };
  return { app, base, upstreamCalls, mkUser, close: () => new Promise((r) => app.server.close(r)) };
}

export async function connect(base, key, { name = "apizie-qa", headers = {} } = {}) {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { ...(key ? { "x-api-key": key } : {}), ...headers } } });
  await client.connect(transport);
  return client;
}

export const parse = (r) => r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? "null");

export async function rpc(base, key, body, headers = {}) {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { "x-api-key": key } : {}), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: Object.fromEntries(res.headers), json, text };
}

export function pct(arr, p) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return +a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))].toFixed(2);
}
