import { isRole, readSession, writeSession } from "../../session.js";
import { withSession, sendData, type Me } from "../_shared/index.js";
import { UserinfoDataSchema } from "../../openapi/schemas.js";

/**
 * GET /v1/userinfo — bff-OWNED aggregation (Profile Contract v2). This used to be a
 * transparent proxy straight to Core's `/userinfo`; Core now serves pure identity/roles at
 * `GET /users/me` with no `currentRole` at all — `currentRole` is per-SESSION bff state (see
 * `SessionData.currentRole`), so the bff is the only place that can answer this. The web app
 * calls this on every page load, so it stays a cheap read: no session write on the common path.
 *
 * Re-validates the session's `currentRole` against the roles Core JUST returned, every call
 * (defensive, read-mostly): a role the account no longer holds (revoked/suspended) — or any
 * stale/garbage value `isRole` rejects — is reported as `currentRole: null`, and ONLY THEN is
 * the stale value cleared from the session and persisted (so a second call doesn't see it
 * again). An ordinary GET where the session's role is still valid (or already absent) does
 * NOT write the session — it must not extend the cookie's TTL on every page load.
 */
export const getUserinfo = withSession(async (req, res, core) => {
  const cu = await core.getCurrentUser<Me>();
  // withSession only reaches this handler after resolveBearer resolved a bearer FROM this
  // request's session, so readSession(req) is guaranteed non-null here; the `?? {}` just keeps
  // the type checker happy without an extra (unreachable) branch to test.
  /* istanbul ignore next */
  const session = readSession(req) ?? {};
  const requestedRole = session.currentRole;
  const current = isRole(requestedRole) && cu.roles.includes(requestedRole) ? requestedRole : null;

  if (requestedRole && !current) {
    const { currentRole: _stale, ...rest } = session;
    writeSession(res, rest);
  }

  sendData(res, { user: cu.user, roles: cu.roles, currentRole: current }, UserinfoDataSchema);
});
