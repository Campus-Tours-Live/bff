import { guideProgress } from "@/api/onboarding/guide.js";

describe("guideProgress", () => {
  it("null guideStatus (no guide profile yet) → not started, not complete, canSubmit true", () => {
    const p = guideProgress(null);
    expect(p).toMatchObject({
      role: "guide",
      started: false,
      complete: false,
      canSubmit: true,
      guideStatus: null,
      verificationStatus: null,
    });
  });

  it.each(["PENDING", "VERIFIED", "REJECTED"])(
    "%s → submitted = complete, canSubmit false",
    (status) => {
      const p = guideProgress(status);
      expect(p).toMatchObject({
        started: true,
        complete: true,
        canSubmit: false,
        guideStatus: status,
        verificationStatus: null,
      });
    },
  );

  it("an unrecognized guideStatus value is treated as started but not submitted", () => {
    // Defensive: there is no DRAFT value anymore under {PENDING,VERIFIED,REJECTED}, but the
    // positive SUBMITTED_STATUSES check (rather than `!== "DRAFT"`) means a stale/unexpected
    // value doesn't get incorrectly treated as "submitted".
    const p = guideProgress("SOME_UNKNOWN_STATUS");
    expect(p).toMatchObject({
      started: true,
      complete: false,
      canSubmit: true,
      guideStatus: "SOME_UNKNOWN_STATUS",
      verificationStatus: null,
    });
  });

  it("verificationStatus is always null (deferred)", () => {
    for (const status of [null, "PENDING", "VERIFIED", "REJECTED"]) {
      expect(guideProgress(status).verificationStatus).toBeNull();
    }
  });

  it("steps reflect submitted state", () => {
    expect(guideProgress(null).steps).toEqual([
      { key: "submitted", label: "Application submitted", done: false },
    ]);
    expect(guideProgress("VERIFIED").steps).toEqual([
      { key: "submitted", label: "Application submitted", done: true },
    ]);
  });
});
