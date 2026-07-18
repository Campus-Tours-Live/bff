import { jest } from "@jest/globals";
import type { Request, Response } from "express";

// Unit test for the one branch the integration suite can't reach: the X-Request-Id fallback.
// In the real app the correlation middleware always sets X-Request-Id before coreProxy runs, so
// `res.getHeader("X-Request-Id")` is never undefined there. Here we call coreProxy directly with a
// response that has no such header to exercise the `?? crypto.randomUUID()` fallback.

const resolveBearer = jest.fn<(...args: unknown[]) => Promise<string | null>>();
const requireReauth = jest.fn<(...args: unknown[]) => void>();
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
    const fetchMock = jest.fn<typeof fetch>(
      async () =>
        ({
          status: 200,
          text: async () => "ok",
          headers: { get: () => null },
        }) as unknown as globalThis.Response,
    );
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

// Multi-topic filter (CTL-16): the bff proxies /v1/tours generically by forwarding
// req.originalUrl verbatim (coreProxy.ts:39), so it should never need to understand
// `topic`/geo params itself. These tests verify that pass-through contract by inspecting
// the URL the mocked upstream `fetch` actually receives, and that an upstream 422
// problem+json response is relayed unchanged (not swallowed into a 500). GET /v1/tours
// is a public read (isPublicGet), so no bearer/session setup is needed here.
describe("coreProxy (unit) — /v1/tours query passthrough", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockFetchOk(body = "[]") {
    const fetchMock = jest.fn<typeof fetch>(
      async () =>
        ({
          status: 200,
          text: async () => body,
          headers: { get: () => "application/json" },
        }) as unknown as globalThis.Response,
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("forwards repeated topic params to core unchanged", async () => {
    const fetchMock = mockFetchOk();
    const req = {
      method: "GET",
      header: () => undefined,
      originalUrl: "/v1/tours?topic=GENERAL_CAMPUS&topic=DORM_HOUSING",
      body: undefined,
    } as unknown as Request;

    await coreProxy(req, mockRes() as unknown as Response);

    const target = fetchMock.mock.calls[0]![0] as string;
    expect(new URL(target).searchParams.getAll("topic")).toEqual([
      "GENERAL_CAMPUS",
      "DORM_HOUSING",
    ]);
  });

  it("forwards arbitrary extra query params (geo) unchanged", async () => {
    const fetchMock = mockFetchOk();
    const req = {
      method: "GET",
      header: () => undefined,
      originalUrl: "/v1/tours?nearLat=37.42&nearLon=-122.08&radiusMiles=50",
      body: undefined,
    } as unknown as Request;

    await coreProxy(req, mockRes() as unknown as Response);

    const target = fetchMock.mock.calls[0]![0] as string;
    const url = new URL(target);
    expect(url.searchParams.get("nearLat")).toBe("37.42");
    expect(url.searchParams.get("nearLon")).toBe("-122.08");
    expect(url.searchParams.get("radiusMiles")).toBe("50");
  });

  it("passes an upstream 422 problem+json response through unchanged (not converted to 500)", async () => {
    const problemBody = JSON.stringify({
      type: "about:blank",
      title: "Invalid topic",
      status: 422,
    });
    const fetchMock = jest.fn<typeof fetch>(
      async () =>
        ({
          status: 422,
          text: async () => problemBody,
          headers: { get: () => "application/problem+json" },
        }) as unknown as globalThis.Response,
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const req = {
      method: "GET",
      header: () => undefined,
      originalUrl: "/v1/tours?topic=NOPE",
      body: undefined,
    } as unknown as Request;
    const res = mockRes();

    await coreProxy(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.type).toHaveBeenCalledWith("application/problem+json");
    expect(res.send).toHaveBeenCalledWith(problemBody);
  });
});
