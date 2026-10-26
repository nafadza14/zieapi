// Stateless MCP server over Streamable HTTP (JSON responses).
// Tool set mirrors the public zapi.ink MCP surface (E03): 8 tools, no
// resources/prompts. Auth: Authorization: Bearer | x-api-key | api-key.

import { HttpError } from "./envelope.js";
import { getPlan } from "./plans.js";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const s = (type, description, extra = {}) => ({ type, description, ...extra });

export const MCP_TOOLS = [
  {
    name: "search_scrapers",
    description: "Find scrapers by name, source, tag or the data they return. Returns catalog items (id, slug, category, endpointCount, ...).",
    inputSchema: {
      type: "object",
      properties: {
        query: s("string", "Free-text search, e.g. 'saham', 'instagram', 'rupiah'"),
        category: s("string", "Category slug filter, e.g. 'finance'"),
        limit: s("integer", "Max results (1-50)", { minimum: 1, maximum: 50, default: 10 }),
      },
    },
  },
  {
    name: "get_scraper_schema",
    description: "Return an endpoint's parameters, HTTP method, path template, cache TTL, plan gate and example response.",
    inputSchema: {
      type: "object",
      required: ["scraper", "endpoint"],
      properties: { scraper: s("string", "Project key 'category:slug'"), endpoint: s("string", "Endpoint slug") },
    },
  },
  {
    name: "list_categories",
    description: "List every category with its scraper and endpoint counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "run_scraper",
    description: "Call any endpoint and return clean JSON. Counts against your per-minute and monthly limits.",
    inputSchema: {
      type: "object",
      required: ["scraper", "endpoint"],
      properties: {
        scraper: s("string", "Project key 'category:slug'"),
        endpoint: s("string", "Endpoint slug"),
        params: { type: "object", description: "Endpoint parameters (see get_scraper_schema)", additionalProperties: true },
      },
    },
  },
  {
    name: "get_account",
    description: "Show your plan, key status and plan limits.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_usage",
    description: "Show requests used this month and in the current minute.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "bulk_submit",
    description: "Submit many inputs for one endpoint as a single bulk job (Ultra/Max plans). Returns jobId to poll.",
    inputSchema: {
      type: "object",
      required: ["scraper", "endpoint", "items"],
      properties: {
        scraper: s("string", "Project key 'category:slug'"),
        endpoint: s("string", "Endpoint slug"),
        items: { type: "array", items: { type: "object" }, description: "Array of params objects" },
        idempotency_key: s("string", "Optional idempotency key"),
      },
    },
  },
  {
    name: "bulk_status",
    description: "Poll a bulk job and fetch its per-item results.",
    inputSchema: { type: "object", required: ["job_id"], properties: { job_id: s("string", "Bulk job id") } },
  },
];

export function createMcpHandler({ catalog, repo, executor, limiter, bulk, version, authenticate }) {
  const toolResult = (data) => ({
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data && typeof data === "object" && !Array.isArray(data) ? data : { result: data },
    isError: false,
  });
  const toolError = (status, body) => {
    const message = body?.message ?? body?.error?.message ?? (typeof body?.error === "string" ? body.error : "Error");
    const code = body?.error?.code ?? codeFor(status);
    const payload = { status, code, message, ...(body?.errors?.length ? { errors: body.errors } : {}), ...(body?.content ? { details: body.content } : {}) };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload, isError: true };
  };

  async function callTool(caller, name, args = {}) {
    try {
      switch (name) {
        case "search_scrapers": {
          const r = catalog.list({ q: args.query, cat: args.category, limit: Math.min(50, args.limit ?? 10) });
          return toolResult(r);
        }
        case "get_scraper_schema": {
          const d = catalog.detail(String(args.scraper ?? ""));
          const ep = d?.endpoints.find((e) => e.slug === args.endpoint);
          if (!ep) return toolError(404, { message: `Unknown scraper/endpoint ${args.scraper}/${args.endpoint}` });
          const schema = catalog.schema(args.scraper, args.endpoint);
          return toolResult({
            scraper: `${d.category}:${d.slug}`,
            endpoint: ep.slug,
            method: ep.method,
            path: `/v1/${d.category}:${d.slug}/${ep.slug}${ep.pathTemplate ? "/" + ep.pathTemplate : ""}`,
            cacheTtl: ep.cacheTtl,
            minPlan: ep.minPlan,
            bulkEnabled: ep.bulkEnabled,
            status: ep.status,
            fields: schema.fields,
            exampleResponse: ep.exampleResponse,
          });
        }
        case "list_categories":
          return toolResult({ categories: catalog.categoryList(), totals: catalog.totals() });
        case "run_scraper": {
          const r = await executor.run({ caller: { ...caller, source: "mcp" }, projectKey: String(args.scraper ?? ""), endpointSlug: String(args.endpoint ?? ""), params: args.params ?? {} });
          return r.status === 200 ? toolResult(r.body) : toolError(r.status, r.body);
        }
        case "get_account": {
          const p = getPlan(caller.plan);
          return toolResult({
            key: { id: caller.keyId, preview: caller.keyPreview }, user: caller.user ? { id: caller.user.id, name: caller.user.name, email: caller.user.email } : null,
            plan: { id: p.id, monthly: p.monthly, perMinute: p.perMinute, bulk: p.bulk, bulkCap: p.bulkCap, webhooks: p.webhooks, minCacheTtl: p.minCacheTtl },
          });
        }
        case "get_usage":
          return toolResult(await limiter.snapshot(caller.owner, caller.plan));
        case "bulk_submit": {
          return toolResult(await bulk.submit(caller, String(args.scraper ?? ""), String(args.endpoint ?? ""), args.items, args.idempotency_key));
        }
        case "bulk_status":
          return toolResult(await bulk.status(caller, String(args.job_id ?? "")));
        default:
          return null;
      }
    } catch (e) {
      if (e instanceof HttpError) return toolError(e.status, e.body);
      throw e;
    }
  }

  /** Handle one JSON-RPC message. Returns a response object, or null for notifications. */
  async function handleMessage(msg, caller) {
    const id = msg?.id;
    const isNotification = id === undefined || id === null;
    const reply = (result) => (isNotification ? null : { jsonrpc: "2.0", id, result });
    const fail = (code, message, data) => (isNotification ? null : { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid Request");

    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        return reply({
          protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "zieapi", version },
          instructions:
            "zieapi exposes a catalog of scrapers. Use search_scrapers → get_scraper_schema → run_scraper. Project keys look like 'category:slug'.",
        });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: MCP_TOOLS });
      case "tools/call": {
        const name = msg.params?.name;
        const result = await callTool(caller, name, msg.params?.arguments ?? {});
        if (!result) return fail(-32602, `Unknown tool: ${name}`);
        return reply(result);
      }
      default:
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  }

  /** HTTP entry: returns {status, body, headers}. */
  return async function handleHttp(req, body) {
    if (req.method !== "POST") {
      return { status: 405, body: { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed. This server is stateless: POST JSON-RPC to /mcp." } }, headers: { Allow: "POST" } };
    }
    let caller;
    try {
      caller = await authenticate(req);
    } catch (e) {
      if (e instanceof HttpError)
        return { status: e.status, body: { jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32001, message: e.body.message, data: { status: e.status } } }, headers: { "WWW-Authenticate": 'Bearer realm="zieapi"' } };
      throw e;
    }
    if (body === undefined) return { status: 400, body: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } } };

    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleMessage(m, caller)))).filter(Boolean);
      return out.length ? { status: 200, body: out } : { status: 202, body: null };
    }
    const res = await handleMessage(body, caller);
    return res ? { status: 200, body: res } : { status: 202, body: null };
  };
}

function codeFor(status) {
  return (
    { 400: "invalid_params", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed", 422: "unprocessable", 429: "rate_limited", 500: "internal", 503: "disabled", 504: "timeout" }[status] ??
    "error"
  );
}
