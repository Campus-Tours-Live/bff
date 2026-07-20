/** Core returned 401 → session no longer valid; caller must re-auth (Auth-Required). */
export class CoreAuthError extends Error {
  constructor() {
    super("Core authentication required");
    this.name = "CoreAuthError";
  }
}

/**
 * A silent token refresh failed for a reason that says nothing about the session's
 * validity (Google 5xx / 429 / network / timeout).
 *
 * Distinct from "no session" on purpose: the session is still good and MUST be preserved.
 * Callers answer 503 + Retry-After so the client retries, and must NOT call requireReauth
 * (which clears the cookie and throws away the refresh token).
 */
export class TransientAuthError extends Error {
  constructor(readonly cause?: unknown) {
    super("Token refresh temporarily unavailable");
    this.name = "TransientAuthError";
  }
}

/** Core returned a non-2xx (other than 401) or was unreachable. Carries the raw body for
 *  verbatim relay on mutations (reads ignore it). */
export class CoreError extends Error {
  constructor(
    public readonly status: number,
    public readonly body?: string,
    public readonly contentType?: string,
  ) {
    super(`Core error ${status}`);
    this.name = "CoreError";
  }
}
