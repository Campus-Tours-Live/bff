/** Minimal shapes the aggregation endpoints read from Core. Centralized so the
 *  per-feature processors don't each re-declare them. */

import type { Role } from "../../session.js";

export type Json = Record<string, unknown>;

/**
 * Core `GET /users/me` response (Profile Contract v2, `CoreClient.getCurrentUser`): pure
 * account identity + held roles — no role-scoped data (no `guideStatus`/`participantType`;
 * those live on the role-specific profile endpoints, `/guide/profile` and
 * `/participant/profile`) and, notably, NO `currentRole` — Core no longer knows it (it's bff
 * session state, see src/session.ts's `SessionData.currentRole`). The bff-owned
 * `GET /userinfo` (src/api/userinfo) composes this with the session's currentRole — see
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
 *  `currentRole`, re-validated against the roles Core just returned (see src/api/userinfo). */
export interface Userinfo extends Me {
  currentRole: Role | null;
}

/**
 * Core `GET /users/me/role-eligibility?role=` response (`CoreClient.getRoleEligibility`) — the
 * authoritative "can this account acquire this role" check (e.g. a PARENT participant is never
 * GUIDE-eligible). `reason` is a typed enum, not a free string (the bff routes on it), and is
 * `null` whenever `eligible` is `true`. Consumed by the login callback (CTL-97 Task 1.5-BFF2)
 * to gate the PARENT→guide case.
 */
export interface RoleEligibility {
  eligible: boolean;
  reason: "PARENT_CANNOT_BECOME_GUIDE" | "ROLE_ALREADY_HELD" | null;
}
