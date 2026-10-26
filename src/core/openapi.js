// OpenAPI 3.1 + llms.txt generated from the live catalog (no hand-written drift).

import { maxPlan } from "./plans.js";
import { pathFieldNames } from "./catalog.js";

const jsonType = (t) => (t === "integer" ? "integer" : ["string", "number", "boolean", "array", "object"].includes(t) ? t : "string");

export function buildOpenApi(catalog, { apiUrl, version, category = null, only = null }) {
  const paths = {};
  for (const s of only ?? catalog.scrapers.filter((x) => !x.lazy && (!category || x.category === category))) {
    for (const e of s.endpoints) {
      const pathNames = pathFieldNames(e);
      const suffix = pathNames.map((n) => `/{${n}}`).join("");
      const p = `/v1/${s.key}/${e.slug}${suffix}`;
      const params = e.fields
        .filter((f) => (e.method === "GET" && f.in !== "body") || pathNames.includes(f.name))
        .map((f) => ({
          name: f.name,
          in: pathNames.includes(f.name) ? "path" : "query",
          required: pathNames.includes(f.name) ? true : !!f.required,
          description: f.description,
          schema: fieldSchema(f),
          ...(f.example !== undefined ? { example: f.example } : {}),
        }));
      const bodyFields = e.method !== "GET" ? e.fields.filter((f) => !pathNames.includes(f.name)) : [];
      paths[p] = {
        [e.method.toLowerCase()]: {
          operationId: `${s.key}_${e.slug}`.replace(/[^a-zA-Z0-9]+/g, "_"),
          summary: e.displayName,
          description: e.description ?? undefined,
          tags: [s.category],
          parameters: params,
          ...(bodyFields.length
            ? {
                requestBody: {
                  required: bodyFields.some((f) => f.required),
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: bodyFields.filter((f) => f.required).map((f) => f.name),
                        properties: Object.fromEntries(bodyFields.map((f) => [f.name, fieldSchema(f)])),
                      },
                    },
                  },
                },
              }
            : {}),
          responses: {
            200: {
              description: "Success",
              content: { "application/json": { schema: { $ref: "#/components/schemas/RunEnvelope" }, ...(e.exampleResponse ? { example: { project: s.key, data: e.exampleResponse, timestamp: "2026-01-01T00:00:00.000Z" } } : {}) } },
            },
            "4XX": { $ref: "#/components/responses/Error" },
            "5XX": { $ref: "#/components/responses/Error" },
          },
          "x-apizie-cache-ttl": e.cacheTtl,
          "x-apizie-min-plan": maxPlan(s.minPlan, e.minPlan),
          "x-apizie-bulk": e.bulkEnabled,
          "x-apizie-status": e.status,
        },
      };
    }
  }
  return {
    openapi: "3.1.0",
    info: { title: category ? `Apizie: ${category}` : "Apizie", version, description: "One API key, one envelope, many public data sources." },
    servers: [{ url: apiUrl }],
    security: [{ ApiKeyAuth: [] }],
    paths,
    components: {
      securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
        RunEnvelope: {
          type: "object",
          required: ["project", "data", "timestamp"],
          properties: { project: { type: "string", example: "dev-tools:hash" }, data: {}, timestamp: { type: "string", format: "date-time" } },
        },
        ErrorEnvelope: {
          type: "object",
          properties: { content: {}, message: { type: "string" }, errors: { type: "array", items: {} }, error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } },
        },
      },
      responses: { Error: { description: "Invalid key, plan gate, rate limit or upstream failure", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } } },
    },
  };
}

function fieldSchema(f) {
  const sc = { type: jsonType(f.type) };
  if (f.enum) sc.enum = f.enum;
  if (f.default !== undefined) sc.default = f.default;
  if (f.min !== undefined) sc[f.type === "string" ? "minLength" : f.type === "array" ? "minItems" : "minimum"] = f.min;
  if (f.max !== undefined) sc[f.type === "string" ? "maxLength" : f.type === "array" ? "maxItems" : "maximum"] = f.max;
  if (f.description) sc.description = f.description;
  return sc;
}

export function buildLlmsTxt(catalog, { apiUrl, publicUrl, category = null, full = true }) {
  const t = catalog.totals();
  const lines = [
    category ? `# Apizie: ${category} APIs` : "# Apizie",
    "",
    `> Apizie is one API key for ${t.scrapers} public data APIs (${t.endpoints} endpoints, ${t.categories} categories): Indonesian sources, finance and crypto, news, research, developer tools and 1,300+ global APIs, all returned as clean JSON. Includes an MCP server for Claude, ChatGPT and Cursor. Free plan: 600 requests/month, no credit card.`,
    "",
    "## Use it",
    `- Base URL: ${apiUrl}`,
    "- Auth: header `x-api-key: apz_...` (also `Authorization: Bearer` or `api-key`). Free key: " + `${publicUrl}/register`,
    "- Call: `GET|POST /v1/{category}:{api}/{endpoint}?param=value`",
    "- Success: `{ project, data, timestamp }`",
    "- Error: `{ content, message, errors }` (bulk/plan errors: `{ error: { code, message } }`)",
    "- Limits: headers `X-RateLimit-Remaining`, `X-RateLimit-Remaining-Month`, `Retry-After` on 429; 5xx are refunded",
    "- APIs marked (your key) need the provider's own key in `x-upstream-key`",
    "",
    "## Key pages",
    `- [MCP server setup](${publicUrl}/mcp): ${apiUrl}/mcp, Streamable HTTP, OAuth 2.1 or API key, 8 tools`,
    `- [Docs](${publicUrl}/docs) · [Quickstart](${publicUrl}/docs/quickstart) · [Errors](${publicUrl}/docs/errors) · [Bring your own key](${publicUrl}/docs/byok)`,
    `- [Pricing](${publicUrl}/pricing): Free 600/month, Pro Rp49.000, Ultra Rp129.000, Max Rp399.000`,
    `- [OpenAPI 3.1](${apiUrl}/openapi.json) · [Full catalog for LLMs](${publicUrl}/llms-full.txt)`,
    "- Any catalog or docs page has a Markdown twin: append `.md` (for example /api/search-tools/wikipedia.md)",
    "",
    "## Endpoints",
  ];
  for (const s of catalog.scrapers.filter((x) => !category || x.category === category)) {
    if (!full) {
      lines.push(`- [${s.displayName}](${publicUrl}/api/${s.category}/${s.slug}) \`${s.key}\`: ${s.lazy ? s._count : s.endpoints.length} endpoints${s.auth ? " (your key)" : ""}`);
      continue;
    }
    if (s.lazy) {
      lines.push(`- ${s.displayName} \`${s.key}\`: ${s._count} endpoints${s.auth ? " (your key)" : ""}. Spec: ${publicUrl}/api/${s.category}/${s.slug}/openapi.json`);
      continue;
    }
    lines.push("", `### ${s.displayName} (\`${s.key}\`)`, s.description ?? "");
    for (const e of s.endpoints) {
      const fields = e.fields.map((f) => `${f.name}${f.required ? "*" : ""}:${f.type}`).join(", ");
      lines.push(`- ${e.method} /v1/${s.key}/${e.slug}${e.pathTemplate ? "/" + e.pathTemplate : ""}: ${e.displayName}${fields ? ` (${fields})` : ""}${e.status === "live" ? "" : " [" + e.status + "]"}`);
    }
  }
  lines.push("", `Pricing: ${publicUrl}/pricing`);
  return lines.join("\n") + "\n";
}
