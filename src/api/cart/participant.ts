import type { Request, Response } from "express";
import {
  sendData,
  writeOpts,
  reshapeBooking,
  reshapeCartItem,
  type CoreBookingDetail,
  type CoreCartItem,
  type CoreClient,
} from "../_shared/index.js";
import {
  BookingListSchema,
  CartItemListSchema,
  CartItemResponseSchema,
} from "../../openapi/schemas.js";

export async function getCart(_req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.get<CoreCartItem[] | null>("/cart");
  sendData(res, (raw ?? []).map(reshapeCartItem), CartItemListSchema);
}

export async function addCartItem(req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.post<CoreCartItem>("/cart/items", req.body, writeOpts(req, res));
  sendData(res, reshapeCartItem(raw), CartItemResponseSchema);
}

export async function removeCartItem(req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.del<CoreCartItem[] | null>(
    `/cart/items/${req.params.id}`,
    writeOpts(req, res),
  );
  sendData(res, (raw ?? []).map(reshapeCartItem), CartItemListSchema);
}

export async function checkout(req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.post<CoreBookingDetail[] | null>(
    "/cart/checkout",
    {},
    writeOpts(req, res),
  );
  sendData(res, (raw ?? []).map(reshapeBooking), BookingListSchema);
}
