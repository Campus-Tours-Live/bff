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

bookingsRoutes.post("/participant/bookings", csrfGuard, withMutation(createBooking));
bookingsRoutes.post("/participant/bookings/:id/cancel", csrfGuard, withMutation(cancelBooking));
bookingsRoutes.get("/participant/cart", withSession(getCart));
bookingsRoutes.post("/participant/cart/items", csrfGuard, withMutation(addCartItem));
bookingsRoutes.delete("/participant/cart/items/:id", csrfGuard, withMutation(removeCartItem));
bookingsRoutes.post("/participant/cart/checkout", csrfGuard, withMutation(checkout));
