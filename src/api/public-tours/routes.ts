import { Router } from "express";
import {
  getPublicTourAvailabilityPreview,
  getPublicTourCatalog,
  getPublicTourDetail,
} from "./handlers.js";

/**
 * Anonymous marketplace discovery allowlist. The preview is deliberately summary-only; concrete
 * bookable slots and booking writes remain behind their role-aware session handlers.
 */
export const publicTourRoutes: Router = Router();
publicTourRoutes.get("/tours", getPublicTourCatalog);
publicTourRoutes.get("/tours/:tourId/availability-preview", getPublicTourAvailabilityPreview);
publicTourRoutes.get("/tours/:tourId", getPublicTourDetail);
