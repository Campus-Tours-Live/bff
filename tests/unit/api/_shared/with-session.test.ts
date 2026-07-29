import { jest } from "@jest/globals";
import type { Request, Response } from "express";
import { CoreAuthError, CoreError, PendingSessionExpiredError } from "@/api/_shared/errors.js";

const resolveBearer = jest.fn<(...args: unknown[]) => Promise<string | null>>();
const requireReauth = jest.fn<(...args: unknown[]) => void>();
const coreUnavailable = jest.fn<(...args: unknown[]) => void>();
const sendProblem = jest.fn<(...args: unknown[]) => void>();
const clearSession = jest.fn<(...args: unknown[]) => void>();

jest.unstable_mockModule("@/api/_shared/session.js", () => ({
  resolveBearer: (...args: unknown[]) => resolveBearer(...args),
}));
jest.unstable_mockModule("@/session.js", () => ({
  clearSession: (...args: unknown[]) => clearSession(...args),
}));
jest.unstable_mockModule("@/api/_shared/reauth.js", () => ({
  requireReauth: (...args: unknown[]) => requireReauth(...args),
  // N2: the transient-refresh path. Exercised in transient-auth-callers.test.ts; stubbed
  // here so this suite's module graph still resolves.
  authUpstreamUnavailable: jest.fn(),
}));
jest.unstable_mockModule("@/api/_shared/envelope.js", () => ({
  coreUnavailable: (...args: unknown[]) => coreUnavailable(...args),
}));
jest.unstable_mockModule("@/util/problem.js", () => ({
  sendProblem: (...args: unknown[]) => sendProblem(...args),
}));

const { withSession } = await import("@/api/_shared/with-session.js");
const { CoreClient } = await import("@/api/_shared/core-client.js");

const req = {} as Request;
const res = {} as Response;

describe("withSession", () => {
  beforeEach(() => {
    resolveBearer.mockReset();
    requireReauth.mockReset();
    coreUnavailable.mockReset();
    sendProblem.mockReset();
    clearSession.mockReset();
  });

  it("calls requireReauth and does NOT call the handler when there is no bearer", async () => {
    resolveBearer.mockResolvedValue(null);
    const handler = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    await withSession(handler as never)(req, res);
    expect(handler).not.toHaveBeenCalled();
    expect(requireReauth).toHaveBeenCalledWith(res);
  });

  it("invokes the handler with (req, res, CoreClient) when a bearer resolves", async () => {
    resolveBearer.mockResolvedValue("bearer-abc");
    const handler = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    await withSession(handler as never)(req, res);

    expect(handler).toHaveBeenCalledTimes(1);
    const [pReq, pRes, core] = handler.mock.calls[0];
    expect(pReq).toBe(req);
    expect(pRes).toBe(res);
    expect(core).toBeInstanceOf(CoreClient);
    expect(requireReauth).not.toHaveBeenCalled();
  });

  it("maps a CoreAuthError thrown by the handler to requireReauth", async () => {
    resolveBearer.mockResolvedValue("bearer");
    const handler = jest
      .fn<(...a: unknown[]) => Promise<void>>()
      .mockRejectedValue(new CoreAuthError());
    await withSession(handler as never)(req, res);
    expect(requireReauth).toHaveBeenCalledWith(res);
    expect(coreUnavailable).not.toHaveBeenCalled();
  });

  it("maps a CoreError with status >= 500 to coreUnavailable (502)", async () => {
    resolveBearer.mockResolvedValue("bearer");
    const handler = jest
      .fn<(...a: unknown[]) => Promise<void>>()
      .mockRejectedValue(new CoreError(503));
    await withSession(handler as never)(req, res);
    expect(coreUnavailable).toHaveBeenCalledWith(res);
    expect(sendProblem).not.toHaveBeenCalled();
  });

  it("surfaces a CoreError with status < 500 via sendProblem with the real status and UPSTREAM_ERROR", async () => {
    resolveBearer.mockResolvedValue("bearer");
    const handler = jest
      .fn<(...a: unknown[]) => Promise<void>>()
      .mockRejectedValue(new CoreError(404));
    await withSession(handler as never)(req, res);
    expect(sendProblem).toHaveBeenCalledWith(res, 404, "Upstream request failed", {
      code: "UPSTREAM_ERROR",
    });
    expect(coreUnavailable).not.toHaveBeenCalled();
  });

  /**
   * CTL-97 Task 4 — the central pending-expiry guard, proven through `withSession` itself so
   * this exercises the SAME code path every protected `/v1` route goes through (not just
   * `/userinfo` or `/dashboard` individually).
   */
  it("on PendingSessionExpiredError: destroys the session, answers 401 SESSION_EXPIRED, and makes NO Core call", async () => {
    resolveBearer.mockRejectedValue(new PendingSessionExpiredError());
    const handler = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);

    await withSession(handler as never)(req, res);

    expect(clearSession).toHaveBeenCalledWith(res);
    expect(sendProblem).toHaveBeenCalledWith(res, 401, expect.any(String), {
      code: "SESSION_EXPIRED",
    });
    // The handler is where a Core client would be constructed and used — never invoked here,
    // so no Core call happens for this request.
    expect(handler).not.toHaveBeenCalled();
    expect(requireReauth).not.toHaveBeenCalled();
    expect(coreUnavailable).not.toHaveBeenCalled();
  });

  it("maps any other thrown error to a 500 INTERNAL problem", async () => {
    resolveBearer.mockResolvedValue("bearer");
    const handler = jest
      .fn<(...a: unknown[]) => Promise<void>>()
      .mockRejectedValue(new Error("boom"));
    await withSession(handler as never)(req, res);
    expect(sendProblem).toHaveBeenCalledWith(res, 500, "Internal server error", {
      code: "INTERNAL",
    });
    expect(requireReauth).not.toHaveBeenCalled();
    expect(coreUnavailable).not.toHaveBeenCalled();
  });
});
