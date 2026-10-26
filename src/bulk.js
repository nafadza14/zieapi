// Bulk jobs: many inputs → one job, polled via GET /v1/bulk/:jobId.
// Contract modelled on E08, E13 and the bulk error fixtures (E27).

import { E, HttpError } from "./envelope.js";
import { getPlan, maxPlan, planAllows } from "./plans.js";
import { ulid, stableStringify, sha256 } from "./util.js";

export class BulkManager {
  constructor({ catalog, store, executor, limiter, webhooks, publicUrl, apiUrl, concurrency = 4 }) {
    Object.assign(this, { catalog, store, executor, limiter, webhooks, publicUrl, apiUrl, concurrency });
  }

  /** Returns the bare job descriptor (HTTP 202). Throws HttpError. */
  submit(keyRec, projectKey, endpointSlug, rawItems, idempotencyKey) {
    const { scraper, endpoint } = this.catalog.resolve(projectKey, endpointSlug);
    if (!scraper) throw E.notFound(`Invalid project key "${projectKey}"`);
    if (!endpoint) throw E.notFound(`Endpoint "${endpointSlug}" not found on ${projectKey}`);
    if (!scraper.enabled || !endpoint.enabled) throw E.disabled();

    const plan = getPlan(keyRec.plan);
    if (!plan.bulk) throw E.planGate("ultra", `${this.publicUrl}/pricing`);
    const required = maxPlan(scraper.minPlan, endpoint.minPlan);
    if (!planAllows(keyRec.plan, required)) throw E.planGate(required, `${this.publicUrl}/pricing`);
    if (!endpoint.bulkEnabled) throw E.coded(403, "bulk_not_enabled", "Bulk submit is not enabled for this scraper.");

    if (!Array.isArray(rawItems) || rawItems.length === 0)
      throw E.invalidParams([{ path: "items", message: "items must be a non-empty array" }]);
    if (rawItems.length > plan.bulkCap)
      throw E.coded(400, "bulk_cap_exceeded", "Bulk submission cap exceeded.", { cap: plan.bulkCap, submitted: rawItems.length });

    const items = rawItems.map((it) => (it && typeof it === "object" && it.params && typeof it.params === "object" ? it.params : it));
    if (items.some((it) => !it || typeof it !== "object" || Array.isArray(it)))
      throw E.invalidParams([{ path: "items", message: "each item must be an object of params" }]);

    // Idempotency (E10/E27: 422 idempotency_key_reuse on a different body).
    const fingerprint = sha256(`${projectKey}/${endpointSlug}:${stableStringify(items)}`);
    if (idempotencyKey) {
      const prev = this.store.idem.get(`${keyRec.id}:${idempotencyKey}`);
      if (prev) {
        if (prev.fingerprint !== fingerprint)
          throw E.coded(422, "idempotency_key_reuse", "Idempotency-Key already used with a different request body.");
        const job = this.store.jobs.get(prev.jobId);
        if (job) return this.descriptor(job);
      }
    }

    // Reserve quota for every item up-front (refunded per 5xx item).
    let ticket;
    try {
      ticket = this.limiter.reserve(keyRec, items.length);
    } catch (e) {
      if (e instanceof HttpError && e.status === 429 && e.body?.content?.window === "month") {
        throw new HttpError(
          429,
          {
            error: { code: "quota_exceeded", message: "Monthly quota exceeded for this bulk submission." },
            used: e.body.content.used,
            limit: e.body.content.limit,
            requested: items.length,
          },
          e.headers
        );
      }
      throw e;
    }

    const job = {
      jobId: ulid(),
      keyId: keyRec.id,
      status: "QUEUED",
      total: items.length,
      succeeded: 0,
      failed: 0,
      scraperSlug: scraper.key,
      endpointSlug: endpoint.slug,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      items: items.map((params) => ({ params, status: "QUEUED" })),
    };
    this.store.jobs.set(job.jobId, job);
    if (idempotencyKey) this.store.idem.set(`${keyRec.id}:${idempotencyKey}`, { fingerprint, jobId: job.jobId });

    job._promise = this._process(job, keyRec, ticket);
    return this.descriptor(job);
  }

  descriptor(job) {
    return { jobId: job.jobId, status: job.status, total: job.total, pollUrl: `${this.apiUrl}/v1/bulk/${job.jobId}` };
  }

  /** Full job view for the owning key. */
  status(keyRec, jobId) {
    const job = this.store.jobs.get(jobId);
    if (!job || job.keyId !== keyRec.id) throw E.notFound(`Bulk job "${jobId}" not found`);
    const { _promise, keyId, ...pub } = job;
    return { ...pub, pollUrl: `${this.apiUrl}/v1/bulk/${job.jobId}` };
  }

  /** Wait for a job to finish (serverless mode: no background work after the response). */
  async settle(jobId) {
    await this.store.jobs.get(jobId)?._promise;
  }

  cancel(keyRec, jobId) {
    const job = this.store.jobs.get(jobId);
    if (!job || job.keyId !== keyRec.id) throw E.notFound(`Bulk job "${jobId}" not found`);
    if (job.status === "QUEUED" || job.status === "RUNNING") job.status = "CANCELLED";
    return this.status(keyRec, jobId);
  }

  async _process(job, keyRec, ticket) {
    await Promise.resolve();
    job.status = job.status === "CANCELLED" ? "CANCELLED" : "RUNNING";
    job.startedAt = new Date().toISOString();
    let idx = 0;
    let refunds = 0;
    const worker = async () => {
      while (idx < job.items.length) {
        const item = job.items[idx++];
        if (job.status === "CANCELLED") {
          refunds++;
          continue;
        }
        item.status = "RUNNING";
        const t0 = Date.now();
        const r = await this.executor.run({
          keyRec,
          projectKey: job.scraperSlug,
          endpointSlug: job.endpointSlug,
          params: item.params,
          reserved: true,
        });
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
    await Promise.all(Array.from({ length: Math.min(this.concurrency, job.items.length) }, worker));
    if (refunds) ticket.refund(refunds);
    if (job.status !== "CANCELLED") job.status = job.succeeded === 0 && job.failed > 0 ? "FAILED" : "COMPLETED";
    job.completedAt = new Date().toISOString();
    this.webhooks?.emit(keyRec.id, job.status === "FAILED" ? "bulk.failed" : "bulk.completed", {
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      succeeded: job.succeeded,
      failed: job.failed,
    });
  }
}
