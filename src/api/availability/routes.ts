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
  getAvailability,
  getOverridePreview,
  getOverrideMultiPreview,
} from "./handlers.js";
import { getSlots } from "./participant.js";

/**
 * Generic guide-availability CRUD (rules / exceptions / settings) — a thin Contract-A
 * reshape of Core's `/availability/*` resource (CTL-54). Role is enforced by Core's authz,
 * not this router, so these paths carry no audience prefix (mirrors the CTL-38
 * bookings/cart module). Reads go through `withSession`; writes through `csrfGuard` +
 * `withMutation` so a bad Core write (e.g. 422 "overlapping rule") relays verbatim.
 */
export const availabilityRoutes: Router = Router();

// The resolved-availability read (Task 3 — the CTL-55 contract): rules + coalesced
// occurrences + DST gap-days. This is the bare collection path, distinct from the
// `/availability/rules|exceptions|settings` sub-resources below — Express matches each
// route by its exact literal path, so the bare `/availability` here is never shadowed by
// (nor shadows) the more specific sub-paths, regardless of registration order.
availabilityRoutes.get("/availability", withSession(getAvailability));

// The date-specific override dry-run preview (CTL-56 v2.1 Task 1): a read-only, non-persisting
// preview of a proposed override, reshaped the same way as the resolved read above. Another
// distinct literal path — `/availability/preview` is never shadowed by nor shadows the bare
// `/availability` above or the `/availability/rules|exceptions|settings` sub-paths below.
availabilityRoutes.get("/availability/preview", withSession(getOverridePreview));

// The MULTI-window override dry-run preview (CTL-56 Phase 2): same read semantics as the
// GET preview above, but `windows[]` doesn't fit a query string, so it travels as a POST
// body. GET and POST coexist on this identical literal path (Express dispatches by method).
// No `csrfGuard`, deliberately — this is a read (nothing is persisted), same as the GET
// above; see the rationale on `getOverrideMultiPreview` in handlers.ts.
availabilityRoutes.post("/availability/preview", withSession(getOverrideMultiPreview));

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

// Participant slots (Task 4): a DIFFERENT resource path (`/offerings/:id/slots`), outside
// the `/availability` sub-tree above. Registered here (in `apiRouter`, before the generic
// `coreProxy`) so this specific path is reshaped; every other `/v1/offerings/*` request
// still falls through to the catch-all passthrough. Role PARTICIPANT is enforced by Core.
availabilityRoutes.get("/offerings/:id/slots", withSession(getSlots));
