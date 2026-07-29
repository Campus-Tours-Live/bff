/** Core returned 401 → session no longer valid; caller must re-auth (Auth-Required). */
export class CoreAuthError extends Error {
  constructor() {
    super("Core authentication required");
    this.name = "CoreAuthError";
  }
}

/**
 * The session's Google `id_token` cannot yield a trustworthy pending identity: the token is
 * missing/malformed, or its payload lacks a verified `email` claim. Thrown by
 * `src/api/userinfo/pendingIdentity.ts` while extracting claims for an authenticated-but-not-yet-
 * provisioned user (Core `GET /users/me` → 404 `ACCOUNT_NOT_PROVISIONED`).
 *
 * This is deliberately NOT a normal "no session" / 4xx case: the OAuth callback already
 * completed the token exchange, so an id_token that can't produce a verified email at this point
 * means Google (or our handling of its response) misbehaved — a system/upstream problem. Callers
 * (the `/userinfo` PENDING branch, CTL-97 Task 3) must map this to a 5xx, never to a normal
 * pending-signin response.
 */
export class IdentityClaimsInvalidError extends Error {
  /** Stable machine-readable discriminant — check this, not `instanceof`, across module reloads. */
  readonly code = "IDENTITY_CLAIMS_INVALID";

  constructor(reason: string) {
    super(`Pending identity claims invalid: ${reason}`);
    this.name = "IdentityClaimsInvalidError";
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

/**
 * The subset of an RFC7807 problem+json body {@link CoreError.fromResponse} recognizes:
 * a machine-readable `code`, human-readable `title`/`detail`, and any remaining extension
 * members (e.g. `role`, `reconciliationRequired` — see Core's `ProblemDetail.setProperty`).
 */
interface ParsedProblem {
  code?: string;
  title?: string;
  detail?: string;
  properties?: Record<string, unknown>;
}

/**
 * Parses a Core problem+json body ONCE, at error-construction time, so every downstream
 * handler reads `err.code` instead of re-parsing `err.body`. Returns `undefined` for anything
 * that isn't a parseable JSON object — including malformed JSON and non-object JSON (`null`,
 * arrays, primitives) — so the caller falls back to leaving code/title/detail/properties all
 * `undefined`. NEVER fabricates a `code`: a body with no `code` member yields `code: undefined`,
 * distinct from a genuinely coded error (see I7 — a 404 with no code must not be mistaken for
 * `ACCOUNT_NOT_PROVISIONED`).
 */
function parseProblem(raw: string): ParsedProblem | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  // `status`/`type` are the other standard RFC7807 members; everything else is an extension
  // member Core attached via `ProblemDetail.setProperty` (role, reconciliationRequired, ...).
  const {
    code,
    title,
    detail,
    status: _status,
    type: _type,
    ...properties
  } = parsed as Record<string, unknown>;
  return {
    code: typeof code === "string" ? code : undefined,
    title: typeof title === "string" ? title : undefined,
    detail: typeof detail === "string" ? detail : undefined,
    properties,
  };
}

/** Core returned a non-2xx (other than 401) or was unreachable. Carries the raw body for
 *  verbatim relay on mutations (reads ignore it), plus the RFC7807 fields parsed from it
 *  (`code`/`title`/`detail`/`properties`) so handlers branch on `err.code` instead of
 *  re-parsing `err.body` themselves. */
export class CoreError extends Error {
  constructor(
    public readonly status: number,
    public readonly body?: string,
    public readonly contentType?: string,
    public readonly code?: string,
    public readonly title?: string,
    public readonly detail?: string,
    public readonly properties?: Record<string, unknown>,
  ) {
    super(`Core error ${status}`);
    this.name = "CoreError";
  }

  /**
   * The single construction site for a Core-response `CoreError`, used by both
   * {@link CoreClient.get} and the private `write()` non-ok branches so the two paths cannot
   * diverge. Parses `raw` as an RFC7807 problem body ONLY when `contentType` indicates JSON;
   * a non-JSON body (or unparseable JSON, or no body — e.g. the 502 transport-failure case)
   * leaves `code`/`title`/`detail`/`properties` all `undefined`.
   */
  static fromResponse(status: number, raw?: string, contentType?: string): CoreError {
    if (raw && contentType && /json/i.test(contentType)) {
      const parsed = parseProblem(raw);
      if (parsed) {
        return new CoreError(
          status,
          raw,
          contentType,
          parsed.code,
          parsed.title,
          parsed.detail,
          parsed.properties,
        );
      }
    }
    return new CoreError(status, raw, contentType);
  }
}
