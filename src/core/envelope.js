// Response envelopes. Shapes mirror the public contract observed on zapi.ink
// (docs/REA-REPORT.md §2.3): scraper success uses {project,data,timestamp};
// catalog + generic errors use {content,message,errors}.

export const nowIso = () => new Date().toISOString();

/** Successful scraper run. */
export function okRun(project, data) {
  return { project, data, timestamp: nowIso() };
}

/** Catalog / account style success. */
export function okContent(content, message = "OK") {
  return { content, message, errors: [] };
}

/** Generic error body. */
export function errBody(message, { content = null, errors = [], ...extra } = {}) {
  return { content, message, errors, ...extra };
}

/** Throwable HTTP error carrying the exact body + headers to send. */
export class HttpError extends Error {
  constructor(status, body, headers = {}) {
    super(typeof body?.message === "string" ? body.message : body?.error?.message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export const E = {
  invalidParams: (errors) => new HttpError(400, errBody("Invalid params", { errors })),
  unauthorized: (message = "Invalid API key") => new HttpError(401, errBody(message)),
  forbidden: (message) => new HttpError(403, errBody(message)),
  notFound: (message = "Not found") => new HttpError(404, errBody(message)),
  methodNotAllowed: (expected) =>
    new HttpError(405, errBody("Method not allowed", { content: { expected } }), { Allow: expected }),
  planGate: (requiredPlan, upgradeUrl) =>
    new HttpError(
      403,
      {
        error: {
          code: "plan_upgrade_required",
          message: `This endpoint requires the ${cap(requiredPlan)} plan.`,
        },
        required_plan: requiredPlan,
        upgrade_url: upgradeUrl,
      },
      { "Cache-Control": "no-store, private" }
    ),
  coded: (status, code, message, extra = {}) => new HttpError(status, { error: { code, message }, ...extra }),
  disabled: (message = "Scraper temporarily disabled") => new HttpError(503, errBody(message)),
  internal: (message = "Internal error") => new HttpError(500, errBody(message)),
};

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
