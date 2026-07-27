import { readSession, type Role } from "../../session.js";
import { sendProblem } from "../../util/problem.js";
import { sendData, withSession, type CoreClient, type Json, type Me } from "../_shared/index.js";
import { ProgressDataSchema, RoleEnum } from "../../openapi/schemas.js";
import { guideProgress } from "./guide.js";
import { participantProgress } from "./participant.js";

/** {@link RoleEnum}'s lowercase discriminator ("guide"|"participant") → the Core/session
 *  UPPERCASE role value used by `roles`/`onboardingRole`. */
function coreRoleOf(role: "guide" | "participant"): Role {
  return role === "guide" ? "GUIDE" : "PARTICIPANT";
}

/**
 * GET /v1/onboarding?role=guide|participant — single entry. Progress is keyed by the
 * TARGET role (the `role` query param), NOT currentRole — a participant applying to be
 * a guide still has currentRole=PARTICIPANT (which, per Profile Contract v2, is bff session
 * state anyway — irrelevant here). Profile Contract v2 moved `guideStatus`/`participantType`
 * off the old Core `/userinfo` onto the role-specific profile endpoints, so this handler reads
 * Core `/users/me` for `roles` and additionally fetches the TARGET role's profile (best-effort
 * — no profile yet, e.g. a brand-new user, degrades to null status/type rather than failing
 * the request). Guide progress is COARSE for now; the verification-level checklist is
 * deferred (see guide.ts).
 *
 * **Onboarding guard (CTL-97 Task 1.5-BFF2):** allowed iff `roles.includes(role) ||
 * session.onboardingRole === role`, else 403. This is what lets a brand-new signup (Core
 * `roles: []`) stay in onboarding for the role the login callback routed it into — it is NOT
 * gated by held roles, but by `onboardingRole`, the session's separate in-progress marker.
 */
export const getOnboarding = withSession(async (req, res, core) => {
  // Validate `role` against the SAME zod enum the OpenAPI spec documents (single source of
  // truth for the accepted values). Lowercase first to keep the case-insensitive behaviour.
  const parsed = RoleEnum.safeParse(String(req.query.role ?? "").toLowerCase());
  if (!parsed.success) {
    return sendProblem(res, 422, "role must be 'guide' or 'participant'", { code: "INVALID_ROLE" });
  }
  const role = parsed.data;
  const coreRole = coreRoleOf(role);

  const me = await core.getCurrentUser<Me>();

  // withSession only reaches this handler after resolveBearer resolved a bearer FROM this
  // request's session, so readSession(req) is guaranteed non-null here.
  /* istanbul ignore next */
  const session = readSession(req) ?? {};
  const authorized = me.roles.includes(coreRole) || session.onboardingRole === coreRole;
  if (!authorized) {
    return sendProblem(res, 403, "Not authorized for this role's onboarding", {
      code: "ONBOARDING_NOT_AUTHORIZED",
    });
  }

  const progress =
    role === "guide"
      ? guideProgress(await guideStatusOf(core))
      : participantProgress(me, await participantTypeOf(core));
  sendData(res, progress, ProgressDataSchema);
});

/** Best-effort: no guide profile yet (e.g. brand-new user) degrades to null, same as
 *  the old /userinfo-derived "null guideStatus" case. */
async function guideStatusOf(core: CoreClient): Promise<string | null> {
  const profile = await core.getGuideProfile<Json>().catch(() => null);
  return (profile?.guideStatus as string | null | undefined) ?? null;
}

/** Best-effort: no participant profile yet degrades to null, same as the old
 *  /userinfo-derived "null participantType" case. */
async function participantTypeOf(core: CoreClient): Promise<string | null> {
  const profile = await core.getParticipantProfile<Json>().catch(() => null);
  return (profile?.type as string | null | undefined) ?? null;
}
