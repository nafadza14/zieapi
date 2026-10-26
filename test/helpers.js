import { createApp } from "../src/app.js";
import { createApiKey } from "../src/auth.js";

export async function boot(opts = {}) {
  const app = createApp({ logger: null, quiet: true, apiUrl: "http://api.test", publicUrl: "http://zie.test", adminToken: "admin-secret", ...opts });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const keys = {};
  for (const plan of ["free", "pro", "ultra", "max"]) keys[plan] = createApiKey(app.store, { plan, name: plan }).key;

  async function call(path, { method = "GET", key, headers = {}, body, raw } = {}) {
    const h = { ...headers };
    if (key) h["x-api-key"] = key;
    let payload;
    if (body !== undefined) {
      h["content-type"] = "application/json";
      payload = raw ? body : JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, headers: h, body: payload });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  return { app, base, keys, call, close: () => new Promise((r) => app.server.close(r)) };
}
