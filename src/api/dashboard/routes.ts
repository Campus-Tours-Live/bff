import { Router } from "express";
import { getDashboard } from "./dashboard.handler.js";

/** Route table (data only) — handler logic lives in dashboard.handler.ts. */
export const dashboardRoutes: Router = Router();
dashboardRoutes.get("/dashboard", getDashboard);
