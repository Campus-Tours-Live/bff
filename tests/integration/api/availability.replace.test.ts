import request from "supertest";
import { z } from "zod";
import { app } from "@/app.js";
import { WriteEnvelope, AvailabilityExceptionResponseSchema } from "@/openapi/schemas.js";
import { coreErr, mintSessionCookie, mockCoreByPath } from "../_helpers.js";

/**
 * Task 3 (CTL-56 B2 bff half): proxy `POST /v1/availability/overrides/replace` → Contract A.
 * A state-mutating POST that forwards the body `{date, kind, windows[]}` to Core's atomic
 * single-day override replace, reshapes the write envelope to UTC-Z, relays 4xx verbatim, and
 * is CSRF-guarded like every other availability write route.
 */

/** The Core `AvailabilityExceptionResponse` list `data` a replace returns. */
const exception = {
  id: "e1",
  exceptionDate: "2026-07-20",
  kind: "UNAVAILABLE",
  startLocal: "09:00",
  windowMin: 60,
  reason: null,
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

const validBody = {
  date: "2026-07-20",
  kind: "UNAVAILABLE",
  windows: [{ startLocal: "09:00", windowMin: 60 }],
};

describe("bff availability override replace (POST /v1/availability/overrides/replace)", () => {
  let cookie: string;
  beforeEach(() => (cookie = mintSessionCookie()));

  it("(a) forwards to Core with the token and returns the reshaped Contract-A write envelope", async () => {
    const mock = mockCoreByPath({
      "/availability/overrides/replace": coreWrite([exception], [affectedBooking]),
    });
    const res = await request(app)
      .post("/v1/availability/overrides/replace")
      .set("Cookie", cookie)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([exception]);
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
    expect(res.body.meta).toBeDefined();

    // Forwarded to the atomic replace path, as a POST, with the bearer token attached.
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/availability/overrides/replace");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(validBody);
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it("(a2) an empty windows list (clear-the-day) is forwarded verbatim to Core", async () => {
    const clearBody = { date: "2026-07-20", kind: "UNAVAILABLE", windows: [] };
    const mock = mockCoreByPath({
      "/availability/overrides/replace": coreWrite([], []),
    });
    const res = await request(app)
      .post("/v1/availability/overrides/replace")
      .set("Cookie", cookie)
      .send(clearBody);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(clearBody);
  });

  it("(b) relays a Core 422 verbatim (status + message, not UPSTREAM_ERROR)", async () => {
    mockCoreByPath({
      "/availability/overrides/replace": coreErr(422, { message: "Windows cross midnight" }),
    });
    const res = await request(app)
      .post("/v1/availability/overrides/replace")
      .set("Cookie", cookie)
      .send(validBody);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/cross midnight/i);
    expect(res.body.code).not.toBe("UPSTREAM_ERROR");
  });

  it("(b2) relays a Core 422 problem+json verbatim", async () => {
    mockCoreByPath({
      "/availability/overrides/replace": problem(422, "Invalid window"),
    });
    const res = await request(app)
      .post("/v1/availability/overrides/replace")
      .set("Cookie", cookie)
      .send(validBody);
    expect(res.status).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(JSON.parse(res.text).title).toBe("Invalid window");
  });

  it("(c) the write-response body conforms to the write-envelope shape", async () => {
    mockCoreByPath({
      "/availability/overrides/replace": coreWrite([exception], [affectedBooking]),
    });
    const res = await request(app)
      .post("/v1/availability/overrides/replace")
      .set("Cookie", cookie)
      .send(validBody);
    expect(res.status).toBe(200);
    const parsed = WriteEnvelope(z.array(AvailabilityExceptionResponseSchema)).safeParse(res.body);
    expect(parsed.success).toBe(true);
  });

  it("(d) CSRF: a cross-site replace POST without a valid CSRF token is rejected (403)", async () => {
    const res = await request(app)
      .post("/v1/availability/overrides/replace")
      .set("Cookie", cookie)
      .set("Origin", "https://evil.test")
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_BLOCKED");
  });

  it("no cookie → 401 + Auth-Required", async () => {
    const res = await request(app).post("/v1/availability/overrides/replace").send(validBody);
    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
  });
});
