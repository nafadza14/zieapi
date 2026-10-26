// Copy this file, rename it, then add it to ./index.js.
// Only scrape sources whose terms allow it; prefer official/public APIs.

import { ScraperError } from "../executor.js";

export default [
  {
    category: "news", // must exist in DEFAULT_CATEGORIES (src/catalog.js)
    slug: "my-source", // → project key "news:my-source"
    displayName: "My Source",
    description: "What this scraper returns.",
    tags: ["news"],
    minPlan: null, // "pro" | "ultra" | "max" to gate the whole scraper
    indonesian: false, // shows up under the "Indonesian sources" filter
    endpoints: [
      {
        slug: "search", // → GET /v1/news:my-source/search
        displayName: "Search",
        method: "GET", // or "POST" (params from JSON body)
        cacheTtl: 300, // seconds; 0 = no cache
        pathTemplate: null, // e.g. ":id" → /v1/news:my-source/search/<id>
        minPlan: null,
        bulkEnabled: false,
        timeoutMs: 20000,
        fields: [
          { name: "q", type: "string", required: true, min: 2, description: "Query", example: "ekonomi" },
          { name: "page", type: "integer", default: 1, min: 1, max: 50 },
        ],
        exampleResponse: { items: [], page: 1 },
        // params are validated + coerced; ctx = { fetch, signal, lookup, key, project, endpoint }
        handler: async ({ q, page }, ctx) => {
          const res = await ctx.fetch(`https://example.org/api?q=${encodeURIComponent(q)}&page=${page}`, { signal: ctx.signal });
          if (!res.ok) throw new ScraperError(`Upstream returned ${res.status}`); // → HTTP 400 exec error
          const j = await res.json();
          return { items: j.items ?? [], page };
        },
      },
    ],
  },
];
