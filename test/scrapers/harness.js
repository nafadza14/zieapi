// Helpers for scraper module tests.
import assert from "node:assert/strict";

const TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Validate the static shape of a scraper module's default export. */
export function checkModule(defs) {
  assert.ok(Array.isArray(defs) && defs.length, "module must export a non-empty array");
  for (const s of defs) {
    assert.match(s.category, SLUG, `category ${s.category}`);
    assert.match(s.slug, SLUG, `slug ${s.slug}`);
    assert.ok(s.displayName, `${s.slug} needs displayName`);
    assert.ok(Array.isArray(s.endpoints) && s.endpoints.length, `${s.slug} needs endpoints`);
    const seen = new Set();
    for (const e of s.endpoints) {
      assert.match(e.slug, SLUG, `${s.slug}/${e.slug} slug`);
      assert.ok(!seen.has(e.slug), `${s.slug}/${e.slug} duplicated`);
      seen.add(e.slug);
      assert.ok(["GET", "POST"].includes(e.method ?? "GET"), `${s.slug}/${e.slug} method`);
      assert.equal(typeof e.handler, "function", `${s.slug}/${e.slug} handler`);
      for (const fl of e.fields ?? []) {
        assert.ok(fl.name && TYPES.has(fl.type), `${s.slug}/${e.slug} field ${JSON.stringify(fl)}`);
      }
      if (e.pathTemplate) {
        for (const p of e.pathTemplate.split("/").filter((x) => x.startsWith(":"))) {
          assert.ok((e.fields ?? []).some((fl) => fl.name === p.slice(1)), `${s.slug}/${e.slug} path param ${p} needs a field`);
        }
      }
    }
  }
}

/**
 * Mock fetch. `routes` is an array of [matcher, response] where matcher is a
 * substring or RegExp tested against the URL, and response is an object/array
 * (→ JSON), a string (→ text), or a function (url, init) => Response.
 * Records calls in mock.calls.
 */
export function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const [m, r] of routes) {
      if (typeof m === "string" ? u.includes(m) : m.test(u)) {
        if (typeof r === "function") return r(u, init);
        if (typeof r === "string") return new Response(r, { status: 200, headers: { "content-type": "text/plain" } });
        return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response("not mocked: " + u, { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

/** Find an endpoint handler and run it with params + mock fetch. */
export async function run(defs, key, endpoint, params, fetch) {
  const [cat, slug] = key.split(":");
  const s = defs.find((x) => x.category === cat && x.slug === slug);
  assert.ok(s, `scraper ${key} not found`);
  const e = s.endpoints.find((x) => x.slug === endpoint);
  assert.ok(e, `endpoint ${key}/${endpoint} not found`);
  // apply defaults like the validator does
  const p = { ...params };
  for (const fl of e.fields ?? []) if (p[fl.name] === undefined && fl.default !== undefined) p[fl.name] = fl.default;
  return e.handler(p, { fetch, signal: undefined, key: { id: "t", plan: "max" }, project: key, endpoint });
}
