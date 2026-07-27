import { sendProblem } from "../../util/problem.js";
import { sendData, withSession, type CoreClient, type Json, type Me } from "../_shared/index.js";
import { ProgressDataSchema, RoleEnum } from "../../openapi/schemas.js";
import { guideProgress } from "./guide.js";
import { participantProgress } from "./participant.js";

/**
 * GET /v1/onboarding?role=guide|participant — single entry. Progress is keyed by the
 * TARGET role (the `role` query param), NOT activeRole — a participant applying to be
 * a guide still has activeRole=PARTICIPANT. Profile Contract v2 moved `guideStatus`/
 * `participantType` off /userinfo onto the role-specific profile endpoints, so this
 * handler reads /userinfo for `roles` and additionally fetches the TARGET role's
 * profile (best-effort — no profile yet, e.g. a brand-new user, degrades to null
 * status/type rather than failing the request). Guide progress is COARSE for now; the
 * verification-level checklist is deferred (see guide.ts).
 */
export const getOnboarding = withSession(async (req, res, core) => {
  // Validate `role` against the SAME zod enum the OpenAPI spec documents (single source of
  // truth for the accepted values). Lowercase first to keep the case-insensitive behaviour.
  const parsed = RoleEnum.safeParse(String(req.query.role ?? "").toLowerCase());
  if (!parsed.success) {
    return sendProblem(res, 422, "role must be 'guide' or 'participant'", { code: "INVALID_ROLE" });
  }
  const role = parsed.data;
  const me = await core.getUserinfo<Me>();
  const progress =
    role === "guide"
      ? guideProgress(await guideApplicationStatus(core))
      : participantProgress(me, await participantTypeOf(core));
  sendData(res, progress, ProgressDataSchema);
});

/** Best-effort: no guide profile yet (e.g. brand-new user) degrades to null, same as
 *  the old /userinfo-derived "null guideStatus" case. */
async function guideApplicationStatus(core: CoreClient): Promise<string | null> {
  const profile = await core.getGuideProfile<Json>().catch(() => null);
  return (profile?.applicationStatus as string | null | undefined) ?? null;
}

/** Best-effort: no participant profile yet degrades to null, same as the old
 *  /userinfo-derived "null participantType" case. */
async function participantTypeOf(core: CoreClient): Promise<string | null> {
  const profile = await core.getParticipantProfile<Json>().catch(() => null);
  return (profile?.type as string | null | undefined) ?? null;
}
