# Registrasi Direktori Model Context Protocol (MCP) Apizie

Dokumen ini berisi spesifikasi pendaftaran resmi Apizie ke direktori ekosistem MCP global terpopuler.

## 1. Glama MCP Registry (glama.ai/mcp/servers)
Metode: Registrasi repositori publik GitHub atau URL Server HTTP langsung.

Data Pendaftaran:
• Name: Apizie MCP Server
• URL: https://apizie.tech/mcp
• Transport: streamable http
• Category: Developer Tools, Search, Data Providers, Finance
• Description: Unified MCP server providing access to 600+ live data endpoints and 1,400+ public APIs with one key. Includes Wikipedia, PubMed research, financial data, news feeds, and open data utilities for Claude, Cursor, and ChatGPT.
• Authentication: OAuth 2.1 or Bearer token (API Key)
• Repository: https://github.com/nafadza14/zieapi
• Homepage: https://apizie.tech/mcp

## 2. Smithery AI (smithery.ai)
Format smithery.yaml yang dapat ditempatkan di root repositori:

```yaml
name: apizie
version: 1.0.0
description: Access 600+ live APIs and open data endpoints via one MCP server
url: https://apizie.tech/mcp
type: http
tools:
  - name: search_scrapers
    description: Search live APIs and data sources across categories
  - name: get_scraper_schema
    description: Get parameters and schema for any endpoint
  - name: run_scraper
    description: Execute an endpoint and get clean JSON
  - name: list_categories
    description: List available data categories
  - name: get_account
    description: Check plan and quota status
  - name: get_usage
    description: Monitor requests used this month
```

## 3. Awesome MCP Servers (GitHub Repositories)
Target repositori:
1. github.com/punkpeye/awesome-mcp-servers
2. github.com/wong2/awesome-mcp-servers

Format Pull Request (Markdown Entry):
Kategori: Aggregators & Data Providers

• [Apizie](https://apizie.tech/mcp) (by [@nafadza14](https://github.com/nafadza14)) : Unified Streamable HTTP MCP server giving AI agents direct access to 600+ live public data sources, financial feeds, PubMed academic research, and news.

## 4. PulseMCP (pulsemcp.com)
• Submission Form: pulsemcp.com/submit
• Server Name: Apizie
• Server Endpoint: https://apizie.tech/mcp
• Documentation: https://apizie.tech/docs
• Pricing Model: Freemium (1,000 requests per month free, paid plans from $9)
