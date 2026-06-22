import { withSession, type Me } from "../_shared/index.js";
import { guideDashboard } from "./guide.js";
import { participantDashboard } from "./participant.js";

/**
 * GET /v1/dashboard — the signed-in home, shaped by the active role (read from the
 * authoritative Core /userinfo; the id_token carries no app role). Guide and
 * participant share one endpoint; the response is discriminated by `kind`, matching
 * the front-end's single shared /dashboard route. Errors (Core 401 / unavailable)
 * are mapped centrally by withSession.
 */
export const getDashboard = withSession(async (_req, res, core) => {
  const me = await core.getUserinfo<Me>();
  if (me.activeRole === "GUIDE") return guideDashboard(res, core, me);
  return participantDashboard(res, core, me);
});
