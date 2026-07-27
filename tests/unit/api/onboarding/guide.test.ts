import { guideProgress } from "@/api/onboarding/guide.js";

describe("guideProgress", () => {
  it("null applicationStatus (no guide profile yet) → not started, not complete, canSubmit true", () => {
    const p = guideProgress(null);
    expect(p).toMatchObject({
      role: "guide",
      started: false,
      complete: false,
      canSubmit: true,
      applicationStatus: null,
      verificationStatus: null,
    });
  });

  it("DRAFT → started, not complete, canSubmit true", () => {
    const p = guideProgress("DRAFT");
    expect(p).toMatchObject({
      started: true,
      complete: false,
      canSubmit: true,
      applicationStatus: "DRAFT",
      verificationStatus: null,
    });
  });

  it.each(["PENDING_REVIEW", "APPROVED", "REJECTED"])(
    "%s → submitted = complete, canSubmit false",
    (status) => {
      const p = guideProgress(status);
      expect(p).toMatchObject({
        started: true,
        complete: true,
        canSubmit: false,
        applicationStatus: status,
        verificationStatus: null,
      });
    },
  );

  it("verificationStatus is always null (deferred)", () => {
    for (const status of [null, "DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED"]) {
      expect(guideProgress(status).verificationStatus).toBeNull();
    }
  });

  it("steps reflect submitted state", () => {
    expect(guideProgress(null).steps).toEqual([
      { key: "submitted", label: "Application submitted", done: false },
    ]);
    expect(guideProgress("APPROVED").steps).toEqual([
      { key: "submitted", label: "Application submitted", done: true },
    ]);
  });
});
