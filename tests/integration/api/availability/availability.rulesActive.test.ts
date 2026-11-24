import request from "supertest";
import { z } from "zod";
import { app } from "@/app.js";
import { WriteEnvelope, AvailabilityRuleResponseSchema } from "@/openapi/schemas.js";
import { coreErr, mintSessionCookie, mockCoreByPath } from "../../_helpers.js";

/**
 * CTL-60 (bff half): proxy `POST /v1/availability/rules/active` -> Contract A. A state-mutating
 * POST that forwards `{dayOfWeek, active}` to Core's atomic day on/off toggle, reshapes the write
 * envelope to UTC-Z, relays 4xx verbatim, and is CSRF-guarded like every other availability write.
 * Mirrors `availability.rulesReplace.test.ts`.
 */

/** A rule from the Core `AvailabilityRuleResponse` list `data` the toggle returns. */
const rule = {
  id: "r1",
  dayOfWeek: 1,
  startLocal: "09:00",
  windowMin: 60,
  timezone: "America/Los_Angeles",
  effectiveFrom: "2026-07-20",
  effectiveTo: null,
  active: false,
};

const affectedBooking = {
  bookingId: "b1",
  bookingNumber: "BK-001",
  status: "CONFIRMED",
  scheduledStartAt: "2026-07-20T15:00:00.500Z",
  scheduledEndAt: "2026-07-20T16:00:00.500Z",
};

/** A Core success response for writes: `AvailabilityWriteResponse{ data, affectedBookings, meta }`. */
const coreWrite = (data: unknown, affectedBookings: unknown[] = []): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({
      data,
      affectedBookings,
      meta: { requestId: "r1", timestamp: "2026-01-01T00:00:00Z" },
    }),
    text: async () =>
      JSON.stringify({
        data,
        affectedBookings,
        meta: { requestId: "r1", timestamp: "2026-01-01T00:00:00Z" },
      }),
  }) as unknown as Response;

/** A Core problem+json error Response (text-only body, like a real 4xx). */
const problem = (status: number, title: string) =>
  ({
    ok: false,
    status,
    headers: new Headers({ "content-type": "application/problem+json" }),
    text: async () => JSON.stringify({ title, status }),
  }) as unknown as Response;

const validBody = { dayOfWeek: 1, active: false };

describe("bff availability day toggle (POST /v1/availability/rules/active)", () => {
  let cookie: string;
  beforeEach(() => (cookie = mintSessionCookie()));

  it("forwards {dayOfWeek, active} to Core with the token and returns the Contract-A write envelope", async () => {
    const mock = mockCoreByPath({
      "/availability/rules/active": coreWrite([rule], [affectedBooking]),
    });
    const res = await request(app)
      .post("/v1/availability/rules/active")
      .set("Cookie", cookie)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([rule]);
    // affectedBookings normalized to canonical UTC `Z` (fractional seconds dropped).
    expect(res.body.affectedBookings).toEqual([
      {
        bookingId: "b1",
        bookingNumber: "BK-001",
        status: "CONFIRMED",
        scheduledStartAt: "2026-07-20T15:00:00Z",
        scheduledEndAt: "2026-07-20T16:00:00Z",
      },
    ]);

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/availability/rules/active");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(validBody);
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it("the write-response body conforms to the write-envelope shape", async () => {
    mockCoreByPath({ "/availability/rules/active": coreWrite([rule], []) });
    const res = await request(app)
      .post("/v1/availability/rules/active")
      .set("Cookie", cookie)
      .send(validBody);
    expect(res.status).toBe(200);
    const parsed = WriteEnvelope(z.array(AvailabilityRuleResponseSchema)).safeParse(res.body);
    expect(parsed.success).toBe(true);
  });

  it("relays a Core 422 verbatim (status + message, not UPSTREAM_ERROR)", async () => {
    mockCoreByPath({
      "/availability/rules/active": coreErr(422, {
        message: "Can't turn Monday on: two of its ranges overlap and cover different dates.",
      }),
    });
    const res = await request(app)
      .post("/v1/availability/rules/active")
      .set("Cookie", cookie)
      .send({ dayOfWeek: 1, active: true });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/two of its ranges overlap/i);
    expect(res.body.code).not.toBe("UPSTREAM_ERROR");
  });

  it("relays a Core 422 problem+json verbatim", async () => {
    mockCoreByPath({ "/availability/rules/active": problem(422, "active is required") });
    const res = await request(app)
      .post("/v1/availability/rules/active")
      .set("Cookie", cookie)
      .send({ dayOfWeek: 1 });
    expect(res.status).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(JSON.parse(res.text).title).toBe("active is required");
  });

  it("CSRF: a cross-site toggle POST is rejected (403)", async () => {
    const res = await request(app)
      .post("/v1/availability/rules/active")
      .set("Cookie", cookie)
      .set("Origin", "https://evil.test")
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_BLOCKED");
  });

  it("no cookie → 401 + Auth-Required", async () => {
    const res = await request(app).post("/v1/availability/rules/active").send(validBody);
    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
  });
});
