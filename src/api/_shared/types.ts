/** Minimal shapes the aggregation endpoints read from Core. Centralized so the
 *  per-feature processors don't each re-declare them. */

export type Json = Record<string, unknown>;

/** Subset of Core /userinfo (MeResponse) the aggregations use. */
export interface Me {
  roles: string[];
  activeRole: string | null;
  participantType: string | null;
  guideStatus: string | null;
  createdAt: string; // ISO-8601 (UTC) account creation; surfaced to the dashboard as "member since"
}
