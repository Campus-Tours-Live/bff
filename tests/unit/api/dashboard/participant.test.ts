import { describe, expect, it, jest } from "@jest/globals";
import type { Response } from "express";
import type { CoreClient, Json, Me } from "@/api/_shared/index.js";
import { participantDashboard } from "@/api/dashboard/participant.js";

function mockRes() {
  const res = {
    body: undefined as unknown,
    type(_t: string) {
      return res;
    },
    send(b: string) {
      res.body = b;
      return res;
    },
    getHeader(_n: string): string | undefined {
      return undefined;
    },
  };
  return res;
}

describe("participantDashboard", () => {
  it("sends a participant envelope with the participant profile", async () => {
    const participant: Json = { id: "p1", displayName: "Sam" };
    const core = {
      getParticipantProfile: jest.fn().mockResolvedValue(participant),
    } as unknown as CoreClient;

    const me = { createdAt: "2025-03-15T00:00:00Z" } as unknown as Me;
    const res = mockRes();
    await participantDashboard(res as unknown as Response, core, me);

    expect(JSON.parse(res.body as string).data).toEqual({
      kind: "participant",
      participant,
      createdAt: "2025-03-15T00:00:00Z",
    });
  });

  it("propagates a rejection from getParticipantProfile (required read)", async () => {
    const core = {
      getParticipantProfile: jest.fn().mockRejectedValue(new Error("401")),
    } as unknown as CoreClient;

    const me = { createdAt: "2025-03-15T00:00:00Z" } as unknown as Me;
    const res = mockRes();
    await expect(participantDashboard(res as unknown as Response, core, me)).rejects.toThrow("401");
  });
});
