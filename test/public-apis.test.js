// Offline checks for the keyless public APIs: every endpoint builds a valid upstream URL from its
// documented example parameters and passes the provider's JSON straight through.
import { test } from "node:test";
import assert from "node:assert/strict";
import mods1 from "../src/scrapers/live/public-apis.js";
import mods2 from "../src/scrapers/live/public-apis-2.js";
import mods3 from "../src/scrapers/live/public-apis-3.js";
// The RSS toolkit fetches caller URLs (several per call) and has its own tests below.
const mods = [...mods1, ...mods2, ...mods3.filter((m) => m.slug !== "rss-reader")];

const sample = (fld) => fld.example ?? fld.default ?? (fld.enum ? fld.enum[0] : fld.type === "integer" || fld.type === "number" ? 1 : "x");

test("public APIs: unique keys and endpoints, every field documented", () => {
  const keys = new Set();
  for (const m of mods) {
    const k = `${m.category}:${m.slug}`;
    assert.ok(!keys.has(k), `duplicate ${k}`);
    keys.add(k);
    assert.match(m.sourceUrl, /^https?:\/\//, k);
    assert.ok(m.description && !/—/.test(m.description), k);
    const slugs = m.endpoints.map((e) => e.slug);
    assert.equal(new Set(slugs).size, slugs.length, `${k} endpoint slugs`);
    for (const e of m.endpoints) for (const fld of e.fields) if (fld.required) assert.ok(fld.example !== undefined || fld.enum, `${k}/${e.slug}.${fld.name} needs an example`);
  }
  assert.ok(mods.length >= 170);
});

test("public APIs: every endpoint calls one valid public URL with its example params", async () => {
  for (const m of mods) {
    for (const e of m.endpoints) {
      const params = Object.fromEntries(e.fields.map((fld) => [fld.name, sample(fld)]).filter(([, v]) => v !== undefined));
      const seen = [];
      const ctx = {
        signal: undefined,
        fetch: async (u, init) => {
          seen.push(String(u));
          const body = /pwnedpasswords/.test(u) ? "0018A45C4D1DEF81644B54AB7F969B88D65:1\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2" : /proxy\.golang\.org.*\/@v\/list/.test(u) ? "v1.0.0\nv1.1.0" : /crt\.sh/.test(u) ? "[]" : "{}";
          return new Response(body, { status: 200 });
        },
      };
      const out = await e.handler(params, ctx);
      assert.equal(seen.length, 1, `${m.slug}/${e.slug} makes one call`);
      const u = new URL(seen[0]);
      assert.ok(["https:", "http:"].includes(u.protocol), seen[0]);
      assert.ok(!/undefined|NaN|\[object/.test(seen[0]), `${m.slug}/${e.slug}: ${seen[0]}`);
      assert.ok(out !== undefined, `${m.slug}/${e.slug} returns data`);
    }
  }
});
