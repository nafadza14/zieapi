// Vercel Serverless Function entry. vercel.json rewrites every path here.
// One app instance per warm function; state (usage, cache, bulk jobs) is
// per-instance — set ZIE_KEYS so API keys exist on every instance.
import { createApp } from "../src/app.js";

const app = createApp({ serverless: true });

export default function handler(req, res) {
  return app.handler(req, res);
}
