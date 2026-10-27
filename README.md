<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/apizie-horizontal-white.svg">
    <img src="brand/logo/apizie-horizontal.svg" alt="Apizie" width="320">
  </picture>
</p>

# Apizie

**One API key for hundreds of public data sources, Indonesia first.**

Apizie is a complete, self-hostable public-data API platform with zero runtime dependencies (Node.js ≥ 20). It includes:

- **Website:** a landing page with the animated globe hero, a searchable catalog, a page per scraper with a "Try it" console and code samples, pricing, docs, the MCP page, a showcase, a status page, issue reporting and legal pages.
- **Accounts:** email/password sign-in plus GitHub, Google and Discord OAuth.
- **Dashboard:** overview, API keys (with IP allowlists), usage charts, request logs, bulk jobs, signed webhooks, billing with manual bank-transfer invoices, and settings.
- **Admin panel:** users and plans, invoice approval, scraper on/off switches, reports and showcase moderation.
- **API:** `GET|POST /v1/{category}:{scraper}/{endpoint}` with one envelope, plans and quotas, per-minute rate limits, caching, bulk jobs with idempotency, OpenAPI files and `llms.txt`.
- **MCP server** at `/mcp` with 8 tools for AI agents.
- **Global APIs:** 1,454 APIs with about 45,500 operations imported from the [APIs.guru OpenAPI Directory](https://github.com/APIs-guru/openapi-directory) plus official provider specs (GitHub, Stripe, Twilio, Spotify, Slack, Microsoft Graph, NASA and more). Keyless ones are live; the rest run with the caller's own provider key (`x-upstream-key`, never stored). See `/docs/byok` and `docs/API-SOURCES.md`.
- **Native live modules:** 245 APIs / 651 endpoints built on official public APIs, open data or publisher RSS feeds, including 153 keyless public APIs (weather, crypto exchanges, research, package registries, security feeds, sports, games). Whole catalog: 1,901 APIs, 47,141 endpoints, 629 APIs / 9,898 endpoints live with no extra key.

The architecture and API contract come from an evidence-backed reverse-engineering study of zapi.ink, done with the [REA](https://github.com/morluto/rea) methodology. See [`docs/REA-REPORT.md`](docs/REA-REPORT.md) (Bahasa Indonesia) and [`docs/evidence/`](docs/evidence). No zapi code, scraper internals, branding or copy is reused. The catalog *structure* (sources, endpoint names, parameter schemas) was imported from their public OpenAPI index, with the circumvention category (Bypass Tools) removed.

## Supabase backend + Google sign-in

1. Supabase SQL editor: run `supabase/migrations/0001_apizie.sql` once.
2. Supabase → Authentication → Providers: enable **Google** (Google Cloud redirect URI: `https://hfscpcwrntvdslxwddjy.supabase.co/auth/v1/callback`).
3. Supabase → Authentication → URL Configuration → Redirect URLs: add `https://<your-domain>/auth/supabase/callback` (and `http://localhost:8787/auth/supabase/callback` for local).
4. Vercel env vars: `SUPABASE_PROJECT_ID`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APIZIE_SESSION_SECRET`, `APIZIE_ADMIN_EMAILS`, `APIZIE_PUBLIC_URL`.
5. `/healthz` reports `"storage":"SupabaseKV"` when connected.

## MCP for end users

`https://<your-domain>/mcp` (Streamable HTTP). Apps that support OAuth (Claude.ai and Claude Desktop custom connectors, ChatGPT, Claude Code `/mcp`) only need the URL: they discover `/.well-known/oauth-protected-resource`, register themselves, and the user signs in and presses Allow. Other apps send an API key (`Authorization: Bearer apz_…` or `x-api-key`). Setup snippets are on `/mcp`.

## Run locally

```bash
git clone https://github.com/nafadza14/zieapi.git
cd zieapi
npm start              # → http://localhost:8787
```

1. Open http://localhost:8787 and click **Sign up**. Locally, the first account you create becomes **admin**.
2. Go to **Dashboard → API keys → Create key**.
3. Call an endpoint:

```bash
curl "http://localhost:8787/v1/indonesia:bmkg/gempa-terkini" -H "x-api-key: apz_xxx"
```

To run the tests: `npm test` (138 tests).

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (Framework preset: **Other**). `vercel.json` already sets the build (`npm test`), the output (`public`) and the rewrites to the `api/apizie.js` function.
2. **Add storage (required):** run `supabase/migrations/0001_apizie.sql` in the Supabase SQL editor and set `SUPABASE_PROJECT_ID` + `SUPABASE_SECRET_KEY` (or connect Upstash for Redis, which sets `KV_REST_API_URL`/`KV_REST_API_TOKEN`). Without a database, accounts, keys and usage live in memory and vanish between serverless instances; the dashboard shows a red banner and `/admin/setup` says what is missing.
3. Set these environment variables:

   | Name | Value |
   |---|---|
   | `APIZIE_PUBLIC_URL` | `https://your-project.vercel.app` (or your domain) |
   | `APIZIE_ADMIN_EMAILS` | your email (becomes admin when you sign up) |
   | `APIZIE_SESSION_SECRET` | any long random string |
   | `APIZIE_BANK_INFO` | bank account text shown on invoices |
   | `APIZIE_SUPPORT_EMAIL`, `APIZIE_DISCORD_URL` | optional, shown on the Support page |
   | `RESEND_API_KEY`, `APIZIE_EMAIL_FROM` | optional, also email dashboard notifications |
   | `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `DISCORD_CLIENT_ID/SECRET` | optional OAuth; callback = `{APIZIE_PUBLIC_URL}/auth/{provider}/callback` |

4. Deploy, open the site, sign up with the admin email, then open **/admin/setup**: every check should be green or "Review".

All options are listed in [`.env.example`](.env.example).

## API in one table

| | |
|---|---|
| Call | `GET` or `POST /v1/{category}:{scraper}/{endpoint}[/{path-params}]` |
| Auth | `x-api-key: apz_…` (or `Authorization: Bearer …`, or `api-key: …`) |
| Success | `{ "project", "data", "timestamp" }` |
| Errors | `{ "content", "message", "errors" }`; plan, bulk and quota errors use `{ "error": { "code", "message" } }` |
| Limits | `X-RateLimit-Remaining`, `X-RateLimit-Remaining-Month`, `Retry-After`. A 5xx is refunded. |
| Bulk | `POST …/{endpoint}/bulk` `{items:[…]}` + `Idempotency-Key`; `GET /v1/bulk/{id}` |
| Catalog | `/api/public/categories`, `/api/scrapers/list`, `/api/scrapers/{key}`, `…/schema`, `…/stats` |
| Machine docs | `/openapi.json`, `/category/{slug}/openapi.json`, `/llms.txt`, `/llms-full.txt` |
| MCP | `POST /mcp` with tools `search_scrapers`, `get_scraper_schema`, `list_categories`, `run_scraper`, `get_account`, `get_usage`, `bulk_submit`, `bulk_status` |

Plans are defined in `src/core/plans.js`. List prices are in USD; `priceIdr` is the local bank-transfer amount. The research behind the numbers is in [`docs/PRICING.md`](docs/PRICING.md).

| Plan | Price / month | Yearly (2 months free) | Req/month | Req/min |
|---|---|---|---|---|
| Free | $0 | - | 1,000 | 100 |
| Pro | $9 (Rp149.000) | $90 | 25,000 | 2,000 |
| Ultra | $29 (Rp479.000) | $290 | 200,000 | 5,000 |
| Max | $99 (Rp1.599.000) | $990 | 1,000,000 | 15,000 |

Pay-as-you-go above the quota: $0.40 per 1,000 requests (Rp6,6 per request) from a prepaid balance.

## Dashboard

`/dashboard` has eleven sections, all backed by `/api/me/*` (`src/dashboard/account.js`):

| Section | What works |
|---|---|
| Dashboard | requests in range, traffic-by-hour heatmap (your timezone), API key with reveal/copy, monthly quota with projection, requests today, success rate, p95 latency, errors 24h, requests over time, recent requests, top endpoints, categories, errors by status. Range 24H/7D/30D (Pro)/90D (Ultra) and a per-key filter. |
| Usage | totals, 24h numbers, per-key usage table, request sources, top endpoints |
| Logs | search (status, endpoint, key, request ID), success/error filter, range, key filter, detail panel with replay cURL, pagination, CSV export. Metadata only, never payloads. |
| API keys | create (limit per plan), reveal again, copy, rename, IP allowlist with IPv4 CIDR (Pro+), revoke (permanent), delete, 30-day sparkline, connected MCP apps, code samples in 6 languages |
| Bulk jobs (Ultra) | submit from the dashboard with an API/endpoint picker, job list with filters, per-item results, JSON download |
| Webhooks (Pro) | up to 5 endpoints, event selection, test, delivery history with payload, redeliver, on/off, rotate secret. Private and localhost targets are refused. |
| Billing | plan, pay-as-you-go balance, top-ups (Rp50k to Rp1M or custom), plan invoices for 1 to 12 months, VAT, pay/cancel, transactions |
| Affiliate | referral link (`/?ref=code`, 30-day cookie), clicks, sign-ups, paying customers, commission history, move to balance, bank payout (min Rp100.000) |
| Showcase, Settings, Support | project submissions; profile photo, name, password, notification switches, active sessions, delete account; support form prefilled from your latest errors |

## Billing flow (manual bank transfer)

1. The user picks a plan (1 to 12 months) or a top-up amount in Billing. The invoice adds VAT (`APIZIE_VAT_PERCENT`, default 11%) and a unique 3-digit code.
2. They transfer the exact amount and click **I've paid** with their reference.
3. An admin marks it paid in **Admin → Invoices**. A plan becomes active for 30 days per month paid; a top-up is added to the balance. The `invoice.paid` webhook fires and, if the customer was referred, the referrer earns `APIZIE_AFFILIATE_PERCENT` (default 10%) of the subtotal.
4. With **Use balance when the plan quota runs out** switched on, requests above the monthly quota cost Rp2,2 each from the balance instead of returning 429 (response header `X-Billing: payg`).

## Adding scrapers

Copy `src/scrapers/_template.js` into `src/scrapers/live/` and register it in `src/scrapers/index.js`. A live module with the same `category:slug` as a catalog entry replaces its planned endpoints. Helpers in `src/scrapers/kit.js` (`getJson`, `feed`, `url`, `ScraperError`, `requireEnv`, …) keep handlers small. Use official APIs or open data only.

## Refreshing the global API directory

```bash
npm i --no-save openapi-directory
node scripts/import-openapi.js node_modules/openapi-directory/api
```

Operators may set shared provider keys with `APIZIE_UPSTREAM_KEY_<CATEGORY>_<SLUG>` (for example `APIZIE_UPSTREAM_KEY_FINANCE_STRIPE`). A caller's own `x-upstream-key` always wins.

## Project layout

```
api/apizie.js            Vercel function entry
public/assets/           site.css · site.js · dash.css · dash.js (runtime) · dash-user.js · dash-admin.js · favicon
src/app.js               router: pages, auth, /api/me, /api/admin, /v1, /mcp
src/core/                catalog · executor · analytics · limits · bulk · webhooks · mcp · openapi · plans · validate
src/dashboard/           account.js (/api/me/*) · setup.js (production checks)
src/db/                  kv.js (Memory / Upstash / Supabase) · repo.js (users, keys, usage, logs, invoices…)
src/auth/                passwords · sessions · API keys · OAuth
src/web/                 html layout + pages (home, catalog, pricing, docs, misc)
src/catalog/seed.js      catalog structure (generated by scripts/import-catalog.js)
src/scrapers/live/       live scraper modules (finance, indonesia, news, research-dev, media-apps, devtools)
brand/                   logo masters, icons, PNGs, presentation board, GUIDELINES.md
docs/                    REA report + evidence
test/                    node:test suites
```

## License

MIT © Zieads. Not affiliated with Zapi / Zeative Labs. You are responsible for complying with each data source's terms and with UU PDP.
