# zieapi

**One API key, one JSON envelope, many public data sources.**
A clean-room, zero-dependency scraper API gateway for Node.js ≥ 20 — catalog, API keys, plans, rate limits, caching, bulk jobs, signed webhooks, OpenAPI, `llms.txt`, and a built-in MCP server for AI agents.

zieapi was designed from an evidence-backed reverse-engineering study of the **public** surface of zapi.ink, done with the [REA](https://github.com/morluto/rea) methodology. See [`docs/REA-REPORT.md`](docs/REA-REPORT.md) (Bahasa Indonesia) and the evidence index in [`docs/evidence/index.json`](docs/evidence/index.json). None of zapi's code, scrapers or brand assets are copied. Only the public contract shapes are reproduced, and the public MIT `zpi-sdk` works against zieapi unchanged ([`examples/zpi-sdk-parity.mjs`](examples/zpi-sdk-parity.mjs)).

---

## Quick start

```bash
git clone https://github.com/nafadza14/zieapi.git
cd zieapi
npm start            # no npm install needed — zero dependencies
```

On the first run in development, a dev API key (Ultra plan) is printed once. Try it:

```bash
KEY=zie_xxx   # paste the key printed by `npm start`

curl "http://localhost:8787/v1/indonesia:terbilang/convert?number=1250000&currency=true" -H "x-api-key: $KEY"
# {"project":"indonesia:terbilang","data":{"number":1250000,"text":"satu juta dua ratus lima puluh ribu rupiah","formatted":"Rp1.250.000"},"timestamp":"…"}
```

Run the tests: `npm test`

## The contract

| | |
|---|---|
| Call | `GET` or `POST /v1/{category}:{scraper}/{endpoint}[/{path-params}]` |
| Auth | `x-api-key: zie_…` (or `Authorization: Bearer …`, or `api-key: …`) |
| Success | `{ "project", "data", "timestamp" }` |
| Error | `{ "content", "message", "errors" }`. Plan, bulk and quota errors use `{ "error": { "code", "message" }, … }` |
| Limits | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Remaining-Month`, `Retry-After` on 429 |
| Tracing | `x-request-id`, `X-Response-Time`, `X-Cache: HIT / MISS / BYPASS` |

| Status | Meaning |
|---|---|
| 400 | `Invalid params` (with `errors[{path,message}]`), or a scraper exec error `{project,error,timestamp}` |
| 401 | Missing, invalid or disabled key |
| 403 | `plan_upgrade_required` (`required_plan`, `upgrade_url`) or `bulk_not_enabled` |
| 404 / 405 | Unknown scraper or endpoint / wrong verb (`content.expected` + `Allow`) |
| 422 | `idempotency_key_reuse` |
| 429 | Per-minute or monthly limit (`content.{limit,used,window,retryAfterSec}`) |
| 5xx | Never billed against your quota |

### Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/public/categories` | – | Categories |
| `GET /api/scrapers/list?q=&cat=&cursor=&limit=&sort=popular\|name\|endpoints&bulk=true&indonesian=true` | – | Catalog search |
| `GET /api/scrapers/{slug}` | – | Scraper detail and endpoints |
| `GET /api/public/scrapers/{slug}/endpoints/{ep}/schema` | – | Parameter schema |
| `GET /api/public/scrapers/{slug}/stats` | – | Requests and success rate |
| `GET /openapi.json`, `GET /llms.txt` | – | Generated from the catalog |
| `GET\|POST /v1/{cat}:{scraper}/{ep}` | key | Run an endpoint |
| `POST /v1/{cat}:{scraper}/{ep}/bulk` `{items:[…]}` + `Idempotency-Key` | key (Ultra/Max) | Bulk job |
| `GET\|DELETE /v1/bulk/{jobId}` | key | Poll or cancel a bulk job |
| `GET /v1/me`, `GET /v1/usage` | key | Account and usage |
| `GET\|PUT /v1/webhooks`, `POST /v1/webhooks/test` | key (Pro+) | Signed webhooks |
| `POST /mcp` | key | MCP (Streamable HTTP, stateless) |
| `GET\|POST /admin/keys`, `PATCH /admin/keys/{id}` | `Bearer $ZIE_ADMIN_TOKEN` | Key management |

### Plans (edit `src/plans.js`)

| Plan | Req/month | Req/min | Cache control | Bulk | Webhooks |
|---|---|---|---|---|---|
| free | 600 | 100 | – | – | – |
| pro | 25,000 | 2,000 | down to 30s | – | ✓ |
| ultra | 200,000 | 5,000 | `ttl=0` bypass | ✓ (500 items) | ✓ |
| max | 1,000,000 | 15,000 | `ttl=0` bypass | ✓ (2,000 items) | ✓ |

Quotas reset on the 1st of each month (UTC).

## MCP (AI agents)

Tools: `search_scrapers`, `get_scraper_schema`, `list_categories`, `run_scraper`, `get_account`, `get_usage`, `bulk_submit`, `bulk_status`.

```bash
claude mcp add --transport http zieapi http://localhost:8787/mcp --header "x-api-key: zie_xxx"
```

## Included scrapers

| Project key | Endpoints | Notes |
|---|---|---|
| `dev-tools:hash` | `digest` | md5, sha1, sha256, sha512 |
| `dev-tools:uuid` | `v4` | |
| `dev-tools:text` | `stats` (POST), `slugify/:text` | path-template example |
| `indonesia:terbilang` | `convert`, `format-rupiah` | Angka → kata, Rupiah formatting |
| `finance:fx` | `latest`, `convert` | ECB rates via the Frankfurter public API |
| `web-tools:page` | `meta` | Pro plan; SSRF-guarded page metadata |

### Add your own

Copy [`src/scrapers/_template.js`](src/scrapers/_template.js), then register it in `src/scrapers/index.js`. Each endpoint declares `fields` (validated and coerced), `cacheTtl`, `minPlan`, `bulkEnabled`, an optional `pathTemplate`, and an async `handler(params, ctx)`. Throw `ScraperError` for known upstream failures. Only scrape sources whose terms allow it, and prefer official APIs.

## Configuration

| Env | Default | |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `ZIE_API_URL` | `http://localhost:8787` | Used in `pollUrl` and OpenAPI |
| `ZIE_PUBLIC_URL` | = API URL | Used in `upgrade_url` |
| `ZIE_ADMIN_TOKEN` | – | Enables `/admin/*` |
| `ZIE_DATA_FILE` | `./data/zieapi.json` | JSON snapshot of keys, usage and webhooks |
| `ZIE_DEV_KEY_PLAN` | `ultra` | Plan for the first-run dev key |
| `NODE_ENV=production` | | Disables the dev key |

Create keys from the CLI: `npm run key:create -- --plan pro --name "my app"`

## Production notes

The `Store` (`src/store.js`), `TtlCache` and in-process bulk queue are deliberately simple. Before scaling past a single instance, replace them with Postgres, Redis and a job queue — the interfaces are small. Put the server behind a reverse proxy or CDN that sets `X-Forwarded-For`.

## Project layout

```
src/app.js         HTTP gateway and routes      src/executor.js   run pipeline
src/catalog.js     scraper registry + read model src/validate.js  param validation
src/auth.js        API keys                      src/ratelimit.js minute + month limits
src/cache.js       TTL cache + plan rules        src/bulk.js      bulk jobs + idempotency
src/webhooks.js    HMAC-signed delivery          src/mcp.js       MCP server
src/openapi.js     OpenAPI + llms.txt            src/scrapers/    scraper modules
docs/REA-REPORT.md reverse-engineering report    test/            node:test suites
```

## License

MIT © Zieads. Not affiliated with Zapi or Zeative Labs.
