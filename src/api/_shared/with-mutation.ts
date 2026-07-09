import type { Request, Response } from "express";
import { sendProblem } from "../../util/problem.js";
import { resolveBearer } from "./session.js";
import { requireReauth } from "./reauth.js";
import { coreUnavailable } from "./envelope.js";
import { CoreClient } from "./core-client.js";
import { CoreAuthError, CoreError } from "./errors.js";

/**
 * Mutation sibling of {@link withSession}. Resolves auth once, then on a Core error:
 *   - CoreAuthError / Core 401 → requireReauth;
 *   - Core 5xx / unreachable → 502;
 *   - Core 4xx → VERBATIM relay of the Core problem+json (status + content-type + body) so
 *     validation messages (e.g. "time slot just taken", 422) reach the browser unchanged;
 *   - anything else → 500.
 * The shared read wrapper (withSession) is intentionally NOT reused, so the read 4xx
 * contract (generic UPSTREAM_ERROR) stays put.
 */
export function withMutation(
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
        if (err.status >= 500) return coreUnavailable(res);
        res.status(err.status);
        if (err.contentType) res.type(err.contentType);
        res.send(err.body ?? "");
        return;
      }
      sendProblem(res, 500, "Internal server error", { code: "INTERNAL" });
    }
  };
}
