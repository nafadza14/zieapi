#!/usr/bin/env node
// Usage: node scripts/create-key.js --plan pro --name "my app" [--owner you@example.com]
import { Store } from "../src/store.js";
import { createApiKey } from "../src/auth.js";
import { PLANS } from "../src/plans.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const plan = args.plan ?? "free";
if (!PLANS[plan]) {
  console.error(`Unknown plan "${plan}". Use one of: ${Object.keys(PLANS).join(", ")}`);
  process.exit(1);
}
const store = new Store({ file: process.env.ZIE_DATA_FILE ?? "./data/zieapi.json" });
const { key, record } = createApiKey(store, { plan, name: args.name ?? "cli", owner: args.owner ?? null });
store.flush();
console.log(`id:   ${record.id}\nplan: ${record.plan}\nkey:  ${key}\n(store it now — only the hash is saved)`);
