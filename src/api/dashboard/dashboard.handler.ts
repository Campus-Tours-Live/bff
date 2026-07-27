import { readSession } from "../../session.js";
import { withSession, type Me } from "../_shared/index.js";
import { guideDashboard } from "./guide.js";
import { participantDashboard } from "./participant.js";

/**
 * GET /v1/dashboard — the signed-in home, shaped by the active role. Profile Contract v2:
 * `activeRole` is bff SESSION state (never a Core/DB value — the id_token carries no app role
 * either), so it's read from this request's session, not from Core. Guide and participant
 * share one endpoint; the response is discriminated by `kind`, matching the front-end's single
 * shared /dashboard route. Errors (Core 401 / unavailable) are mapped centrally by withSession.
 *
 * A session with no (or a stale) active role has no dashboard "home" of its own — the frontend
 * is expected to route away from that state before ever landing here (see `GET /userinfo`).
 * Rather than invent a new error for that case, this keeps the pre-existing default: anything
 * other than an active GUIDE role renders the participant variant, exactly like the
 * `me.activeRole === "GUIDE"` check this replaces.
 */
export const getDashboard = withSession(async (req, res, core) => {
  const me = await core.getCurrentUser<Me>();
  // withSession only reaches this handler once resolveBearer resolved a bearer FROM this
  // session, so readSession(req) is guaranteed non-null; `?.` just satisfies the type checker.
  /* istanbul ignore next */
  const activeRole = readSession(req)?.activeRole;
  if (activeRole === "GUIDE") return guideDashboard(res, core, me);
  return participantDashboard(res, core, me);
});
