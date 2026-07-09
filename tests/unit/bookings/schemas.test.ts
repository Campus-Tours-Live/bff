import { BookingResponseSchema, CreateBookingRequestSchema } from "@/openapi/schemas.js";

const valid = {
  id: "b1",
  status: "CONFIRMED",
  scheduledStartAt: "2026-08-01T15:00:00Z",
  scheduledEndAt: "2026-08-01T16:00:00Z",
  displayTimeZone: "UTC",
  durationMinutes: 60,
  tourOfferingId: "o1",
  tourTitle: "T",
  guideName: "G",
  guideResponseDeadline: null,
  universityName: "U",
  price: { amount: 4200, currency: "USD" },
};

describe("booking schemas", () => {
  it("accepts a well-formed booking response", () => {
    expect(BookingResponseSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a non-integer price amount", () => {
    expect(
      BookingResponseSchema.safeParse({ ...valid, price: { amount: 1.5, currency: "USD" } })
        .success,
    ).toBe(false);
  });
  it("requires tourOfferingId + scheduledStartAt on create", () => {
    expect(CreateBookingRequestSchema.safeParse({}).success).toBe(false);
    expect(
      CreateBookingRequestSchema.safeParse({
        tourOfferingId: "o1",
        scheduledStartAt: "2026-08-01T15:00:00Z",
        displayTimezone: "UTC",
      }).success,
    ).toBe(true);
  });
});
