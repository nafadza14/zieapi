# Apizie pricing (October 2026)

## The plans

| Plan | Monthly | Yearly (2 months free) | Requests / month | Per 1,000 | Local transfer |
|---|---|---|---|---|---|
| Free | $0 | - | 1,000 | - | - |
| Pro | $9 | $90 | 25,000 | $0.36 | Rp149.000 |
| Ultra (most popular) | $29 | $290 | 200,000 | $0.145 | Rp479.000 |
| Max | $99 | $990 | 1,000,000 | $0.099 | Rp1.599.000 |
| Pay-as-you-go | prepaid | - | above the plan quota | $0.40 | Rp6,6 per request |

Above 1,000,000 requests a month: custom (talk to us).

## What competitors charge

| Product | What you buy | Free | Entry paid plan | Unit cost at entry |
|---|---|---|---|---|
| Composio (tools for AI agents) | tool calls | 100,000 calls | $29/mo | overage $0.30 / 1,000 |
| Firecrawl (web scraping) | credits | 1,000 | $16/mo for 5,000; $83 for 100,000 | $3.20 / 1,000 |
| Tavily (search for agents) | credits | 1,000 | $30/mo for 4,000 | $7.50 / 1,000; PAYG $8 |
| Apify (scraping platform) | platform credit | $5 credit | $29/mo | depends on the actor |
| APILayer marketplace | requests per API | 100 to 500 | $9.99 to $29.99 for 5,000 to 25,000 | about $1 to $2 / 1,000 |
| Exchange-rate APIs (Open Exchange Rates, Fixer, ExchangeRate-API) | requests | 100 to 1,500 | $10 to $15 for 10,000 to 30,000 | $0.33 to $1.50 / 1,000 |

Sources: Composio pricing page, Tavily API credits docs, eesel.ai Firecrawl pricing, Automation Atlas Apify pricing, APIspine APILayer pricing, AllRatesToday state of exchange-rate APIs (all 2026).

## Why these numbers

- **Free 1,000.** The norm for developer and agent APIs is 1,000 free units a month (Firecrawl, Tavily, Open Exchange Rates). 600 looked stingy next to them; 1,000 still costs us cents.
- **$9 / $29 / $99.** $29 is the anchor price in this market (Composio, Apify, Tavily's $30). Ultra sits on that anchor and is marked "most popular". Pro at $9 is an impulse price under the $10 to $16 entry plans, and Max at $99 is a clean 10x jump in volume for about 3.4x the price.
- **Cheaper per request than single-purpose APIs.** Apizie mostly wraps public and official APIs, so we cannot charge scraping prices (Firecrawl, Tavily). We are priced below APILayer and exchange-rate APIs per 1,000 requests while covering 1,600+ sources with one key, which is the pitch.
- **Pay-as-you-go above Pro's rate.** $0.40 per 1,000 keeps a growing user from being cut off with a 429, but staying on Free plus PAYG is never cheaper than upgrading, so the plans stay the better deal.
- **Yearly = 10 months.** Two months free (about 17% off) is the common SaaS discount and improves cash flow.

## Unit cost and margin

Estimated cost to serve one request on Vercel Fluid compute (Pro plan rates: active CPU about $0.128 to $0.22 per CPU-hour, memory about $0.011 to $0.018 per GB-hour, $0.60 per million invocations), assuming about 30 ms of active CPU and 200 ms wall time at 1 GB:

- compute about $0.0000013, memory about $0.0000008, invocation $0.0000006
- plus the Supabase write for logs and usage, roughly $0.5 to $1 per million requests on the $25 Pro project

That is about $3 to $5 per million requests. Even Max ($99 for 1,000,000) keeps a gross margin above 90%. Bring-your-own-key APIs cost us nothing upstream; keyless sources have their own fair-use limits, which the per-minute caps protect.

## Local transfer amounts

Bank transfer invoices stay in IDR at roughly Rp16.500 per USD (market rate was about Rp17.900 on 2 October 2026), rounded down to friendly numbers. When a card or PayPal processor is added (Paddle or Lemon Squeezy act as merchant of record and handle global VAT), charge the USD prices directly.
