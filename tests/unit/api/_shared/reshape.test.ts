import { reshapeBooking } from "@/api/_shared/reshape.js";

const core = {
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

describe("reshapeBooking", () => {
  it("renames, computes scheduledEndAt, and builds price{amount,currency}", () => {
    expect(reshapeBooking(core)).toEqual({
      id: "b1",
      status: "WAITING_FOR_GUIDE",
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
  });

  it("strips millis on both times and computes end from a non-60 duration; passes the deadline", () => {
    const out = reshapeBooking({
      ...core,
      scheduledAt: "2026-08-01T15:00:00.500Z",
      durationMin: 90,
      guideResponseDeadline: "2026-07-30T15:00:00Z",
    });
    expect(out.scheduledStartAt).toBe("2026-08-01T15:00:00Z"); // millis stripped
    expect(out.scheduledEndAt).toBe("2026-08-01T16:30:00Z"); // +90min, stripped
    expect(out.durationMinutes).toBe(90);
    expect(out.guideResponseDeadline).toBe("2026-07-30T15:00:00Z");
  });

  it("normalizes a non-UTC scheduledAt to UTC Z (same instant) for start and end", () => {
    const out = reshapeBooking({
      ...core,
      scheduledAt: "2026-08-01T11:00:00-04:00",
      durationMin: 60,
    });
    expect(out.scheduledStartAt).toBe("2026-08-01T15:00:00Z"); // 11:00-04:00 == 15:00Z
    expect(out.scheduledEndAt).toBe("2026-08-01T16:00:00Z");
  });
});
