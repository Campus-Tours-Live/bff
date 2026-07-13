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
    getParticipantProfile: jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ id: "p1", displayName: "Sam" }),
    getNextTour: jest.fn<() => Promise<unknown>>().mockResolvedValue({
      id: "b1",
      status: "CONFIRMED",
      scheduledAt: "2026-08-01T15:00:00Z",
      offeringId: "o1",
      offeringTitle: "North Campus",
      guideName: "Maya",
      guideResponseDeadline: null,
      universityName: "NCU",
      durationMin: 60,
      priceCents: 4200,
      currency: "USD",
    }),
    getUpcomingBookings: jest.fn<() => Promise<unknown>>().mockResolvedValue([
      {
        id: "b2",
        status: "CONFIRMED",
        scheduledAt: "2026-08-01T15:00:00Z",
        offeringId: "o1",
        offeringTitle: "North Campus",
        guideName: "Maya",
        guideResponseDeadline: null,
        universityName: "NCU",
        durationMin: 60,
        priceCents: 4200,
        currency: "USD",
      },
    ]),
    getPendingActions: jest
      .fn<() => Promise<unknown>>()
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
    expect(body.nextTour).toEqual({
      id: "b1",
      status: "CONFIRMED",
      scheduledStartAt: "2026-08-01T15:00:00Z",
      scheduledEndAt: "2026-08-01T16:00:00Z",
      durationMinutes: 60,
      tourOfferingId: "o1",
      tourTitle: "North Campus",
      guideName: "Maya",
      guideResponseDeadline: null,
      universityName: "NCU",
      price: { amount: 4200, currency: "USD" },
    });
    expect(body.upcomingBookings).toEqual([
      {
        id: "b2",
        status: "CONFIRMED",
        scheduledStartAt: "2026-08-01T15:00:00Z",
        scheduledEndAt: "2026-08-01T16:00:00Z",
        durationMinutes: 60,
        tourOfferingId: "o1",
        tourTitle: "North Campus",
        guideName: "Maya",
        guideResponseDeadline: null,
        universityName: "NCU",
        price: { amount: 4200, currency: "USD" },
      },
    ]);
    expect(body.pendingActions).toEqual({
      paymentsToFinish: 0,
      waitingForGuide: 1,
      reviewsToWrite: 0,
    });
    expect(body.createdAt).toBe("2025-03-15T00:00:00Z");
  });

  it("propagates a rejection from getParticipantProfile (required read)", async () => {
    const core = mockCore({
      getParticipantProfile: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("401")),
    } as Partial<Record<keyof CoreClient, jest.Mock>>);

    const res = mockRes();
    await expect(participantDashboard(res as unknown as Response, core, ME)).rejects.toThrow("401");
  });

  it("degrades nextTour to null when getNextTour fails (best-effort)", async () => {
    const core = mockCore({
      getNextTour: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("503")),
    } as Partial<Record<keyof CoreClient, jest.Mock>>);

    const res = mockRes();
    await participantDashboard(res as unknown as Response, core, ME);

    expect(JSON.parse(res.body as string).data.nextTour).toBeNull();
  });

  it("degrades upcomingBookings to [] when getUpcomingBookings fails (best-effort)", async () => {
    const core = mockCore({
      getUpcomingBookings: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("503")),
    } as Partial<Record<keyof CoreClient, jest.Mock>>);

    const res = mockRes();
    await participantDashboard(res as unknown as Response, core, ME);

    expect(JSON.parse(res.body as string).data.upcomingBookings).toEqual([]);
  });

  it("degrades pendingActions to null when getPendingActions fails (best-effort)", async () => {
    const core = mockCore({
      getPendingActions: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("503")),
    } as Partial<Record<keyof CoreClient, jest.Mock>>);

    const res = mockRes();
    await participantDashboard(res as unknown as Response, core, ME);

    expect(JSON.parse(res.body as string).data.pendingActions).toBeNull();
  });

  it("still sends the response when all three booking calls fail", async () => {
    const core = mockCore({
      getNextTour: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("down")),
      getUpcomingBookings: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("down")),
      getPendingActions: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("down")),
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
