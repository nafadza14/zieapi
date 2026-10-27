// Markdown twins of public pages, served at <path>.md or with Accept: text/markdown.
// AI assistants and agents read these far more reliably than the JS-enhanced HTML.

import { PLANS, PLAN_COPY } from "../core/plans.js";
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
