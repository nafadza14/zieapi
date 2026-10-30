<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/apizie-horizontal-white.svg">
    <img src="brand/logo/apizie-horizontal.svg" alt="Apizie" width="320">
  </picture>
</p>

# Apizie

**One API key for thousands of public data sources. Plus Apizie Finance: official financial data with citations for AI agents.**

Apizie turns thousands of public APIs into clean JSON behind one API key, with an MCP server for Claude, ChatGPT and Cursor. **Apizie Finance** is a premium add-on: SEC EDGAR, FRED, the ECB, the U.S. Treasury, GLEIF and the World Bank through one REST API and one MCP server, where every answer carries its source (publisher, official URL, retrieval time, licence, attribution).

It is a complete, self-hostable platform with zero runtime dependencies (Node.js ≥ 20). It includes:

- **Apizie Finance (premium):** the six sources (`finance:sec-edgar`, `finance:fred`, `finance:ecb`, `finance:us-treasury`, `finance:gleif`, `finance:worldbank`) plus combined, cited endpoints in `official:company` and `official:macro`. They need an active Finance plan (`user.financePlan`, checked in `src/core/executor.js`), use their own quota (`fin:<owner>` counters in `src/core/limits.js`) and answer `403 finance_plan_required` otherwise. Provenance lives in `src/core/sources.js`; licence guards include the FRED third-party-copyright filter and SEC fair-access pacing.
- **Data alerts (Finance):** watch new SEC filings, FRED series, the Treasury curve, ECB rates or World Bank values and get a signed `data.changed` webhook (`src/core/watches.js`, daily Vercel cron at `/api/cron/watches`).
- **Key permissions:** new keys and MCP connections are read-only by default, can be limited to categories, and refused calls are never billed.

- **Website:** a landing page with the animated globe hero, a searchable catalog, a page per scraper with a "Try it" console and code samples, pricing, docs, the MCP page, a showcase, a status page, issue reporting and legal pages.
- **Accounts:** email/password sign-in plus GitHub, Google and Discord OAuth.
- **Dashboard:** overview, API keys (with IP allowlists), usage charts, request logs, bulk jobs, signed webhooks, billing with card checkout through Dodo Payments (USD), and settings.
- **Admin panel:** users and plans, invoice approval, scraper on/off switches, reports and showcase moderation.
- **API:** `GET|POST /v1/{category}:{scraper}/{endpoint}` with one envelope, plans and quotas, per-minute rate limits, caching, bulk jobs with idempotency, OpenAPI files and `llms.txt`.
- **MCP server** at `/mcp` with 8 tools for AI agents.
- **Global APIs:** 3,319 APIs with about 142,500 operations from official API descriptions: the [APIs.guru OpenAPI Directory](https://github.com/APIs-guru/openapi-directory), AWS (382 services, SigV4-signed), Azure (Resource Manager and data plane, 336), Google (350, Discovery documents), Alibaba Cloud (341, ACS3-signed), Tencent Cloud (254, TC3-signed), Akamai (51, EdgeGrid-signed), HubSpot, Microsoft Fabric, SendGrid, Confluent Cloud, LINE, Webex and other provider-published specs. Keyless ones are live; the rest run with the caller's own provider key (`x-upstream-key`, never stored). See `/docs/byok` and `docs/API-SOURCES.md`; rebuild with `scripts/build-directory.sh`.
- **Native live modules:** 404 APIs / 930 endpoints built on official public APIs, open data or publisher RSS feeds, including 153 keyless public APIs, 104 international news feeds, a general RSS/Atom reader and 30 open-data portals and research-data repositories (CKAN, Dataverse). Public catalog: 3,723 APIs and 143,423 endpoints (712 APIs / 10,757 endpoints live with no extra key, the rest with your own provider key). 202 planned sources are visible to admins only.

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
   | `APIZIE_PUBLIC_URL` | `https://apizie.tech` (your domain, no path) |
   | `APIZIE_ADMIN_EMAILS` | your email (becomes admin when you sign up) |
   | `APIZIE_SESSION_SECRET` | any long random string |
   | `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_PRODUCT_ID`, `DODO_PAYMENTS_WEBHOOK_SECRET`, `DODO_PAYMENTS_ENVIRONMENT` | card checkout (required for paid plans and top-ups) |
   | `APIZIE_SUPPORT_EMAIL`, `APIZIE_DISCORD_URL` | optional, shown on the Support page |
   | `RESEND_API_KEY`, `APIZIE_EMAIL_FROM` | optional, also email dashboard notifications |
   | `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `DISCORD_CLIENT_ID/SECRET` | optional OAuth; callback = `{APIZIE_PUBLIC_URL}/auth/{provider}/callback` |
   | `FRED_API_KEY` | free key from fred.stlouisfed.org, needed for every FRED endpoint and `official:macro/us` |
   | `CRON_SECRET` | any long random string; Vercel Cron sends it to `/api/cron/watches` to run data alerts |
   | `APIZIE_SEC_USER_AGENT` | optional; the User-Agent sent to sec.gov (default `Apizie support@zieads.com`) |

4. Deploy, open the site, sign up with the admin email, then open **/admin/setup**: every check should be green or "Review".

All options are listed in [`.env.example`](.env.example).

## API in one table

| | |
|---|---|
| Call | `GET` or `POST /v1/{category}:{scraper}/{endpoint}[/{path-params}]` |
| Auth | `x-api-key: apz_…` (or `Authorization: Bearer …`, or `api-key: …`) |
| Success | `{ "project", "data", "source", "timestamp" }` (`source` = publisher, url, apiUrl, retrievedAt, license, attribution) |
| Errors | `{ "content", "message", "errors" }`; plan, bulk and quota errors use `{ "error": { "code", "message" } }` |
| Limits | `X-RateLimit-Remaining`, `X-RateLimit-Remaining-Month`, `Retry-After`. A 5xx is refunded. |
| Bulk | `POST …/{endpoint}/bulk` `{items:[…]}` + `Idempotency-Key`; `GET /v1/bulk/{id}` |
| Catalog | `/api/public/categories`, `/api/scrapers/list`, `/api/scrapers/{key}`, `…/schema`, `…/stats` |
| Machine docs | `/openapi.json`, `/category/{slug}/openapi.json`, `/llms.txt`, `/llms-full.txt` |
| MCP | `POST /mcp` with tools `search_scrapers`, `get_scraper_schema`, `list_categories`, `run_scraper`, `get_account`, `get_usage`, `bulk_submit`, `bulk_status` |

Plans are defined in `src/core/plans.js`. Every price is in USD and paid by card through Dodo Payments. There are two schemes; the research behind them is in [`docs/PRICING.md`](docs/PRICING.md).

**General plans** (whole public catalog):

| Plan | Price / month | Yearly (2 months free) | Req/month | Req/min |
|---|---|---|---|---|
| Free | $0 | - | 1,000 | 100 |
| Pro | $9 | $90 | 25,000 | 2,000 |
| Ultra | $29 | $290 | 200,000 | 5,000 |
| Max | $99 | $990 | 1,000,000 | 15,000 |

Pay-as-you-go above the quota: $0.40 per 1,000 requests from a prepaid USD balance.

**Apizie Finance** (premium add-on, its own quota, no free tier; ids `fin_starter`, `fin_growth`, `fin_business`):

| Plan | Price / month | Yearly | Finance req/month | Licence | Data alerts |
|---|---|---|---|---|---|
| Finance Starter | $49 | $490 | 100,000 | Commercial use inside your company | 5 |
| Finance Growth | $199 | $1,990 | 1,000,000 | Use in your own product, with attribution | 50 |
| Finance Business | $499 | $4,990 | 5,000,000 | Use in your own product, with attribution | 200 |

Finance overage: $1.00 per 1,000 requests from the same balance. Admins can grant Finance from Admin → Customers. Server keys in `ZIE_KEYS` can carry it too: `max+fin_growth:apz_...`.

## Dashboard

`/dashboard` has twelve sections, all backed by `/api/me/*` (`src/dashboard/account.js`):

| Section | What works |
|---|---|
| Dashboard | requests in range, traffic-by-hour heatmap (your timezone), API key with reveal/copy, monthly quota with projection, requests today, success rate, p95 latency, errors 24h, requests over time, recent requests, top endpoints, categories, errors by status. Range 24H/7D/30D (Pro)/90D (Ultra) and a per-key filter. |
| Usage | totals, 24h numbers, per-key usage table, request sources, top endpoints |
| Logs | search (status, endpoint, key, request ID), success/error filter, range, key filter, detail panel with replay cURL, pagination, CSV export. Metadata only, never payloads. |
| API keys | create (limit per plan) with read-only or read and write access and category limits, reveal again, copy, rename, IP allowlist with IPv4 CIDR (Pro+), last-write time and a one-click "make read-only" suggestion, revoke, delete, 30-day sparkline, connected MCP apps with editable permissions, code samples in 6 languages |
| Data alerts (Finance) | watch SEC filings, FRED series, the Treasury curve, ECB rates or World Bank values; check now; on/off; signed `data.changed` webhooks |
| Bulk jobs (Ultra, or Finance Growth) | submit from the dashboard with an API/endpoint picker, job list with filters, per-item results, JSON download |
| Webhooks (Pro, or any Finance plan) | up to 5 endpoints, event selection, test, delivery history with payload, redeliver, on/off, rotate secret. Private and localhost targets are refused. |
| Billing | plan, pay-as-you-go balance, USD top-ups ($5 to $5,000), plan checkout for 1 to 12 months, transactions |
| Affiliate | referral link (`/?ref=code`, 30-day cookie), clicks, sign-ups, paying customers, commission history, move to balance, payout via PayPal or SWIFT (min $10) |
| Showcase, Settings, Support | project submissions; profile photo, name, password, notification switches, active sessions, delete account; support form prefilled from your latest errors |

## Billing flow (card checkout, USD)

1. The user picks a plan (1 to 12 months) or a USD top-up in Billing and is sent to a Dodo Payments checkout. Tax is calculated at checkout by Dodo (merchant of record).
2. Dodo calls `POST /webhooks/dodo` (signed, Standard Webhooks). The return page also asks Dodo directly, so payment is applied even if the webhook is late.
3. A plan becomes active for 30 days per month paid; a top-up is added to the balance. The `invoice.paid` webhook fires and, if the customer was referred, the referrer earns `APIZIE_AFFILIATE_PERCENT` (default 10%).
4. With **Use balance when the plan quota runs out** switched on, requests above the monthly quota cost $0.0004 each from the balance instead of returning 429 (response header `X-Billing: payg`).

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
