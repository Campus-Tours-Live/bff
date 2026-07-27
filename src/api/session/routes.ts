import { Router } from "express";
import { setActiveRole } from "./active-role.handler.js";
import { csrfGuard } from "../../util/csrf.js";

/** Route table (data only) — handler logic lives in active-role.handler.ts. CSRF-guarded:
 *  a state-changing POST that a cross-site form/fetch could otherwise forge. */
export const sessionRoutes: Router = Router();
sessionRoutes.post("/session/active-role", csrfGuard, setActiveRole);
