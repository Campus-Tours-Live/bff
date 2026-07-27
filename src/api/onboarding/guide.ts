import type { Progress } from "./types.js";

/**
 * The "has submitted" guideStatus values under Profile Contract v2 Phase 4
 * (verification-driven lifecycle). There is no `DRAFT` value anymore — a guide profile
 * either doesn't exist yet (`guideStatus` null, not started) or has already been
 * submitted, landing directly in one of these three statuses.
 */
const SUBMITTED_STATUSES = new Set(["PENDING", "VERIFIED", "REJECTED"]);

/**
 * Guide onboarding progress — COARSE for now, derived from the guide profile's
 * `guideStatus` alone (Profile Contract v2 — /userinfo no longer carries
 * `guideStatus`, so the handler fetches /guide/profile and passes its
 * `guideStatus` in; null when there's no guide profile yet). The
 * verification-level detail (verificationStatus + field-by-field checklist) is
 * DEFERRED until guide verification is built; verificationStatus stays null and the
 * checklist collapses to the submit step meanwhile.
 */
export function guideProgress(guideStatus: string | null): Progress {
  const status = guideStatus; // null if no guide profile yet
  const submitted = status !== null && SUBMITTED_STATUSES.has(status);
  return {
    role: "guide",
    started: status !== null,
    complete: submitted,
    canSubmit: !submitted, // coarse — field-level gating returns with /guide/profile
    guideStatus: status,
    verificationStatus: null, // deferred
    steps: [{ key: "submitted", label: "Application submitted", done: submitted }],
  };
}
