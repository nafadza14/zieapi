// Stateless MCP server over Streamable HTTP (JSON responses).
// Tool set mirrors the public zapi.ink MCP surface (E03): 8 tools, no resources/prompts.
// search_scrapers pages through the whole catalog with cursor; get_scraper_schema without an endpoint
// lists an API's endpoints. Auth: Authorization: Bearer | x-api-key | api-key.

import { HttpError } from "./envelope.js";
import { getPlan, getFinancePlan } from "./plans.js";

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_TEXT = 120_000; // keep tool results small enough for any MCP client

const s = (type, description, extra = {}) => ({ type, description, ...extra });

export const MCP_TOOLS = [
  {
    name: "search_scrapers",
    title: "Search the catalog",
    annotations: { title: "Search the catalog", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Find APIs by name, source, tag or the data they return (news, finance, research, open data, cloud and 3,300+ global APIs). Returns catalog items with key 'category:slug', status (live = works now, byok = needs the provider's own key), premium ('finance' = needs an Apizie Finance plan) and endpointCount. Results are paged: pass nextCursor back as cursor to get the next page; when nextCursor is null you have seen all `total` matches.",
    inputSchema: {
      type: "object",
      properties: {
        query: s("string", "Free-text search, e.g. 'weather', 'github', 'bitcoin'. Omit to list everything."),
        category: s("string", "Category slug filter, e.g. 'finance' (see list_categories)"),
        status: s("string", "Only items with this status", { enum: ["live", "byok"] }),
        limit: s("integer", "Max results per page (1-50)", { minimum: 1, maximum: 50, default: 10 }),
        cursor: s("string", "nextCursor from the previous page"),
      },
    },
  },
  {
    name: "get_scraper_schema",
    title: "Endpoints and schema",
    annotations: { title: "Endpoints and schema", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Without endpoint: list the endpoints (operations) of an API with slug, method, status and summary, paged with cursor. With endpoint: return that endpoint's parameters (name, type, required, enum, location), HTTP method, path template, cache TTL, plan gate, auth needs and example response.",
    inputSchema: {
      type: "object",
      required: ["scraper"],
      properties: {
        scraper: s("string", "Project key 'category:slug'"),
        endpoint: s("string", "Endpoint slug. Omit to list the API's endpoints."),
        limit: s("integer", "When listing: endpoints per page (1-200)", { minimum: 1, maximum: 200, default: 100 }),
        cursor: s("string", "When listing: nextCursor from the previous page"),
      },
    },
  },
  {
    name: "list_categories",
    title: "List categories",
    annotations: { title: "List categories", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "List every category with its scraper and endpoint counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "run_scraper",
    title: "Run an endpoint",
    annotations: { title: "Run an endpoint", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: "Call any endpoint and return clean JSON with a `source` block to cite. Apizie Finance endpoints (official:company, official:macro, finance:sec-edgar, finance:fred, finance:ecb, finance:us-treasury, finance:gleif, finance:worldbank) need an active Finance plan and use the Finance quota. Counts against your per-minute and monthly limits.",
    inputSchema: {
      type: "object",
      required: ["scraper", "endpoint"],
      properties: {
        scraper: s("string", "Project key 'category:slug'"),
        endpoint: s("string", "Endpoint slug"),
        params: { type: "object", description: "Endpoint parameters (see get_scraper_schema)", additionalProperties: true },
        upstream_key: s("string", "Your own key/token for APIs marked 'your key' (status byok). Never stored."),
      },
    },
  },
  {
    name: "get_account",
    title: "Account and plan",
    annotations: { title: "Account and plan", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Show your plan, key status and plan limits.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_usage",
    title: "Usage this month",
    annotations: { title: "Usage this month", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Show requests used this month and in the current minute.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "bulk_submit",
    title: "Submit a bulk job",
    annotations: { title: "Submit a bulk job", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: "Submit many inputs for one endpoint as a single bulk job (Ultra/Max plans, or Finance Growth/Business for Apizie Finance endpoints). Returns jobId to poll.",
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
    title: "Bulk job status",
    annotations: { title: "Bulk job status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Poll a bulk job and fetch its per-item results.",
    inputSchema: { type: "object", required: ["job_id"], properties: { job_id: s("string", "Bulk job id") } },
  },
];

export function createMcpHandler({ catalog, repo, executor, limiter, bulk, version, authenticate, wwwAuthenticate = () => 'Bearer realm="apizie"' }) {
  const toolResult = (data) => {
    let text = JSON.stringify(data, null, 2) ?? "null";
    if (text.length > MAX_TEXT) {
      // Too big for most MCP clients. Shrink to valid JSON (shorter arrays and strings) and say so, so the agent can
      // still parse the result and knows to ask for a narrower query or the next page.
      const { value, note } = shrink(data, text.length);
      text = JSON.stringify(value, null, 2);
      return { content: [{ type: "text", text }], structuredContent: value, isError: false, _meta: { truncated: true, note } };
    }
    return { content: [{ type: "text", text }], structuredContent: data && typeof data === "object" && !Array.isArray(data) ? data : { result: data }, isError: false };
  };
  const toolError = (status, body) => {
    const message = body?.message ?? body?.error?.message ?? (typeof body?.error === "string" ? body.error : "Error");
    // A ScraperError body ({ error: "<message>", context: { url | upstreamStatus } }) is the provider answering with an error,
    // not bad input from the agent.
    const upstream = typeof body?.error === "string" && (body?.context?.url || body?.context?.upstreamStatus);
    const code = body?.error?.code ?? (upstream ? "upstream_error" : codeFor(status));
    const payload = { status, code, message, ...(body?.errors?.length ? { errors: body.errors } : {}), ...(body?.content ? { details: body.content } : {}) };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload, isError: true };
  };

  async function callTool(caller, name, args = {}) {
    try {
      switch (name) {
        case "search_scrapers": {
          const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
          const disabled = await repo.disabledScrapers();
          const allowed = caller.scope?.categories?.length ? caller.scope.categories : null;
          if (allowed && args.category && !allowed.includes(args.category)) return toolResult({ total: 0, items: [], nextCursor: null, note: `This connection is limited to: ${allowed.join(", ")}.` });
          const cat = args.category ?? (allowed?.length === 1 ? allowed[0] : undefined);
          const r = catalog.list({ q: args.query, cat, status: args.status, cursor: args.cursor, limit }, {}, disabled);
          const items = (allowed ? r.items.filter((i) => allowed.includes(i.category)) : r.items).map(slimItem);
          return toolResult({ ...r, items, ...(allowed ? { note: `This connection is limited to: ${allowed.join(", ")}.` } : {}) });
        }
        case "get_scraper_schema": {
          const key = String(args.scraper ?? "");
          const sc = catalog.find(key);
          if (!sc || !key.includes(":")) return toolError(404, { message: `Unknown scraper "${key}". Use search_scrapers to find project keys like 'category:slug'.` });
          const d = catalog.detail(sc.key, undefined, await repo.disabledScrapers());
          if (args.endpoint === undefined || args.endpoint === null || args.endpoint === "") {
            const limit = Math.min(200, Math.max(1, Number(args.limit) || 100));
            const off = Math.max(0, Number(args.cursor) || 0);
            const eps = d.endpoints;
            return toolResult({
              scraper: d.key, displayName: d.displayName, description: d.description, status: d.status, auth: d.auth, provider: d.provider, sourceUrl: d.sourceUrl,
              note: d.status === "byok" ? "Needs your own provider key: pass it as upstream_key to run_scraper." : d.status === "planned" ? "Listed in the catalog but not callable on this server yet." : undefined,
              total: eps.length,
              endpoints: eps.slice(off, off + limit).map((e) => ({ slug: e.slug, displayName: e.displayName, method: e.method, ...(e.upstreamMethod ? { upstreamMethod: e.upstreamMethod } : {}), access: e.access ?? "read", status: e.status, minPlan: e.minPlan ?? null, description: e.description ? String(e.description).slice(0, 200) : null })),
              nextCursor: off + limit < eps.length ? String(off + limit) : null,
            });
          }
          const ep = d.endpoints.find((e) => e.slug === args.endpoint);
          if (!ep) return toolError(404, { message: `Unknown endpoint "${args.endpoint}" on ${d.key}. Call get_scraper_schema without endpoint to list them.` });
          return toolResult({
            scraper: d.key,
            endpoint: ep.slug,
            method: ep.method,
            ...(ep.upstreamMethod ? { upstreamMethod: ep.upstreamMethod } : {}),
            path: `/v1/${d.key}/${ep.slug}${ep.pathTemplate ? "/" + ep.pathTemplate : ""}`,
            cacheTtl: ep.cacheTtl,
            minPlan: ep.minPlan,
            bulkEnabled: ep.bulkEnabled,
            status: ep.status,
            access: ep.access ?? "read",
            auth: d.auth ?? null,
            note:
              ep.access === "write" && caller.access === "read"
                ? "This endpoint changes data at the provider and this connection is read-only, so run_scraper will refuse it."
                : d.auth ? "This API needs your own credentials: pass them as upstream_key to run_scraper." : ep.status === "planned" ? "Listed in the catalog but not callable on this server yet." : undefined,
            citation: "Successful results include a `source` block (publisher, official URL, retrieval time, licence). Cite it when you use the data.",
            fields: ep.fields,
            exampleResponse: ep.exampleResponse,
          });
        }
        case "list_categories":
          return toolResult({ categories: catalog.categoryList(), totals: catalog.totals() });
        case "run_scraper": {
          const r = await executor.run({ upstreamAuth: args.upstream_key ? { key: String(args.upstream_key) } : null, caller: { ...caller, source: "mcp" }, projectKey: String(args.scraper ?? ""), endpointSlug: String(args.endpoint ?? ""), params: args.params ?? {} });
          return r.status === 200 ? toolResult(r.body) : toolError(r.status, r.body);
        }
        case "get_account": {
          const p = getPlan(caller.plan);
          return toolResult({
            key: { id: caller.keyId, preview: caller.keyPreview, access: caller.access ?? "read_write", categories: caller.scope?.categories ?? [] }, user: caller.user ? { id: caller.user.id, name: caller.user.name, email: caller.user.email } : null,
            plan: { id: p.id, monthly: p.monthly, perMinute: p.perMinute, bulk: p.bulk, bulkCap: p.bulkCap, webhooks: p.webhooks, minCacheTtl: p.minCacheTtl },
            finance: caller.financePlan ? (({ id, name, monthly, perMinute, bulk, bulkCap, alerts, licence }) => ({ id, name, monthly, perMinute, bulk, bulkCap, alerts, licence }))(getFinancePlan(caller.financePlan)) : null,
          });
        }
        case "get_usage":
          return toolResult({ ...(await limiter.snapshot(caller.owner, caller.plan)), finance: await limiter.financeSnapshot(caller.owner, caller.financePlan) });
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
          serverInfo: { name: "apizie", title: "Apizie", version },
          instructions:
            "Apizie is one gateway to thousands of public data APIs. Results include a `source` block; cite it (publisher, url, retrievedAt) when you answer. If the user has Apizie Finance (see get_account), official financial data is available with full citations: run_scraper with official:company/profile (company by ticker, CIK or LEI), official:macro/us, official:macro/euro-area or official:macro/country. Without it those calls return finance_plan_required. Workflow: search_scrapers to find a source (page with cursor until nextCursor is null), get_scraper_schema with only scraper to list its endpoints, get_scraper_schema with scraper and endpoint to read parameters, then run_scraper. Project keys look like 'category:slug'. Items with status 'byok' need the user's own provider key, passed as upstream_key. Endpoints with access 'write' change data at the provider and are refused on read-only connections. Every call counts against the user's Apizie quota (see get_usage).",
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
    // Streamable HTTP: a request carrying an MCP-Protocol-Version this server does not support must get 400.
    const pv = req.headers?.["mcp-protocol-version"];
    if (pv && !MCP_PROTOCOL_VERSIONS.includes(String(pv))) {
      return { status: 400, body: { jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version "${String(pv).slice(0, 40)}". Supported: ${MCP_PROTOCOL_VERSIONS.join(", ")}` } } };
    }
    let caller;
    try {
      caller = await authenticate(req);
    } catch (e) {
      if (e instanceof HttpError)
        return { status: e.status, body: { jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32001, message: e.body.message, data: { status: e.status } } }, headers: e.status === 401 ? { "WWW-Authenticate": wwwAuthenticate(/expired|invalid/i.test(e.body.message ?? "") ? ', error="invalid_token"' : "") } : {} };
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

/** Shrink a large result to fit MAX_TEXT: cut long strings, then halve the longest arrays, keeping valid JSON. */
function shrink(data, originalChars) {
  let v = JSON.parse(JSON.stringify(data ?? null));
  const cutStrings = (x, max) => {
    if (typeof x === "string") return x.length > max ? x.slice(0, max) + "…" : x;
    if (Array.isArray(x)) return x.map((y) => cutStrings(y, max));
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, cutStrings(y, max)]));
    return x;
  };
  // containers that can be shortened: arrays, and objects used as maps (many keys, e.g. versions by number)
  const containers = (x, out = []) => {
    if (Array.isArray(x)) { out.push({ ref: x, n: x.length, w: JSON.stringify(x).length }); x.forEach((y) => containers(y, out)); }
    else if (x && typeof x === "object") {
      const keys = Object.keys(x);
      if (keys.length > 20) out.push({ ref: x, n: keys.length, w: JSON.stringify(x).length, map: true });
      Object.values(x).forEach((y) => containers(y, out));
    }
    return out;
  };
  const size = () => JSON.stringify(v, null, 2).length;
  const budget = MAX_TEXT - 600;
  for (const max of [4000, 1000, 300]) if (size() > budget) v = cutStrings(v, max);
  let dropped = 0;
  for (let i = 0; i < 80 && size() > budget; i++) {
    const big = containers(v).filter((c) => c.n > 1).sort((a, b) => b.w - a.w)[0];
    if (!big) break;
    const keep = Math.max(1, Math.floor(big.n / 2));
    dropped += big.n - keep;
    if (big.map) Object.keys(big.ref).slice(keep).forEach((k) => delete big.ref[k]);
    else big.ref.length = keep;
  }
  if (size() > budget) v = { preview: JSON.stringify(v).slice(0, budget - 200) };
  const note = `Result was ${originalChars} characters and was shortened to fit${dropped ? ` (${dropped} list or map entries omitted)` : ""}. Ask for fewer items, a narrower query or the next page.`;
  const wrapped = v && typeof v === "object" && !Array.isArray(v) ? { ...v, _truncated: { originalChars, note } } : { result: v, _truncated: { originalChars, note } };
  return { value: wrapped, note };
}

const slimItem = (i) => ({ key: i.key, displayName: i.displayName, description: i.description ? String(i.description).slice(0, 240) : null, category: i.category, status: i.status, endpointCount: i.endpointCount, liveEndpoints: i.liveEndpoints, auth: i.auth, provider: i.provider, origin: i.origin, minPlan: i.minPlan, ...(i.premium ? { premium: i.premium } : {}), tags: (i.tags ?? []).slice(0, 8) });

function codeFor(status) {
  return (
    { 400: "invalid_params", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed", 422: "unprocessable", 429: "rate_limited", 500: "internal", 501: "not_live", 502: "upstream_unavailable", 503: "disabled", 504: "timeout" }[status] ??
    "error"
  );
}
