import { Router } from "express";
import { withSession, withMutation } from "../_shared/index.js";
import { csrfGuard } from "../../util/csrf.js";
import {
  createBooking,
  cancelBooking,
  getCart,
  addCartItem,
  removeCartItem,
  checkout,
} from "./participant.handler.js";

/** Participant booking + cart — Contract-A reshapes of the Core /bookings + /cart resource. */
export const participantBookingRoutes: Router = Router();

participantBookingRoutes.post("/participant/bookings", csrfGuard, withMutation(createBooking));
participantBookingRoutes.post(
  "/participant/bookings/:id/cancel",
  csrfGuard,
  withMutation(cancelBooking),
);
participantBookingRoutes.get("/participant/cart", withSession(getCart));
participantBookingRoutes.post("/participant/cart/items", csrfGuard, withMutation(addCartItem));
participantBookingRoutes.delete(
  "/participant/cart/items/:id",
  csrfGuard,
  withMutation(removeCartItem),
);
participantBookingRoutes.post("/participant/cart/checkout", csrfGuard, withMutation(checkout));
