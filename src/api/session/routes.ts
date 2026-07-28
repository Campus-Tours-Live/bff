import { Router } from "express";
import { setCurrentRole } from "./current-role.handler.js";
import { csrfGuard } from "../../util/csrf.js";

/** Route table (data only) — handler logic lives in current-role.handler.ts.
 *  CSRF-guarded: a state-changing POST that a cross-site form/fetch could otherwise forge. */
export const sessionRoutes: Router = Router();
sessionRoutes.post("/session/current-role", csrfGuard, setCurrentRole);
