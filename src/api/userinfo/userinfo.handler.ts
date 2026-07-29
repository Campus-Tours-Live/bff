import type { z } from "zod";
import {
  convertToProvisioned,
  isRole,
  readSession,
  writeSession,
  type ProvisionedSessionData,
  type Role,
} from "../../session.js";
import { withSession, sendData, CoreError, type Me } from "../_shared/index.js";
import { sendProblem } from "../../util/problem.js";
import { UserinfoDataSchema, HeldRoleEnum } from "../../openapi/schemas.js";
import { pendingIdentityFromSession } from "./pendingIdentity.js";

/** Every role value Core can report on an account (`GET /users/me` `roles`) — the four
 *  {@link HeldRoleEnum} values, including the staff-only ADMIN/SUPPORT that never become a
 *  switchable/onboardable `currentRole` (see `isRole`/`Role` in src/session.ts). */
type HeldRole = z.infer<typeof HeldRoleEnum>;

/**
 * GET /v1/userinfo — bff-OWNED aggregation (Profile Contract v2 + CTL-97 defer-provisioning).
 * The web app calls this on every page load, so the response is a discriminated union on
 * `accountState`:
 *   - `PENDING`  — Google sign-in succeeded but Core has no `users` row yet (Core `GET
 *     /users/me` → 404 `ACCOUNT_NOT_PROVISIONED`, exactly — I7). `user` is derived straight
 *     from the session's Google id_token (never a Core call succeeds here), `roles` is always
 *     `[]`, `currentRole` is always `null`.
 *   - `PROVISIONED` — Core has an account. Composes Core's identity + held roles with THIS
 *     bff session's `currentRole` (session state, never a Core/DB value — Core never learns
 *     it).
 *
 * **I7 — exact discrimination:** ONLY a 404 whose parsed problem `code` is literally
 * `ACCOUNT_NOT_PROVISIONED` is treated as pending. A 404 with any other code (e.g.
 * `PROFILE_NOT_FOUND`) or a non-JSON/uncoded 404 is a system error and is RE-THROWN — never
 * silently downgraded to "pending", which would let an unrelated backend problem masquerade as
 * an ordinary not-yet-signed-up user.
 *
 * **I8 — destroy on bad account state:** a Core 403 `ACCOUNT_SUSPENDED`/`ACCOUNT_DELETED` or 409
 * `ACCOUNT_STATE_INVALID` is also RE-THROWN — `withSession` (src/api/_shared/with-session.ts)
 * destroys the session cookie centrally for every protected read, not just this endpoint.
 *
 * **Upstream contract violation:** Core returning 200 with `roles: []`, a missing/non-string
 * `user.id`, or any role outside the four {@link HeldRoleEnum} values (GUIDE/PARTICIPANT/
 * ADMIN/SUPPORT) is NOT a valid PROVISIONED response and is NOT reinterpreted as pending — it
 * is a 502 `UPSTREAM_CONTRACT_VIOLATION` (Core broke its own contract; this is never a normal
 * signin/signup state). ADMIN/SUPPORT are real, expected Core roles (staff accounts) and are
 * always passed through in the response `roles` — only a role NONE of the four recognise is
 * garbage.
 *
 * **Deterministic currentRole repair (no array-order reliance):** `currentRole` is only ever
 * GUIDE or PARTICIPANT — ADMIN/SUPPORT are never switchable/onboardable, so they're excluded
 * from the candidate set even though they appear in `roles`. Let `switchable` be the
 * GUIDE/PARTICIPANT subset of the held roles: when the session's stored `currentRole` is still
 * in `switchable`, it's kept; else, when `switchable` holds EXACTLY one role, that role is
 * adopted; otherwise `null` (the frontend shows the role picker, or — for a staff-only account
 * with an empty `switchable` — simply doesn't need one). The repaired value is persisted ONLY
 * when it differs from what the session already had — an ordinary read (role unchanged) must
 * not extend the cookie's TTL. If persisting the repair throws, this responds 500
 * `SESSION_CONVERSION_FAILED` rather than handing back a PROVISIONED body while the client
 * still holds a stale/pending cookie.
 *
 * **The PENDING branch is read-only:** it must NEVER call `writePendingSession`/`writeSession`
 * — doing so would reset the pending session's 24h absolute TTL on every single `/userinfo`
 * poll, defeating the whole point of an absolute (not sliding) lifetime.
 */
export const getUserinfo = withSession(async (req, res, core) => {
  let cu: Me;
  try {
    cu = await core.getCurrentUser<Me>();
  } catch (err) {
    if (err instanceof CoreError && err.status === 404 && err.code === "ACCOUNT_NOT_PROVISIONED") {
      // withSession only reaches this handler after resolveBearer resolved a bearer FROM this
      // request's session, so readSession(req) is guaranteed non-null here; the fallback
      // literal just keeps the type checker happy without an extra (unreachable) branch to
      // test. `pendingIdentityFromSession` throws `IdentityClaimsInvalidError` when the
      // session's id_token can't yield a verified email — deliberately left to propagate here
      // (uncaught) so `withSession`'s generic mapping turns it into a 500: a pending session
      // with unusable identity claims is a system error, never a normal pending response.
      /* istanbul ignore next */
      const session = readSession(req) ?? { accountState: "PROVISIONED" as const };
      const pendingUser = pendingIdentityFromSession(session);
      // NO session write here — see the read-only contract in the header comment above.
      return sendData(
        res,
        { accountState: "PENDING" as const, user: pendingUser, roles: [], currentRole: null },
        UserinfoDataSchema,
      );
    }
    // Any other Core error (a different 404 code, non-JSON 404, 401, 403, 409, 5xx) is NOT a
    // pending signal — re-throw so withSession's central mapping handles it (I7/I8).
    throw err;
  }

  // --- PROVISIONED path: runtime-validate the Core contract before trusting it. ---
  const heldRoles = cu.roles;
  const idIsValid = typeof cu.user.id === "string" && cu.user.id.length > 0;
  const rolesAreValid =
    heldRoles.length >= 1 && heldRoles.every((r) => HeldRoleEnum.safeParse(r).success);
  if (!idIsValid || !rolesAreValid) {
    // Core broke its own contract — this is an upstream problem, NOT a signin, and must never
    // be reported as PROVISIONED (nor misread as "roles: [] → pending"). Note ADMIN/SUPPORT
    // pass this check (they're real Core roles, see HeldRoleEnum) — only a role outside the
    // four known values is garbage.
    return sendProblem(res, 502, "Upstream contract violation", {
      code: "UPSTREAM_CONTRACT_VIOLATION",
    });
  }
  const held = heldRoles as HeldRole[];
  // currentRole is GUIDE/PARTICIPANT only — ADMIN/SUPPORT are never switchable/onboardable, so
  // they're excluded from the repair candidate set even though they stay in `held`/`roles`.
  const switchable = held.filter(isRole);

  /* istanbul ignore next -- see the fallback-literal note above; same unreachable-null case. */
  const session = readSession(req) ?? { accountState: "PROVISIONED" as const };
  const priorRole = session.accountState === "PROVISIONED" ? session.currentRole : undefined;
  const repairedRole: Role | null =
    isRole(priorRole) && switchable.includes(priorRole)
      ? priorRole
      : switchable.length === 1
        ? switchable[0]!
        : null;

  try {
    if (session.accountState === "PENDING") {
      // Core just confirmed (via getCurrentUser above) that this account IS provisioned — this
      // is the "/userinfo finds Core provisioned" repair path (a PENDING session whose account
      // got provisioned by some other means, e.g. the onboarding flow completing elsewhere).
      convertToProvisioned(res, session, repairedRole ?? undefined);
    } else if (repairedRole !== (session.currentRole ?? null)) {
      // Persist ONLY when the repaired role actually differs from what the session already
      // had — the ordinary "still valid" read must not write (no TTL extension on every page
      // load). `rest` carries every other session field forward unchanged.
      const { currentRole: _stale, ...rest } = session;
      const next: ProvisionedSessionData =
        repairedRole !== null ? { ...rest, currentRole: repairedRole } : rest;
      writeSession(res, next);
    }
  } catch {
    // Do NOT hand back a PROVISIONED body while the client still holds a stale/pending
    // session — the repair didn't take, so the client must retry rather than proceed on a
    // cookie that no longer matches what this response claims.
    return sendProblem(res, 500, "Session conversion failed", {
      code: "SESSION_CONVERSION_FAILED",
    });
  }

  sendData(
    res,
    { accountState: "PROVISIONED" as const, user: cu.user, roles: held, currentRole: repairedRole },
    UserinfoDataSchema,
  );
});
