import { jest } from "@jest/globals";
import type { Request, Response } from "express";

/**
 * N2 — `bearerForSession` must distinguish a dead grant from a bad minute.
 *
 * Old behaviour: `catch { return null }` for ANY refresh failure. The caller turns null
 * into `requireReauth(res)` → `clearSession(res)`, so a single Google 5xx hitting a user
 * inside the pre-expiry refresh window logged them out with the refresh token discarded —
 * nothing left to retry with. These tests pin the new contract:
 *
 *   fatal (invalid_grant)  → resolve null  → caller clears the session (correct)
 *   transient (5xx/network) → THROW TransientAuthError → caller sends 503, session intact
 */
const readSession =
  jest.fn<
    (...args: unknown[]) => { idToken?: string; refreshToken?: string; expiresAt?: number } | null
  >();
const writeSession = jest.fn<(...args: unknown[]) => void>();
const refreshTokens = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("@/session.js", () => ({
  readSession: (...args: unknown[]) => readSession(...args),
  writeSession: (...args: unknown[]) => writeSession(...args),
}));

// The real GoogleTokenError — the classification under test is its `fatal` flag.
const { GoogleTokenError } = await import("@/auth/google.js");
jest.unstable_mockModule("@/auth/google.js", () => ({
  refreshTokens: (...args: unknown[]) => refreshTokens(...args),
  GoogleTokenError,
}));

const { resolveBearer } = await import("@/api/_shared/session.js");
const { TransientAuthError } = await import("@/api/_shared/errors.js");

const req = {} as Request;
const res = {} as Response;
const NOW = 1_000_000_000_000;

/** A session sitting inside the refresh window, with a refresh token available. */
function expiringSession() {
  return { idToken: "id-old", refreshToken: "rt-old", expiresAt: NOW + 30_000 };
}

beforeEach(() => {
  readSession.mockReset();
  writeSession.mockReset();
  refreshTokens.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("refresh failure classification", () => {
  it("clears nothing and THROWS TransientAuthError when Google returns a 5xx", async () => {
    readSession.mockReturnValue(expiringSession());
    refreshTokens.mockRejectedValue(new GoogleTokenError(503, undefined, "backend error"));

    await expect(resolveBearer(req, res)).rejects.toBeInstanceOf(TransientAuthError);
    // The invariant: the session cookie is untouched, so a retry can still succeed.
    expect(writeSession).not.toHaveBeenCalled();
  });

  it("THROWS TransientAuthError on a network failure", async () => {
    readSession.mockReturnValue(expiringSession());
    refreshTokens.mockRejectedValue(new GoogleTokenError(0, undefined, "fetch failed"));

    await expect(resolveBearer(req, res)).rejects.toBeInstanceOf(TransientAuthError);
  });

  it("resolves null on invalid_grant so the caller re-auths (the grant IS dead)", async () => {
    readSession.mockReturnValue(expiringSession());
    refreshTokens.mockRejectedValue(new GoogleTokenError(400, "invalid_grant"));

    await expect(resolveBearer(req, res)).resolves.toBeNull();
    expect(writeSession).not.toHaveBeenCalled();
  });

  it("resolves null on invalid_client", async () => {
    readSession.mockReturnValue(expiringSession());
    refreshTokens.mockRejectedValue(new GoogleTokenError(401, "invalid_client"));

    await expect(resolveBearer(req, res)).resolves.toBeNull();
  });

  it("treats a non-Google exception as transient (unknown cause ⇒ keep the session)", async () => {
    readSession.mockReturnValue(expiringSession());
    refreshTokens.mockRejectedValue(new Error("boom"));

    await expect(resolveBearer(req, res)).rejects.toBeInstanceOf(TransientAuthError);
  });
});

describe("refresh window", () => {
  it("refreshes at 4 minutes to expiry — the old 60s window left no room for a slow call", async () => {
    readSession.mockReturnValue({
      idToken: "id-old",
      refreshToken: "rt-old",
      expiresAt: NOW + 4 * 60_000,
    });
    refreshTokens.mockResolvedValue({ id_token: "id-new", access_token: "a", expires_in: 3600 });

    await expect(resolveBearer(req, res)).resolves.toBe("id-new");
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("still does not refresh when comfortably far from expiry", async () => {
    readSession.mockReturnValue({
      idToken: "id-old",
      refreshToken: "rt-old",
      expiresAt: NOW + 30 * 60_000,
    });

    await expect(resolveBearer(req, res)).resolves.toBe("id-old");
    expect(refreshTokens).not.toHaveBeenCalled();
  });
});

describe("single-flight refresh", () => {
  it("coalesces concurrent refreshes of the same token into ONE call to Google", async () => {
    readSession.mockReturnValue(expiringSession());
    let release!: (v: unknown) => void;
    refreshTokens.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const a = resolveBearer(req, res);
    const b = resolveBearer(req, res);
    release({ id_token: "id-new", access_token: "a", expires_in: 3600 });

    await expect(a).resolves.toBe("id-new");
    await expect(b).resolves.toBe("id-new");
    // Without coalescing both requests hit Google, and if Google rotates the refresh
    // token the losing writer persists an already-invalid one.
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("does not leak the in-flight entry — a later refresh calls Google again", async () => {
    readSession.mockReturnValue(expiringSession());
    refreshTokens.mockResolvedValue({ id_token: "id-new", access_token: "a", expires_in: 3600 });

    await resolveBearer(req, res);
    await resolveBearer(req, res);

    expect(refreshTokens).toHaveBeenCalledTimes(2);
  });

  it("does not leak the in-flight entry after a FAILED refresh", async () => {
    readSession.mockReturnValue(expiringSession());
    refreshTokens.mockRejectedValue(new GoogleTokenError(503));

    await expect(resolveBearer(req, res)).rejects.toBeInstanceOf(TransientAuthError);
    await expect(resolveBearer(req, res)).rejects.toBeInstanceOf(TransientAuthError);

    expect(refreshTokens).toHaveBeenCalledTimes(2);
  });
});
