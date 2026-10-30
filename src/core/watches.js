// Data alerts: watch an official source and get a signed `data.changed` webhook (and a dashboard notification)
// when it publishes something new. Checks run on a schedule (/api/cron/watches) and on demand ("Check now").
// A check runs through the normal executor, so it is validated, cached and cited like any other call, but it
// is not billed to the customer's quota.

import { sha256 } from "./util.js";

/** What can be watched. `pick` reduces the response to the part that matters, so only real changes alert. */
export const WATCH_TYPES = {
  "sec-filings": {
    label: "New SEC filings",
    help: "A company files a new form with the SEC (10-K, 10-Q, 8-K…).",
    fields: [
      { name: "company", label: "Ticker, company name or CIK", required: true, example: "AAPL" },
      { name: "form", label: "Only these forms (optional, comma-separated)", example: "10-K,10-Q,8-K" },
    ],
    run: (p) => ({ project: "finance:sec-edgar", endpoint: "filings", params: { company: p.company, form: p.form || undefined, count: 10 } }),
    pick: (d) => {
      const f = d?.filings?.[0];
      return f ? { key: f.accessionNumber, summary: `${d.name ?? "Company"} filed ${f.form} on ${f.filingDate}`, latest: f, recent: (d.filings ?? []).slice(0, 5) } : null;
    },
  },
  "fred-series": {
    label: "New FRED observation",
    help: "A FRED series gets a new or revised latest value (rates, CPI, unemployment…).",
    fields: [{ name: "series", label: "FRED series id", required: true, example: "CPIAUCSL" }],
    run: (p) => ({ project: "finance:fred", endpoint: "series-observations", params: { series: String(p.series).toUpperCase(), length: 1 } }),
    pick: (d) => {
      const o = d?.observations?.at(-1);
      return o ? { key: `${o.date}=${o.value}`, summary: `${d.series ?? "Series"} ${o.date}: ${o.value}`, latest: o } : null;
    },
  },
  "treasury-yields": {
    label: "New Treasury yield curve",
    help: "The U.S. Treasury publishes a new daily par yield curve.",
    fields: [],
    run: () => ({ project: "finance:us-treasury", endpoint: "yield-curve", params: { length: 1 } }),
    pick: (d) => (d?.latest ? { key: d.latest.date, summary: `Treasury par yield curve for ${d.latest.date}`, latest: d.latest } : null),
  },
  "ecb-rates": {
    label: "ECB policy rate change",
    help: "The ECB changes its deposit facility, main refinancing or marginal lending rate.",
    fields: [],
    run: () => ({ project: "finance:ecb", endpoint: "key-rates", params: { last: 1 } }),
    pick: (d) => {
      const rates = Object.fromEntries((d?.rates ?? []).map((r) => [r.rate, r.latest?.value ?? null]));
      return Object.keys(rates).length ? { key: JSON.stringify(rates), summary: `ECB key rates: ${Object.entries(rates).map(([k, v]) => `${k} ${v}%`).join(", ")}`, latest: rates } : null;
    },
  },
  "worldbank-indicator": {
    label: "New World Bank value",
    help: "A World Bank indicator gets a newer year for a country.",
    fields: [
      { name: "country", label: "Country (ISO2/ISO3)", required: true, example: "US" },
      { name: "indicator", label: "Indicator code", required: true, example: "NY.GDP.MKTP.CD" },
    ],
    run: (p) => ({ project: "finance:worldbank", endpoint: "indicator", params: { country: p.country, indicator: p.indicator, length: 1 } }),
    pick: (d) => {
      const r = d?.data?.[0];
      return r ? { key: `${r.year}=${r.value}`, summary: `${r.indicatorName ?? r.indicator} for ${r.country}, ${r.year}: ${r.value}`, latest: r } : null;
    },
  },
};

export const watchTypeList = () => Object.entries(WATCH_TYPES).map(([id, t]) => ({ id, label: t.label, help: t.help, fields: t.fields }));

/** Validate a new watch request. Returns { type, params } or throws an Error with a user-facing message. */
export function parseWatch(body) {
  const type = String(body?.type ?? "");
  const def = WATCH_TYPES[type];
  if (!def) throw new Error(`Unknown alert type. Choose one of: ${Object.keys(WATCH_TYPES).join(", ")}`);
  const params = {};
  for (const f of def.fields) {
    const v = String(body?.params?.[f.name] ?? "").trim().slice(0, 120);
    if (f.required && !v) throw new Error(`${f.label} is required`);
    if (v) params[f.name] = v;
  }
  return { type, params };
}

export function createWatcher({ repo, executor, webhooks, notify, planOf, financeOf = async () => null, logger = null, now = () => Date.now() }) {
  /** Check one watch. Returns the updated record plus `changed`. Never throws. */
  async function check(w) {
    const def = WATCH_TYPES[w.type];
    if (!def || w.enabled === false) return { watch: w, changed: false, skipped: true };
    const plan = await planOf(w.userId);
    // Data alerts are an Apizie Finance feature: without an active Finance plan the watch is skipped, not deleted.
    const financePlan = await financeOf(w.userId);
    if (!financePlan) return { watch: w, changed: false, skipped: true, reason: "finance_plan_required" };
    const { project, endpoint, params } = def.run(w.params ?? {});
    const [cat, slug] = project.split(":");
    const r = await executor.run({
      caller: { owner: w.userId, plan, financePlan, keyId: null, keyPreview: "alert", keyName: "Data alert", source: "alert", requestId: null },
      projectKey: `${cat}:${slug}`,
      endpointSlug: endpoint,
      method: "GET",
      params,
      fresh: true,
      reserved: true, // alerts are part of the plan, not billed per check
    });
    const at = new Date(now()).toISOString();
    if (r.status !== 200) {
      const next = await repo.patchItem("watch", w.id, { lastCheckedAt: at, lastError: String(r.body?.message ?? r.body?.error?.message ?? r.body?.error ?? `HTTP ${r.status}`).slice(0, 300) });
      return { watch: next, changed: false, error: next.lastError };
    }
    const picked = def.pick(r.body.data);
    if (!picked) {
      const next = await repo.patchItem("watch", w.id, { lastCheckedAt: at, lastError: "The source returned no data for these settings" });
      return { watch: next, changed: false, error: next.lastError };
    }
    const fp = sha256(String(picked.key)).slice(0, 24);
    const first = !w.fingerprint;
    const changed = !first && fp !== w.fingerprint;
    const patch = { lastCheckedAt: at, lastError: null, fingerprint: fp, lastSummary: picked.summary, lastSource: r.body.source ?? null };
    if (changed) Object.assign(patch, { lastChangedAt: at, changes: (w.changes ?? 0) + 1 });
    const next = await repo.patchItem("watch", w.id, patch);
    if (changed) {
      const payload = { alert: w.id, name: w.name, type: w.type, params: w.params, summary: picked.summary, previous: w.lastSummary ?? null, current: picked.latest, recent: picked.recent ?? undefined, source: r.body.source ?? null, detectedAt: at };
      webhooks?.emit(w.userId, "data.changed", payload);
      notify?.(w.userId, "dataAlerts", w.name || def.label, picked.summary, { link: "/dashboard/alerts" });
    }
    return { watch: next, changed, first };
  }

  /** Check every enabled watch that is due. Bounded so one run stays inside a serverless time limit. */
  async function runDue({ minAgeMs = 50 * 60 * 1000, max = 200, budgetMs = 45_000 } = {}) {
    const t0 = now();
    const all = (await repo.listItems("watch")).filter((w) => w.enabled !== false && (!w.lastCheckedAt || now() - Date.parse(w.lastCheckedAt) >= minAgeMs));
    all.sort((a, b) => String(a.lastCheckedAt ?? "").localeCompare(String(b.lastCheckedAt ?? "")));
    const out = { due: all.length, checked: 0, changed: 0, errors: 0 };
    for (const w of all.slice(0, max)) {
      if (now() - t0 > budgetMs) break;
      try {
        const r = await check(w);
        out.checked++;
        if (r.changed) out.changed++;
        if (r.error) out.errors++;
      } catch (e) {
        out.errors++;
        logger?.warn?.(`watch ${w.id} failed: ${e.message}`);
      }
    }
    return out;
  }

  return { check, runDue };
}
