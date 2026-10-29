// Super-admin monitoring API: platform traffic, customers, revenue, source health and a live request feed.
// Reads the platform-wide hourly rollups (ah:_g:<hour>, see core/analytics.js) plus users and invoices.

import { loadHours, summarize, systemStatus, RANGES, GLOBAL_LOG } from "../core/analytics.js";
import { PLANS, billedMonths } from "../core/plans.js";

const DAY = 86400_000;
const HOUR = 3600_000;

export function createAdminAnalytics({ repo, kv, catalog, storage, version, env = {} }) {
  const memo = new Map();
  const cached = async (id, ttlMs, fn) => {
    const hit = memo.get(id);
    if (hit && hit.exp > Date.now()) return hit.v;
    const v = await fn();
    if (memo.size > 50) memo.delete(memo.keys().next().value);
    memo.set(id, { v, exp: Date.now() + ttlMs });
    return v;
  };

  const rangeOf = (q) => {
    const range = RANGES[q.range] ? q.range : "7d";
    const tz = Math.max(-840, Math.min(840, Number(q.tz) || 0));
    const to = Date.now();
    return { range, tz, to, from: to - RANGES[range], span: RANGES[range], granularity: range === "24h" ? "hour" : "day" };
  };

  /** Extra global fields summarize() does not read: per-owner requests and per-source errors. */
  function extras(hours, from, to) {
    const owners = {}, proj = {}, perr = {}, p5 = {};
    for (const { t, f } of hours) {
      if (t + HOUR <= from || t > to) continue;
      for (const [k, v] of Object.entries(f)) {
        if (k.startsWith("ow|")) owners[k.slice(3)] = (owners[k.slice(3)] ?? 0) + v;
        else if (k.startsWith("ep|")) { const pk = k.slice(3).split("/")[0]; proj[pk] = (proj[pk] ?? 0) + v; }
        else if (k.startsWith("pe|")) perr[k.slice(3)] = (perr[k.slice(3)] ?? 0) + v;
        else if (k.startsWith("p5|")) p5[k.slice(3)] = (p5[k.slice(3)] ?? 0) + v;
      }
    }
    return { owners, proj, perr, p5 };
  }

  const paidPlan = (u) => {
    const p = repo.effectivePlan(u);
    return p !== "free" ? p : null;
  };
  const inRange = (iso, from, to) => { const t = Date.parse(iso ?? ""); return t >= from && t <= to; };
  const dayKeyTz = (t, tz) => new Date(t + tz * 60_000).toISOString().slice(0, 10);
  function daySeries(from, to, tz) {
    const out = new Map();
    for (let d = Date.parse(dayKeyTz(from, tz)); d <= Date.parse(dayKeyTz(to, tz)); d += DAY) out.set(new Date(d).toISOString().slice(0, 10), 0);
    return out;
  }

  async function overview(q) {
    const r = rangeOf(q);
    return cached(`ov|${r.range}|${r.tz}|${Math.floor(Date.now() / 15_000)}`, 15_000, async () => {
      const prevFrom = r.from - r.span;
      const [hours, users, invoices, payouts, reports, showcase, disabled, status] = await Promise.all([
        loadHours(kv, "_g", r.range === "90d" ? r.from : prevFrom, r.to),
        repo.listUsers(),
        repo.listItems("invoice"),
        repo.listItems("payout"),
        repo.listItems("report"),
        repo.listItems("showcase"),
        repo.disabledScrapers(),
        systemStatus(kv),
      ]);
      const cur = summarize(hours, { from: r.from, to: r.to, tzOffsetMin: r.tz, granularity: r.granularity });
      const prev = r.range === "90d" ? null : summarize(hours, { from: prevFrom, to: r.from, tzOffsetMin: r.tz, granularity: "day" });
      const x = extras(hours, r.from, r.to);
      const byId = new Map(users.map((u) => [u.id, u]));

      // customers
      const byPlan = { free: 0, pro: 0, ultra: 0, max: 0 };
      let mrrUsd = 0;
      for (const u of users) {
        const p = repo.effectivePlan(u);
        byPlan[p] = (byPlan[p] ?? 0) + 1;
        if (p !== "free" && u.status !== "suspended") mrrUsd += PLANS[p]?.priceUsd ?? 0;
      }
      const paying = users.filter((u) => paidPlan(u) && u.status !== "suspended").length;
      const newUsers = users.filter((u) => inRange(u.createdAt, r.from, r.to));
      const prevNewUsers = users.filter((u) => inRange(u.createdAt, prevFrom, r.from)).length;
      const signups = daySeries(r.from, r.to, r.tz);
      for (const u of newUsers) { const k = dayKeyTz(Date.parse(u.createdAt), r.tz); if (signups.has(k)) signups.set(k, signups.get(k) + 1); }
      const activeOwners = Object.keys(x.owners);
      const topCustomers = Object.entries(x.owners)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id, requests]) => {
          const u = byId.get(id);
          return { id, requests, email: u?.email ?? null, name: u?.name ?? (id.startsWith("key_") ? "Server key" : "Deleted account"), plan: u ? repo.effectivePlan(u) : null, usedShare: cur.total ? requests / cur.total : 0 };
        });

      // revenue in US dollars: card invoices (cents); older bank-transfer invoices at their US dollar list price
      const usdOf = (i) => (i.currency === "USD" ? (i.amount ?? 0) / 100 : i.priceUsd ?? ((i.requests ?? 0) * 0.4) / 1000);
      const paid = invoices.filter((i) => i.status === "paid");
      const paidIn = (a, b) => paid.filter((i) => inRange(i.paidAt, a, b));
      const revenue = paidIn(r.from, r.to).reduce((n, i) => n + usdOf(i), 0);
      const prevRevenue = paidIn(prevFrom, r.from).reduce((n, i) => n + usdOf(i), 0);
      const revSeries = daySeries(r.from, r.to, r.tz);
      for (const i of paidIn(r.from, r.to)) { const k = dayKeyTz(Date.parse(i.paidAt), r.tz); if (revSeries.has(k)) revSeries.set(k, revSeries.get(k) + usdOf(i)); }

      // source health: sources with traffic, worst first
      const sources = Object.entries(x.proj)
        .map(([project, requests]) => ({ project, name: catalog.find(project, { all: true })?.displayName ?? project, iconUrl: catalog.overrides?.[project] || catalog.find(project, { all: true })?.iconUrl || null, status: catalog.find(project, { all: true })?.status ?? null, requests, errors: x.perr[project] ?? 0, serverErrors: x.p5[project] ?? 0, disabled: disabled.has(project) }))
        .map((s) => ({ ...s, errorRate: s.requests ? s.errors / s.requests : 0 }))
        .sort((a, b) => b.serverErrors - a.serverErrors || b.errorRate - a.errorRate || b.requests - a.requests);
      const failing = sources.filter((s) => s.requests >= 5 && s.serverErrors / s.requests >= 0.2);

      const pick = (i) => ({ id: i.id, email: i.email ?? byId.get(i.userId)?.email ?? null, type: i.type ?? "plan", plan: i.plan ?? null, months: i.months ?? null, amount: i.amount, currency: i.currency ?? "IDR", method: i.method ?? "bank_transfer", status: i.status, createdAt: i.createdAt, paidAt: i.paidAt ?? null });
      const delta = (a, b) => (b ? (a - b) / b : null);

      return {
        range: r.range,
        generatedAt: new Date().toISOString(),
        traffic: {
          ...cur,
          activeCustomers: activeOwners.length,
          previous: prev ? { total: prev.total, errors: prev.errors, successRate: prev.successRate, p95Ms: prev.p95Ms } : null,
          change: prev ? { total: delta(cur.total, prev.total), errors: delta(cur.errors, prev.errors) } : null,
          allTime: Number(await kv.get("g:requests")) || 0,
        },
        customers: {
          total: users.length,
          paying,
          byPlan,
          suspended: users.filter((u) => u.status === "suspended").length,
          admins: users.filter((u) => u.role === "admin").length,
          newInRange: newUsers.length,
          newPrevious: r.range === "90d" ? null : prevNewUsers,
          conversion: users.length ? paying / users.length : null,
          signups: [...signups].map(([t, count]) => ({ t, count })),
          recent: [...users].sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0)).slice(0, 8).map((u) => ({ id: u.id, email: u.email, name: u.name, plan: repo.effectivePlan(u), createdAt: u.createdAt, status: u.status ?? "active" })),
          top: topCustomers,
        },
        revenue: {
          currency: "USD",
          inRange: revenue,
          previous: r.range === "90d" ? null : prevRevenue,
          change: r.range === "90d" ? null : delta(revenue, prevRevenue),
          mrrUsd,
          arpuUsd: paying ? mrrUsd / paying : 0,
          series: [...revSeries].map(([t, amount]) => ({ t, amount })),
          paidCount: paidIn(r.from, r.to).length,
          awaitingReview: invoices.filter((i) => i.status === "awaiting_review").map(pick).slice(0, 10),
          pending: invoices.filter((i) => i.status === "pending").length,
          recentPaid: [...paid].sort((a, b) => Date.parse(b.paidAt ?? 0) - Date.parse(a.paidAt ?? 0)).slice(0, 6).map(pick),
          yearlyMonthsBilled: billedMonths(12),
        },
        attention: {
          invoicesToReview: invoices.filter((i) => i.status === "awaiting_review").length,
          payoutsRequested: payouts.filter((p) => p.status === "requested").length,
          payoutAmount: payouts.filter((p) => p.status === "requested").reduce((n, p) => n + (p.amount ?? 0), 0),
          openReports: reports.filter((x) => x.status === "open").length,
          showcasePending: showcase.filter((x) => x.status === "pending").length,
          failingSources: failing.length,
          disabledSources: disabled.size,
        },
        sources: { top: sources.slice(0, 12), failing: failing.slice(0, 10), withTraffic: sources.length, all: sources.map(({ project, requests, errors, serverErrors }) => ({ project, requests, errors, serverErrors })) },
        system: { ...status, storage: storage.backend, serverless: !!storage.serverless, version, region: env.VERCEL_REGION ?? null, catalog: catalog.totals() },
      };
    });
  }

  async function live(q) {
    const limit = Math.min(200, Math.max(10, Number(q.limit) || 60));
    const [rows, users] = await Promise.all([kv.lrange(GLOBAL_LOG, 0, limit - 1), repo.listUsers()]);
    const byId = new Map(users.map((u) => [u.id, u]));
    let items = rows.map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
    if (q.status === "error") items = items.filter((i) => i.status >= 400);
    if (q.source) items = items.filter((i) => i.source === q.source);
    return { items: items.map((i) => ({ ...i, email: byId.get(i.owner)?.email ?? null })), at: new Date().toISOString() };
  }

  return { overview, live };
}
