import type { Response } from "express";
import { type CoreClient, sendData, type Json, type Me } from "../_shared/index.js";
import { GuideDashboardDataSchema } from "../../openapi/schemas.js";

/**
 * Guide workspace: profile (required — throws → mapped by withSession) + offerings
 * (best-effort — degrades to empty list) + earnings (best-effort — degrades to null) +
 * `canPublish`, a computed convenience field mirroring the Core's publish gate. All
 * three Core reads are fanned out in parallel to cut latency.
 */
export async function guideDashboard(res: Response, core: CoreClient, me: Me): Promise<void> {
  const [guide, offerings, earnings] = await Promise.all([
    core.getGuideProfile<Json>(),
    core.getOfferings<Json[]>().catch(() => [] as Json[]),
    core.getGuideEarnings<Json>().catch(() => null),
  ]);
  sendData(
    res,
    {
      kind: "guide",
      guide,
      guideStatus: me.guideStatus,
      canPublish: me.guideStatus === "APPROVED",
      offerings,
      earnings,
      createdAt: me.createdAt,
    },
    GuideDashboardDataSchema,
  );
}
