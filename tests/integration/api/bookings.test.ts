import request from "supertest";
import { app } from "@/app.js";
import { coreOk, mintSessionCookie, mockCoreByPath } from "../_helpers.js";

const coreBooking = {
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

/** A Core problem+json error Response (text-only body, like a real 4xx). */
const problem = (status: number, title: string) =>
  ({
    ok: false,
    status,
    headers: new Headers({ "content-type": "application/problem+json" }),
    text: async () => JSON.stringify({ title, status }),
  }) as unknown as Response;

describe("bff booking module", () => {
  let cookie: string;
  beforeEach(() => (cookie = mintSessionCookie()));

  it("POST /v1/bookings reshapes the Core booking", async () => {
    mockCoreByPath({ "/bookings": coreOk(coreBooking) });
    const res = await request(app).post("/v1/bookings").set("Cookie", cookie).send({
      tourOfferingId: "o1",
      scheduledStartAt: "2026-08-01T15:00:00Z",
      displayTimezone: "UTC",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.price).toEqual({ amount: 4200, currency: "USD" });
    expect(res.body.data.scheduledEndAt).toBe("2026-08-01T16:00:00Z");
    expect(res.body.data.durationMinutes).toBe(60);
    expect(res.body.data.tourTitle).toBe("North Campus");
    expect(res.body.data).not.toHaveProperty("priceCents");
  });

  it("POST /v1/bookings/:id/cancel reshapes the cancelled booking", async () => {
    mockCoreByPath({ "/bookings/b1/cancel": coreOk({ ...coreBooking, status: "CANCELLED" }) });
    const res = await request(app)
      .post("/v1/bookings/b1/cancel")
      .set("Cookie", cookie)
      .send({ reason: "changed plans" });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("b1");
    expect(res.body.data.status).toBe("CANCELLED");
    expect(res.body.data.price).toEqual({ amount: 4200, currency: "USD" });
  });

  it("relays a Core 422 verbatim (problem+json)", async () => {
    mockCoreByPath({ "/bookings": problem(422, "That time slot was just taken") });
    const res = await request(app)
      .post("/v1/bookings")
      .set("Cookie", cookie)
      .send({ tourOfferingId: "o1", scheduledStartAt: "x", displayTimezone: "UTC" });
    expect(res.status).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(JSON.parse(res.text).title).toBe("That time slot was just taken");
  });

  it("blocks a cross-site mutation with 403 (CSRF)", async () => {
    const res = await request(app)
      .post("/v1/bookings")
      .set("Cookie", cookie)
      .set("Origin", "https://evil.test")
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_BLOCKED");
  });
});
