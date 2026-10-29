// Session-authenticated account API behind the dashboard (/api/me/*).
// Every route the dashboard calls lives here; app.js only resolves the session and CSRF.

import { E, HttpError, okContent } from "../core/envelope.js";
import { PLANS, PAYG, MICROS, getPlan, planAllows, requestsForUsd, billedMonths } from "../core/plans.js";

const MIN_PAYOUT_USD = 10;
import { RANGES, loadHours, summarize, systemStatus } from "../core/analytics.js";
import { WEBHOOK_EVENTS, newWebhookSecret } from "../core/webhooks.js";
import { ulid, monthKey, secondsToMonthReset } from "../core/util.js";
import { hashPassword, verifyPassword, clientIp } from "../auth/index.js";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const RANGE_PLAN = { "24h": null, "7d": null, "30d": "pro", "90d": "ultra" };
const LOG_PAGE = 25;
const AVATAR_MAX = 150_000;

export const ipAllowed = (ip, rules) => !rules?.length || rules.some((r) => ipMatches(ip, r));

/** Exact match, or IPv4 CIDR like 203.0.113.0/24. */
export function ipMatches(ip, rule) {
  if (!ip || !rule) return false;
  if (!rule.includes("/")) return ip === rule;
  const [base, bitsRaw] = rule.split("/");
  const bits = Number(bitsRaw);
  const toInt = (s) => {
    const p = s.split(".").map(Number);
    return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null;
  };
  const a = toInt(ip.replace(/^::ffff:/, ""));
  const b = toInt(base);
  if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}
const validRule = (r) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(3[0-2]|[12]?\d))?$/.exec(r);
  if (m) return m.slice(1, 5).every((o) => Number(o) <= 255);
  return /^[0-9a-f:]+$/i.test(r) && r.includes(":");
};

export function createAccountApi(d) {
  const { repo, catalog, limiter, bulk, webhooks, oauth, publicUrl, apiUrl, affPercent, support, storage, notify, cookie, SESSION_COOKIE, isHttps } = d;
  const kv = repo.kv;
  const memo = new Map();

  const json = (status, body, headers = {}) => ({ status, body, headers: { "Cache-Control": "private, no-store", ...headers } });
  const ok = (content, message) => json(200, okContent(content, message));
  const planOf = (user) => repo.effectivePlan(user);

  function rangeParams(user, q) {
    const range = RANGES[q.range] ? q.range : "7d";
    const need = RANGE_PLAN[range];
    if (need && !planAllows(planOf(user), need)) throw E.planGate(need, `${publicUrl}/dashboard/billing?plan=${need}`);
    const now = Date.now();
    const from = now - RANGES[range];
    const tz = Math.max(-840, Math.min(840, Number(q.tz) || 0));
    return { range, from, to: now, tz, keyId: q.key && q.key !== "all" ? String(q.key) : null };
  }

  async function rollup(user, { range, from, to, tz, keyId }) {
    // Long ranges read up to 2,160 hourly rows, so they are memoised for 15 s per instance.
    // Short ranges stay live so a request shows up on the next refresh.
    const cacheable = range === "30d" || range === "90d";
    const id = `${user.id}|${range}|${keyId}|${tz}|${Math.floor(Date.now() / 15_000)}`;
    if (cacheable && memo.has(id)) return memo.get(id);
    const hours = await loadHours(kv, user.id, from, to);
    const out = summarize(hours, { keyId, from, to, tzOffsetMin: tz, granularity: range === "24h" ? "hour" : "day" });
    if (cacheable) {
      if (memo.size > 200) memo.delete(memo.keys().next().value);
      memo.set(id, out);
    }
    return out;
  }

  const publicKey = (k) => ({ id: k.id, name: k.name, preview: k.preview, status: k.status === "disabled" ? "revoked" : k.status, ipAllowlist: k.ipAllowlist ?? [], createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt ?? null, canReveal: !!k.sealed && !!repo.vault });

  async function quota(user) {
    const plan = planOf(user);
    const snap = await limiter.snapshot(user.id, plan);
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const elapsed = (Date.now() - start) / (end - start);
    // Straight-line projection of this month's usage; only shown once there is enough of the month to project from.
    const projected = elapsed > 0.03 && snap.month.used ? Math.round((snap.month.used / elapsed / snap.month.limit) * 100) : null;
    return { ...snap, plan: getPlan(plan), projectedPercent: projected, resetsAt: new Date(end).toISOString() };
  }

  async function keysWithUsage(user) {
    const keys = await repo.listKeys(user.id);
    const now = Date.now();
    const from = Math.max(now - 30 * DAY, (Date.parse(user.createdAt) || 0) - HOUR);
    const hours = keys.length ? await loadHours(kv, user.id, from, now) : [];
    return keys.map((k) => {
      const spark = Array(30).fill(0);
      let total = 0;
      for (const { t, f } of hours) {
        const v = f[`K|${k.id}|req`] ?? 0;
        if (!v) continue;
        total += v;
        const i = 29 - Math.floor((now - t) / DAY);
        if (i >= 0 && i < 30) spark[i] += v;
      }
      return { ...publicKey(k), requests30d: total, spark };
    });
  }

  async function filteredLogs(user, q) {
    const plan = getPlan(planOf(user));
    const range = RANGES[q.range] ? q.range : "24h";
    const need = RANGE_PLAN[range];
    if (need && !planAllows(plan.id, need)) throw E.planGate(need, `${publicUrl}/dashboard/billing?plan=${need}`);
    const cutoff = Date.now() - Math.min(RANGES[range], plan.logDays * DAY);
    const status = ["success", "error"].includes(q.status) ? q.status : "all";
    const terms = String(q.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const keyId = q.key && q.key !== "all" ? q.key : null;
    const all = await repo.getLogs(user.id, { limit: 5000, offset: 0 });
    let req = 0;
    let err = 0;
    const rows = [];
    for (const l of all) {
      if (!l || Date.parse(l.at) < cutoff) continue;
      if (keyId && l.keyId !== keyId) continue;
      const hay = `${l.status} ${l.project} ${l.endpoint} ${l.keyName ?? ""} ${l.key ?? ""} ${l.ip ?? ""} ${l.id ?? ""} ${l.error ?? ""} ${l.code ?? ""} ${l.source ?? ""} ${l.method ?? ""}`.toLowerCase();
      if (terms.some((t) => !hay.includes(t))) continue;
      req++;
      if (l.status >= 400) err++;
      if (status === "success" && l.status >= 400) continue;
      if (status === "error" && l.status < 400) continue;
      rows.push(l);
    }
    return { rows, req, err, range, status, retentionDays: plan.logDays, since: new Date(cutoff).toISOString() };
  }

  /** New invoices are in US dollars (cents) and paid through Dodo Payments checkout. */
  async function invoiceFor(user, body) {
    const type = body?.type === "topup" ? "topup" : "plan";
    let cents;
    let extra;
    if (type === "topup") {
      const usd = Math.round(Number(body?.usd) * 100) / 100;
      if (!Number.isFinite(usd) || usd < PAYG.minTopupUsd || usd > PAYG.maxTopupUsd) throw E.invalidParams([{ path: "usd", message: `Top-up must be between $${PAYG.minTopupUsd} and $${PAYG.maxTopupUsd.toLocaleString("en-US")}` }]);
      const requests = requestsForUsd(usd);
      cents = Math.round(usd * 100);
      extra = { usd, requests, creditMicros: requests * PAYG.priceMicros };
    } else {
      const target = PLANS[body?.plan];
      const months = Math.min(12, Math.max(1, Math.round(Number(body?.months) || 1)));
      if (!target || target.id === "free") throw E.invalidParams([{ path: "plan", message: "Choose pro, ultra or max" }]);
      // Buying a lower plan would cut short time already paid for on a higher one.
      const cur = getPlan(user.plan);
      if (cur.rank > target.rank && user.planExpiresAt && Date.parse(user.planExpiresAt) > Date.now()) throw E.invalidParams([{ path: "plan", message: `You're on ${cur.id[0].toUpperCase() + cur.id.slice(1)} until ${user.planExpiresAt.slice(0, 10)}. You can switch to a lower plan after it ends` }]);
      const priceUsd = target.priceUsd * billedMonths(months);
      cents = Math.round(priceUsd * 100);
      extra = { plan: target.id, months, priceUsd };
    }
    if (!d.dodo?.enabled) throw new HttpError(503, { content: null, message: "Checkout is not available right now. Please try again later or contact support.", errors: [] });
    let open = (await repo.listItems("invoice", user.id)).filter((i) => i.status === "pending" || i.status === "awaiting_review");
    // Clicking the same plan or top-up again reopens the checkout that is already waiting instead of stacking invoices.
    const same = open.find((i) => i.provider === "dodo" && i.status === "pending" && i.type === type && i.amount === cents && (type === "topup" || (i.plan === extra.plan && i.months === extra.months)));
    if (same) {
      const synced = await syncCard(user, same);
      if (synced.status === "pending") return startCheckout(user, synced);
      open = open.filter((i) => i.id !== same.id);
    }
    // Checkouts people walked away from never block a new one: the oldest unpaid ones are closed to make room.
    // A late payment on a closed checkout is still applied by the webhook.
    for (const old of open.filter((i) => i.provider === "dodo" && i.status === "pending").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
      if (open.length < 5) break;
      if ((await syncCard(user, old)).status === "pending") await repo.patchItem("invoice", old.id, { status: "cancelled", cancelledReason: "replaced by a newer checkout" });
      open = open.filter((i) => i.id !== old.id);
    }
    if (open.length >= 5) throw E.invalidParams([{ path: "type", message: "You already have 5 open invoices. Pay or cancel one first" }]);
    // Card / Apple Pay / Google Pay through Dodo Payments (merchant of record: it adds the right sales tax itself).
    const inv = { id: "INV-" + ulid().slice(-10), userId: user.id, email: user.email, type, ...extra, subtotal: cents, vat: 0, base: cents, amount: cents, currency: "USD", method: "card", provider: "dodo", status: "pending", reference: null, createdAt: new Date().toISOString() };
    await repo.put("invoice", inv, user.id);
    return startCheckout(user, inv);
  }

  async function startCheckout(user, inv) {
    const back = `${publicUrl}/dashboard/billing?invoice=${encodeURIComponent(inv.id)}`;
    let session;
    try {
      session = await d.dodo.createCheckout({ invoice: inv, user, returnUrl: `${back}&checkout=done`, cancelUrl: `${back}&checkout=cancelled` });
    } catch (e) {
      throw new HttpError(e.status ?? 502, { content: null, message: e.message, errors: [] });
    }
    const updated = await repo.patchItem("invoice", inv.id, { checkoutSessionId: session.sessionId, checkoutAt: new Date().toISOString() });
    return { ...updated, checkoutUrl: session.checkoutUrl };
  }

  /** Return page: ask Dodo whether the checkout was paid (the webhook does the same; whichever comes first wins). */
  async function syncCard(user, inv) {
    if (inv.provider !== "dodo" || inv.status !== "pending" || !inv.checkoutSessionId || !d.dodo?.enabled) return inv;
    const { paymentId, paymentStatus } = await d.dodo.getCheckout(inv.checkoutSessionId).catch(() => ({}));
    if (paymentStatus === "succeeded" && paymentId) return (await d.fulfill(inv, { via: "dodo", paymentId })).invoice;
    if (paymentStatus === "failed") return repo.patchItem("invoice", inv.id, { lastPaymentStatus: "failed" });
    return inv;
  }

  const usdCents = (i) => (i.currency === "USD" ? i.amount : Math.round((i.priceUsd ?? ((i.requests ?? 0) * PAYG.usdPer1k) / 1000) * 100));
  async function transactions(user) {
    const inv = (await repo.listItems("invoice", user.id)).map((i) => ({
      id: i.id,
      kind: i.type === "topup" ? "topup" : "plan",
      date: i.createdAt,
      item: i.type === "topup" ? `Balance top-up (≈ ${(i.requests ?? 0).toLocaleString("en-US")} requests)` : `${cap(i.plan)} plan · ${i.months} month${i.months > 1 ? "s" : ""}`,
      method: i.method === "card" ? "Card (Dodo Payments)" : "Bank transfer",
      // Older bank-transfer invoices were in rupiah; they are shown at their US dollar list price.
      currency: "USD",
      subtotal: usdCents(i),
      vat: 0,
      total: usdCents(i),
      status: i.status,
      reference: i.reference,
    }));
    const usage = (await repo.paygUsage(user.id, 90)).map((u) => {
      const cents = -(u.requests * PAYG.priceMicros) / 10_000;
      return { id: `USE-${u.date}`, kind: "usage", date: `${u.date}T23:59:59.000Z`, item: `${u.requests.toLocaleString("en-US")} requests over quota`, method: "Balance", currency: "USD", subtotal: cents, vat: 0, total: cents, status: "settled" };
    });
    return [...inv, ...usage].sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  async function webhookView(user) {
    const plan = getPlan(planOf(user));
    const hooks = await repo.getWebhooks(user.id);
    return {
      enabled: plan.webhooks,
      events: WEBHOOK_EVENTS,
      hooks: hooks.map(({ secret, ...h }) => ({ ...h, enabled: h.enabled !== false, secretPreview: secret.slice(0, 10) + "…" })),
      deliveries: (await repo.listDeliveries(user.id, 50)).map(({ payload, ...dl }) => ({ ...dl, payload })),
    };
  }

  const requireWebhooks = (user) => {
    if (!getPlan(planOf(user)).webhooks) throw E.planGate("pro", `${publicUrl}/dashboard/billing?plan=pro`);
  };
  const checkTarget = async (url, path = "url") => {
    try {
      await webhooks.checkTarget(url);
    } catch (e) {
      throw E.invalidParams([{ path, message: `${e.message}. Use a public https endpoint.` }]);
    }
    return url;
  };
  const checkUrl = (raw, path = "url") => {
    let u;
    try {
      u = new URL(String(raw ?? ""));
    } catch {}
    if (!u || !/^https?:$/.test(u.protocol)) throw E.invalidParams([{ path, message: "Use a full http(s) URL" }]);
    return u.toString();
  };

  return async function handle(ctx, p, m, q, body) {
    const { req, user } = ctx;
    if (!user) throw E.unauthorized("Sign in required");
    const plan = planOf(user);
    let mm;

    // ---- profile ---------------------------------------------------------------
    if (p === "/api/me" && m === "GET") {
      const [keys, balance, prefs, notes] = await Promise.all([repo.listKeys(user.id), repo.getBalance(user.id), repo.getPrefs(user.id), repo.listNotifications(user.id, 1)]);
      return ok({
        user: d.publicUser(user),
        plan: getPlan(plan),
        admin: d.isAdmin(user),
        providers: Object.keys(user.providers ?? {}),
        prefs,
        balance: balance / MICROS, // US dollars
        keys: { active: keys.filter((k) => k.status === "active").length, revoked: keys.filter((k) => k.status !== "active").length, max: getPlan(plan).maxKeys },
        unread: notes.unread,
        emailEnabled: !!d.emailEnabled,
        storage,
      });
    }
    if (p === "/api/me" && m === "PATCH") {
      const patch = {};
      if (body?.name !== undefined) {
        const name = String(body.name).trim().slice(0, 60);
        if (!name) throw E.invalidParams([{ path: "name", message: "Name can't be empty" }]);
        patch.name = name;
      }
      if (body?.avatar !== undefined) {
        if (body.avatar === null || body.avatar === "") patch.avatar = null;
        else if (typeof body.avatar === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.avatar) && body.avatar.length <= AVATAR_MAX) patch.avatar = body.avatar;
        else throw E.invalidParams([{ path: "avatar", message: "Use a PNG, JPEG or WebP image under 100 KB" }]);
      }
      let signedOutOthers = false;
      if (body?.newPassword !== undefined) {
        if (String(body.newPassword).length < 8) throw E.invalidParams([{ path: "newPassword", message: "At least 8 characters" }]);
        if (user.passwordHash && !(await verifyPassword(String(body.currentPassword ?? ""), user.passwordHash))) throw E.invalidParams([{ path: "currentPassword", message: "Current password is wrong" }]);
        patch.passwordHash = await hashPassword(String(body.newPassword));
        signedOutOthers = true;
      }
      const next = await repo.updateUser(user.id, patch);
      if (signedOutOthers) for (const s of await repo.listSessions(user.id)) if (s.id !== ctx.sessionId) await repo.deleteSessionById(s.id);
      return ok({ user: d.publicUser(next), signedOutOthers });
    }
    if (p === "/api/me/delete" && m === "POST") {
      if (body?.confirm !== "DELETE") throw E.invalidParams([{ path: "confirm", message: "Type DELETE to confirm" }]);
      await repo.deleteUser(user.id);
      return json(200, okContent({ deleted: true }), { "Set-Cookie": cookie(SESSION_COOKIE, "", { maxAge: 0, secure: isHttps(req) }) });
    }
    if (p === "/api/me/prefs" && m === "PATCH") return ok(await repo.setPrefs(user.id, body ?? {}));

    // ---- dashboard + usage -------------------------------------------------------
    if (p === "/api/me/overview" && m === "GET") {
      const r = rangeParams(user, q);
      const [sum, qt, keys, recent, status, balance] = await Promise.all([rollup(user, r), quota(user), repo.listKeys(user.id), repo.getLogs(user.id, { limit: 8 }), systemStatus(kv), repo.getBalance(user.id)]);
      const tzNow = new Date(Date.now() + r.tz * 60_000).toISOString().slice(0, 10);
      const day = await rollup(user, { range: "24h", from: Math.max(Date.parse(tzNow) - r.tz * 60_000, (Date.parse(user.createdAt) || 0) - HOUR), to: Date.now(), tz: r.tz, keyId: r.keyId });
      const last24 = await rollup(user, { range: "24h", from: Date.now() - DAY, to: Date.now(), tz: r.tz, keyId: r.keyId });
      const active = keys.filter((k) => k.status === "active");
      return ok({
        range: r.range,
        keyId: r.keyId,
        summary: sum,
        today: day.total,
        errors24h: last24.errors,
        quota: qt,
        balance: balance / MICROS, // US dollars
        key: active[0] ? publicKey(active[0]) : null,
        activeKeys: active.length,
        keys: keys.map((k) => ({ id: k.id, name: k.name, preview: k.preview, status: publicKey(k).status })),
        recent: recent.filter((l) => !r.keyId || l.keyId === r.keyId).slice(0, 6),
        system: status,
        storage,
      });
    }
    if (p === "/api/me/usage" && m === "GET") {
      const r = rangeParams(user, q);
      const [sum, last24, qt, keys] = await Promise.all([rollup(user, r), rollup(user, { range: "24h", from: Date.now() - DAY, to: Date.now(), tz: r.tz, keyId: r.keyId }), quota(user), repo.listKeys(user.id)]);
      const allSum = r.keyId ? await rollup(user, { ...r, keyId: null }) : sum;
      const perKey = keys.map((k) => ({ id: k.id, name: k.name, preview: k.preview, status: publicKey(k).status, requests: allSum.keys[k.id]?.requests ?? 0, errors: allSum.keys[k.id]?.errors ?? 0 })).sort((a, b) => b.requests - a.requests);
      const other = Object.entries(allSum.keys).filter(([id]) => !keys.some((k) => k.id === id)).reduce((n, [, v]) => n + v.requests, 0);
      return ok({ range: r.range, keyId: r.keyId, summary: sum, last24h: { total: last24.total, successRate: last24.successRate, errors: last24.errors }, quota: qt, perKey, otherRequests: other, scrapersThisMonth: await repo.scraperUse(user.id, monthKey()) });
    }

    // ---- logs -------------------------------------------------------------------
    if (p === "/api/me/logs" && m === "GET") {
      const f = await filteredLogs(user, q);
      const page = Math.max(1, Math.round(Number(q.page) || 1));
      const size = Math.min(100, Math.max(5, Math.round(Number(q.size) || LOG_PAGE)));
      const total = f.rows.length;
      // `limit`/`offset` keep the older API shape working.
      const offset = q.offset !== undefined ? Math.max(0, Number(q.offset) || 0) : (page - 1) * size;
      const limit = q.limit !== undefined ? Math.min(100, Number(q.limit) || 50) : size;
      return ok({ items: f.rows.slice(offset, offset + limit), total, page, size: limit, offset, limit, counts: { requests: f.req, errors: f.err }, range: f.range, status: f.status, since: f.since, retentionDays: f.retentionDays });
    }
    if (p === "/api/me/logs/export" && m === "GET") {
      const f = await filteredLogs(user, q);
      const cols = ["id", "at", "method", "project", "endpoint", "status", "ms", "keyName", "key", "source", "ip", "cache", "billed", "code", "error"];
      const cell = (v) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [cols.join(","), ...f.rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
      return { status: 200, body: csv, headers: { "content-type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="apizie-logs-${f.range}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" } };
    }

    // ---- API keys -----------------------------------------------------------------
    if (p === "/api/me/keys" && m === "GET") {
      const keys = await keysWithUsage(user);
      return ok({ items: keys, max: getPlan(plan).maxKeys, active: keys.filter((k) => k.status === "active").length, allowlist: getPlan(plan).webhooks });
    }
    if (p === "/api/me/keys" && m === "POST") {
      const keys = await repo.listKeys(user.id);
      const max = getPlan(plan).maxKeys;
      if (keys.filter((k) => k.status === "active").length >= max) throw E.invalidParams([{ path: "name", message: `Your plan allows ${max} active keys. Revoke one or upgrade.` }]);
      if (keys.length >= 100) throw E.invalidParams([{ path: "name", message: "Delete some revoked keys first" }]);
      const name = String(body?.name ?? "").trim().slice(0, 60) || `Key ${keys.length + 1}`;
      const { secret, rec } = await repo.createKey(user.id, { name });
      webhooks.emit(user.id, "key.created", { keyId: rec.id, name: rec.name });
      return json(201, okContent({ key: secret, record: publicKey(rec) }, "Created. Copy this key now."));
    }
    if ((mm = /^\/api\/me\/keys\/([^/]+)(\/(reveal|revoke))?$/.exec(p))) {
      const k = await repo.getKeyById(mm[1]);
      if (!k || k.userId !== user.id) throw E.notFound("Key not found");
      if (mm[3] === "reveal" && m === "POST") {
        const secret = repo.revealKey(k);
        if (!secret) throw new HttpError(409, { content: null, message: "This key can't be shown again. Create a new key if you lost it.", errors: [] });
        return ok({ key: secret });
      }
      if (mm[3] === "revoke" && m === "POST") {
        if (k.status !== "active") return ok(publicKey(k));
        const next = await repo.updateKey(k.id, { status: "revoked", revokedAt: new Date().toISOString(), sealed: null });
        webhooks.emit(user.id, "key.revoked", { keyId: k.id, name: k.name });
        return ok(publicKey(next));
      }
      if (!mm[3] && m === "DELETE") {
        await repo.deleteKey(k.id);
        return ok({ ok: true });
      }
      if (!mm[3] && m === "PATCH") {
        const patch = {};
        if (body?.name !== undefined) patch.name = String(body.name).trim().slice(0, 60) || k.name;
        if (body?.status !== undefined) {
          if (body.status === "revoked" || body.status === "disabled") {
            patch.status = "revoked";
            patch.revokedAt = new Date().toISOString();
            webhooks.emit(user.id, "key.disabled", { keyId: k.id });
          } else if (body.status === "active") {
            if (k.status === "revoked") throw E.invalidParams([{ path: "status", message: "Revoked keys can't be restored. Create a new key." }]);
            patch.status = "active";
          } else throw E.invalidParams([{ path: "status", message: "active | revoked" }]);
        }
        if (body?.ipAllowlist !== undefined) {
          if (!getPlan(plan).webhooks) throw E.planGate("pro", `${publicUrl}/dashboard/billing?plan=pro`);
          const list = (Array.isArray(body.ipAllowlist) ? body.ipAllowlist : String(body.ipAllowlist).split(/[\s,]+/)).map((s) => String(s).trim()).filter(Boolean);
          const bad = list.find((r) => !validRule(r));
          if (bad) throw E.invalidParams([{ path: "ipAllowlist", message: `Not an IP or IPv4 CIDR: ${bad}` }]);
          if (list.length > 20) throw E.invalidParams([{ path: "ipAllowlist", message: "Up to 20 entries" }]);
          patch.ipAllowlist = list;
        }
        return ok(publicKey(await repo.updateKey(k.id, patch)));
      }
    }
    if (p === "/api/me/apps" && m === "GET") return ok(await oauth.listGrants(user.id));
    if ((mm = /^\/api\/me\/apps\/([^/]+)$/.exec(p)) && m === "DELETE") {
      await oauth.revokeGrant(user.id, decodeURIComponent(mm[1]));
      return ok({ ok: true });
    }

    // ---- bulk ------------------------------------------------------------------------
    if (p === "/api/me/bulk" && m === "GET") {
      const jobs = await bulk.list(user.id);
      const since = Date.now() - 30 * DAY;
      const recent = jobs.filter((j) => Date.parse(j.createdAt) >= since);
      const items = recent.reduce((n, j) => n + j.total, 0);
      const okItems = recent.reduce((n, j) => n + j.succeeded, 0);
      return ok({ enabled: getPlan(plan).bulk, cap: getPlan(plan).bulkCap, items: jobs, stats: { jobs30d: recent.length, items30d: items, successRate: items ? Math.round((okItems / items) * 10000) / 100 : null, running: jobs.filter((j) => j.status === "RUNNING").length } });
    }
    if (p === "/api/me/bulk" && m === "POST") {
      const caller = { owner: user.id, plan, keyId: null, keyPreview: "dashboard", keyName: "Dashboard", ip: clientIp(req), user, source: "bulk", requestId: ctx.requestId };
      const job = await bulk.submit(caller, String(body?.project ?? ""), String(body?.endpoint ?? ""), body?.items, body?.idempotencyKey ? String(body.idempotencyKey).slice(0, 100) : undefined);
      return json(201, okContent(job));
    }
    if ((mm = /^\/api\/me\/bulk\/([^/]+)$/.exec(p)) && m === "GET") return ok(await bulk.status({ owner: user.id }, mm[1]));

    // ---- webhooks ----------------------------------------------------------------------
    if (p === "/api/me/webhooks" && m === "GET") return ok(await webhookView(user));
    if (p === "/api/me/webhooks" && m === "POST") {
      requireWebhooks(user);
      const hooks = await repo.getWebhooks(user.id);
      if (hooks.length >= 5) throw E.invalidParams([{ path: "url", message: "Up to 5 endpoints" }]);
      const events = Array.isArray(body?.events) && body.events.length ? body.events : ["*"];
      const bad = events.filter((e) => e !== "*" && !WEBHOOK_EVENTS.includes(e));
      if (bad.length) throw E.invalidParams([{ path: "events", message: `Unknown events: ${bad.join(", ")}` }]);
      const hook = { id: ulid(), url: await checkTarget(checkUrl(body?.url)), events, description: String(body?.description ?? "").slice(0, 80), enabled: true, secret: newWebhookSecret(), createdAt: new Date().toISOString() };
      await repo.setWebhooks(user.id, [...hooks, hook]);
      return json(201, okContent({ ...hook }, "Endpoint added. Copy the signing secret now."));
    }
    if (p === "/api/me/webhooks" && m === "PUT") {
      requireWebhooks(user);
      const list = Array.isArray(body) ? body : body?.webhooks;
      if (!Array.isArray(list) || list.length > 5) throw E.invalidParams([{ path: "webhooks", message: "Up to 5 webhooks" }]);
      const prev = await repo.getWebhooks(user.id);
      const errors = [];
      const next = list.map((h, i) => {
        let url = null;
        try {
          url = checkUrl(h.url);
        } catch {
          errors.push({ path: `webhooks.${i}.url`, message: "Must be an http(s) URL" });
        }
        const events = Array.isArray(h.events) && h.events.length ? h.events : ["*"];
        const bad = events.filter((e) => e !== "*" && !WEBHOOK_EVENTS.includes(e));
        if (bad.length) errors.push({ path: `webhooks.${i}.events`, message: `Unknown events: ${bad.join(", ")}` });
        const ex = prev.find((x) => x.url === h.url);
        return { ...(ex ?? {}), id: ex?.id ?? ulid(), url, events, enabled: ex?.enabled ?? true, secret: ex?.secret ?? newWebhookSecret(), createdAt: ex?.createdAt ?? new Date().toISOString() };
      });
      if (errors.length) throw E.invalidParams(errors);
      await repo.setWebhooks(user.id, next);
      return ok(next);
    }
    if (p === "/api/me/webhooks/test" && m === "POST") {
      requireWebhooks(user);
      const hooks = (await repo.getWebhooks(user.id)).filter((h) => !body?.hookId || h.id === body.hookId);
      if (!hooks.length) throw E.invalidParams([{ path: "hookId", message: "Add an endpoint first" }]);
      const res = await Promise.all(hooks.map((h) => webhooks.deliver(h, "webhook.test", { message: "Hello from Apizie", hookId: h.id }, { owner: user.id })));
      return ok(res.map((r, i) => ({ url: hooks[i].url, ok: r.ok, status: r.status, error: r.error })));
    }
    if ((mm = /^\/api\/me\/webhooks\/deliveries\/([^/]+)\/redeliver$/.exec(p)) && m === "POST") {
      requireWebhooks(user);
      const dl = (await repo.listDeliveries(user.id)).find((x) => x.id === mm[1]);
      if (!dl) throw E.notFound("Delivery not found");
      const hook = (await repo.getWebhooks(user.id)).find((h) => h.id === dl.hookId);
      if (!hook) throw E.notFound("That endpoint was deleted");
      const r = await webhooks.deliver(hook, dl.event, dl.payload?.data, { owner: user.id, payload: dl.payload?.data === "[truncated]" ? null : dl.payload });
      return ok({ ok: r.ok, status: r.status, error: r.error });
    }
    if ((mm = /^\/api\/me\/webhooks\/([^/]+)(\/rotate)?$/.exec(p))) {
      requireWebhooks(user);
      const hooks = await repo.getWebhooks(user.id);
      const h = hooks.find((x) => x.id === mm[1]);
      if (!h) throw E.notFound("Endpoint not found");
      if (mm[2] && m === "POST") {
        h.secret = newWebhookSecret();
        await repo.setWebhooks(user.id, hooks);
        return ok({ id: h.id, secret: h.secret }, "New secret. Update your server before the next event.");
      }
      if (!mm[2] && m === "DELETE") {
        await repo.setWebhooks(user.id, hooks.filter((x) => x.id !== h.id));
        return ok({ ok: true });
      }
      if (!mm[2] && m === "PATCH") {
        if (body?.url !== undefined) h.url = await checkTarget(checkUrl(body.url));
        if (body?.description !== undefined) h.description = String(body.description).slice(0, 80);
        if (body?.enabled !== undefined) h.enabled = !!body.enabled;
        if (body?.events !== undefined) {
          const events = Array.isArray(body.events) && body.events.length ? body.events : ["*"];
          const bad = events.filter((e) => e !== "*" && !WEBHOOK_EVENTS.includes(e));
          if (bad.length) throw E.invalidParams([{ path: "events", message: `Unknown events: ${bad.join(", ")}` }]);
          h.events = events;
        }
        await repo.setWebhooks(user.id, hooks);
        const { secret, ...pub } = h;
        return ok(pub);
      }
    }

    // ---- billing ------------------------------------------------------------------------
    if (p === "/api/me/billing" && m === "GET") {
      const [qt, balance, prefs, tx] = await Promise.all([quota(user), repo.getBalance(user.id), repo.getPrefs(user.id), transactions(user)]);
      return ok({
        plan: getPlan(plan),
        storedPlan: user.plan,
        planExpiresAt: user.planExpiresAt,
        quota: qt,
        plans: Object.values(PLANS),
        currency: "USD",
        balance: balance / MICROS, // US dollars
        balanceRequests: Math.floor(balance / PAYG.priceMicros),
        payg: { usdPer1k: PAYG.usdPer1k, topupsUsd: PAYG.topupsUsd.map((usd) => ({ usd, requests: requestsForUsd(usd) })), minTopupUsd: PAYG.minTopupUsd, maxTopupUsd: PAYG.maxTopupUsd, lowBalanceUsd: PAYG.lowBalanceUsd, enabled: prefs.payg, lowBalanceAlert: prefs.lowBalanceAlert },
        cardEnabled: !!d.dodo?.enabled,
        invoices: await repo.listItems("invoice", user.id),
        transactions: tx,
      });
    }
    if (p === "/api/me/invoices" && m === "POST") return json(201, okContent(await invoiceFor(user, body)));
    if ((mm = /^\/api\/me\/invoices\/([^/]+)\/(checkout|sync)$/.exec(p)) && m === "POST") {
      const inv = await repo.getItem("invoice", mm[1]);
      if (!inv || inv.userId !== user.id) throw E.notFound("Invoice not found");
      if (inv.provider !== "dodo") throw E.invalidParams([{ path: "method", message: "This older invoice cannot be paid online. Cancel it and choose the plan again" }]);
      if (mm[2] === "sync") return ok(await syncCard(user, inv));
      const synced = await syncCard(user, inv); // never open a second checkout for an invoice that was just paid
      if (synced.status !== "pending") throw E.invalidParams([{ path: "status", message: `Invoice is ${synced.status}` }]);
      return ok(await startCheckout(user, synced));
    }
    if ((mm = /^\/api\/me\/invoices\/([^/]+)\/(confirm|cancel)$/.exec(p)) && m === "POST") {
      const inv = await repo.getItem("invoice", mm[1]);
      if (!inv || inv.userId !== user.id) throw E.notFound("Invoice not found");
      if (mm[2] === "confirm") throw E.invalidParams([{ path: "method", message: "Payments are confirmed automatically at checkout" }]);
      if (inv.status !== "pending") throw E.invalidParams([{ path: "status", message: `Invoice is ${inv.status}` }]);
      if (mm[2] === "cancel") {
        if (inv.provider === "dodo" && (await syncCard(user, inv)).status === "paid") throw E.invalidParams([{ path: "status", message: "This invoice was just paid" }]);
        return ok(await repo.patchItem("invoice", inv.id, { status: "cancelled" }));
      }
      const reference = String(body?.reference ?? "").trim().slice(0, 200);
      if (!reference) throw E.invalidParams([{ path: "reference", message: "Enter the transfer reference or sender name" }]);
      return ok(await repo.patchItem("invoice", inv.id, { status: "awaiting_review", reference, confirmedAt: new Date().toISOString() }));
    }

    // ---- affiliate --------------------------------------------------------------------
    if (p === "/api/me/affiliate" && m === "GET") {
      const code = await repo.ensureAffCode(user);
      const stats = await repo.affiliateStats(user.id);
      const refs = await Promise.all(stats.referrals.slice(0, 200).map((id) => repo.getUser(id)));
      const paying = refs.filter((u) => u && u.plan !== "free").length;
      const payouts = (await repo.listItems("payout", user.id)).map(({ userId, ...x }) => x);
      return ok({
        code,
        link: `${publicUrl}/?ref=${code}`,
        percent: affPercent,
        clicks: stats.clicks,
        signups: stats.referrals.length,
        paying,
        currency: "USD",
        earned: stats.totalMicros / MICROS,
        available: stats.availableMicros / MICROS,
        minPayout: MIN_PAYOUT_USD,
        earnings: stats.earnings.map((e) => ({ ...e, amount: (e.amountMicros ?? 0) / MICROS })),
        payouts,
      });
    }
    if (p === "/api/me/affiliate/move" && m === "POST") {
      const moved = await repo.moveAffToBalance(user.id);
      if (!moved) throw E.invalidParams([{ path: "amount", message: "Nothing available to move yet" }]);
      return ok({ moved: moved / MICROS, balance: (await repo.getBalance(user.id)) / MICROS });
    }
    if (p === "/api/me/affiliate/payout" && m === "POST") {
      const stats = await repo.affiliateStats(user.id);
      const amount = Math.floor(stats.availableMicros / 10_000) / 100; // whole cents, US dollars
      if (amount < MIN_PAYOUT_USD) throw E.invalidParams([{ path: "amount", message: `Payouts start at $${MIN_PAYOUT_USD}` }]);
      const account = String(body?.account ?? "").trim().slice(0, 200);
      if (account.length < 6) throw E.invalidParams([{ path: "account", message: "Enter your PayPal email, or bank name, SWIFT code, account number and holder" }]);
      if (!(await repo.takeAffForPayout(user.id, Math.round(amount * MICROS)))) throw E.invalidParams([{ path: "amount", message: "Balance changed, try again" }]);
      const payout = await repo.put("payout", { id: "PO-" + ulid().slice(-10), userId: user.id, email: user.email, amount, currency: "USD", account, status: "requested", createdAt: new Date().toISOString() }, user.id);
      return json(201, okContent(payout));
    }

    // ---- showcase -----------------------------------------------------------------------
    if (p === "/api/me/showcase" && m === "GET") return ok((await repo.listItems("showcase")).filter((s) => s.userId === user.id));
    if ((mm = /^\/api\/me\/showcase\/([^/]+)$/.exec(p)) && m === "DELETE") {
      const s = await repo.getItem("showcase", mm[1]);
      if (!s || s.userId !== user.id) throw E.notFound("Submission not found");
      await repo.patchItem("showcase", s.id, { status: "withdrawn" });
      return ok({ ok: true });
    }

    // ---- sessions + notifications --------------------------------------------------------
    if (p === "/api/me/sessions" && m === "GET") {
      const list = await repo.listSessions(user.id);
      return ok(list.map((s) => ({ id: s.id, current: s.id === ctx.sessionId, device: describeUa(s.ua), ip: s.ip, createdAt: new Date(s.createdAt).toISOString(), lastSeenAt: new Date(s.lastSeenAt ?? s.createdAt).toISOString() })));
    }
    if (p === "/api/me/sessions/revoke-others" && m === "POST") {
      let n = 0;
      for (const s of await repo.listSessions(user.id)) if (s.id !== ctx.sessionId && (await repo.deleteSessionById(s.id, user.id))) n++;
      return ok({ signedOut: n });
    }
    if ((mm = /^\/api\/me\/sessions\/([^/]+)$/.exec(p)) && m === "DELETE") {
      if (mm[1] === ctx.sessionId) throw E.invalidParams([{ path: "id", message: "Use Sign out for this device" }]);
      if (!(await repo.deleteSessionById(mm[1], user.id))) throw E.notFound("Session not found");
      return ok({ ok: true });
    }
    if (p === "/api/me/notifications" && m === "GET") return ok(await repo.listNotifications(user.id, 30));
    if (p === "/api/me/notifications/read" && m === "POST") {
      await repo.markNotificationsRead(user.id);
      return ok({ ok: true });
    }

    // ---- support ----------------------------------------------------------------------
    if (p === "/api/me/support" && m === "GET") {
      const logs = await repo.getLogs(user.id, { limit: 500 });
      return ok({ errors: logs.filter((l) => l && l.status >= 400).slice(0, 10), contacts: support });
    }

    throw E.notFound("Not found");
  };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Short device label from a user agent, e.g. "Windows · Chrome". */
export function describeUa(ua = "") {
  const os = /windows/i.test(ua) ? "Windows" : /iphone|ipad/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /mac os x|macintosh/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "Unknown device";
  const br = /edg\//i.test(ua) ? "Edge" : /opr\//i.test(ua) ? "Opera" : /firefox\//i.test(ua) ? "Firefox" : /chrome\//i.test(ua) ? "Chrome" : /safari\//i.test(ua) ? "Safari" : /node|undici|curl/i.test(ua) ? "API client" : "Browser";
  return `${os} · ${br}`;
}

export { secondsToMonthReset };
