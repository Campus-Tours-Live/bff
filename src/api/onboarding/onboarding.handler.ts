import { sendProblem } from "../../util/problem.js";
import { sendData, withSession, type Me } from "../_shared/index.js";
import { ProgressDataSchema, RoleEnum } from "../../openapi/schemas.js";
import { guideProgress } from "./guide.js";
import { participantProgress } from "./participant.js";

/**
 * GET /v1/onboarding?role=guide|participant — single entry, ONE /userinfo read for
 * both roles: their progress derives from /userinfo alone (guideStatus for guide,
 * held role for participant), so onboarding never touches /guide/profile. Keyed by
 * the TARGET role (the `role` query param), NOT activeRole — a participant applying to
 * be a guide still has activeRole=PARTICIPANT. Guide progress is COARSE for now; the
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
  const progress = role === "guide" ? guideProgress(me) : participantProgress(me);
  sendData(res, progress, ProgressDataSchema);
});
