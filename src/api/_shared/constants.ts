/** Guide `applicationStatus` value that gates offering publish (Core's `TourOfferingService
 *  .publish()` check). Single place to flip: Phase 1 (admin-review lifecycle) used
 *  `"APPROVED"`; Profile Contract v2 Phase 4 (verification-driven lifecycle) flips this to
 *  `"VERIFIED"` now that Core's status model has migrated (backend design doc
 *  `2026-07-27-profile-contract-v2-design.md`, decision 10). */
export const PUBLISHABLE_STATUS = "VERIFIED";
