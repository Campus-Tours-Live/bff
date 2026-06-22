import { sendProblem } from "../../util/problem.js";
import { sendData, withSession, type Me } from "../_shared/index.js";
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
  const role = String(req.query.role ?? "").toLowerCase();
  if (role !== "guide" && role !== "participant") {
    return sendProblem(res, 422, "role must be 'guide' or 'participant'", { code: "INVALID_ROLE" });
  }
  const me = await core.getUserinfo<Me>();
  sendData(res, role === "guide" ? guideProgress(me) : participantProgress(me));
});
