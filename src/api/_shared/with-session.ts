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
 * Handler wrapper for aggregation endpoints: resolve auth once, hand the handler a
 * ready-to-use Core client, and funnel every error through one place so handlers stay
 * branch-free (required reads just `await`; best-effort reads `.catch(...)`).
 * Error mapping:
 *   - no session / silent-refresh failed, OR a Core 401 → requireReauth (web app opens
 *     the sign-in modal);
 *   - a PENDING session past its 24h absolute lifetime → destroy the cookie + 401
 *     SESSION_EXPIRED, with NO Core call (CTL-97 Task 4's central pending-expiry guard —
 *     see `PendingSessionExpiredError`); distinct from the requireReauth case above, which
 *     is why it is caught and handled separately rather than folded into it;
 *   - a Core 403 `ACCOUNT_SUSPENDED`/`ACCOUNT_DELETED`, or a Core 409 `ACCOUNT_STATE_INVALID`
 *     → destroy the cookie + the coded status (CTL-97 Task 3, I8): a bad ACCOUNT STATE means
 *     this session can no longer be trusted, so every protected read destroys it uniformly,
 *     not just `/userinfo`;
 *   - a Core 5xx / unreachable → 502 (upstream unavailable);
 *   - any other Core 4xx → surfaced with its real status (don't mislabel a 404/422 as
 *     "unavailable");
 *   - anything else → 500.
 */
export function withSession(
  handler: (req: Request, res: Response, core: CoreClient) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    let bearer: string | null;
    try {
      bearer = await resolveBearer(req, res);
    } catch (err) {
      // Google was unreachable, not the session dead — keep the session, ask for a retry.
      if (err instanceof TransientAuthError) return authUpstreamUnavailable(res);
      // The pending session's 24h absolute lifetime is up: destroy the cookie (expiring
      // Set-Cookie) and answer 401 SESSION_EXPIRED WITHOUT ever constructing a CoreClient or
      // invoking the handler below — no Core call happens for this request.
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
        // I8 — a bad account STATE (not just a bad request) must destroy the local session:
        // an account Core reports suspended/deleted/invalid-state can't be trusted to still be
        // the same session-holder's account next request, so the cookie is wiped uniformly for
        // every protected read, BEFORE the generic 4xx passthrough below ever sees it.
        if (
          err.status === 403 &&
          (err.code === "ACCOUNT_SUSPENDED" || err.code === "ACCOUNT_DELETED")
        ) {
          clearSession(res);
          const title = err.code === "ACCOUNT_SUSPENDED" ? "Account suspended" : "Account deleted";
          return sendProblem(res, 403, title, { code: err.code });
        }
        if (err.status === 409 && err.code === "ACCOUNT_STATE_INVALID") {
          clearSession(res);
          return sendProblem(res, 409, "Account state invalid", { code: err.code });
        }
        // 5xx / unreachable → genuinely unavailable; 4xx → surface the real status.
        if (err.status >= 500) return coreUnavailable(res);
        return sendProblem(res, err.status, "Upstream request failed", { code: "UPSTREAM_ERROR" });
      }
      // Unexpected (non-Core) exception in an aggregation handler — log it (it is otherwise
      // swallowed) so a 500 is diagnosable, then return the generic problem.
      console.error("[withSession] unhandled error:", err);
      sendProblem(res, 500, "Internal server error", { code: "INTERNAL" });
    }
  };
}
