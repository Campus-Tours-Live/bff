import type { Me } from "../_shared/index.js";
import type { Progress } from "./types.js";

/**
 * Guide onboarding progress — COARSE for now, derived from /userinfo alone
 * (guideStatus = application_status, plus the held role). The verification-level
 * detail (verificationStatus + field-by-field checklist) needs /guide/profile and is
 * DEFERRED until guide verification is built; verificationStatus stays null and the
 * checklist collapses to the submit step meanwhile.
 */
export function guideProgress(me: Me): Progress {
  const status = me.guideStatus; // = application_status (null if no guide profile yet)
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
