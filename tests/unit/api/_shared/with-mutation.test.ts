import { jest } from "@jest/globals";
import { CoreError, CoreAuthError } from "@/api/_shared/errors.js";

const resolveBearer = jest.fn(() => Promise.resolve("tok"));
const requireReauth = jest.fn();
const coreUnavailable = jest.fn();
const sendProblem = jest.fn();

jest.unstable_mockModule("@/api/_shared/session.js", () => ({
  resolveBearer: (...args: unknown[]) => resolveBearer(...args),
}));
jest.unstable_mockModule("@/api/_shared/reauth.js", () => ({
  requireReauth: (...args: unknown[]) => requireReauth(...args),
}));
jest.unstable_mockModule("@/api/_shared/envelope.js", () => ({
  coreUnavailable: (...args: unknown[]) => coreUnavailable(...args),
}));
jest.unstable_mockModule("@/util/problem.js", () => ({
  sendProblem: (...args: unknown[]) => sendProblem(...args),
}));

const { withMutation } = await import("@/api/_shared/with-mutation.js");

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  sent: unknown;
  status(code: number): MockResponse;
  type(contentType: string): MockResponse;
  send(body: unknown): MockResponse;
  setHeader(key: string, value: string): void;
}

function res(): MockResponse {
  const r: MockResponse = { statusCode: 200, headers: {}, sent: undefined } as never;
  r.status = (s: number) => ((r.statusCode = s), r);
  r.type = (t: string) => ((r.headers["content-type"] = t), r);
  r.send = (b: unknown) => ((r.sent = b), r);
  r.setHeader = (k: string, v: string) => (r.headers[k] = v);
  return r;
}

describe("withMutation", () => {
  beforeEach(() => {
    resolveBearer.mockClear();
    requireReauth.mockClear();
    coreUnavailable.mockClear();
    sendProblem.mockClear();
  });

  it("relays a Core 4xx verbatim (status + content-type + body)", async () => {
    resolveBearer.mockResolvedValueOnce("tok");
    const r = res();
    const handler = jest.fn(async () => {
      throw new CoreError(422, '{"title":"slot taken"}', "application/problem+json");
    });
    await withMutation(handler as never)({} as never, r);
    expect(r.statusCode).toBe(422);
    expect(r.headers["content-type"]).toBe("application/problem+json");
    expect(r.sent).toBe('{"title":"slot taken"}');
  });

  it("maps a Core 5xx to 502", async () => {
    resolveBearer.mockResolvedValueOnce("tok");
    const r = res();
    const handler = jest.fn(async () => {
      throw new CoreError(500);
    });
    await withMutation(handler as never)({} as never, r);
    expect(coreUnavailable).toHaveBeenCalledWith(r);
  });

  it("maps CoreAuthError to a re-auth 401", async () => {
    resolveBearer.mockResolvedValueOnce("tok");
    const r = res();
    const handler = jest.fn(async () => {
      throw new CoreAuthError();
    });
    await withMutation(handler as never)({} as never, r);
    expect(requireReauth).toHaveBeenCalledWith(r);
  });
});
