import type { Request, Response } from "express";
import { clearSession } from "../../session.js";
import { sendProblem } from "../../util/problem.js";
import { resolveBearer } from "./session.js";
import { requireReauth, authUpstreamUnavailable } from "./reauth.js";
import { coreUnavailable } from "./envelope.js";
import { CoreClient } from "./core-client.js";
import {
  CoreAuthError,
  CoreError,
  PendingSessionExpiredError,
  TransientAuthError,
} from "./errors.js";

/**
 * Mutation sibling of {@link withSession}. Resolves auth once, then on a Core error:
 *   - CoreAuthError / Core 401 → requireReauth;
 *   - Core 5xx / unreachable → 502;
 *   - Core 4xx → VERBATIM relay of the Core problem+json (status + content-type + body) so
 *     validation messages (e.g. "time slot just taken", 422) reach the browser unchanged;
 *   - anything else → 500.
 * The shared read wrapper (withSession) is intentionally NOT reused, so the read 4xx
 * contract (generic UPSTREAM_ERROR) stays put. The pending-expiry guard below IS shared with
 * `withSession` (CTL-97 Task 4 review fix) — every protected `/v1` route must destroy an
 * expired-PENDING session's cookie and answer 401 SESSION_EXPIRED uniformly, mutations included.
 */
export function withMutation(
  handler: (req: Request, res: Response, core: CoreClient) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    let bearer: string | null;
    try {
      bearer = await resolveBearer(req, res);
    } catch (err) {
      // Google was unreachable, not the session dead — keep the session, ask for a retry.
      // Safe for a mutation: the handler has not run, so nothing was written.
      if (err instanceof TransientAuthError) return authUpstreamUnavailable(res);
      // The pending session's 24h absolute lifetime is up: destroy the cookie (expiring
      // Set-Cookie) and answer 401 SESSION_EXPIRED WITHOUT ever constructing a CoreClient or
      // invoking the handler below — no Core call happens for this request. Safe for a
      // mutation: the handler has not run, so nothing was written.
      if (err instanceof PendingSessionExpiredError) {
        clearSession(res);
        return sendProblem(res, 401, "Session expired", { code: err.code });
      }
      throw err;
    }
    if (!bearer) return requireReauth(res);
    try {
      await handler(req, res, new CoreClient(bearer));
    } catch (err) {
      if (err instanceof CoreAuthError) return requireReauth(res);
      if (err instanceof CoreError) {
        if (err.status >= 500) return coreUnavailable(res);
        res.status(err.status);
        if (err.contentType) res.type(err.contentType);
        res.send(err.body ?? "");
        return;
      }
      console.error("[withMutation] unhandled error:", err);
      sendProblem(res, 500, "Internal server error", { code: "INTERNAL" });
    }
  };
}
