import { Router } from "express";
import { withMutation } from "../_shared/index.js";
import { csrfGuard } from "../../util/csrf.js";
import { onboardingCommand } from "./handler.js";

/**
 * CTL-97 defer-provisioning onboarding commands. TWO CONCRETE routes, matching Core's
 * type-safe two-endpoint contract (`POST /users/me/roles/guide` and `.../participant`) — NOT a
 * generic `:role` param relying on a runtime allowlist. Registered on `apiRouter` (see
 * src/api/index.ts), which is mounted under `/v1` BEFORE the transparent `coreProxy` catch-all,
 * so these two specific paths are intercepted here; every OTHER `/users/me/roles/*` path (e.g.
 * a role this bff doesn't know) falls through untouched to the proxy.
 */
export const onboardingCommandRoutes: Router = Router();

onboardingCommandRoutes.post(
  "/users/me/roles/guide",
  csrfGuard,
  withMutation(onboardingCommand("guide")),
);
onboardingCommandRoutes.post(
  "/users/me/roles/participant",
  csrfGuard,
  withMutation(onboardingCommand("participant")),
);
