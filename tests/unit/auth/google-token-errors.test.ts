import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { GoogleTokenError, refreshTokens } from "@/auth/google.js";

/**
 * N2 — a transient Google failure must never destroy the session.
 *
 * `postToken` used to throw a bare `Error` carrying only the HTTP status, so the caller
 * (`bearerForSession`) could not tell "this grant is dead" from "Google had a bad minute"
 * and treated both as a dead session — discarding the refresh token, which made the
 * logout UNRECOVERABLE. Google signals a genuinely dead grant with `invalid_grant`;
 * everything else is retryable.
 *
 * The classification is deliberately CONSERVATIVE: only an explicit `invalid_grant` /
 * `invalid_client` is fatal. An unparseable or unfamiliar error is treated as transient,
 * because wrongly keeping a session costs one extra 401 later, while wrongly clearing it
 * costs the user their session with nothing left to retry.
 */

/** A fetch Response stand-in whose json() may also reject (non-JSON error bodies). */
function errorResponse(status: number, json: unknown | (() => never)): Response {
  return {
    ok: false,
    status,
    json: async () => (typeof json === "function" ? (json as () => never)() : json),
  } as unknown as Response;
}

function mockFetch(impl: () => Promise<Response>): void {
  global.fetch = jest.fn(impl) as unknown as typeof fetch;
}

async function refreshFailure(): Promise<GoogleTokenError> {
  try {
    await refreshTokens("rt-1");
  } catch (err) {
    return err as GoogleTokenError;
  }
  throw new Error("expected refreshTokens to reject");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("postToken failure typing", () => {
  it("throws a GoogleTokenError carrying Google's error code and the HTTP status", async () => {
    mockFetch(async () =>
      errorResponse(400, { error: "invalid_grant", error_description: "Token has been expired" }),
    );

    const err = await refreshFailure();

    expect(err).toBeInstanceOf(GoogleTokenError);
    expect(err.code).toBe("invalid_grant");
    expect(err.status).toBe(400);
    expect(err.description).toBe("Token has been expired");
  });

  it("marks invalid_grant fatal — the grant really is dead, so the session must go", async () => {
    mockFetch(async () => errorResponse(400, { error: "invalid_grant" }));
    expect((await refreshFailure()).fatal).toBe(true);
  });

  it("marks invalid_client fatal — our credentials are rejected, retrying cannot help", async () => {
    mockFetch(async () => errorResponse(401, { error: "invalid_client" }));
    expect((await refreshFailure()).fatal).toBe(true);
  });

  it("marks a 500 NOT fatal — Google being down must not cost the user their session", async () => {
    mockFetch(async () => errorResponse(500, { error: "internal_failure" }));
    expect((await refreshFailure()).fatal).toBe(false);
  });

  it("marks a 429 NOT fatal — rate limiting is the definition of retryable", async () => {
    mockFetch(async () => errorResponse(429, { error: "rate_limit_exceeded" }));
    expect((await refreshFailure()).fatal).toBe(false);
  });

  it("marks a network failure NOT fatal and reports status 0", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const err = await refreshFailure();

    expect(err).toBeInstanceOf(GoogleTokenError);
    expect(err.fatal).toBe(false);
    expect(err.status).toBe(0);
  });

  it("treats an unparseable (non-JSON) error body as transient, not fatal", async () => {
    // A proxy/CDN returning an HTML 502 must not be read as "the grant is dead".
    mockFetch(async () =>
      errorResponse(502, () => {
        throw new SyntaxError("Unexpected token < in JSON");
      }),
    );

    const err = await refreshFailure();

    expect(err.fatal).toBe(false);
    expect(err.status).toBe(502);
    expect(err.code).toBeUndefined();
  });

  it("treats an unrecognised 400 error code as transient (conservative default)", async () => {
    mockFetch(async () => errorResponse(400, { error: "something_new" }));
    expect((await refreshFailure()).fatal).toBe(false);
  });

  it("handles a non-Error transport rejection without losing the classification", async () => {
    // Some runtimes/agents reject with a non-Error value; it must still be transient.
    mockFetch(async () => {
      throw "connection reset";
    });

    const err = await refreshFailure();

    expect(err).toBeInstanceOf(GoogleTokenError);
    expect(err.fatal).toBe(false);
    expect(err.status).toBe(0);
  });
});
