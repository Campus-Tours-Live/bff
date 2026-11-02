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
 * (best-effort — fallback values are marked unavailable) + `canPublish`, a computed convenience field
 * mirroring the Core's publish gate. The output `guideStatus` is read from the
 * fetched guide profile's own `guideStatus` field. Core reads are fanned out in
 * parallel to cut latency.
 */
export async function guideDashboard(res: Response, core: CoreClient, me: Me): Promise<void> {
  const [guide, offerings, pending] = await Promise.all([
    core.getGuideProfile<Json>(),
    core.getOfferings<Json[]>().catch(() => null),
    core.getGuidePendingActions<GuidePendingActions>().catch(() => null),
  ]);
  const guideStatus = (guide.guideStatus as string | null | undefined) ?? null;
  const pendingCount = pending?.pendingAcceptance;
  const pendingAvailable =
    typeof pendingCount === "number" && Number.isSafeInteger(pendingCount) && pendingCount >= 0;
  const offeringsAvailable = Array.isArray(offerings);
  sendData(
    res,
    {
      kind: "guide",
      guide,
      guideStatus,
      canPublish: guideStatus === PUBLISHABLE_STATUS,
      offerings: offeringsAvailable ? offerings : [],
      pendingBookingRequests: pendingAvailable ? pendingCount : 0,
      dataAvailability: {
        offerings: offeringsAvailable,
        pendingBookingRequests: pendingAvailable,
      },
      createdAt: me.user.createdAt,
    },
    GuideDashboardDataSchema,
  );
}
