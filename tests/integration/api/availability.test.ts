import request from "supertest";
import { app } from "@/app.js";
import { coreErr, mintSessionCookie, mockCoreByPath } from "../_helpers.js";

const rule = {
  id: "r1",
  dayOfWeek: 1,
  startLocal: "09:00",
  windowMin: 120,
  timezone: "America/Los_Angeles",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  active: true,
};

const exception = {
  id: "e1",
  exceptionDate: "2026-08-01",
  kind: "UNAVAILABLE",
  startLocal: "09:00",
  windowMin: 60,
  reason: "Holiday",
};

const settings = {
  guideId: "g1",
  acceptanceMode: "AUTO",
  responseDeadlineMin: 60,
  minNoticeMin: 120,
  maxAdvanceDays: 30,
  bufferBeforeMin: 10,
  bufferAfterMin: 10,
  durationsOffered: [30, 60],
  timezone: "America/Los_Angeles",
  updatedAt: "2026-07-01T12:00:00.000Z",
};

const affectedBooking = {
  bookingId: "b1",
  bookingNumber: "BK-001",
  status: "CONFIRMED",
  scheduledStartAt: "2026-08-01T15:00:00.500Z",
  scheduledEndAt: "2026-08-01T16:00:00.500Z",
};

/** A Core success response for GET reads: plain `{ data, meta }` envelope. */
const coreRead = (data: unknown): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ data, meta: { requestId: "r1", timestamp: "2026-01-01T00:00:00Z" } }),
    text: async () =>
      JSON.stringify({ data, meta: { requestId: "r1", timestamp: "2026-01-01T00:00:00Z" } }),
  }) as unknown as Response;

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

describe("bff availability module", () => {
  let cookie: string;
  beforeEach(() => (cookie = mintSessionCookie()));

  describe("rules", () => {
    it("GET /v1/availability/rules passes rules through unchanged", async () => {
      mockCoreByPath({ "/availability/rules": coreRead([rule]) });
      const res = await request(app).get("/v1/availability/rules").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([rule]);
    });

    it("POST /v1/availability/rules passes data through and reshapes affectedBookings", async () => {
      mockCoreByPath({ "/availability/rules": coreWrite(rule, [affectedBooking]) });
      const res = await request(app).post("/v1/availability/rules").set("Cookie", cookie).send({
        dayOfWeek: 1,
        startLocal: "09:00",
        windowMin: 120,
        timezone: "America/Los_Angeles",
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(rule);
      expect(res.body.affectedBookings).toEqual([
        {
          bookingId: "b1",
          bookingNumber: "BK-001",
          status: "CONFIRMED",
          scheduledStartAt: "2026-08-01T15:00:00Z",
          scheduledEndAt: "2026-08-01T16:00:00Z",
        },
      ]);
    });

    it("PATCH /v1/availability/rules/:id forwards to Core with the id and reshapes the response", async () => {
      const mock = mockCoreByPath({
        "/availability/rules/r1": coreWrite({ ...rule, active: false }, []),
      });
      const res = await request(app)
        .patch("/v1/availability/rules/r1")
        .set("Cookie", cookie)
        .send({ active: false });
      expect(res.status).toBe(200);
      expect(res.body.data.active).toBe(false);
      expect(res.body.affectedBookings).toEqual([]);
      const [url, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).pathname).toBe("/availability/rules/r1");
      expect(init.method).toBe("PATCH");
    });

    it("DELETE /v1/availability/rules/:id returns the remaining rule list + reshaped affectedBookings", async () => {
      mockCoreByPath({
        "/availability/rules/r1": coreWrite([{ ...rule, id: "r2" }], [affectedBooking]),
      });
      const res = await request(app).delete("/v1/availability/rules/r1").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ ...rule, id: "r2" }]);
      expect(res.body.affectedBookings[0].scheduledStartAt).toBe("2026-08-01T15:00:00Z");
    });
  });

  describe("exceptions", () => {
    it("GET /v1/availability/exceptions passes exceptions through unchanged", async () => {
      mockCoreByPath({ "/availability/exceptions": coreRead([exception]) });
      const res = await request(app).get("/v1/availability/exceptions").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([exception]);
    });

    it("POST /v1/availability/exceptions passes data through and reshapes affectedBookings", async () => {
      mockCoreByPath({ "/availability/exceptions": coreWrite(exception, [affectedBooking]) });
      const res = await request(app)
        .post("/v1/availability/exceptions")
        .set("Cookie", cookie)
        .send({ exceptionDate: "2026-08-01", kind: "UNAVAILABLE" });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(exception);
      expect(res.body.affectedBookings[0].bookingId).toBe("b1");
    });

    it("PATCH /v1/availability/exceptions/:id forwards to Core with the id", async () => {
      const mock = mockCoreByPath({
        "/availability/exceptions/e1": coreWrite({ ...exception, reason: "Storm" }, []),
      });
      const res = await request(app)
        .patch("/v1/availability/exceptions/e1")
        .set("Cookie", cookie)
        .send({ reason: "Storm" });
      expect(res.status).toBe(200);
      expect(res.body.data.reason).toBe("Storm");
      const [url, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).pathname).toBe("/availability/exceptions/e1");
      expect(init.method).toBe("PATCH");
    });

    it("DELETE /v1/availability/exceptions/:id returns the remaining exception list + reshaped affectedBookings", async () => {
      mockCoreByPath({
        "/availability/exceptions/e1": coreWrite([], [affectedBooking]),
      });
      const res = await request(app).delete("/v1/availability/exceptions/e1").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.affectedBookings).toHaveLength(1);
    });
  });

  describe("settings", () => {
    it("GET /v1/availability/settings reshapes updatedAt to canonical UTC Z", async () => {
      mockCoreByPath({ "/availability/settings": coreRead(settings) });
      const res = await request(app).get("/v1/availability/settings").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.updatedAt).toBe("2026-07-01T12:00:00Z");
      expect(res.body.data.guideId).toBe("g1");
    });

    it("PATCH /v1/availability/settings reshapes data.updatedAt and affectedBookings", async () => {
      mockCoreByPath({
        "/availability/settings": coreWrite({ ...settings, acceptanceMode: "MANUAL" }, [
          affectedBooking,
        ]),
      });
      const res = await request(app)
        .patch("/v1/availability/settings")
        .set("Cookie", cookie)
        .send({ acceptanceMode: "MANUAL" });
      expect(res.status).toBe(200);
      expect(res.body.data.acceptanceMode).toBe("MANUAL");
      expect(res.body.data.updatedAt).toBe("2026-07-01T12:00:00Z");
      expect(res.body.affectedBookings[0].scheduledEndAt).toBe("2026-08-01T16:00:00Z");
    });
  });

  it("relays a Core 422 verbatim (problem+json) on a write", async () => {
    mockCoreByPath({ "/availability/rules": problem(422, "Overlapping rule") });
    const res = await request(app)
      .post("/v1/availability/rules")
      .set("Cookie", cookie)
      .send({ dayOfWeek: 1, startLocal: "09:00", windowMin: 120 });
    expect(res.status).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(JSON.parse(res.text).title).toBe("Overlapping rule");
  });

  it("blocks a cross-site mutation with 403 (CSRF)", async () => {
    const res = await request(app)
      .post("/v1/availability/rules")
      .set("Cookie", cookie)
      .set("Origin", "https://evil.test")
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_BLOCKED");
  });

  it("Core 401 on a write → 401 + Auth-Required (re-auth)", async () => {
    mockCoreByPath({ "/availability/rules": coreErr(401) });
    const res = await request(app)
      .post("/v1/availability/rules")
      .set("Cookie", cookie)
      .send({ dayOfWeek: 1 });
    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
    expect(res.body).toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
  });

  it("no cookie on a read → 401 + Auth-Required", async () => {
    const res = await request(app).get("/v1/availability/rules");
    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
  });

  describe("resolved read (GET /v1/availability)", () => {
    const occurrence = { startAt: "2026-08-01T15:00:00.000Z", endAt: "2026-08-01T16:00:00.000Z" };
    const resolved = {
      rules: [rule],
      occurrences: [occurrence],
      dstGapDays: ["2026-03-08"],
    };

    it("reshapes occurrences to UTC Z and passes rules/dstGapDays through unchanged", async () => {
      mockCoreByPath({ "/availability": coreRead(resolved) });
      const res = await request(app).get("/v1/availability").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.rules).toEqual([rule]);
      expect(res.body.data.dstGapDays).toEqual(["2026-03-08"]);
      expect(res.body.data.occurrences).toEqual([
        { startAt: "2026-08-01T15:00:00Z", endAt: "2026-08-01T16:00:00Z" },
      ]);
      expect(res.body.meta).toBeDefined();
    });

    it("forwards from/to query params to Core verbatim", async () => {
      const mock = mockCoreByPath({ "/availability": coreRead(resolved) });
      const res = await request(app)
        .get("/v1/availability")
        .query({ from: "2026-08-01", to: "2026-08-31" })
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/availability");
      expect(parsed.searchParams.get("from")).toBe("2026-08-01");
      expect(parsed.searchParams.get("to")).toBe("2026-08-31");
    });

    it("calls Core without a query string when from/to are absent", async () => {
      const mock = mockCoreByPath({ "/availability": coreRead(resolved) });
      const res = await request(app).get("/v1/availability").set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(new URL(url).origin + "/availability");
      expect(new URL(url).search).toBe("");
    });

    it("returns empty arrays when Core has no rules/occurrences/gap-days", async () => {
      mockCoreByPath({
        "/availability": coreRead({ rules: [], occurrences: [], dstGapDays: [] }),
      });
      const res = await request(app).get("/v1/availability").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ rules: [], occurrences: [], dstGapDays: [] });
    });

    it("no cookie → 401 + Auth-Required", async () => {
      const res = await request(app).get("/v1/availability");
      expect(res.status).toBe(401);
      expect(res.headers["auth-required"]).toBe("reauthenticate");
    });

    it("does not shadow the /v1/availability/rules sub-route", async () => {
      mockCoreByPath({
        "/availability": coreRead(resolved),
        "/availability/rules": coreRead([rule]),
      });
      const bare = await request(app).get("/v1/availability").set("Cookie", cookie);
      const sub = await request(app).get("/v1/availability/rules").set("Cookie", cookie);
      expect(bare.status).toBe(200);
      expect(sub.status).toBe(200);
      expect(bare.body.data.rules).toEqual([rule]);
      expect(sub.body.data).toEqual([rule]);
    });
  });
});
