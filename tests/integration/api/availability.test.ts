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

    it("POST /v1/availability/exceptions forwards a multi-day date-range body unchanged (CTL-56 v2.1 no-op confirmation)", async () => {
      const mock = mockCoreByPath({
        "/availability/exceptions": coreWrite({ ...exception, exceptionDate: "2026-08-01" }, []),
      });
      const multiDayBody = {
        dateFrom: "2026-08-01",
        dateTo: "2026-08-03",
        kind: "UNAVAILABLE",
        startLocal: "09:30",
        windowMin: 90,
      };
      const res = await request(app)
        .post("/v1/availability/exceptions")
        .set("Cookie", cookie)
        .send(multiDayBody);
      expect(res.status).toBe(200);
      const [, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual(multiDayBody);
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

    it("widens from/to query params sent to Core by 1 day on each present side", async () => {
      const mock = mockCoreByPath({ "/availability": coreRead(resolved) });
      const res = await request(app)
        .get("/v1/availability")
        .query({ from: "2026-08-01", to: "2026-08-31" })
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/availability");
      // Widened by 1 calendar day on each side vs. what the caller requested (2026-08-01 /
      // 2026-08-31), so Core's UTC-midnight-anchored window can't cut a guide-local edge day.
      expect(parsed.searchParams.get("from")).toBe("2026-07-31");
      expect(parsed.searchParams.get("to")).toBe("2026-09-01");
    });

    it("widens only `from` when `to` is absent, leaving `to` unset", async () => {
      const mock = mockCoreByPath({ "/availability": coreRead(resolved) });
      const res = await request(app)
        .get("/v1/availability")
        .query({ from: "2026-08-01" })
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);
      expect(parsed.searchParams.get("from")).toBe("2026-07-31");
      expect(parsed.searchParams.has("to")).toBe(false);
    });

    it("widens only `to` when `from` is absent, leaving `from` unset", async () => {
      const mock = mockCoreByPath({ "/availability": coreRead(resolved) });
      const res = await request(app)
        .get("/v1/availability")
        .query({ to: "2026-08-31" })
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);
      expect(parsed.searchParams.get("to")).toBe("2026-09-01");
      expect(parsed.searchParams.has("from")).toBe(false);
    });

    it("does not cut an edge occurrence just outside the UTC-midnight-anchored `from` boundary", async () => {
      // A UTC+13 guide's local day 2026-07-15 begins at 2026-07-14T11:00Z. An occurrence at
      // 2026-07-14T19:00Z is still within that guide-local 2026-07-15, but a naive
      // from=2026-07-15 (Core's UTC-midnight anchor = 2026-07-15T00:00Z) would exclude it.
      // Widening `from` to 2026-07-14 pulls Core's window back far enough to include it.
      const edgeOccurrence = {
        startAt: "2026-07-14T19:00:00.000Z",
        endAt: "2026-07-14T20:00:00.000Z",
      };
      const mock = mockCoreByPath({
        "/availability": coreRead({ rules: [rule], occurrences: [edgeOccurrence], dstGapDays: [] }),
      });
      const res = await request(app)
        .get("/v1/availability")
        .query({ from: "2026-07-15" })
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).searchParams.get("from")).toBe("2026-07-14");
      expect(res.body.data.occurrences).toEqual([
        { startAt: "2026-07-14T19:00:00Z", endAt: "2026-07-14T20:00:00Z" },
      ]);
    });

    it("does not crash on a malformed from/to and forwards it verbatim so Core can reject it", async () => {
      const mock = mockCoreByPath({ "/availability": problem(422, "Invalid from") });
      const res = await request(app)
        .get("/v1/availability")
        .query({ from: "not-a-date", to: "also-bad" })
        .set("Cookie", cookie);
      expect(res.status).toBe(422);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);
      expect(parsed.searchParams.get("from")).toBe("not-a-date");
      expect(parsed.searchParams.get("to")).toBe("also-bad");
    });

    it("forwards a shape-valid but value-invalid date (e.g. month 13) verbatim, unwidened", async () => {
      // `2026-13-01` passes the yyyy-MM-dd shape regex but is not a real date, so Date.parse
      // returns NaN and widening is skipped — the original string is forwarded to Core verbatim
      // (Core validates it and rejects with a 4xx, which we relay).
      const mock = mockCoreByPath({ "/availability": problem(422, "Invalid from") });
      const res = await request(app)
        .get("/v1/availability")
        .query({ from: "2026-13-01" })
        .set("Cookie", cookie);
      expect(res.status).toBe(422);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).searchParams.get("from")).toBe("2026-13-01");
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

  describe("override dry-run preview (GET /v1/availability/preview)", () => {
    const previewQuery = {
      dateFrom: "2026-07-18",
      dateTo: "2026-07-18",
      kind: "UNAVAILABLE",
      startLocal: "09:30",
      windowMin: "90",
    };

    it("forwards dateFrom/dateTo/kind/startLocal/windowMin to Core verbatim and reshapes resultingWindows to UTC Z", async () => {
      const day = {
        date: "2026-07-18",
        resultingWindows: [
          { startAt: "2026-07-18T16:30:00.000Z", endAt: "2026-07-18T18:00:00.000Z" },
        ],
        trimmed: [{ kind: "UNAVAILABLE", startLocal: "09:30", windowMin: 90 }],
      };
      const mock = mockCoreByPath({
        "/availability/preview": coreRead({ days: [day], valid: true, message: null }),
      });
      const res = await request(app)
        .get("/v1/availability/preview")
        .query(previewQuery)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/availability/preview");
      expect(parsed.searchParams.get("dateFrom")).toBe("2026-07-18");
      expect(parsed.searchParams.get("dateTo")).toBe("2026-07-18");
      expect(parsed.searchParams.get("kind")).toBe("UNAVAILABLE");
      expect(parsed.searchParams.get("startLocal")).toBe("09:30");
      expect(parsed.searchParams.get("windowMin")).toBe("90");
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.message).toBeNull();
      expect(res.body.data.days).toEqual([
        {
          date: "2026-07-18",
          resultingWindows: [{ startAt: "2026-07-18T16:30:00Z", endAt: "2026-07-18T18:00:00Z" }],
          trimmed: [{ kind: "UNAVAILABLE", startLocal: "09:30", windowMin: 90 }],
        },
      ]);
    });

    it("multi-day: reshapes resultingWindows on every day entry", async () => {
      const days = [
        {
          date: "2026-07-18",
          resultingWindows: [
            { startAt: "2026-07-18T16:30:00.000Z", endAt: "2026-07-18T18:00:00.000Z" },
          ],
          trimmed: [],
        },
        {
          date: "2026-07-19",
          resultingWindows: [
            { startAt: "2026-07-19T16:30:00+00:00", endAt: "2026-07-19T18:00:00+00:00" },
          ],
          trimmed: [{ kind: "UNAVAILABLE", startLocal: "09:30", windowMin: 90 }],
        },
      ];
      mockCoreByPath({
        "/availability/preview": coreRead({ days, valid: true, message: null }),
      });
      const res = await request(app)
        .get("/v1/availability/preview")
        .query({ ...previewQuery, dateTo: "2026-07-19" })
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.days).toHaveLength(2);
      expect(res.body.data.days[0].resultingWindows).toEqual([
        { startAt: "2026-07-18T16:30:00Z", endAt: "2026-07-18T18:00:00Z" },
      ]);
      expect(res.body.data.days[1].resultingWindows).toEqual([
        { startAt: "2026-07-19T16:30:00Z", endAt: "2026-07-19T18:00:00Z" },
      ]);
      expect(res.body.data.days[1].trimmed).toEqual([
        { kind: "UNAVAILABLE", startLocal: "09:30", windowMin: 90 },
      ]);
    });

    it("no cookie → 401 + Auth-Required", async () => {
      const res = await request(app).get("/v1/availability/preview").query(previewQuery);
      expect(res.status).toBe(401);
      expect(res.headers["auth-required"]).toBe("reauthenticate");
    });

    it("calls Core without a query string when no preview params are present", async () => {
      const mock = mockCoreByPath({
        "/availability/preview": coreRead({ days: [], valid: true, message: null }),
      });
      const res = await request(app).get("/v1/availability/preview").set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).search).toBe("");
      expect(res.body.data.days).toEqual([]);
    });

    it("Core 422 (e.g. cross-midnight/>366 override) → surfaces the real status, not a blanket 500", async () => {
      mockCoreByPath({ "/availability/preview": coreErr(422) });
      const res = await request(app)
        .get("/v1/availability/preview")
        .query(previewQuery)
        .set("Cookie", cookie);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "UPSTREAM_ERROR" });
    });
  });

  describe("multi-window override dry-run preview (POST /v1/availability/preview)", () => {
    const multiWindowBody = {
      dateFrom: "2026-07-18",
      dateTo: "2026-07-19",
      kind: "ADDITIONAL",
      windows: [
        { startLocal: "09:00", windowMin: 60 },
        { startLocal: "14:00", windowMin: 60 },
      ],
    };

    it("forwards the body to Core POST /availability/preview verbatim and reshapes resultingWindows to UTC Z", async () => {
      const day1 = {
        date: "2026-07-18",
        resultingWindows: [
          { startAt: "2026-07-18T16:00:00.000Z", endAt: "2026-07-18T17:00:00.000Z" },
          { startAt: "2026-07-18T21:00:00.000Z", endAt: "2026-07-18T22:00:00.000Z" },
        ],
        trimmed: [{ kind: "ADDITIONAL", startLocal: "09:00", windowMin: 60 }],
      };
      const mock = mockCoreByPath({
        "/availability/preview": coreRead({ days: [day1], valid: true, message: null }),
      });
      const res = await request(app)
        .post("/v1/availability/preview")
        .set("Cookie", cookie)
        .send(multiWindowBody);
      expect(res.status).toBe(200);
      const [url, init] = mock.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).pathname).toBe("/availability/preview");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual(multiWindowBody);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.message).toBeNull();
      expect(res.body.data.days).toEqual([
        {
          date: "2026-07-18",
          resultingWindows: [
            { startAt: "2026-07-18T16:00:00Z", endAt: "2026-07-18T17:00:00Z" },
            { startAt: "2026-07-18T21:00:00Z", endAt: "2026-07-18T22:00:00Z" },
          ],
          trimmed: [{ kind: "ADDITIONAL", startLocal: "09:00", windowMin: 60 }],
        },
      ]);
    });

    it("forwards replaceExisting:true to Core verbatim alongside the rest of the body", async () => {
      const replaceBody = { ...multiWindowBody, replaceExisting: true };
      const mock = mockCoreByPath({
        "/availability/preview": coreRead({ days: [], valid: true, message: null }),
      });
      const res = await request(app)
        .post("/v1/availability/preview")
        .set("Cookie", cookie)
        .send(replaceBody);
      expect(res.status).toBe(200);
      const [, init] = mock.mock.calls[0] as [string, RequestInit];
      const forwarded = JSON.parse(init.body as string);
      expect(forwarded).toEqual(replaceBody);
      expect(forwarded.replaceExisting).toBe(true);
    });

    it("multi-day: reshapes resultingWindows on every day entry", async () => {
      const days = [
        {
          date: "2026-07-18",
          resultingWindows: [
            { startAt: "2026-07-18T16:00:00.000Z", endAt: "2026-07-18T17:00:00.000Z" },
          ],
          trimmed: [],
        },
        {
          date: "2026-07-19",
          resultingWindows: [
            { startAt: "2026-07-19T16:00:00+00:00", endAt: "2026-07-19T17:00:00+00:00" },
          ],
          trimmed: [{ kind: "ADDITIONAL", startLocal: "09:00", windowMin: 60 }],
        },
      ];
      mockCoreByPath({
        "/availability/preview": coreRead({ days, valid: true, message: null }),
      });
      const res = await request(app)
        .post("/v1/availability/preview")
        .set("Cookie", cookie)
        .send(multiWindowBody);
      expect(res.status).toBe(200);
      expect(res.body.data.days).toHaveLength(2);
      expect(res.body.data.days[0].resultingWindows).toEqual([
        { startAt: "2026-07-18T16:00:00Z", endAt: "2026-07-18T17:00:00Z" },
      ]);
      expect(res.body.data.days[1].resultingWindows).toEqual([
        { startAt: "2026-07-19T16:00:00Z", endAt: "2026-07-19T17:00:00Z" },
      ]);
      expect(res.body.data.days[1].trimmed).toEqual([
        { kind: "ADDITIONAL", startLocal: "09:00", windowMin: 60 },
      ]);
    });

    it("no cookie → 401 + Auth-Required", async () => {
      const res = await request(app).post("/v1/availability/preview").send(multiWindowBody);
      expect(res.status).toBe(401);
      expect(res.headers["auth-required"]).toBe("reauthenticate");
    });

    it("Core 422 (e.g. empty windows[] or cross-midnight) → surfaces the real status via the read-path relay", async () => {
      mockCoreByPath({ "/availability/preview": coreErr(422) });
      const res = await request(app)
        .post("/v1/availability/preview")
        .set("Cookie", cookie)
        .send(multiWindowBody);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "UPSTREAM_ERROR" });
    });

    it("is NOT blocked by the CSRF guard on a cross-site Origin (deliberate — a pure read, no state mutation)", async () => {
      mockCoreByPath({
        "/availability/preview": coreRead({ days: [], valid: true, message: null }),
      });
      const res = await request(app)
        .post("/v1/availability/preview")
        .set("Cookie", cookie)
        .set("Origin", "https://evil.test")
        .send(multiWindowBody);
      expect(res.status).toBe(200);
    });
  });

  describe("participant slots read (GET /v1/offerings/:id/slots)", () => {
    const slot = { startAt: "2026-08-01T15:00:00.000Z", endAt: "2026-08-01T15:30:00.000Z" };

    it("reshapes each slot's startAt/endAt to canonical UTC Z", async () => {
      mockCoreByPath({ "/offerings/off1/slots": coreRead([slot]) });
      const res = await request(app).get("/v1/offerings/off1/slots").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { startAt: "2026-08-01T15:00:00Z", endAt: "2026-08-01T15:30:00Z" },
      ]);
      expect(res.body.meta).toBeDefined();
    });

    it("forwards the :id path param and from/to query params to the correct Core path", async () => {
      const mock = mockCoreByPath({ "/offerings/off1/slots": coreRead([slot]) });
      const res = await request(app)
        .get("/v1/offerings/off1/slots")
        .query({ from: "2026-08-01", to: "2026-08-31" })
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/offerings/off1/slots");
      expect(parsed.searchParams.get("from")).toBe("2026-08-01");
      expect(parsed.searchParams.get("to")).toBe("2026-08-31");
    });

    it("calls Core without a query string when from/to are absent", async () => {
      const mock = mockCoreByPath({ "/offerings/off1/slots": coreRead([slot]) });
      const res = await request(app).get("/v1/offerings/off1/slots").set("Cookie", cookie);
      expect(res.status).toBe(200);
      const [url] = mock.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).search).toBe("");
    });

    it("returns an empty array when Core has no bookable slots", async () => {
      mockCoreByPath({ "/offerings/off1/slots": coreRead([]) });
      const res = await request(app).get("/v1/offerings/off1/slots").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("no cookie → 401 + Auth-Required", async () => {
      const res = await request(app).get("/v1/offerings/off1/slots");
      expect(res.status).toBe(401);
      expect(res.headers["auth-required"]).toBe("reauthenticate");
    });

    it("Core 404 (offering not found/inactive) → surfaces the real 404", async () => {
      mockCoreByPath({ "/offerings/off1/slots": coreErr(404) });
      const res = await request(app).get("/v1/offerings/off1/slots").set("Cookie", cookie);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: "UPSTREAM_ERROR" });
    });

    it("Core 403 (non-participant) → surfaces the real 403", async () => {
      mockCoreByPath({ "/offerings/off1/slots": coreErr(403) });
      const res = await request(app).get("/v1/offerings/off1/slots").set("Cookie", cookie);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "UPSTREAM_ERROR" });
    });
  });
});
