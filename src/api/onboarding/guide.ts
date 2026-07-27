import type { Progress } from "./types.js";

/**
 * Guide onboarding progress — COARSE for now, derived from the guide profile's
 * `applicationStatus` alone (Profile Contract v2 — /userinfo no longer carries
 * `guideStatus`, so the handler fetches /guide/profile and passes its
 * `applicationStatus` in; null when there's no guide profile yet). The
 * verification-level detail (verificationStatus + field-by-field checklist) is
 * DEFERRED until guide verification is built; verificationStatus stays null and the
 * checklist collapses to the submit step meanwhile.
 */
export function guideProgress(applicationStatus: string | null): Progress {
  const status = applicationStatus; // null if no guide profile yet
  const submitted = status !== null && status !== "DRAFT";
  return {
    role: "guide",
    started: status !== null,
    complete: submitted,
    canSubmit: !submitted, // coarse — field-level gating returns with /guide/profile
    applicationStatus: status,
    verificationStatus: null, // deferred
    steps: [{ key: "submitted", label: "Application submitted", done: submitted }],
  };
}
