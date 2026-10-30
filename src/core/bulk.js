// Bulk jobs. Inputs are processed in-request (works on serverless) with bounded
// concurrency; the job record is persisted so GET /v1/bulk/:id works afterwards.

import { E, HttpError } from "./envelope.js";
import { getPlan, getFinancePlan, maxPlan, planAllows } from "./plans.js";
import { isFinanceKey } from "./sources.js";
import { ulid, stableStringify, sha256 } from "./util.js";

export class BulkManager {
  constructor({ catalog, repo, executor, limiter, webhooks, publicUrl, apiUrl, concurrency = 6 }) {
    Object.assign(this, { catalog, repo, executor, limiter, webhooks, publicUrl, apiUrl, concurrency });
  }

  async submit(caller, projectKey, endpointSlug, rawItems, idempotencyKey) {
    const { scraper, endpoint } = this.catalog.resolve(projectKey, endpointSlug);
    if (!scraper) throw E.notFound(`Invalid project key "${projectKey}"`);
    if (!endpoint) throw E.notFound(`Endpoint "${endpointSlug}" not found on ${projectKey}`);
    // Apizie Finance endpoints use the Finance plan (bulk on Finance Growth and Business) and the Finance quota.
    const finance = isFinanceKey(scraper.key);
    if (finance && !caller.financePlan)
      throw E.coded(403, "finance_plan_required", `${scraper.key} is part of Apizie Finance. Add a Finance plan to use it: ${this.publicUrl}/finance#pricing`, { upgrade_url: `${this.publicUrl}/finance#pricing`, product: "finance" });
    const plan = finance ? getFinancePlan(caller.financePlan) : getPlan(caller.plan);
    if (!plan.bulk) throw finance ? E.coded(403, "plan_upgrade_required", "Bulk jobs on Apizie Finance need Finance Growth or Business.", { required_plan: "fin_growth", upgrade_url: `${this.publicUrl}/finance#pricing` }) : E.planGate("ultra", `${this.publicUrl}/pricing`);
    const required = finance ? null : maxPlan(scraper.minPlan, endpoint.minPlan);
    if (!planAllows(caller.plan, required)) throw E.planGate(required, `${this.publicUrl}/pricing`);
    if (!endpoint.bulkEnabled) throw E.coded(403, "bulk_not_enabled", "Bulk submit is not enabled for this endpoint.");
    if (!Array.isArray(rawItems) || !rawItems.length) throw E.invalidParams([{ path: "items", message: "items must be a non-empty array" }]);
    if (rawItems.length > plan.bulkCap) throw E.coded(400, "bulk_cap_exceeded", "Bulk submission cap exceeded.", { cap: plan.bulkCap, submitted: rawItems.length });
    const items = rawItems.map((it) => (it && typeof it === "object" && it.params && typeof it.params === "object" ? it.params : it));
    if (items.some((it) => !it || typeof it !== "object" || Array.isArray(it))) throw E.invalidParams([{ path: "items", message: "each item must be an object of params" }]);

    const fingerprint = sha256(`${projectKey}/${endpointSlug}:${stableStringify(items)}`);
    if (idempotencyKey) {
      const prev = await this.repo.getIdem(caller.owner, idempotencyKey);
      if (prev) {
        if (prev.fingerprint !== fingerprint) throw E.coded(422, "idempotency_key_reuse", "Idempotency-Key already used with a different request body.");
        const job = await this.repo.getJob(prev.jobId);
        if (job) return this.view(job);
      }
    }

    let ticket;
    try {
      ticket = await this.limiter.reserve(caller.owner, caller.plan, items.length, finance ? { finance: caller.financePlan } : undefined);
    } catch (e) {
      if (e instanceof HttpError && e.status === 429 && e.body?.content?.window === "month")
        throw new HttpError(429, { error: { code: "quota_exceeded", message: "Monthly quota exceeded for this bulk submission." }, used: e.body.content.used, limit: e.body.content.limit, requested: items.length }, e.headers);
      throw e;
    }

    const job = { jobId: ulid(), owner: caller.owner, status: "RUNNING", total: items.length, succeeded: 0, failed: 0, scraperSlug: scraper.key, endpointSlug: endpoint.slug, createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), completedAt: null, items: items.map((params) => ({ params, status: "QUEUED" })) };
    if (idempotencyKey) await this.repo.setIdem(caller.owner, idempotencyKey, { fingerprint, jobId: job.jobId });

    let idx = 0;
    let refunds = 0;
    const worker = async () => {
      while (idx < job.items.length) {
        const item = job.items[idx++];
        item.status = "RUNNING";
        const t0 = Date.now();
        const r = await this.executor.run({ caller: { ...caller, source: "bulk" }, projectKey: scraper.key, endpointSlug: endpoint.slug, params: item.params, reserved: true });
        item.latencyMs = Date.now() - t0;
        if (r.status === 200) {
          item.status = "SUCCEEDED";
          item.data = r.body.data;
          job.succeeded++;
        } else {
          item.status = "FAILED";
          item.error = { status: r.status, message: r.body?.message ?? (typeof r.body?.error === "string" ? r.body.error : r.body?.error?.message), errors: r.body?.errors };
          job.failed++;
          if (r.status >= 500) refunds++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, items.length) }, worker));
    if (refunds) await ticket.refund(refunds);
    await this.repo.incrDay(caller.owner, items.length - refunds);
    job.status = job.succeeded === 0 && job.failed > 0 ? "FAILED" : "COMPLETED";
    job.completedAt = new Date().toISOString();
    await this.repo.saveJob(job);
    this.webhooks?.emit(caller.owner, job.status === "FAILED" ? "bulk.failed" : "bulk.completed", { jobId: job.jobId, status: job.status, total: job.total, succeeded: job.succeeded, failed: job.failed });
    return this.view(job);
  }

  view(job) {
    const { owner, ...pub } = job;
    return { ...pub, pollUrl: `${this.apiUrl}/v1/bulk/${job.jobId}` };
  }

  async status(caller, jobId) {
    const job = await this.repo.getJob(jobId);
    if (!job || job.owner !== caller.owner) throw E.notFound(`Bulk job "${jobId}" not found`);
    return this.view(job);
  }

  async list(owner) {
    return (await this.repo.listJobs(owner)).map((j) => {
      const { items, ...rest } = this.view(j);
      return rest;
    });
  }
}
