import type { Response } from "express";
import {
  type CoreClient,
  sendData,
  type Json,
  type Me,
  PUBLISHABLE_STATUS,
} from "../_shared/index.js";
import { GuideDashboardDataSchema } from "../../openapi/schemas.js";

/**
 * Guide workspace: profile (required — throws → mapped by withSession) + offerings
 * (best-effort — degrades to an empty list) + `canPublish`, a computed convenience
 * field mirroring the Core's publish gate: only a PUBLISHABLE_STATUS guide may publish
 * an offering. `guideStatus` is read from the fetched guide profile's
 * `applicationStatus` (Profile Contract v2 — /userinfo no longer carries it). The two
 * Core reads are fanned out in parallel to cut latency.
 */
export async function guideDashboard(res: Response, core: CoreClient, me: Me): Promise<void> {
  const [guide, offerings] = await Promise.all([
    core.getGuideProfile<Json>(),
    core.getOfferings<Json[]>().catch(() => [] as Json[]),
  ]);
  const guideStatus = (guide.applicationStatus as string | null | undefined) ?? null;
  sendData(
    res,
    {
      kind: "guide",
      guide,
      guideStatus,
      canPublish: guideStatus === PUBLISHABLE_STATUS,
      offerings,
      createdAt: me.user.createdAt,
    },
    GuideDashboardDataSchema,
  );
}
