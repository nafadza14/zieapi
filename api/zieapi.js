// Vercel Serverless Function entry: vercel.json rewrites every non-static path here.
import { createApp } from "../src/app.js";

const app = createApp({ serverless: true });

export default function handler(req, res) {
  return app.handler(req, res);
}
