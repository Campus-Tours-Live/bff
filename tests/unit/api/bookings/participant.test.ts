import { describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import type { CoreClient } from "@/api/_shared/index.js";
import { createBooking, cancelBooking } from "@/api/bookings/participant.js";

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

function sentData(res: { body: unknown }): unknown {
  return JSON.parse(res.body as string).data;
}

function mockReq(over: Partial<Record<string, unknown>> = {}): Request {
  return {
    params: {},
    body: {},
    header: () => undefined,
    ...over,
  } as unknown as Request;
}

const coreBooking = {
  id: "b1",
  status: "WAITING_FOR_GUIDE",
  scheduledAt: "2026-08-01T15:00:00Z",
  offeringId: "o1",
  offeringTitle: "North Campus",
  guideName: "Maya",
  guideResponseDeadline: null,
  universityName: "NCU",
  durationMin: 60,
  priceCents: 4200,
  currency: "USD",
};

describe("createBooking (participant)", () => {
  it("posts the body to /bookings and reshapes the response", async () => {
    const post = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(coreBooking);
    const core = { post } as unknown as CoreClient;
    const res = mockRes();
    const body = { tourOfferingId: "o1", scheduledStartAt: "2026-08-01T15:00:00Z" };
    const req = mockReq({ body });

    await createBooking(req, res as unknown as Response, core);

    expect(post).toHaveBeenCalledWith("/bookings", body, expect.any(Object));
    const data = sentData(res) as Record<string, unknown>;
    expect(data.id).toBe("b1");
    expect(data.price).toEqual({ amount: 4200, currency: "USD" });
    expect(data.scheduledEndAt).toBe("2026-08-01T16:00:00Z");
    expect(data.durationMinutes).toBe(60);
    expect(data.tourTitle).toBe("North Campus");
  });
});

describe("cancelBooking (participant)", () => {
  it("POSTs /bookings/:id/cancel when an id is present", async () => {
    const post = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ ...coreBooking, status: "CANCELLED" });
    const core = { post } as unknown as CoreClient;
    const res = mockRes();
    const req = mockReq({ params: { id: "b1" }, body: { reason: "changed plans" } });

    await cancelBooking(req, res as unknown as Response, core);

    expect(post).toHaveBeenCalledWith(
      "/bookings/b1/cancel",
      { reason: "changed plans" },
      expect.any(Object),
    );
    const data = sentData(res) as Record<string, unknown>;
    expect(data.id).toBe("b1");
    expect(data.status).toBe("CANCELLED");
  });

  it("defensively falls back to an empty id segment when req.params.id is absent", async () => {
    const post = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(coreBooking);
    const core = { post } as unknown as CoreClient;
    const res = mockRes();

    await cancelBooking(mockReq(), res as unknown as Response, core);

    expect(post).toHaveBeenCalledWith("/bookings//cancel", {}, expect.any(Object));
  });
});
