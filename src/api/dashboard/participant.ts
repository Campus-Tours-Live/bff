import type { Response } from "express";
import {
  type CoreClient,
  sendData,
  reshapeBooking,
  type CoreBookingDetail,
  type Json,
  type Me,
} from "../_shared/index.js";
import { ParticipantDashboardDataSchema } from "../../openapi/schemas.js";

/**
 * Participant dashboard. Fans out four Core reads in parallel:
 * - profile (required — throws → mapped by withSession on auth failure)
 * - next confirmed tour (best-effort → null on failure)
 * - upcoming bookings list (best-effort → [] on failure)
 * - pending actions counts (best-effort → null on failure)
 */
export async function participantDashboard(res: Response, core: CoreClient, me: Me): Promise<void> {
  const [participant, nextTourRaw, upcomingRaw, pendingActions] = await Promise.all([
    core.getParticipantProfile<Json>(),
    core.getNextTour<CoreBookingDetail | null>().catch(() => null),
    core.getUpcomingBookings<CoreBookingDetail[] | null>().catch(() => null),
    core.getPendingActions<Json>().catch(() => null),
  ]);
  sendData(
    res,
    {
      kind: "participant",
      participant,
      nextTour: nextTourRaw ? reshapeBooking(nextTourRaw) : null,
      upcomingBookings: (upcomingRaw ?? []).map(reshapeBooking),
      pendingActions,
      createdAt: me.user.createdAt,
    },
    ParticipantDashboardDataSchema,
  );
}
