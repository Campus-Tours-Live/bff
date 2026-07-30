import { convertToProvisioned, isRole, readSession } from "../../session.js";
import { sendProblem } from "../../util/problem.js";
import { sendData, withSession, type Me } from "../_shared/index.js";
import { CurrentRoleDataSchema } from "../../openapi/schemas.js";

/**
 * POST /v1/session/current-role — bff-OWNED manual role switch (Profile Contract v2). Core has
 * no current-role endpoint and never learns which role a session has chosen; this is the only
 * place `SessionData.currentRole` is set from a direct user action (the login callback sets it
 * too, but only from its own role-resolution logic — see src/auth/routes.ts).
 *
 * `roles` are re-validated against Core `GET /users/me` on EVERY call rather than cached in the
 * session (a second staleable copy).
 *
 * A disabled/suspended account surfaces as a Core 403 (`ACCOUNT_NOT_ACTIVE`, carried in
 * `Problem.title`) from `GET /users/me` — that throws a `CoreError(403)` from `core.getCurrentUser`,
 * which `withSession`'s generic 4xx passthrough already turns into a 403 here; no special-casing
 * needed.
 */
export const setCurrentRole = withSession(async (req, res, core) => {
  const role = (req.body as { role?: unknown } | undefined)?.role;
  if (!isRole(role)) {
    return sendProblem(res, 400, "role must be 'GUIDE' or 'PARTICIPANT'", { code: "INVALID_ROLE" });
  }

  const cu = await core.getCurrentUser<Me>();
  if (!cu.roles.includes(role)) {
    // Session unchanged — a rejected switch must not touch the cookie.
    return sendProblem(res, 403, "Role not held by this account", { code: "ROLE_NOT_HELD" });
  }

  // withSession only reaches this handler after resolveBearer resolved a bearer FROM this
  // request's session, so readSession(req) is guaranteed non-null here — and Core just
  // confirmed (via getCurrentUser above) that this account IS provisioned, so
  // convertToProvisioned is the right transition regardless of the session's prior
  // provisioningStatus; the fallback literal just keeps the type checker happy without an extra
  // (unreachable) branch to test.
  /* istanbul ignore next */
  const session = readSession(req) ?? { provisioningStatus: "PROVISIONED" as const };
  convertToProvisioned(res, session, role);

  sendData(res, { currentRole: role }, CurrentRoleDataSchema);
});
