// Wire-compatibility check against the public MIT zpi-sdk.
// Run: npm i --no-save zpi-sdk@0.6.0 && node examples/zpi-sdk-parity.mjs
import { createApp } from "../src/app.js";
import { createApiKey } from "../src/auth.js";
import { ZpiClient, ZpiPlanGateError, ZpiInvalidParamsError, ZpiAuthError, ZpiExecError } from "zpi-sdk";
const app = createApp({ logger: null, quiet: true });
await new Promise(r => app.server.listen(0, "127.0.0.1", r));
const baseURL = `http://127.0.0.1:${app.server.address().port}`;
const key = createApiKey(app.store, { plan: "ultra" }).key;
const c = new ZpiClient({ apiKey: key, baseURL, maxRetries: 0 });
const out = {};
out.run = await c.run("indonesia:terbilang", "convert", { number: 2026 });
out.post_autoverb = await c.run("dev-tools:text", "stats", { text: "a b c" });
out.path = await c.run("dev-tools:text", "slugify/:text", { text: "Halo Zie" });
out.list = (await c.catalog.list({ limit: 2 })).items.map(i => i.slug);
out.schema = await c.catalog.schema("dev-tools:text", "slugify");
out.stats = await c.catalog.stats("indonesia:terbilang");
const free = new ZpiClient({ apiKey: createApiKey(app.store, { plan: "free" }).key, baseURL, maxRetries: 0 });
try { await free.run("web-tools:page","meta",{url:"https://example.com"}) } catch(e){ out.gate = [e instanceof ZpiPlanGateError, e.requiredPlan, e.upgradeUrl] }
try { await c.run("dev-tools:hash","digest",{}) } catch(e){ out.invalid = [e instanceof ZpiInvalidParamsError, e.errors] }
try { await new ZpiClient({apiKey:"zie_x", baseURL, maxRetries:0}).run("dev-tools:uuid","v4",{}) } catch(e){ out.auth = e instanceof ZpiAuthError }
const job = await c.bulk.submit("dev-tools:hash","digest",[{text:"a"},{params:{text:"b"}}]);
const done = await job.wait({ pollIntervalMs: 20 });
out.bulk = [done.status, done.succeeded];
console.log(JSON.stringify(out, null, 1));
app.server.close();
