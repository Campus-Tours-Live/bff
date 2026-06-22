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
