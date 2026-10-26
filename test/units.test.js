import { test } from "node:test";
import assert from "node:assert/strict";
import { terbilang, formatRupiah } from "../src/scrapers/indonesia.js";
import { isPrivateIp, assertPublicUrl } from "../src/scrapers/web-tools.js";
import { validateParams } from "../src/validate.js";
import { effectiveTtl } from "../src/cache.js";
import { extractKey } from "../src/auth.js";

test("terbilang", () => {
  const cases = {
    0: "nol", 1: "satu", 11: "sebelas", 12: "dua belas", 19: "sembilan belas", 20: "dua puluh", 100: "seratus", 115: "seratus lima belas",
    1000: "seribu", 1001: "seribu satu", 2500: "dua ribu lima ratus", 1000000: "satu juta", 1500000000: "satu miliar lima ratus juta",
    [-7]: "minus tujuh", 2.5: "dua koma lima",
  };
  for (const [n, w] of Object.entries(cases)) assert.equal(terbilang(Number(n)), w, n);
});

test("formatRupiah", () => {
  assert.equal(formatRupiah(1250000), "Rp1.250.000");
  assert.equal(formatRupiah(-1234.5, 2), "-Rp1.234,50");
});

test("private IP detection + SSRF guard", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) assert.ok(!isPrivateIp(ip), ip);
  await assert.rejects(assertPublicUrl("http://127.0.0.1/"), /private/);
  await assert.rejects(assertPublicUrl("file:///etc/passwd"), /http/);
  await assert.rejects(assertPublicUrl("http://evil.test/", async () => [{ address: "10.0.0.5" }]), /private/);
  const u = await assertPublicUrl("https://ok.test/x", async () => [{ address: "93.184.216.34" }]);
  assert.equal(u.hostname, "ok.test");
});

test("validator coerces query strings", () => {
  const fields = [
    { name: "n", type: "integer", required: true, min: 1, max: 5 },
    { name: "b", type: "boolean", default: false },
    { name: "tags", type: "array" },
  ];
  assert.deepEqual(validateParams(fields, { n: "3", b: "true", tags: "a,b" }).value, { n: 3, b: true, tags: ["a", "b"] });
  assert.equal(validateParams(fields, { n: "9" }).errors[0].path, "n");
  assert.equal(validateParams(fields, { n: "1.5" }).errors[0].message, "Expected integer");
});

test("effective cache ttl by plan", () => {
  assert.deepEqual(effectiveTtl(600, 0, null), { readTtl: 600, writeTtl: 600 }); // free: no control
  assert.deepEqual(effectiveTtl(600, 5, 30), { readTtl: 30, writeTtl: 600 }); // pro floor 30s
  assert.deepEqual(effectiveTtl(600, 0, 0), { readTtl: 0, writeTtl: 600 }); // ultra bypass
  assert.deepEqual(effectiveTtl(600, 9999, 0), { readTtl: 600, writeTtl: 600 });
});

test("key extraction order", () => {
  assert.equal(extractKey({ "x-api-key": "a", authorization: "Bearer b" }), "a");
  assert.equal(extractKey({ authorization: "bearer  c " }), "c");
  assert.equal(extractKey({}), null);
});
