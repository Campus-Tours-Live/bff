import type { Response } from "express";
import { type CoreClient, sendData, type Json, type Me } from "../_shared/index.js";

/**
 * Participant dashboard. Fans out four Core reads in parallel:
 * - profile (required — throws → mapped by withSession on auth failure)
 * - next confirmed tour (best-effort → null on failure)
 * - upcoming bookings list (best-effort → [] on failure)
 * - pending actions counts (best-effort → null on failure)
 */
export async function participantDashboard(res: Response, core: CoreClient, me: Me): Promise<void> {
  const [participant, nextTour, upcomingBookings, pendingActions] = await Promise.all([
    core.getParticipantProfile<Json>(),
    core.getNextTour<Json | null>().catch(() => null),
    core.getUpcomingBookings<Json[]>().catch(() => [] as Json[]),
    core.getPendingActions<Json>().catch(() => null),
  ]);
  sendData(res, {
    kind: "participant",
    participant,
    nextTour,
    upcomingBookings,
    pendingActions,
    createdAt: me.createdAt,
  });
}
