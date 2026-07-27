/** Guide `applicationStatus` value that gates offering publish (Core's `TourOfferingService
 *  .publish()` check). Single place to flip: Phase 1 (admin-review lifecycle) uses
 *  `"APPROVED"`; Profile Contract v2 Phase 4 (verification-driven lifecycle) flips this to
 *  `"VERIFIED"` once Core's status model migrates (backend design doc
 *  `2026-07-27-profile-contract-v2-design.md`, decision 10). */
export const PUBLISHABLE_STATUS = "APPROVED";
