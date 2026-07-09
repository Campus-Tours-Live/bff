import type { Request, Response } from "express";
import {
  sendData,
  writeOpts,
  reshapeBooking,
  type CoreBookingDetail,
  type CoreClient,
} from "../_shared/index.js";
import { BookingResponseSchema, BookingListSchema } from "../../openapi/schemas.js";

export async function getCart(_req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.get<CoreBookingDetail[]>("/cart");
  sendData(res, raw.map(reshapeBooking), BookingListSchema);
}

export async function addCartItem(req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.post<CoreBookingDetail>("/cart/items", req.body, writeOpts(req, res));
  sendData(res, reshapeBooking(raw), BookingResponseSchema);
}

export async function removeCartItem(req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.del<CoreBookingDetail[]>(
    `/cart/items/${req.params.id}`,
    writeOpts(req, res),
  );
  sendData(res, raw.map(reshapeBooking), BookingListSchema);
}

export async function checkout(req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.post<CoreBookingDetail[]>("/cart/checkout", {}, writeOpts(req, res));
  sendData(res, raw.map(reshapeBooking), BookingListSchema);
}
