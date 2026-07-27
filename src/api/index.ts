import { Router } from "express";
import { dashboardRoutes } from "./dashboard/routes.js";
import { onboardingRoutes } from "./onboarding/routes.js";
import { bookingsRoutes } from "./bookings/routes.js";
import { cartRoutes } from "./cart/routes.js";
import { availabilityRoutes } from "./availability/routes.js";
import { publicTourRoutes } from "./public-tours/routes.js";
import { userinfoRoutes } from "./userinfo/routes.js";
import { sessionRoutes } from "./session/routes.js";

/**
 * BFF aggregation API — front-end-shaped composites the Core does not expose directly.
 * Each feature owns a folder (routes + handler + per-role processors), flattened here
 * into one router. Mounted under /v1 BEFORE the generic coreProxy so these specific
 * paths win over the catch-all passthrough.
 */
export const apiRouter: Router = Router();
// Deliberately public, exact GET-only discovery routes. They must be registered before the
// authenticated catch-all core proxy in app.ts.
apiRouter.use(publicTourRoutes);
apiRouter.use(userinfoRoutes);
apiRouter.use(sessionRoutes);
apiRouter.use(dashboardRoutes);
apiRouter.use(onboardingRoutes);
apiRouter.use(bookingsRoutes);
apiRouter.use(cartRoutes);
apiRouter.use(availabilityRoutes);
