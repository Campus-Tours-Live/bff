import { jest } from "@jest/globals";
import type { Response } from "express";

const clearSession = jest.fn();
jest.unstable_mockModule("@/session.js", () => ({
  clearSession: (...args: unknown[]) => clearSession(...args),
}));

const { requireReauth } = await import("@/api/_shared/reauth.js");

function mockRes() {
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
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    getHeader(name: string): string | undefined {
      return name === "X-Request-Id" ? "req-7" : undefined;
    },
  };
  return res;
}

describe("requireReauth", () => {
  beforeEach(() => {
    clearSession.mockReset();
  });

  it("clears the session", () => {
    const res = mockRes();
    requireReauth(res as unknown as Response);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(clearSession).toHaveBeenCalledWith(res);
  });

  it("sets the Auth-Required and Cache-Control headers", () => {
    const res = mockRes();
    requireReauth(res as unknown as Response);
    expect(res.headers["Auth-Required"]).toBe("reauthenticate");
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("sends a 401 problem with code SESSION_EXPIRED", () => {
    const res = mockRes();
    requireReauth(res as unknown as Response);
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toBe("application/problem+json");
    expect(JSON.parse(res.body as string)).toMatchObject({
      status: 401,
      title: "Authentication required",
      code: "SESSION_EXPIRED",
    });
  });
});
