// Legal pages name the operating company and stay free of em dashes; machine files are not shown as buttons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { MemoryKV } from "../src/db/kv.js";
import { LEGAL_DOCS } from "../src/web/legal.js";

test("legal pages: company, address, no em dashes, working anchors", async () => {
  const app = createApp({ logger: null, quiet: true, apiUrl: "http://api.test", publicUrl: "http://zie.test", scrapers: [], kv: new MemoryKV(), env: {} });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    for (const slug of Object.keys(LEGAL_DOCS)) {
      const html = await (await fetch(`${base}/${slug}`)).text();
      assert.match(html, /Ziera Technology/, slug);
      assert.match(html, /Somodaran, Kalasan, Sleman, DI Yogyakarta, Indonesia 55571/, slug);
      assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, ""), /—/, `${slug} has an em dash`);
      for (const [, id] of html.matchAll(/href="#([a-z0-9-]+)"/g)) assert.match(html, new RegExp(`id="${id}"`), `${slug} anchor #${id}`);
    }
    const terms = await (await fetch(`${base}/terms`)).text();
    for (const h of ["Governing law", "Limitation of liability", "Bring your own provider key", "Prices, payment and taxes"]) assert.ok(terms.includes(h), h);
    const privacy = await (await fetch(`${base}/privacy`)).text();
    for (const h of ["UU PDP", "3 x 24 hours", "never stored or logged", "International transfers"]) assert.ok(privacy.includes(h), h);
    const cat = await (await fetch(`${base}/scrapers`)).text();
    assert.doesNotMatch(await (await fetch(`${base}/`)).text(), /href="\/llms\.txt">llms\.txt/);
    assert.ok(cat.length > 0);
  } finally {
    await new Promise((r) => app.server.close(r));
  }
});
