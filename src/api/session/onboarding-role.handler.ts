import { isRole, readSession, writeSession } from "../../session.js";
import { sendProblem } from "../../util/problem.js";
import { sendData, withSession, type Me, type RoleEligibility } from "../_shared/index.js";
import { OnboardingRoleDataSchema } from "../../openapi/schemas.js";

/**
 * POST /v1/session/onboarding-role — bff-OWNED authorisation for a *logged-in* user to start
 * onboarding into a SECOND role (Profile Contract v2, CTL-97 Task 1.5-BFF3). The "Become a
 * Guide/Participant" affordance must stay in-app — it must NOT round-trip through
 * `/auth/login` (that re-runs Google OAuth / forces account re-selection, which is wrong for an
 * already-authenticated user). Mirrors `POST /session/current-role`
 * (src/api/session/current-role.handler.ts) in structure, but the two are NOT interchangeable:
 * current-role switches among roles ALREADY held; this endpoint authorises acquiring a role NOT
 * yet held, by setting `session.onboardingRole` (never `currentRole` — the role isn't held yet).
 *
 * `roles` are re-validated against Core `GET /users/me` on EVERY call (never cached in the
 * session). Already holding the role is a 409 (the UI should call current-role to switch, not
 * onboard) — this endpoint deliberately never sets `currentRole`. Eligibility is Core's
 * authoritative call (`GET /users/me/role-eligibility?role=`), e.g. a PARENT participant is
 * never GUIDE-eligible.
 *
 * A disabled/suspended account surfaces as a Core 403 (`ACCOUNT_NOT_ACTIVE`, carried in
 * `Problem.title`) from `GET /users/me` — that throws a `CoreError(403)` from `core.getCurrentUser`,
 * which `withSession`'s generic 4xx passthrough already turns into a 403 here; no special-casing
 * needed. No Core write happens in this flow.
 */
export const setOnboardingRole = withSession(async (req, res, core) => {
  const role = (req.body as { role?: unknown } | undefined)?.role;
  if (!isRole(role)) {
    return sendProblem(res, 400, "role must be 'GUIDE' or 'PARTICIPANT'", { code: "INVALID_ROLE" });
  }

  const cu = await core.getCurrentUser<Me>();
  if (cu.roles.includes(role)) {
    // Already held — the UI should switch (POST /session/current-role), not onboard. Session
    // unchanged.
    return sendProblem(res, 409, "Role already held by this account", {
      code: "ROLE_ALREADY_HELD",
    });
  }

  const elig = await core.getRoleEligibility<RoleEligibility>(role);
  if (!elig.eligible) {
    // e.g. PARENT_CANNOT_BECOME_GUIDE — carry Core's reason so the frontend can map it to the
    // parent-not-eligible message. Session unchanged.
    return sendProblem(res, 403, "Not eligible to onboard into this role", {
      code: elig.reason ?? "ROLE_NOT_ELIGIBLE",
    });
  }

  // withSession only reaches this handler after resolveBearer resolved a bearer FROM this
  // request's session, so readSession(req) is guaranteed non-null here; the `?? {}` just keeps
  // the type checker happy without an extra (unreachable) branch to test.
  /* istanbul ignore next */
  const session = readSession(req) ?? {};
  writeSession(res, { ...session, onboardingRole: role });

  sendData(res, { onboardingRole: role }, OnboardingRoleDataSchema);
});
