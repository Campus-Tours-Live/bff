import { Router } from "express";
import { withMutation } from "../_shared/index.js";
import { csrfGuard } from "../../util/csrf.js";
import { createBooking, cancelBooking } from "./participant.js";

/** Participant booking actions — Contract-A reshapes of the generic Core /bookings resource. */
export const bookingsRoutes: Router = Router();

bookingsRoutes.post("/bookings", csrfGuard, withMutation(createBooking));
bookingsRoutes.post("/bookings/:id/cancel", csrfGuard, withMutation(cancelBooking));
