// Example of an upstream-backed scraper using a documented public API
// (Frankfurter — ECB reference rates, no key). Shows the ScraperError path.

import { ScraperError } from "../executor.js";

const UPSTREAM = process.env.ZIE_FX_UPSTREAM ?? "https://api.frankfurter.dev/v1";
const CCY = "^[A-Z]{3}$";

async function getJson(ctx, url) {
  let res;
  try {
    res = await ctx.fetch(url, { signal: ctx.signal, headers: { accept: "application/json", "user-agent": "zieapi/1" } });
  } catch (e) {
    throw new ScraperError("Upstream unreachable", { context: { upstream: "frankfurter", reason: e.message } });
  }
  if (!res.ok) throw new ScraperError(`Upstream returned ${res.status}`, { context: { upstream: "frankfurter" } });
  return res.json();
}

export default [
  {
    category: "finance",
    slug: "fx",
    displayName: "Kurs Valuta (ECB)",
    description: "Kurs referensi harian European Central Bank, termasuk IDR.",
    tags: ["kurs", "forex", "idr", "usd", "currency", "finance"],
    indonesian: true,
    endpoints: [
      {
        slug: "latest",
        displayName: "Latest Rates",
        method: "GET",
        cacheTtl: 3600,
        fields: [
          { name: "base", type: "string", required: false, default: "USD", pattern: CCY, description: "Base currency (ISO 4217)" },
          { name: "symbols", type: "string", required: false, description: "Comma-separated targets, e.g. IDR,SGD", example: "IDR" },
        ],
        exampleResponse: { base: "USD", date: "2026-10-23", rates: { IDR: 16000 } },
        handler: async ({ base, symbols }, ctx) => {
          const qs = new URLSearchParams({ base });
          if (symbols) qs.set("symbols", symbols.toUpperCase());
          const j = await getJson(ctx, `${UPSTREAM}/latest?${qs}`);
          return { base: j.base, date: j.date, rates: j.rates, provider: "ecb/frankfurter" };
        },
      },
      {
        slug: "convert",
        displayName: "Convert",
        method: "GET",
        cacheTtl: 3600,
        bulkEnabled: true,
        fields: [
          { name: "amount", type: "number", required: true, min: 0, example: 100 },
          { name: "from", type: "string", required: true, pattern: CCY, example: "USD" },
          { name: "to", type: "string", required: true, pattern: CCY, example: "IDR" },
        ],
        exampleResponse: { amount: 100, from: "USD", to: "IDR", rate: 16000, result: 1600000, date: "2026-10-23" },
        handler: async ({ amount, from, to }, ctx) => {
          if (from === to) return { amount, from, to, rate: 1, result: amount, date: null, provider: "ecb/frankfurter" };
          const j = await getJson(ctx, `${UPSTREAM}/latest?${new URLSearchParams({ base: from, symbols: to })}`);
          const rate = j.rates?.[to];
          if (typeof rate !== "number") throw new ScraperError(`No rate for ${from}→${to}`);
          return { amount, from, to, rate, result: Math.round(amount * rate * 100) / 100, date: j.date, provider: "ecb/frankfurter" };
        },
      },
    ],
  },
];
