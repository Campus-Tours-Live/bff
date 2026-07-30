import type { Request, Response } from "express";
import {
  readSession,
  convertToProvisioned,
  isRole,
  type Role,
  type SessionData,
} from "../../session.js";
import { sendData, writeOpts, type CoreClient } from "../_shared/index.js";
import { sendProblem } from "../../util/problem.js";
import { HeldRoleEnum, OnboardingCommandDataSchema } from "../../openapi/schemas.js";

/** Maps this route's lowercase path segment to the uppercase `Role` value the session/roles
 *  contract uses (`src/session.ts`'s `Role`) — the two vocabularies differ (URL segment vs
 *  Core's `user_roles` values), so this is the one place they're bridged. */
const ROUTE_ROLE: Record<"guide" | "participant", Role> = {
  guide: "GUIDE",
  participant: "PARTICIPANT",
};

/**
 * Core `POST /users/me/roles/{guide|participant}` response (Profile Contract v2 onboarding
 * command; `OnboardingResponse`, enveloped `{ data }`, unwrapped by `CoreClient.post`).
 * Deliberately typed loosely on the fields this handler runtime-validates below — like
 * `src/api/userinfo/userinfo.handler.ts`'s `Me`, this is an unsound cast at the JSON boundary
 * (Core is untrusted), not a defensive runtime guard; every field is checked before use. NO
 * `currentRole` — Core never owns it (bff session state, see src/session.ts).
 */
interface CoreOnboardingResponse {
  // Core's OnboardingResponse has NO provisioningStatus and NO currentRole — both are bff session
  // state. Core's account-lifecycle status lives on user.accountStatus. The bff synthesizes the
  // frontend-facing provisioningStatus: "PROVISIONED" discriminator + currentRole after conversion.
  user: { id: string; [key: string]: unknown };
  roles: string[];
  acquiredRole: string;
  profile: unknown;
}

/**
 * Attempt `convertToProvisioned` once, retrying ONCE synchronously on throw before giving up —
 * bounded, not unbounded (an unbounded retry loop could hang the request on a persistently
 * broken session store). Returns whether the session was converted.
 */
function convertSessionWithOneRetry(res: Response, session: SessionData, role: Role): boolean {
  try {
    convertToProvisioned(res, session, role);
    return true;
  } catch {
    try {
      convertToProvisioned(res, session, role);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Handler factory for the onboarding-command routes (CTL-97 defer-provisioning),
 * `POST /v1/users/me/roles/guide` and `.../participant` (see ./routes.ts for why these are two
 * CONCRETE routes rather than one generic `:role`). Provisions `role` in Core for the caller —
 * a PENDING (not-yet-provisioned) session is the ordinary case (the create path), but an
 * already-PROVISIONED session acquiring a SECOND role also goes through this same handler —
 * then converts THIS bff session so `currentRole` reflects the just-acquired role.
 *
 * **Core 4xx passthrough:** `core.post` throws a `CoreError` on any non-2xx Core response
 * (409 `ROLE_ALREADY_GRANTED`/`ROLE_NOT_ELIGIBLE`, 422 `VALIDATION_FAILED`) — this handler does
 * NOT catch it; `withMutation` relays it VERBATIM (status + content-type + body) to the
 * browser. Critically, that throw happens BEFORE any of the validation/conversion below runs,
 * so a rejected onboarding attempt never sets `currentRole` and never touches the session.
 *
 * **Upstream contract violation:** a Core 201 whose body doesn't hold up — a non-string/empty
 * `user.id`, an `acquiredRole` that isn't a switchable `Role`, doesn't match the `{role}` this
 * route is for, or isn't itself present in `roles`, or any `roles` entry outside the four
 * {@link HeldRoleEnum} values — is 502 `UPSTREAM_CONTRACT_VIOLATION`, and the session is left
 * untouched (never converted on a garbage Core response).
 *
 * **Session conversion failure:** a session-store write failure AFTER a genuine Core 201 is
 * 500 `SESSION_CONVERSION_FAILED` (after one bounded retry) — the Core row is NOT rolled back,
 * so the response signals the frontend to reconcile via `GET /v1/userinfo` (which repairs a
 * still-pending session once Core reports provisioned — the I11 recovery path), NOT to resend
 * this command (Core already granted the role; a resend would now 409 `ROLE_ALREADY_GRANTED`).
 *
 * **The bff response is NOT Core's response verbatim:** Core's `OnboardingResponse` has NO
 * `provisioningStatus` and NO `currentRole` — both are bff session state (Core's account-lifecycle
 * status lives on `user.accountStatus`). On success this constructs the frontend-facing
 * `OnboardingCommandResponse` — `provisioningStatus: "PROVISIONED"` (the bff session discriminator)
 * plus the bff-added `currentRole` — only AFTER the session conversion above actually succeeded.
 */
export function onboardingCommand(
  role: "guide" | "participant",
): (req: Request, res: Response, core: CoreClient) => Promise<void> {
  const expectedRole = ROUTE_ROLE[role];

  return async (req, res, core) => {
    const core201 = await core.post<CoreOnboardingResponse>(
      `/users/me/roles/${role}`,
      req.body,
      writeOpts(req, res),
    );

    // --- Runtime-validate the Core 201 body before trusting ANY of it. ---
    const idIsValid = typeof core201.user.id === "string" && core201.user.id.length > 0;
    const heldRoles = core201.roles;
    const rolesAreValid =
      heldRoles.length >= 1 && heldRoles.every((r) => HeldRoleEnum.safeParse(r).success);
    const acquiredRoleIsRole = isRole(core201.acquiredRole);
    const acquiredRoleMatchesRoute = core201.acquiredRole === expectedRole;
    const acquiredRoleIsHeld = rolesAreValid && heldRoles.includes(core201.acquiredRole);

    if (
      !idIsValid ||
      !rolesAreValid ||
      !acquiredRoleIsRole ||
      !acquiredRoleMatchesRoute ||
      !acquiredRoleIsHeld
    ) {
      sendProblem(res, 502, "Upstream contract violation", {
        code: "UPSTREAM_CONTRACT_VIOLATION",
      });
      return;
    }

    // --- Convert the session: PENDING -> PROVISIONED (the ordinary onboarding case), or
    //     re-stamp an already-PROVISIONED session's currentRole (acquiring a second role). ---
    // withMutation only reaches this handler after resolveBearer resolved a bearer FROM this
    // request's session, so readSession(req) is guaranteed non-null here; the fallback literal
    // just keeps the type checker happy without an extra (unreachable) branch to test — mirrors
    // the same pattern in src/api/userinfo/userinfo.handler.ts.
    /* istanbul ignore next */
    const session: SessionData = readSession(req) ?? { provisioningStatus: "PROVISIONED" as const };
    if (!convertSessionWithOneRetry(res, session, expectedRole)) {
      sendProblem(res, 500, "Session conversion failed", {
        code: "SESSION_CONVERSION_FAILED",
      });
      return;
    }

    res.status(201);
    sendData(
      res,
      {
        provisioningStatus: "PROVISIONED" as const,
        user: core201.user,
        roles: heldRoles,
        currentRole: expectedRole,
        acquiredRole: expectedRole,
        profile: core201.profile,
      },
      OnboardingCommandDataSchema,
    );
  };
}
