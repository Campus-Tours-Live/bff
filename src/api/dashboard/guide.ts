import type { Response } from "express";
import {
  type CoreClient,
  sendData,
  type Json,
  type Me,
  PUBLISHABLE_STATUS,
} from "../_shared/index.js";
import { GuideDashboardDataSchema } from "../../openapi/schemas.js";

type GuidePendingActions = { pendingAcceptance?: number };

/**
 * Guide workspace: profile (required — throws → mapped by withSession) + offerings
 * (best-effort — degrades to an empty list) + pending booking request count
 * (best-effort — degrades to 0) + `canPublish`, a computed convenience field
 * mirroring the Core's publish gate. The output `guideStatus` is read from the
 * fetched guide profile's own `guideStatus` field. Core reads are fanned out in
 * parallel to cut latency.
 */
export async function guideDashboard(res: Response, core: CoreClient, me: Me): Promise<void> {
  const [guide, offerings, pending] = await Promise.all([
    core.getGuideProfile<Json>(),
    core.getOfferings<Json[]>().catch(() => [] as Json[]),
    core.getGuidePendingActions<GuidePendingActions>().catch(() => null),
  ]);
  const guideStatus = (guide.guideStatus as string | null | undefined) ?? null;
  const pendingBookingRequests =
    typeof pending?.pendingAcceptance === "number" && pending.pendingAcceptance >= 0
      ? pending.pendingAcceptance
      : 0;
  sendData(
    res,
    {
      kind: "guide",
      guide,
      guideStatus,
      canPublish: guideStatus === PUBLISHABLE_STATUS,
      offerings,
      pendingBookingRequests,
      createdAt: me.user.createdAt,
    },
    GuideDashboardDataSchema,
  );
}
