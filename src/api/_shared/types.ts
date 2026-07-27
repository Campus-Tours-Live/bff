/** Minimal shapes the aggregation endpoints read from Core. Centralized so the
 *  per-feature processors don't each re-declare them. */

export type Json = Record<string, unknown>;

/** Core /userinfo (MeResponse), Profile Contract v2: session/bootstrap only — no
 *  role-scoped data (no `guideStatus`/`participantType`; those now live on the
 *  role-specific profile endpoints, `/guide/profile` and `/participant/profile`). */
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
  activeRole: string | null;
}
