#!/usr/bin/env node
// Print a new key line for the ZIE_KEYS env var (Vercel / serverless).
// Usage: node scripts/gen-key.js ultra   →   ultra:zie_xxxxxxxx
import { randomBytes } from "node:crypto";
import { PLANS } from "../src/plans.js";
const plan = process.argv[2] ?? "free";
if (!PLANS[plan]) {
  console.error(`Unknown plan "${plan}". Use: ${Object.keys(PLANS).join(", ")}`);
  process.exit(1);
}
console.log(`${plan}:zie_${randomBytes(24).toString("base64url")}`);
