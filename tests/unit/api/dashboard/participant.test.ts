import { describe, expect, it, jest } from "@jest/globals";
import type { Response } from "express";
import type { CoreClient, Me } from "@/api/_shared/index.js";
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

const ME: Me = { createdAt: "2025-03-15T00:00:00Z" } as unknown as Me;

/** Full happy-path mock — all four Core calls succeed. */
function mockCore(overrides: Partial<Record<keyof CoreClient, jest.Mock>> = {}): CoreClient {
  return {
    getParticipantProfile: jest.fn().mockResolvedValue({ id: "p1", displayName: "Sam" }),
    getNextTour: jest.fn().mockResolvedValue({ id: "b1", displayStatus: "CONFIRMED" }),
    getUpcomingBookings: jest.fn().mockResolvedValue([{ id: "b2", displayStatus: "CONFIRMED" }]),
    getPendingActions: jest
      .fn()
      .mockResolvedValue({ paymentsToFinish: 0, waitingForGuide: 1, reviewsToWrite: 0 }),
    ...overrides,
  } as unknown as CoreClient;
}

describe("participantDashboard", () => {
  it("sends the full participant envelope when all Core calls succeed", async () => {
    const res = mockRes();
    await participantDashboard(res as unknown as Response, mockCore(), ME);

    const body = JSON.parse(res.body as string).data;
    expect(body.kind).toBe("participant");
    expect(body.participant).toEqual({ id: "p1", displayName: "Sam" });
    expect(body.nextTour).toEqual({ id: "b1", displayStatus: "CONFIRMED" });
    expect(body.upcomingBookings).toEqual([{ id: "b2", displayStatus: "CONFIRMED" }]);
    expect(body.pendingActions).toEqual({
      paymentsToFinish: 0,
      waitingForGuide: 1,
      reviewsToWrite: 0,
    });
    expect(body.createdAt).toBe("2025-03-15T00:00:00Z");
  });

  it("propagates a rejection from getParticipantProfile (required read)", async () => {
    const core = mockCore({
      getParticipantProfile: jest.fn().mockRejectedValue(new Error("401")),
    } as Partial<Record<keyof CoreClient, jest.Mock>>);

    const res = mockRes();
    await expect(participantDashboard(res as unknown as Response, core, ME)).rejects.toThrow("401");
  });

  it("degrades nextTour to null when getNextTour fails (best-effort)", async () => {
    const core = mockCore({
      getNextTour: jest.fn().mockRejectedValue(new Error("503")),
    } as Partial<Record<keyof CoreClient, jest.Mock>>);

    const res = mockRes();
    await participantDashboard(res as unknown as Response, core, ME);

    expect(JSON.parse(res.body as string).data.nextTour).toBeNull();
  });

  it("degrades upcomingBookings to [] when getUpcomingBookings fails (best-effort)", async () => {
    const core = mockCore({
      getUpcomingBookings: jest.fn().mockRejectedValue(new Error("503")),
    } as Partial<Record<keyof CoreClient, jest.Mock>>);

    const res = mockRes();
    await participantDashboard(res as unknown as Response, core, ME);

    expect(JSON.parse(res.body as string).data.upcomingBookings).toEqual([]);
  });

  it("degrades pendingActions to null when getPendingActions fails (best-effort)", async () => {
    const core = mockCore({
      getPendingActions: jest.fn().mockRejectedValue(new Error("503")),
    } as Partial<Record<keyof CoreClient, jest.Mock>>);

    const res = mockRes();
    await participantDashboard(res as unknown as Response, core, ME);

    expect(JSON.parse(res.body as string).data.pendingActions).toBeNull();
  });

  it("still sends the response when all three booking calls fail", async () => {
    const core = mockCore({
      getNextTour: jest.fn().mockRejectedValue(new Error("down")),
      getUpcomingBookings: jest.fn().mockRejectedValue(new Error("down")),
      getPendingActions: jest.fn().mockRejectedValue(new Error("down")),
    } as Partial<Record<keyof CoreClient, jest.Mock>>);

    const res = mockRes();
    await participantDashboard(res as unknown as Response, core, ME);

    const body = JSON.parse(res.body as string).data;
    expect(body.kind).toBe("participant");
    expect(body.participant).toEqual({ id: "p1", displayName: "Sam" });
    expect(body.nextTour).toBeNull();
    expect(body.upcomingBookings).toEqual([]);
    expect(body.pendingActions).toBeNull();
  });
});
