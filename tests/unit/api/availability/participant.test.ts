import { describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import type { CoreClient } from "@/api/_shared/index.js";
import { getSlots } from "@/api/availability/participant.js";

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
    query: {},
    ...over,
  } as unknown as Request;
}

const slot = { startAt: "2026-08-01T15:00:00.500Z", endAt: "2026-08-01T16:00:00.500Z" };
const reshapedSlot = { startAt: "2026-08-01T15:00:00Z", endAt: "2026-08-01T16:00:00Z" };

describe("getSlots (participant)", () => {
  it("forwards the offering id and from/to query params, reshaping each slot", async () => {
    const get = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue([slot]);
    const core = { get } as unknown as CoreClient;
    const res = mockRes();
    const req = mockReq({
      params: { id: "o1" },
      query: { from: "2026-08-01", to: "2026-08-02" },
    });

    await getSlots(req, res as unknown as Response, core);

    expect(get).toHaveBeenCalledWith("/offerings/o1/slots?from=2026-08-01&to=2026-08-02");
    expect(sentData(res)).toEqual([reshapedSlot]);
  });

  it("omits the query string when from/to are absent", async () => {
    const get = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue([slot]);
    const core = { get } as unknown as CoreClient;
    const res = mockRes();
    const req = mockReq({ params: { id: "o1" } });

    await getSlots(req, res as unknown as Response, core);

    expect(get).toHaveBeenCalledWith("/offerings/o1/slots");
  });

  it("defensively falls back to an empty id segment when req.params.id is absent", async () => {
    const get = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue([]);
    const core = { get } as unknown as CoreClient;
    const res = mockRes();

    await getSlots(mockReq(), res as unknown as Response, core);

    expect(get).toHaveBeenCalledWith("/offerings//slots");
    expect(sentData(res)).toEqual([]);
  });
});
