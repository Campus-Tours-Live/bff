import { Router } from "express";
import { getPublicTourCatalog, getPublicTourDetail } from "./handlers.js";

/**
 * Anonymous marketplace discovery allowlist. Do not add availability, slots, or booking routes
 * here: those require a session and remain behind their role-aware handlers/Core authorization.
 */
export const publicTourRoutes: Router = Router();
publicTourRoutes.get("/tours", getPublicTourCatalog);
publicTourRoutes.get("/tours/:tourId", getPublicTourDetail);
