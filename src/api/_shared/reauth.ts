import type { Response } from "express";
import { clearSession } from "../../session.js";
import { sendProblem } from "../../util/problem.js";

/**
 * Signal a genuine re-auth situation (session expired/revoked or silent refresh
 * failed). The explicit `Auth-Required` header is what the web app keys on to open
 * the sign-in modal — a plain 401 (e.g. an authorization failure) must NOT. Shared
 * with the /v1 coreProxy so token expiry behaves identically on proxy + aggregation
 * endpoints.
 */
export function requireReauth(res: Response): void {
  clearSession(res);
  res.setHeader("Auth-Required", "reauthenticate");
  res.setHeader("Cache-Control", "private, no-store");
  sendProblem(res, 401, "Authentication required", { code: "SESSION_EXPIRED" });
}

/**
 * The silent refresh could not reach Google (5xx / 429 / network), but the session itself
 * is fine. The deliberate contrast with {@link requireReauth}: this does NOT clear the
 * session and does NOT set `Auth-Required`, so the refresh token survives to be retried.
 * A short `Retry-After` invites exactly that.
 */
export function authUpstreamUnavailable(res: Response): void {
  res.setHeader("Retry-After", "5");
  res.setHeader("Cache-Control", "private, no-store");
  sendProblem(res, 503, "Sign-in service temporarily unavailable", {
    code: "AUTH_UPSTREAM_UNAVAILABLE",
    detail: "Could not refresh your session with Google. Your session is intact — retry shortly.",
  });
}
