import { dodoConfig } from "../billing/dodo.js";
// Production readiness checks shown at /admin/setup. Each check says what is wrong and how to fix it.

export async function setupReport({ env, kv, storage, publicUrl, sbAuth, stableSecret, fetchImpl }) {
  const checks = [];
  const add = (id, label, status, detail, fix = null) => checks.push({ id, label, status, detail, fix });

  if (storage.backend === "MemoryKV") {
    add(
      "storage",
      "Database",
      storage.persistent ? "warn" : "fail",
      storage.persistent ? "Using a local JSON file. Fine for one server, not for Vercel." : "No database connected. Accounts, keys and usage live in memory and disappear between serverless instances.",
      "Run supabase/migrations/0001_apizie.sql in the Supabase SQL editor, then set SUPABASE_PROJECT_ID and SUPABASE_SECRET_KEY in Vercel and redeploy."
    );
  } else {
    try {
      const t0 = Date.now();
      const [pong] = await kv.batch([["PING"]]);
      const t1 = Date.now();
      await kv.batch([["PING"]]); // second call: connection already warm
      const rtt = Date.now() - t1;
      add("storage", "Database", pong === "PONG" ? "ok" : "fail", `${storage.backend} answered ${JSON.stringify(pong)} (first call ${t1 - t0} ms).`);
      const region = env.VERCEL_REGION ? ` from Vercel region ${env.VERCEL_REGION}` : "";
      add(
        "latency",
        "Database round trip",
        rtt <= 60 ? "ok" : "warn",
        `${rtt} ms per storage round trip${region}. Every API and MCP call needs at least one.`,
        rtt <= 60 ? null : "Run the functions in the same region as the database: Vercel, Project Settings, Functions, Function Region (or \"regions\" in vercel.json), set to the region closest to your Supabase project (Supabase, Project Settings, General shows it). Example: Supabase ap-southeast-1 (Singapore) -> Vercel sin1."
      );
    } catch (e) {
      const missing = /function|apizie_kv|schema cache/i.test(e.message);
      add("storage", "Database", "fail", `${storage.backend}: ${e.message}`, missing ? "The SQL migration has not been run. Open the Supabase SQL editor and run supabase/migrations/0001_apizie.sql." : "Check SUPABASE_SECRET_KEY (Project Settings, API Keys, secret key).");
    }
  }

  add("secret", "Session secret", stableSecret ? "ok" : "fail", stableSecret ? "A stable secret signs sign-in state and encrypts API keys." : "No APIZIE_SESSION_SECRET or SUPABASE_SECRET_KEY. Sign-in can fail across serverless instances and keys can't be revealed later.", stableSecret ? null : "Set APIZIE_SESSION_SECRET to a long random string in Vercel.");

  const pub = env.ZIE_PUBLIC_URL;
  const https = !!pub && /^https:\/\//.test(pub);
  let pubPath = "";
  try { pubPath = pub ? new URL(pub).pathname.replace(/\/+$/, "") : ""; } catch {}
  if (pubPath) add("url-path", "Public URL has a path", "warn", `APIZIE_PUBLIC_URL is ${pub}; only the origin is used (${publicUrl}).`, `Set APIZIE_PUBLIC_URL to just the domain, for example ${publicUrl}, and redeploy.`);
  add("url", "Public URL", https ? "ok" : "warn", pub ? `APIZIE_PUBLIC_URL is ${pub}.${https ? "" : " Production should use https."}` : `Not set; using ${publicUrl}. OAuth callbacks, sitemap and canonical links use this.`, https ? null : "Set APIZIE_PUBLIC_URL to your final https domain, for example https://apizie.tech.");

  add("admins", "Admin accounts", env.ZIE_ADMIN_EMAILS ? "ok" : "warn", env.ZIE_ADMIN_EMAILS ? `Admins: ${env.ZIE_ADMIN_EMAILS}` : "No admin emails configured, so nobody can approve invoices.", env.ZIE_ADMIN_EMAILS ? null : "Set APIZIE_ADMIN_EMAILS to your email.");

  let sbSettings = null;
  if (sbAuth) {
    try {
      const res = await fetchImpl(`${sbAuth.url}/auth/v1/settings`, { headers: { apikey: sbAuth.key }, signal: AbortSignal.timeout?.(5000) });
      const s = await res.json().catch(() => ({}));
      sbSettings = s?.external ?? {};
      const google = !!sbSettings.google;
      add("google", "Google sign-in (Supabase)", google ? "ok" : "fail", google ? "Google is enabled in Supabase Auth." : `Supabase answered ${res.status}; Google provider is ${google ? "on" : "off"}.`, `Supabase, Authentication, Providers: enable Google. Then add ${publicUrl}/auth/supabase/callback under Authentication, URL Configuration, Redirect URLs.`);
    } catch (e) {
      add("google", "Google sign-in (Supabase)", "warn", `Could not reach Supabase Auth: ${e.message}`, "Check SUPABASE_PROJECT_ID and SUPABASE_PUBLISHABLE_KEY.");
    }
  }

  // GitHub sign-in: a GitHub OAuth App (GITHUB_CLIENT_ID/SECRET) or the GitHub provider in Supabase Auth.
  const ghDirect = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
  const ghListed = !!sbAuth?.providers?.includes("github");
  const ghSupabase = ghListed && !!sbSettings?.github;
  const ghFix = `Create a GitHub OAuth App (GitHub, Settings, Developer settings, OAuth Apps, New OAuth App) with Homepage URL ${publicUrl} and Authorization callback URL ${publicUrl}/auth/github/callback. Then set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in Vercel and redeploy.`;
  if (ghDirect) add("github", "GitHub sign-in", "ok", "GitHub OAuth App is configured. Callback: " + `${publicUrl}/auth/github/callback`);
  else if (ghSupabase) add("github", "GitHub sign-in", "ok", "GitHub is enabled in Supabase Auth.");
  else if (ghListed) add("github", "GitHub sign-in", "fail", "SUPABASE_AUTH_PROVIDERS lists github, but the GitHub provider is off in Supabase Auth, so the button fails.", "Supabase, Authentication, Providers: enable GitHub with your OAuth App's client ID and secret (callback https://<project>.supabase.co/auth/v1/callback). Or remove github from SUPABASE_AUTH_PROVIDERS and use the direct setup: " + ghFix);
  else add("github", "GitHub sign-in", "warn", "Not configured, so the login page shows no GitHub button.", ghFix);

  {
    // Card payments through Dodo Payments (merchant of record).
    const cfg = dodoConfig(env);
    const mode = cfg.mode === "test_mode" ? "test mode" : "live mode";
    const seen = cfg.names.length ? `Dodo variables this deployment can see: ${cfg.names.join(", ")}.` : "This deployment sees no variable with DODO in its name.";
    const how = `In Vercel (Production environment) set DODO_PAYMENTS_API_KEY to an API key from Dodo, Developer, API Keys, then redeploy. Optional: DODO_PAYMENTS_PRODUCT_ID (a "Pay What You Want" USD product; created automatically when missing), DODO_PAYMENTS_ENVIRONMENT=test_mode for a test key, and the webhook ${publicUrl}/webhooks/dodo (payment.succeeded, payment.failed, payment.cancelled) with its secret in DODO_PAYMENTS_WEBHOOK_SECRET.`;
    if (!cfg.apiKey) add("card", "Card payments (Dodo Payments)", "fail", `No Dodo API key found, so checkout is off. ${seen}`, how);
    else if (!cfg.webhookSecret) add("card", "Card payments (Dodo Payments)", "warn", `Checkout works (${mode}${cfg.productId ? "" : ", product created automatically"}), but without the webhook secret a payment is only picked up when the customer returns to the billing page. ${seen}`, how);
    else add("card", "Card payments (Dodo Payments)", "ok", `Card checkout is on (${mode}${cfg.productId ? "" : ", product created automatically"}). Webhook: ${publicUrl}/webhooks/dodo. ${seen}`);
  }
  add("email", "Email notifications", env.RESEND_API_KEY && env.ZIE_EMAIL_FROM ? "ok" : "warn", env.RESEND_API_KEY && env.ZIE_EMAIL_FROM ? "Notifications are also emailed through Resend." : "Notifications appear in the dashboard only.", env.RESEND_API_KEY ? "Set APIZIE_EMAIL_FROM too." : "Optional: set RESEND_API_KEY and APIZIE_EMAIL_FROM.");
  add("support", "Support contacts", env.ZIE_SUPPORT_EMAIL ? "ok" : "warn", env.ZIE_SUPPORT_EMAIL ? `Support email: ${env.ZIE_SUPPORT_EMAIL}` : "The Support page only offers the report form.", env.ZIE_SUPPORT_EMAIL ? null : "Optional: set APIZIE_SUPPORT_EMAIL and APIZIE_DISCORD_URL.");

  return { storage, checks, ready: checks.every((c) => c.status !== "fail") };
}
