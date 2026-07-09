import { reshapeBooking } from "@/api/bookings/reshape.js";

const core = {
  id: "b1",
  status: "WAITING_FOR_GUIDE",
  scheduledAt: "2026-08-01T15:00:00Z",
  timezone: "America/Los_Angeles",
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
      displayTimeZone: "America/Los_Angeles",
      durationMinutes: 60,
      tourOfferingId: "o1",
      tourTitle: "North Campus",
      guideName: "Maya",
      guideResponseDeadline: null,
      universityName: "NCU",
      price: { amount: 4200, currency: "USD" },
    });
  });
});
