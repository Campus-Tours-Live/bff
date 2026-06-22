import type { Request, Response } from "express";
import { sendProblem } from "../../util/problem.js";
import { resolveBearer } from "./session.js";
import { requireReauth } from "./reauth.js";
import { coreUnavailable } from "./envelope.js";
import { CoreClient } from "./core-client.js";
import { CoreAuthError, CoreError } from "./errors.js";

/**
 * Handler wrapper for aggregation endpoints: resolve auth once, hand the handler a
 * ready-to-use Core client, and funnel every error through one place so handlers stay
 * branch-free (required reads just `await`; best-effort reads `.catch(...)`).
 * Error mapping:
 *   - no session / silent-refresh failed, OR a Core 401 → requireReauth (web app opens
 *     the sign-in modal);
 *   - a Core 5xx / unreachable → 502 (upstream unavailable);
 *   - a Core 4xx → surfaced with its real status (don't mislabel a 404/422 as
 *     "unavailable");
 *   - anything else → 500.
 */
export function withSession(
  handler: (req: Request, res: Response, core: CoreClient) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    const bearer = await resolveBearer(req, res);
    if (!bearer) return requireReauth(res);
    try {
      await handler(req, res, new CoreClient(bearer));
    } catch (err) {
      if (err instanceof CoreAuthError) return requireReauth(res);
      if (err instanceof CoreError) {
        // 5xx / unreachable → genuinely unavailable; 4xx → surface the real status.
        if (err.status >= 500) return coreUnavailable(res);
        return sendProblem(res, err.status, "Upstream request failed", { code: "UPSTREAM_ERROR" });
      }
      sendProblem(res, 500, "Internal server error", { code: "INTERNAL" });
    }
  };
}
