import type { Me } from "@/api/_shared/index.js";
import { guideProgress } from "@/api/onboarding/guide.js";

function makeMe(over: Partial<Me> = {}): Me {
  return {
    roles: [],
    activeRole: null,
    participantType: null,
    guideStatus: null,
    ...over,
  } as Me;
}

describe("guideProgress", () => {
  it("null guideStatus → not started, not complete, canSubmit true", () => {
    const p = guideProgress(makeMe({ guideStatus: null }));
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
    const p = guideProgress(makeMe({ guideStatus: "DRAFT" }));
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
      const p = guideProgress(makeMe({ guideStatus: status }));
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
      expect(guideProgress(makeMe({ guideStatus: status })).verificationStatus).toBeNull();
    }
  });

  it("steps reflect submitted state", () => {
    expect(guideProgress(makeMe({ guideStatus: null })).steps).toEqual([
      { key: "submitted", label: "Application submitted", done: false },
    ]);
    expect(guideProgress(makeMe({ guideStatus: "APPROVED" })).steps).toEqual([
      { key: "submitted", label: "Application submitted", done: true },
    ]);
  });
});
