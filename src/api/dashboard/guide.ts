import type { Response } from "express";
import { type CoreClient, sendData, type Json, type Me } from "../_shared/index.js";
import { GuideDashboardDataSchema } from "../../openapi/schemas.js";

/**
 * Guide workspace: profile (required — throws → mapped by withSession) + offerings
 * (best-effort — degrades to an empty list) + `canPublish`, a computed convenience
 * field mirroring the Core's publish gate: only an APPROVED guide may publish an
 * offering. The two Core reads are fanned out in parallel to cut latency.
 */
export async function guideDashboard(res: Response, core: CoreClient, me: Me): Promise<void> {
  const [guide, offerings] = await Promise.all([
    core.getGuideProfile<Json>(),
    core.getOfferings<Json[]>().catch(() => [] as Json[]),
  ]);
  sendData(
    res,
    {
      kind: "guide",
      guide,
      guideStatus: me.guideStatus,
      canPublish: me.guideStatus === "APPROVED",
      offerings,
      createdAt: me.createdAt,
    },
    GuideDashboardDataSchema,
  );
}
