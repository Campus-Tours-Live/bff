/** Minimal shapes the aggregation endpoints read from Core. Centralized so the
 *  per-feature processors don't each re-declare them. */

import type { Role } from "../../session.js";

export type Json = Record<string, unknown>;

/**
 * Core `GET /users/me` response (Profile Contract v2, `CoreClient.getCurrentUser`): pure
 * account identity + held roles — no role-scoped data (no `guideStatus`/`participantType`;
 * those live on the role-specific profile endpoints, `/guide/profile` and
 * `/participant/profile`) and, notably, NO `activeRole` — Core no longer knows it (it's bff
 * session state, see src/session.ts's `SessionData.activeRole`). The bff-owned
 * `GET /userinfo` (src/api/userinfo) composes this with the session's activeRole — see
 * {@link Userinfo}.
 */
export interface Me {
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    email: string | null;
    accountStatus: string | null;
    ageBand: string | null;
    createdAt: string; // ISO-8601 (UTC) account creation; surfaced to the dashboard as "member since"
  };
  roles: string[];
}

/** `GET /userinfo` (bff-owned aggregation) response `data` — {@link Me} plus this session's
 *  `activeRole`, re-validated against the roles Core just returned (see src/api/userinfo). */
export interface Userinfo extends Me {
  activeRole: Role | null;
}
