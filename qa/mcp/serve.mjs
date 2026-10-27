import { writeFileSync } from "node:fs";
import { boot } from "./lib.mjs";
const env = await boot({ fetchMode: "real" });
const { key } = await env.mkUser("claude-client@example.test");
writeFileSync(new URL("./mcp-config.json", import.meta.url), JSON.stringify({ mcpServers: { apizie: { type: "http", url: `${env.base}/mcp`, headers: { "x-api-key": key } } } }));
console.log("ready", env.base);
setInterval(() => {}, 1 << 30);
