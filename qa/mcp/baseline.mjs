// Baseline (before any fix): protocol handshake, tool list, and how much of the catalog an MCP client can enumerate.
import { boot, connect, parse } from "./lib.mjs";

const env = await boot();
const { key } = await env.mkUser("qa-a@example.test");
const out = {};
try {
  const c = await connect(env.base, key);
  out.server = c.getServerVersion();
  out.protocol = c.transport?.protocolVersion ?? null;
  const tools = (await c.listTools()).tools;
  out.tools = tools.map((t) => t.name);
  const canonical = new Set(env.app.catalog.scrapers.map((s) => s.key));
  out.canonicalSources = canonical.size;

  // 1. plain listing, then try a cursor the way a paginating agent would
  const seen = new Set();
  const r1 = parse(await c.callTool({ name: "search_scrapers", arguments: { limit: 50 } }));
  r1.items.forEach((i) => seen.add(i.key));
  out.searchFirstPage = { returned: r1.items.length, total: r1.total, nextCursor: r1.nextCursor };
  const r2 = parse(await c.callTool({ name: "search_scrapers", arguments: { limit: 50, cursor: r1.nextCursor } }));
  out.secondPageSameAsFirst = r2.items.every((i, n) => i.key === r1.items[n].key);
  // 2. union over every category
  const cats = parse(await c.callTool({ name: "list_categories", arguments: {} })).categories;
  for (const cat of cats) parse(await c.callTool({ name: "search_scrapers", arguments: { category: cat.slug, limit: 50 } })).items.forEach((i) => seen.add(i.key));
  out.discoverableViaListAndCategories = seen.size;
  out.discoveryCoveragePct = +((100 * seen.size) / canonical.size).toFixed(1);
  // 3. can an agent learn the endpoint slugs of a source?
  const item = r1.items[0];
  out.searchItemFields = Object.keys(item);
  out.searchItemHasEndpointSlugs = "endpoints" in item;
  const noEp = await c.callTool({ name: "get_scraper_schema", arguments: { scraper: item.key } });
  out.schemaWithoutEndpoint = { isError: noEp.isError, text: noEp.content[0].text.slice(0, 160) };
  await c.close();
} finally {
  await env.close();
}
console.log(JSON.stringify(out, null, 2));
