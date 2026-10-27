# MCP QA harness

End-to-end checks that drive Apizie through its real `/mcp` endpoint with the official MCP TypeScript SDK client.
It is separate from the app (the app itself stays dependency-free) and is not run by `npm test`.
Regression tests for every defect it found live in `test/mcp-qa.test.js` and do run in `npm test`.

```
cd qa/mcp && npm install
node discovery.mjs > discovery.out.json   # every source, every operation, every schema via MCP (writes ops.json)
node execute.mjs                          # runs every operation through run_scraper against a recording stub upstream
node protocol.mjs                         # protocol edge cases, failures, quota, isolation, security (49 checks)
node live.mjs                             # real upstream calls for hosts reachable from the test machine
node agent.mjs                            # scripted agent scenarios (discover, inspect, invoke, page, explain gaps)
node serve.mjs                            # boots a server and writes mcp-config.json for a real client (Claude Code)
```

`execute.mjs` uses a stub upstream on purpose: it proves the gateway path, not live data. Live data is only
claimed for what `live.mjs` actually reached. The latest results are in `docs/QA-MCP-REPORT.json`.
