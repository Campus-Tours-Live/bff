import { Router } from "express";
import { getOnboarding } from "./onboarding.handler.js";

/** Route table (data only) — handler logic lives in onboarding.handler.ts. */
export const onboardingRoutes: Router = Router();
onboardingRoutes.get("/onboarding", getOnboarding);
