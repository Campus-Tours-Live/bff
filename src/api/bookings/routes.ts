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
} from "./participant.js";

/** Participant booking + cart — Contract-A reshapes of the Core /bookings + /cart resource. */
export const bookingsRoutes: Router = Router();

bookingsRoutes.post("/bookings", csrfGuard, withMutation(createBooking));
bookingsRoutes.post("/bookings/:id/cancel", csrfGuard, withMutation(cancelBooking));
bookingsRoutes.get("/cart", withSession(getCart));
bookingsRoutes.post("/cart/items", csrfGuard, withMutation(addCartItem));
bookingsRoutes.delete("/cart/items/:id", csrfGuard, withMutation(removeCartItem));
bookingsRoutes.post("/cart/checkout", csrfGuard, withMutation(checkout));
