import type { Response } from "express";
import { type CoreClient, sendData, type Json, type Me } from "../_shared/index.js";

/**
 * Participant workspace. Thin for now — richer aggregation (next tour / to-dos /
 * picks) arrives once those domains exist. `me` supplies the account-level
 * "member since" date (createdAt), which is common to every role.
 */
export async function participantDashboard(res: Response, core: CoreClient, me: Me): Promise<void> {
  const participant = await core.getParticipantProfile<Json>();
  sendData(res, { kind: "participant", participant, createdAt: me.createdAt });
}
