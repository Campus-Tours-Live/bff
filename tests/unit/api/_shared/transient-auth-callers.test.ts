import { jest } from "@jest/globals";
import type { Request, Response } from "express";
import { TransientAuthError } from "@/api/_shared/errors.js";

/**
 * N2, caller half — the three `resolveBearer` call sites must translate a
 * `TransientAuthError` into "try again shortly", never into "sign in again".
 *
 * This is where the whole task is won or lost. `bearerForSession` can now preserve the
 * session across a Google outage, but if a caller lets the throw fall through to its
 * generic handler the user still gets logged out (or a 500), and the preserved refresh
 * token never gets used. The invariant under test: on a transient failure NOTHING calls
 * `requireReauth` — because `requireReauth` clears the session cookie.
 */
const resolveBearer = jest.fn<(...args: unknown[]) => Promise<string | null>>();
const requireReauth = jest.fn<(...args: unknown[]) => void>();
const authUpstreamUnavailable = jest.fn<(...args: unknown[]) => void>();
const coreUnavailable = jest.fn<(...args: unknown[]) => void>();
const sendProblem = jest.fn<(...args: unknown[]) => void>();

jest.unstable_mockModule("@/api/_shared/session.js", () => ({
  resolveBearer: (...args: unknown[]) => resolveBearer(...args),
}));
jest.unstable_mockModule("@/api/_shared/reauth.js", () => ({
  requireReauth: (...args: unknown[]) => requireReauth(...args),
  authUpstreamUnavailable: (...args: unknown[]) => authUpstreamUnavailable(...args),
}));
jest.unstable_mockModule("@/api/_shared/envelope.js", () => ({
  coreUnavailable: (...args: unknown[]) => coreUnavailable(...args),
}));
jest.unstable_mockModule("@/util/problem.js", () => ({
  sendProblem: (...args: unknown[]) => sendProblem(...args),
}));

const { withSession } = await import("@/api/_shared/with-session.js");
const { withMutation } = await import("@/api/_shared/with-mutation.js");

const req = {} as Request;
const res = {} as Response;

const wrappers: Array<[string, (h: never) => (req: Request, res: Response) => Promise<void>]> = [
  ["withSession", withSession as never],
  ["withMutation", withMutation as never],
];

describe.each(wrappers)("%s — transient refresh failure", (_name, wrap) => {
  beforeEach(() => {
    resolveBearer.mockReset();
    requireReauth.mockReset();
    authUpstreamUnavailable.mockReset();
    coreUnavailable.mockReset();
    sendProblem.mockReset();
  });

  it("answers 'temporarily unavailable' and NEVER re-auths (that would clear the session)", async () => {
    resolveBearer.mockRejectedValue(new TransientAuthError());
    const handler = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);

    await wrap(handler as never)(req, res);

    expect(authUpstreamUnavailable).toHaveBeenCalledTimes(1);
    expect(requireReauth).not.toHaveBeenCalled();
    // Not a 500 either — this is a known, retryable condition.
    expect(sendProblem).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("still re-auths when the bearer is genuinely absent (dead grant)", async () => {
    resolveBearer.mockResolvedValue(null);
    const handler = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);

    await wrap(handler as never)(req, res);

    expect(requireReauth).toHaveBeenCalledTimes(1);
    expect(authUpstreamUnavailable).not.toHaveBeenCalled();
  });

  it("does not swallow an unrelated exception from resolveBearer", async () => {
    resolveBearer.mockRejectedValue(new Error("programmer error"));
    const handler = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);

    await expect(wrap(handler as never)(req, res)).rejects.toThrow("programmer error");
    expect(requireReauth).not.toHaveBeenCalled();
    expect(authUpstreamUnavailable).not.toHaveBeenCalled();
  });
});
