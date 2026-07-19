import { describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import type { CoreClient } from "@/api/_shared/index.js";
import {
  getRules,
  createRule,
  updateRule,
  deleteRule,
  replaceRules,
  getExceptions,
  createException,
  updateException,
  deleteException,
  replaceOverrides,
  getSettings,
  updateSettings,
  getAvailability,
  getOverridePreview,
  getOverrideMultiPreview,
} from "@/api/availability/handlers.js";

/** Mirrors the `mockRes` helper in `tests/unit/api/dashboard/guide.test.ts`. */
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

function sentAffected(res: { body: unknown }): unknown {
  return JSON.parse(res.body as string).affectedBookings;
}

/** A minimal `Request` stub — every handler under test only reads `params`/`body`/`query`/
 *  `header()`. Defaults to no `id` param (the `?? ""` defensive branches under test) and no
 *  query string; callers override via `over`. */
function mockReq(over: Partial<Record<string, unknown>> = {}): Request {
  return {
    params: {},
    body: {},
    query: {},
    header: () => undefined,
    ...over,
  } as unknown as Request;
}

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
  updatedAt: "2026-07-01T12:00:00.500Z",
};

const affectedBooking = {
  bookingId: "b1",
  bookingNumber: "BK-001",
  status: "CONFIRMED",
  scheduledStartAt: "2026-08-01T15:00:00.500Z",
  scheduledEndAt: "2026-08-01T16:00:00.500Z",
};

const reshapedAffectedBooking = {
  bookingId: "b1",
  bookingNumber: "BK-001",
  status: "CONFIRMED",
  scheduledStartAt: "2026-08-01T15:00:00Z",
  scheduledEndAt: "2026-08-01T16:00:00Z",
};

const occurrence = { startAt: "2026-08-01T15:00:00.500Z", endAt: "2026-08-01T16:00:00.500Z" };
const reshapedOccurrence = { startAt: "2026-08-01T15:00:00Z", endAt: "2026-08-01T16:00:00Z" };

function coreMock(over: Partial<Record<string, unknown>>): CoreClient {
  return over as unknown as CoreClient;
}

describe("availability handlers", () => {
  describe("getRules", () => {
    it("passes the rule list through unchanged", async () => {
      const get = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue([rule]);
      const core = coreMock({ get });
      const res = mockRes();
      await getRules(mockReq(), res as unknown as Response, core);
      expect(sentData(res)).toEqual([rule]);
      expect(get).toHaveBeenCalledWith("/availability/rules");
    });
  });

  describe("createRule", () => {
    it("posts the body and sends data + reshaped affectedBookings", async () => {
      const postFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: rule, affectedBookings: [affectedBooking] });
      const core = coreMock({ postFull });
      const res = mockRes();
      const req = mockReq({ body: { dayOfWeek: 1 } });
      await createRule(req, res as unknown as Response, core);
      expect(postFull).toHaveBeenCalledWith(
        "/availability/rules",
        { dayOfWeek: 1 },
        expect.any(Object),
      );
      expect(sentData(res)).toEqual(rule);
      expect(sentAffected(res)).toEqual([reshapedAffectedBooking]);
    });
  });

  describe("updateRule", () => {
    it("PATCHes /availability/rules/:id when an id is present", async () => {
      const patchFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: rule, affectedBookings: [] });
      const core = coreMock({ patchFull });
      const res = mockRes();
      const req = mockReq({ params: { id: "r1" }, body: { active: false } });
      await updateRule(req, res as unknown as Response, core);
      expect(patchFull).toHaveBeenCalledWith(
        "/availability/rules/r1",
        { active: false },
        expect.any(Object),
      );
      expect(sentData(res)).toEqual(rule);
    });

    it("defensively falls back to an empty id segment when req.params.id is absent", async () => {
      const patchFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: rule, affectedBookings: [] });
      const core = coreMock({ patchFull });
      const res = mockRes();
      await updateRule(mockReq(), res as unknown as Response, core);
      expect(patchFull).toHaveBeenCalledWith(
        "/availability/rules/",
        expect.anything(),
        expect.any(Object),
      );
      expect(sentData(res)).toEqual(rule);
    });
  });

  describe("deleteRule", () => {
    it("DELETEs /availability/rules/:id when an id is present", async () => {
      const delFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: [rule], affectedBookings: [affectedBooking] });
      const core = coreMock({ delFull });
      const res = mockRes();
      const req = mockReq({ params: { id: "r1" } });
      await deleteRule(req, res as unknown as Response, core);
      expect(delFull).toHaveBeenCalledWith("/availability/rules/r1", expect.any(Object));
      expect(sentData(res)).toEqual([rule]);
      expect(sentAffected(res)).toEqual([reshapedAffectedBooking]);
    });

    it("defensively falls back to an empty id segment when req.params.id is absent", async () => {
      const delFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: [rule], affectedBookings: [] });
      const core = coreMock({ delFull });
      const res = mockRes();
      await deleteRule(mockReq(), res as unknown as Response, core);
      expect(delFull).toHaveBeenCalledWith("/availability/rules/", expect.any(Object));
      expect(sentData(res)).toEqual([rule]);
    });
  });

  describe("replaceRules", () => {
    it("POSTs /availability/rules/replace with the body", async () => {
      const postFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: [rule], affectedBookings: [] });
      const core = coreMock({ postFull });
      const res = mockRes();
      const req = mockReq({ body: { dayOfWeek: 1, windows: [] } });
      await replaceRules(req, res as unknown as Response, core);
      expect(postFull).toHaveBeenCalledWith(
        "/availability/rules/replace",
        { dayOfWeek: 1, windows: [] },
        expect.any(Object),
      );
      expect(sentData(res)).toEqual([rule]);
    });
  });

  describe("getExceptions", () => {
    it("passes the exception list through unchanged", async () => {
      const core = coreMock({
        get: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue([exception]),
      });
      const res = mockRes();
      await getExceptions(mockReq(), res as unknown as Response, core);
      expect(sentData(res)).toEqual([exception]);
    });
  });

  describe("createException", () => {
    it("posts the body and sends data + reshaped affectedBookings", async () => {
      const postFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: exception, affectedBookings: [affectedBooking] });
      const core = coreMock({ postFull });
      const res = mockRes();
      const req = mockReq({ body: { exceptionDate: "2026-08-01", kind: "UNAVAILABLE" } });
      await createException(req, res as unknown as Response, core);
      expect(postFull).toHaveBeenCalledWith(
        "/availability/exceptions",
        { exceptionDate: "2026-08-01", kind: "UNAVAILABLE" },
        expect.any(Object),
      );
      expect(sentData(res)).toEqual(exception);
      expect(sentAffected(res)).toEqual([reshapedAffectedBooking]);
    });
  });

  describe("updateException", () => {
    it("PATCHes /availability/exceptions/:id when an id is present", async () => {
      const patchFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: exception, affectedBookings: [] });
      const core = coreMock({ patchFull });
      const res = mockRes();
      const req = mockReq({ params: { id: "e1" }, body: { reason: "Storm" } });
      await updateException(req, res as unknown as Response, core);
      expect(patchFull).toHaveBeenCalledWith(
        "/availability/exceptions/e1",
        { reason: "Storm" },
        expect.any(Object),
      );
      expect(sentData(res)).toEqual(exception);
    });

    it("defensively falls back to an empty id segment when req.params.id is absent", async () => {
      const patchFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: exception, affectedBookings: [] });
      const core = coreMock({ patchFull });
      const res = mockRes();
      await updateException(mockReq(), res as unknown as Response, core);
      expect(patchFull).toHaveBeenCalledWith(
        "/availability/exceptions/",
        expect.anything(),
        expect.any(Object),
      );
      expect(sentData(res)).toEqual(exception);
    });
  });

  describe("deleteException", () => {
    it("DELETEs /availability/exceptions/:id when an id is present", async () => {
      const delFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: [exception], affectedBookings: [affectedBooking] });
      const core = coreMock({ delFull });
      const res = mockRes();
      const req = mockReq({ params: { id: "e1" } });
      await deleteException(req, res as unknown as Response, core);
      expect(delFull).toHaveBeenCalledWith("/availability/exceptions/e1", expect.any(Object));
      expect(sentData(res)).toEqual([exception]);
      expect(sentAffected(res)).toEqual([reshapedAffectedBooking]);
    });

    it("defensively falls back to an empty id segment when req.params.id is absent", async () => {
      const delFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: [exception], affectedBookings: [] });
      const core = coreMock({ delFull });
      const res = mockRes();
      await deleteException(mockReq(), res as unknown as Response, core);
      expect(delFull).toHaveBeenCalledWith("/availability/exceptions/", expect.any(Object));
      expect(sentData(res)).toEqual([exception]);
    });
  });

  describe("replaceOverrides", () => {
    it("POSTs /availability/overrides/replace with the body", async () => {
      const postFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: [exception], affectedBookings: [] });
      const core = coreMock({ postFull });
      const res = mockRes();
      const req = mockReq({ body: { date: "2026-08-01", kind: "UNAVAILABLE", windows: [] } });
      await replaceOverrides(req, res as unknown as Response, core);
      expect(postFull).toHaveBeenCalledWith(
        "/availability/overrides/replace",
        { date: "2026-08-01", kind: "UNAVAILABLE", windows: [] },
        expect.any(Object),
      );
      expect(sentData(res)).toEqual([exception]);
    });
  });

  describe("getSettings", () => {
    it("reshapes updatedAt to canonical UTC Z", async () => {
      const core = coreMock({
        get: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(settings),
      });
      const res = mockRes();
      await getSettings(mockReq(), res as unknown as Response, core);
      expect(sentData(res)).toEqual({ ...settings, updatedAt: "2026-07-01T12:00:00Z" });
    });
  });

  describe("updateSettings", () => {
    it("patches settings and reshapes the write response", async () => {
      const patchFull = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: settings, affectedBookings: [affectedBooking] });
      const core = coreMock({ patchFull });
      const res = mockRes();
      const req = mockReq({ body: { acceptanceMode: "AUTO" } });
      await updateSettings(req, res as unknown as Response, core);
      expect(patchFull).toHaveBeenCalledWith(
        "/availability/settings",
        { acceptanceMode: "AUTO" },
        expect.any(Object),
      );
      expect(sentData(res)).toEqual({ ...settings, updatedAt: "2026-07-01T12:00:00Z" });
      expect(sentAffected(res)).toEqual([reshapedAffectedBooking]);
    });
  });

  describe("getAvailability", () => {
    const resolved = {
      rules: [rule],
      occurrences: [occurrence],
      dstGapDays: ["2026-03-08"],
      bookable: true,
      hasWeeklyHours: true,
    };

    it("forwards from/to as a query string and reshapes occurrences", async () => {
      const get = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(resolved);
      const core = coreMock({ get });
      const res = mockRes();
      const req = mockReq({ query: { from: "2026-08-01", to: "2026-08-02" } });
      await getAvailability(req, res as unknown as Response, core);
      expect(get).toHaveBeenCalledWith("/availability?from=2026-08-01&to=2026-08-02");
      expect(sentData(res)).toEqual({
        rules: [rule],
        occurrences: [reshapedOccurrence],
        dstGapDays: ["2026-03-08"],
        bookable: true,
        hasWeeklyHours: true,
      });
    });

    it("omits the query string when from/to are absent", async () => {
      const get = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(resolved);
      const core = coreMock({ get });
      const res = mockRes();
      await getAvailability(mockReq(), res as unknown as Response, core);
      expect(get).toHaveBeenCalledWith("/availability");
    });
  });

  describe("getOverridePreview", () => {
    const preview = {
      days: [
        {
          date: "2026-07-18",
          resultingWindows: [occurrence],
          trimmed: [{ kind: "ADDITIONAL", startLocal: "09:00", windowMin: 30 }],
          inert: false,
        },
      ],
      valid: true,
      message: null,
    };
    const reshapedPreview = {
      days: [
        {
          date: "2026-07-18",
          resultingWindows: [reshapedOccurrence],
          trimmed: [{ kind: "ADDITIONAL", startLocal: "09:00", windowMin: 30 }],
          inert: false,
        },
      ],
      valid: true,
      message: null,
    };

    it("forwards all five query params when present", async () => {
      const get = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(preview);
      const core = coreMock({ get });
      const res = mockRes();
      const req = mockReq({
        query: {
          dateFrom: "2026-07-18",
          dateTo: "2026-07-18",
          kind: "ADDITIONAL",
          startLocal: "09:00",
          windowMin: "30",
        },
      });
      await getOverridePreview(req, res as unknown as Response, core);
      expect(get).toHaveBeenCalledWith(
        "/availability/preview?dateFrom=2026-07-18&dateTo=2026-07-18&kind=ADDITIONAL&startLocal=09%3A00&windowMin=30",
      );
      expect(sentData(res)).toEqual(reshapedPreview);
    });

    it("omits the query string when no preview params are present", async () => {
      const get = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(preview);
      const core = coreMock({ get });
      const res = mockRes();
      await getOverridePreview(mockReq(), res as unknown as Response, core);
      expect(get).toHaveBeenCalledWith("/availability/preview");
    });
  });

  describe("getOverrideMultiPreview", () => {
    it("posts the body to /availability/preview and reshapes the response", async () => {
      const preview = { days: [], valid: true, message: null };
      const post = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(preview);
      const core = coreMock({ post });
      const res = mockRes();
      const body = {
        dateFrom: "2026-07-18",
        dateTo: "2026-07-19",
        kind: "UNAVAILABLE",
        windows: [{ startLocal: "09:00", windowMin: 30 }],
      };
      const req = mockReq({ body });
      await getOverrideMultiPreview(req, res as unknown as Response, core);
      expect(post).toHaveBeenCalledWith("/availability/preview", body, expect.any(Object));
      expect(sentData(res)).toEqual(preview);
    });
  });
});
