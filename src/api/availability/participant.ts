import type { Request, Response } from "express";
import { z } from "zod";
import { sendData, reshapeSlot, type CoreClient, type CoreSlot } from "../_shared/index.js";
import { AvailabilityOccurrenceSchema } from "../../openapi/schemas.js";

/**
 * Participant bookable-slots read (`GET /v1/offerings/:id/slots`) — a different resource
 * path from the `/availability*` sub-tree above (this route lives outside it, at
 * `/offerings/:id/slots`). Core enforces role PARTICIPANT (CTL-54 Task 8); the bff just
 * forwards the session bearer via `withSession` and relays whatever status Core returns.
 *
 * Reshapes each bookable slot's `startAt`/`endAt` to canonical UTC `Z` (CTL-49) via
 * {@link reshapeSlot}. `from`/`to` (optional ISO-date query params) are forwarded to Core
 * verbatim — same pattern as the resolved-availability read (Task 3): this handler does not
 * widen or validate the window itself.
 */
export async function getSlots(req: Request, res: Response, core: CoreClient): Promise<void> {
  const params = new URLSearchParams();
  const { from, to } = req.query;
  if (typeof from === "string") params.set("from", from);
  if (typeof to === "string") params.set("to", to);
  const qs = params.toString();
  const raw = await core.get<CoreSlot[]>(`/offerings/${req.params.id}/slots${qs ? `?${qs}` : ""}`);
  sendData(res, raw.map(reshapeSlot), z.array(AvailabilityOccurrenceSchema));
}
