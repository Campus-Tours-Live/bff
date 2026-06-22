import type { Response } from "express";
import { sendData, coreUnavailable } from "@/api/_shared/envelope.js";

function mockRes(requestId?: string) {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    type(t: string) {
      res.headers["content-type"] = t;
      return res;
    },
    send(b: string) {
      res.body = b;
      return res;
    },
    getHeader(name: string): string | undefined {
      return name === "X-Request-Id" ? requestId : undefined;
    },
  };
  return res;
}

describe("sendData", () => {
  it("wraps data in { data, meta: { requestId } } with the request id from the header", () => {
    const res = mockRes("req-42");
    sendData(res as unknown as Response, { hello: "world" });
    expect(res.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(res.body as string)).toEqual({
      data: { hello: "world" },
      meta: { requestId: "req-42" },
    });
  });

  it("sets requestId to undefined (absent in JSON) when no X-Request-Id header", () => {
    const res = mockRes(undefined);
    sendData(res as unknown as Response, [1, 2, 3]);
    const parsed = JSON.parse(res.body as string);
    expect(parsed).toEqual({ data: [1, 2, 3], meta: {} });
    expect("requestId" in parsed.meta).toBe(false);
  });

  it("passes through null/primitive data unchanged", () => {
    const res = mockRes("r1");
    sendData(res as unknown as Response, null);
    expect(JSON.parse(res.body as string)).toEqual({ data: null, meta: { requestId: "r1" } });
  });
});

describe("coreUnavailable", () => {
  it("sends a 502 problem with code CORE_UNAVAILABLE", () => {
    const res = mockRes("req-99");
    coreUnavailable(res as unknown as Response);
    expect(res.statusCode).toBe(502);
    expect(res.headers["content-type"]).toBe("application/problem+json");
    expect(JSON.parse(res.body as string)).toMatchObject({
      status: 502,
      title: "Upstream service unavailable",
      code: "CORE_UNAVAILABLE",
      requestId: "req-99",
    });
  });
});
