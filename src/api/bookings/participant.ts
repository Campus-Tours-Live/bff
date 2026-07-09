import type { Request, Response } from "express";
import {
  sendData,
  writeOpts,
  reshapeBooking,
  type CoreBookingDetail,
  type CoreClient,
} from "../_shared/index.js";
import { BookingResponseSchema } from "../../openapi/schemas.js";

export async function createBooking(req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.post<CoreBookingDetail>("/bookings", req.body, writeOpts(req, res));
  sendData(res, reshapeBooking(raw), BookingResponseSchema);
}

export async function cancelBooking(req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.post<CoreBookingDetail>(
    `/bookings/${req.params.id}/cancel`,
    req.body,
    writeOpts(req, res),
  );
  sendData(res, reshapeBooking(raw), BookingResponseSchema);
}
