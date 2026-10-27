/** Throw from a scraper handler when the source fails in a known way → HTTP 400 exec error. */
export class ScraperError extends Error {
  constructor(message, { errors = [], context, status } = {}) {
    super(message);
    this.name = "ScraperError";
    this.errors = errors;
    this.context = context;
    this.upstreamStatus = status;
  }
}

/** Throw when an endpoint needs configuration that is missing (e.g. an API key env var) → HTTP 503. */
export class NotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

/**
 * The upstream provider failed (unreachable, 5xx or rate-limited), not the caller. Mapped to HTTP 502 (not billed)
 * or 429 with Retry-After, so agents can tell an outage from bad input.
 */
export class UpstreamError extends Error {
  constructor(message, { httpStatus = 502, upstreamStatus, retryAfter, context } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.httpStatus = httpStatus;
    this.upstreamStatus = upstreamStatus;
    this.retryAfter = retryAfter;
    this.context = context;
  }
}
