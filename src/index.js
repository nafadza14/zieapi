#!/usr/bin/env node
import { createApp, VERSION } from "./app.js";
import { createApiKey } from "./auth.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp({ dataFile: process.env.ZIE_DATA_FILE ?? "./data/zieapi.json" });

// First run in development: mint a key so you can try the API immediately.
if (process.env.NODE_ENV !== "production" && app.store.listKeys().length === 0) {
  const plan = process.env.ZIE_DEV_KEY_PLAN ?? "ultra";
  const { key } = createApiKey(app.store, { name: "dev", plan });
  app.store.flush();
  console.log(`\n  Dev API key (${plan}) — shown once:\n  ${key}\n`);
}

app.server.listen(port, host, () => {
  const t = app.catalog.totals();
  console.log(`zieapi v${VERSION} listening on http://${host}:${port}  (${t.scrapers} scrapers, ${t.endpoints} endpoints)`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    app.server.close();
    await app.webhooks.drain();
    app.store.flush();
    process.exit(0);
  });
}
