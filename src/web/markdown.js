// Markdown twins of public pages, served at <path>.md or with Accept: text/markdown.
// AI assistants and agents read these far more reliably than the JS-enhanced HTML.

import { PLANS, PLAN_COPY, LICENCE_COPY, FINANCE_PLANS, FINANCE_PAYG } from "../core/plans.js";
import { BRAND, apiSummary, apiFaq, htmlToMd } from "./seo.js";

const n = (x) => Number(x ?? 0).toLocaleString("en-US");

export function homeMd({ totals, categories, publicUrl, apiUrl, faq }) {
  return `# Apizie: ${BRAND.tagline}

> ${BRAND.description}

- Catalog: ${n(totals.scrapers)} APIs, ${n(totals.endpoints)} endpoints, ${totals.categories} categories (${n(totals.liveEndpoints)} live endpoints)
- REST: \`GET ${apiUrl}/v1/{category}:{api}/{endpoint}?param=value\` with header \`x-api-key\`
- Response: \`{ project, data, timestamp }\`; errors \`{ content, message, errors }\`
- MCP: \`${apiUrl}/mcp\` (Streamable HTTP, OAuth 2.1 or API key) for Claude, ChatGPT, Cursor, VS Code, Gemini CLI
- Free plan: 1,000 requests/month, 100/minute, no credit card. Paid: Pro $9, Ultra $29, Max $99 per month (2 months free yearly)
- OpenAPI: ${apiUrl}/openapi.json · llms.txt: ${publicUrl}/llms.txt

## How it works
1. Get a free API key at ${publicUrl}/register
2. Pick an API at ${publicUrl}/scrapers
3. Call it and get JSON. Same URL pattern and envelope for every source.

## Why Apizie
- One key, one format: every source answers with the same envelope.
- Built for AI agents: native MCP server for Claude, ChatGPT, Cursor and VS Code.
- Official sources only: official APIs, open data and publisher feeds.
- Your keys stay yours: provider keys in \`x-upstream-key\` are never stored or logged.
- See every call: request logs, latency, errors, usage alerts and webhooks.
- Start free: 1,000 requests a month, paid plans from $9, pay-as-you-go above quota.

## Example
\`\`\`
curl "${apiUrl}/v1/search-tools:wikipedia/search?query=Eiffel%20Tower" -H "x-api-key: $APIZIE_KEY"
\`\`\`

## Categories
${categories.map((c) => `- [${c.displayName}](${publicUrl}/category/${c.slug}): ${c.scrapers} APIs, ${c.endpoints} endpoints`).join("\n")}

## FAQ
${faq.map(([q, a]) => `### ${q}\n${a}`).join("\n\n")}
`;
}

export function apiMd({ s, category, publicUrl, apiUrl }) {
  const lines = [
    `# ${s.displayName} API`,
    "",
    `> ${apiSummary(s, apiUrl)}`,
    "",
    `- Project key: \`${s.key}\``,
    `- Category: ${category?.displayName ?? s.category}`,
    `- Status: ${s.status}`,
    s.sourceUrl ? `- Source: ${s.sourceUrl}` : null,
    `- Page: ${publicUrl}/api/${s.category}/${s.slug}`,
    `- OpenAPI: ${publicUrl}/api/${s.category}/${s.slug}/openapi.json`,
    "",
    s.description ?? "",
    "",
    "## Endpoints",
  ].filter((x) => x !== null);
  for (const e of s.endpoints.slice(0, 120)) {
    lines.push("", `### ${e.displayName}`, `\`${e.method} ${apiUrl}/v1/${s.key}/${e.slug}${e.pathTemplate ? "/" + e.pathTemplate : ""}\`${e.status === "live" ? "" : ` (${e.status})`}`);
    if (e.fields?.length) {
      lines.push("", "| Parameter | Type | Required | Description |", "|---|---|---|---|");
      for (const f of e.fields) lines.push(`| ${f.name} | ${f.type} | ${f.required ? "yes" : "no"} | ${(f.description ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} |`);
    }
  }
  if (s.endpoints.length > 120) lines.push("", `…and ${s.endpoints.length - 120} more. See the OpenAPI spec.`);
  const ep = s.endpoints[0];
  if (ep) lines.push("", "## Example", "```", `curl "${apiUrl}/v1/${s.key}/${ep.slug}" \\`, `  -H "x-api-key: $APIZIE_KEY"${s.status === "byok" ? ' \\\n  -H "x-upstream-key: $PROVIDER_KEY"' : ""}`, "```");
  lines.push("", "## FAQ", ...apiFaq(s, apiUrl).map(([q, a]) => `\n### ${q}\n${a}`));
  return lines.join("\n") + "\n";
}

export function pricingMd({ faq, publicUrl }) {
  const rows = Object.values(PLANS).map((p) => `| ${PLAN_COPY[p.id]?.name ?? p.id} | ${p.priceUsd ? "$" + p.priceUsd + "/month" : "Free"} | ${n(p.monthly)} | ${n(p.perMinute)} | ${p.bulk ? `yes (${p.bulkCap})` : "no"} |`);
  return `# Apizie pricing

| Plan | Price | Requests / month | Requests / minute | Bulk |
|---|---|---|---|---|
${rows.join("\n")}

5xx errors are refunded automatically. Quotas reset on the 1st (UTC). Sign up: ${publicUrl}/register

## FAQ
${faq.map(([q, a]) => `### ${q}\n${a}`).join("\n\n")}
`;
}

export function docMd({ page, apiUrl }) {
  return `# ${page.title}\n\n${htmlToMd(page.body(apiUrl))}`;
}

export function categoryMd({ category, items, publicUrl }) {
  return `# ${category.displayName} APIs on Apizie

> ${category.description} ${category.scrapers} APIs, ${category.endpoints} endpoints, one API key.

${items.map((i) => `- [${i.displayName}](${publicUrl}/api/${i.category}/${i.slug}) \`${i.key}\`: ${i.endpointCount} endpoints, ${i.status}${i.description ? `. ${i.description.slice(0, 140)}` : ""}`).join("\n")}
`;
}

// Apizie Finance page twin (/finance.md).
export function financeMd({ totals, publicUrl, apiUrl, faq, official = [] }) {
  return `# Apizie Finance: official-source data for AI agents

> Apizie Finance is a premium Apizie service. It serves data from six official publishers (SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF and World Bank) through one REST API and one MCP server. Every answer carries its source: publisher, official link, retrieval time, licence and attribution text.

Apizie serves normalized data from six official publishers through one REST API and an MCP server. Every successful response includes a \`source\` block: publisher, official URL, retrieval time, licence and attribution text, so an AI agent can cite it.

## Official sources
${official.map((s) => `- [${s.name}](${publicUrl}/sources/${s.id}) (${s.publisher}): ${s.covers}. Licence: ${s.license}.`).join("\n")}

Combined endpoints: \`official:company/profile\` (SEC EDGAR + GLEIF: profile, filings, LEI, annual financials linked to filings), \`official:macro/us\`, \`official:macro/euro-area\`, \`official:macro/country\`.

## Use it
- REST: \`GET ${apiUrl}/v1/{category}:{source}/{endpoint}?param=value\` with header \`x-api-key\`
- Response: \`{ project, data, source, timestamp }\`; errors \`{ content, message, errors }\`
- MCP: \`${apiUrl}/mcp\` (Streamable HTTP, OAuth 2.1 or API key) for Claude, ChatGPT, Cursor, VS Code, Gemini CLI
- Keys are read-only by default and can be limited to categories.
- Data alerts: signed \`data.changed\` webhooks for new SEC filings, FRED updates, Treasury curves, ECB rate changes and World Bank values.

\`\`\`
curl "${apiUrl}/v1/official:company/profile?company=AAPL" -H "x-api-key: $APIZIE_KEY"
\`\`\`

## Pricing (premium add-on, no free tier)
${Object.values(FINANCE_PLANS).map((p) => `- ${p.name}: $${p.priceUsd}/month, ${n(p.monthly)} requests/month, ${LICENCE_COPY[p.licence].toLowerCase()}, ${p.alerts} data alerts`).join("\n")}
- Runs next to any Apizie plan with its own quota. Pay-as-you-go above the Finance quota: $${FINANCE_PAYG.usdPer1k.toFixed(2)} per 1,000 requests. Enterprise (redistribution, SLA): contact us.

## Also on Apizie
${n(totals.scrapers)} more public and bring-your-own-key APIs behind the same key (${totals.categories} categories). Bring-your-own-key APIs use your provider key, sent per request and never stored.

## FAQ
${faq.map(([q, a]) => `### ${q}\n${a}`).join("\n\n")}

Apizie is independent and not affiliated with or endorsed by the SEC, the Federal Reserve, the ECB, the U.S. Treasury, GLEIF or the World Bank. This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.
`;
}
