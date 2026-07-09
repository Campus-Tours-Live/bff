import { Router } from "express";
import { withSession, withMutation } from "../_shared/index.js";
import { csrfGuard } from "../../util/csrf.js";
import { getCart, addCartItem, removeCartItem, checkout } from "./participant.js";

/** Participant cart — Contract-A reshapes of the generic Core /cart resource (cart items are DRAFT bookings). */
export const cartRoutes: Router = Router();

cartRoutes.get("/cart", withSession(getCart));
cartRoutes.post("/cart/items", csrfGuard, withMutation(addCartItem));
cartRoutes.delete("/cart/items/:id", csrfGuard, withMutation(removeCartItem));
cartRoutes.post("/cart/checkout", csrfGuard, withMutation(checkout));
