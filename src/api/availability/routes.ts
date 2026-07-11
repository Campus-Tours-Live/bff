import { Router } from "express";
import { withSession, withMutation } from "../_shared/index.js";
import { csrfGuard } from "../../util/csrf.js";
import {
  getRules,
  createRule,
  updateRule,
  deleteRule,
  getExceptions,
  createException,
  updateException,
  deleteException,
  getSettings,
  updateSettings,
} from "./handlers.js";

/**
 * Generic guide-availability CRUD (rules / exceptions / settings) — a thin Contract-A
 * reshape of Core's `/availability/*` resource (CTL-54). Role is enforced by Core's authz,
 * not this router, so these paths carry no audience prefix (mirrors the CTL-38
 * bookings/cart module). Reads go through `withSession`; writes through `csrfGuard` +
 * `withMutation` so a bad Core write (e.g. 422 "overlapping rule") relays verbatim.
 */
export const availabilityRoutes: Router = Router();

availabilityRoutes.get("/availability/rules", withSession(getRules));
availabilityRoutes.post("/availability/rules", csrfGuard, withMutation(createRule));
availabilityRoutes.patch("/availability/rules/:id", csrfGuard, withMutation(updateRule));
availabilityRoutes.delete("/availability/rules/:id", csrfGuard, withMutation(deleteRule));

availabilityRoutes.get("/availability/exceptions", withSession(getExceptions));
availabilityRoutes.post("/availability/exceptions", csrfGuard, withMutation(createException));
availabilityRoutes.patch("/availability/exceptions/:id", csrfGuard, withMutation(updateException));
availabilityRoutes.delete("/availability/exceptions/:id", csrfGuard, withMutation(deleteException));

availabilityRoutes.get("/availability/settings", withSession(getSettings));
availabilityRoutes.patch("/availability/settings", csrfGuard, withMutation(updateSettings));
