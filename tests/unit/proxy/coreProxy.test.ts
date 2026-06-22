import { jest } from "@jest/globals";
import type { Request, Response } from "express";

// Unit test for the one branch the integration suite can't reach: the X-Request-Id fallback.
// In the real app the correlation middleware always sets X-Request-Id before coreProxy runs, so
// `res.getHeader("X-Request-Id")` is never undefined there. Here we call coreProxy directly with a
// response that has no such header to exercise the `?? crypto.randomUUID()` fallback.

const resolveBearer = jest.fn();
const requireReauth = jest.fn();
jest.unstable_mockModule("@/api/_shared/index.js", () => ({
  resolveBearer: (...args: unknown[]) => resolveBearer(...args),
  requireReauth: (...args: unknown[]) => requireReauth(...args),
}));

const { coreProxy } = await import("@/proxy/coreProxy.js");

function mockRes() {
  const res = {
    getHeader: jest.fn(() => undefined), // no X-Request-Id on the response
    setHeader: jest.fn(),
    status: jest.fn(() => res),
    type: jest.fn(() => res),
    send: jest.fn(() => res),
  };
  return res;
}

describe("coreProxy (unit) — correlation-id fallback", () => {
  beforeEach(() => {
    resolveBearer.mockReset();
    requireReauth.mockReset();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("generates an X-Request-Id when the response carries none", async () => {
    resolveBearer.mockResolvedValue("bearer-xyz");
    const fetchMock = jest.fn(async () => ({
      status: 200,
      text: async () => "ok",
      headers: { get: () => null },
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const req = {
      method: "GET",
      header: () => undefined, // no Origin / Referer / Idempotency-Key
      originalUrl: "/v1/guide/profile",
      body: undefined,
    } as unknown as Request;

    await coreProxy(req, mockRes() as unknown as Response);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    // Fell back to a generated UUID (not undefined, not empty).
    expect(headers["X-Request-Id"]).toMatch(/[0-9a-f-]{36}/i);
    expect(headers.Authorization).toBe("Bearer bearer-xyz");
  });
});
