<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/apizie-horizontal-white.svg">
    <img src="brand/logo/apizie-horizontal.svg" alt="Apizie" width="320">
  </picture>
</p>

# Apizie Finance: Official-Source Financial Data Layer for AI Agents

[![Official MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.nafadza14%2Fapizie--finance-blue)](https://registry.modelcontextprotocol.io)
[![Glama Connector](https://glama.ai/mcp/connectors/io.github.nafadza14/apizie-finance/badges/score.svg)](https://glama.ai/mcp/connectors/io.github.nafadza14/apizie-finance)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Streamable HTTP](https://img.shields.io/badge/Transport-Streamable%20HTTP-orange)](https://apizie.tech/mcp)

Zero-hallucination, compliance-ready financial data for AI agents, quantitative bots, and LLM copilots. Connects directly to **SEC EDGAR, FRED (Federal Reserve), European Central Bank (ECB), U.S. Treasury, and GLEIF** over a single remote Streamable HTTP MCP server and REST API.

Every response includes machine-readable source citations with official publisher links, timestamps, and verifiable document anchors.

---

## ⚡ Quick Start: Connect to Claude Code / Cursor

No local Python runtimes, Docker containers, or fragile scrapers required. Add Apizie Finance directly via your MCP client:

### Cursor (`~/.cursor/mcp.json` or Project `.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "apizie-finance": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://apizie.tech/mcp"]
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "apizie-finance": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://apizie.tech/mcp"]
    }
  }
}
```

### Remote Streamable HTTP Endpoint
- **URL:** `https://apizie.tech/mcp`
- **Protocol Version:** `2025-11-25`, `2024-11-05`
- **Free Quota:** 1,000 requests/month out of the box at [apizie.tech/register](https://apizie.tech/register)

---

## 🏛️ Supported Official Data Sources

| Provider | Data Coverage | Compliance Citations |
| :--- | :--- | :--- |
| **SEC EDGAR** | 10-K, 10-Q, 8-K filings, XBRL facts, company concept metrics | SEC Document URL & Accession Number |
| **FRED (Fed)** | Macro series, inflation (CPI/PCE), Fed funds rate, unemployment, GDP | St. Louis Fed Observation ID & Link |
| **U.S. Treasury** | Daily yield curve, debt to the penny, interest rate spreads | Treasury Fiscal Data API Anchor |
| **ECB** | Euro foreign exchange rates, key policy rates | European Central Bank Statistical Data |
| **GLEIF** | Legal Entity Identifier (LEI) verification & entity structure | Global Legal Entity Identifier Foundation |
| **Global Markets** | Real-time market quotes, tickers, order books, and crypto feeds | Exchange Timestamp & Multi-source Validation |

---

## 🤖 Why Agents Need Apizie

1. **Zero Hallucination Guarantee:** Prompts receive pre-parsed, deterministic tables with source URLs linking to the raw filing.
2. **Audit Trail for Compliance:** Every single data point returns an audit block containing publisher, timestamp, human-verifiable link, and official legal entity info.
3. **Token Efficiency:** Raw SEC 10-K filings dump hundreds of pages of unstructured text. Apizie extracts exact figures into compact JSON payloads, saving up to 90% in agent token consumption.
4. **Composite Endpoints:** Fetch company registration, recent filings, LEI identifier, and annual revenue in a single round trip.

---

## 📚 Complete REST & MCP Documentation

Full catalog with 680+ endpoints, interactive sandbox, and API keys:
👉 **[https://apizie.tech/finance](https://apizie.tech/finance)**

Free tier registration:
👉 **[https://apizie.tech/register](https://apizie.tech/register)**

---

## 📄 License

MIT © Ghilman Nafadza Hakim / Apizie.
