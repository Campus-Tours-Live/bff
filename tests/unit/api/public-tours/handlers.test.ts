import { jest } from "@jest/globals";
import type { Request, Response } from "express";
import { getPublicTourDetail } from "@/api/public-tours/handlers.js";

// Unit test for the branches the integration suite can't reach. Through the app, the correlation
// middleware always sets X-Request-Id and the `/tours/:tourId` route always captures a segment, so
// three defensive fallbacks in `relayPublicTourRead` never fire there. Calling the handlers
// directly with a bare req/res exercises them, mirroring the coreProxy unit test.

function mockRes() {
  const res = {
    getHeader: jest.fn(() => undefined), // no X-Request-Id on the response
    status: jest.fn(() => res),
    type: jest.fn(() => res),
    send: jest.fn(() => res),
  };
  return res;
}

/** A Core Response whose body has NO content-type header — hits the `if (contentType)` false arm. */
function coreResNoContentType(body: string) {
  return {
    status: 200,
    text: jest.fn<() => Promise<string>>().mockResolvedValue(body),
    headers: { get: jest.fn(() => null) }, // content-type absent
  } as unknown as Response;
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("public-tours handlers — defensive fallbacks", () => {
  it("mints an X-Request-Id and tolerates a missing tourId + missing content-type", async () => {
    fetchMock.mockResolvedValue(coreResNoContentType("[]"));
    const res = mockRes();
    // `params: {}` → `req.params.tourId` is undefined → the `?? ""` fallback. `originalUrl` has no
    // `?` → the no-query branch. `getHeader` → undefined → the `?? crypto.randomUUID()` fallback.
    const req = { originalUrl: "/v1/tours/", params: {} } as unknown as Request;

    await getPublicTourDetail(req, res as unknown as Response);

    const [url, init] = fetchMock.mock.calls[0]!;
    // encodeURIComponent("") === "" → the path is just "/tours/".
    expect(String(url)).toBe("http://core.test/tours/");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Request-Id"]).toMatch(/[0-9a-f-]{36}/); // a freshly-minted uuid
    expect(res.type).not.toHaveBeenCalled(); // no content-type from Core → never typed
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith("[]");
  });
});
