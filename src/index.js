#!/usr/bin/env node
import { createApp, VERSION } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp({ dataFile: process.env.ZIE_DATA_FILE ?? "./data/zieapi.json" });

app.server.listen(port, host, () => {
  const t = app.catalog.totals();
  console.log(`\n  zieapi v${VERSION}  →  http://localhost:${port}`);
  console.log(`  ${t.scrapers} scrapers · ${t.endpoints} endpoints · ${t.liveEndpoints} live · storage: ${app.kv.constructor.name}`);
  if (app.kv.constructor.name === "MemoryKV") console.log("  First account you register locally becomes admin.\n");
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    app.server.close();
    await app.webhooks.drain();
    app.kv.flush?.();
    process.exit(0);
  });
}
