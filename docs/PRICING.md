# Apizie pricing (30 October 2026)

Apizie has two price schemes:

1. **General plans** for the whole public catalog (thousands of public and bring-your-own-key APIs). This is the global, mass-market offer and keeps the original prices.
2. **Apizie Finance**, a premium add-on for teams building AI agents on financial and economic data: SEC EDGAR, FRED, ECB, U.S. Treasury, GLEIF and the World Bank through one REST API and one MCP server, with the source (publisher, official link, retrieval time, licence and attribution text) on every answer.

Finance runs next to any general plan, with its own monthly quota. One API key and one MCP connection reach both.

## General plans

| Plan (id) | Monthly | Yearly (2 months free) | Requests / month | Requests / minute | Bulk |
|---|---|---|---|---|---|
| Free (`free`) | $0 | - | 1,000 | 100 | - |
| Pro (`pro`) | $9 | $90 | 25,000 | 2,000 | - |
| Ultra (`ultra`) | $29 | $290 | 200,000 | 5,000 | 500 items |
| Max (`max`) | $99 | $990 | 1,000,000 | 15,000 | 2,000 items |

Pay-as-you-go above the quota: **$0.40 per 1,000 requests** from a prepaid balance (top-ups $5, $10, $25, $50; minimum $5).

## Apizie Finance (premium add-on)

| Plan (id) | Monthly | Yearly | Finance requests / month | Licence | Data alerts | Bulk |
|---|---|---|---|---|---|---|
| Finance Starter (`fin_starter`) | $49 | $490 | 100,000 | Commercial use inside your company | 5 | - |
| Finance Growth (`fin_growth`, most popular) | $199 | $1,990 | 1,000,000 | Use in your own product, with attribution | 50 | 500 items |
| Finance Business (`fin_business`) | $499 | $4,990 | 5,000,000 | Use in your own product, with attribution | 200 | 2,000 items |
| Finance Enterprise | custom | - | custom | Redistribution, resale, SLA with credits | custom | custom |

- There is no free tier for Finance. Without an active Finance plan, the six sources and `official:*` answer `403 finance_plan_required` and are not billed.
- Finance requests count against the Finance quota only, never the general plan's.
- Above the Finance quota, pay-as-you-go uses the same balance at **$1.00 per 1,000 Finance requests**.
- Data alerts and signed webhooks come with every Finance plan.

## What revenue-earning competitors charge (Finance)

Researched on 30 October 2026 from official pricing pages.

| Product | Who pays | Entry paid | Mid | Top self-serve | Licence split |
|---|---|---|---|---|---|
| sec-api.io (EDGAR + MCP) | developers, funds, law firms | $49 Personal & Startups | $199 Business internal | Enterprise (redistribution) | yes, by licence |
| Financial Modeling Prep | developers, fintechs | $29 | $69 | $139 (Commercial tab separate) | personal vs commercial |
| EODHD | developers, analysts | $19.99 to $99.99 personal | $399 internal commercial | $2,499 enterprise | personal vs commercial |
| Massive (formerly Polygon.io) | developers, traders | $29 | $79 to $199 individual | $2,499 business | individual vs business |
| Financial Datasets (built for AI agents) | AI agent builders | $200 personal | $2,000 professional | enterprise | personal vs commercial, overage $5 to $10 per 1,000 |
| Alpha Vantage | developers | $49.99 | $99.99 to $149.99 | $249.99 | by rate limit |
| Tiingo | developers | $30 | $50 commercial internal | redistribution priced separately | yes |
| OpenCorporates (company data with provenance) | KYC and risk teams | £225 | £660 | £1,200 | all tiers commercial |

Sources: sec-api.io/pricing, site.financialmodelingprep.com/pricing-plans, eodhd.com/pricing and /commercial-pricing, massive.com/pricing and /business, financialdatasets.ai/pricing, alphavantage.co/premium, tiingo.com/about/pricing, opencorporates.com/pricing.

## Why two schemes

- **The general catalog sells to everyone.** Low prices ($9 to $99) keep it easy to start and match the mass-market API gateway segment.
- **Finance sells to a specific buyer with a budget.** Teams building research, finance and business-analysis agents already pay $49 to $499 a month for official financial data. Finance is priced in that band, not at gateway prices.
- **$49 and $199** match sec-api.io, the closest competitor selling official filings data with an MCP server to the same buyers.
- **Licence by tier.** Every revenue-earning competitor separates internal from customer-facing use. Finance Starter is internal; Growth and Business allow use in your own product with attribution; redistribution is Enterprise.
- **Overage $1 per 1,000** on Finance is below Financial Datasets ($5 to $10) and high enough that plans stay the better deal.

## Existing customers

- General plans keep the prices they had before; nothing changes for current subscribers.
- The six official sources move into Apizie Finance. Accounts that used them on a general plan need a Finance plan to keep calling them.
