import type { Me } from "@/api/_shared/index.js";
import { participantProgress } from "@/api/onboarding/participant.js";

function makeMe(over: Partial<Me> = {}): Me {
  return {
    roles: [],
    activeRole: null,
    participantType: null,
    guideStatus: null,
    ...over,
  } as Me;
}

describe("participantProgress", () => {
  it("complete + started when roles includes PARTICIPANT", () => {
    const p = participantProgress(makeMe({ roles: ["PARTICIPANT"] }));
    expect(p).toMatchObject({
      role: "participant",
      complete: true,
      started: true,
      canSubmit: false,
      applicationStatus: null,
      verificationStatus: null,
    });
  });

  it("not complete but started when participantType is set and role absent", () => {
    const p = participantProgress(makeMe({ roles: [], participantType: "HIGH_SCHOOL" }));
    expect(p).toMatchObject({ complete: false, started: true, canSubmit: true });
  });

  it("not started when no role and participantType null", () => {
    const p = participantProgress(makeMe({ roles: ["GUIDE"], participantType: null }));
    expect(p).toMatchObject({ complete: false, started: false, canSubmit: true });
  });

  it("applicationStatus and verificationStatus are null", () => {
    const p = participantProgress(makeMe({ roles: ["PARTICIPANT"] }));
    expect(p.applicationStatus).toBeNull();
    expect(p.verificationStatus).toBeNull();
  });

  it("steps reflect complete state", () => {
    expect(participantProgress(makeMe({ roles: ["PARTICIPANT"] })).steps).toEqual([
      { key: "profile", label: "Your details", done: true },
    ]);
    expect(participantProgress(makeMe()).steps).toEqual([
      { key: "profile", label: "Your details", done: false },
    ]);
  });

  it("not complete / not started when roles is missing entirely (defensive null-guard)", () => {
    const me = { ...makeMe(), roles: undefined as unknown as Me["roles"] };
    expect(participantProgress(me)).toMatchObject({ complete: false, started: false });
  });
});
