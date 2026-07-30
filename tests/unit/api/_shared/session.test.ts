import { jest } from "@jest/globals";
import type { Request, Response } from "express";

const readSession = jest.fn<
  (...args: unknown[]) => {
    provisioningStatus?: string;
    idToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    currentRole?: string;
    pendingSince?: number;
    pendingExpiresAt?: number;
  } | null
>();
const writeSession = jest.fn<(...args: unknown[]) => void>();
const refreshTokens = jest.fn<
  (...args: unknown[]) => Promise<{
    id_token?: string;
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>
>();

jest.unstable_mockModule("@/session.js", () => ({
  readSession: (...args: unknown[]) => readSession(...args),
  writeSession: (...args: unknown[]) => writeSession(...args),
}));
// The REAL GoogleTokenError — bearerForSession branches on `instanceof` + `.fatal` to
// decide whether a refresh failure may destroy the session, so a stand-in would never
// match and every failure would look transient. (N2)
const { GoogleTokenError } = await import("@/auth/google.js");
jest.unstable_mockModule("@/auth/google.js", () => ({
  refreshTokens: (...args: unknown[]) => refreshTokens(...args),
  GoogleTokenError,
}));

const { resolveBearer } = await import("@/api/_shared/session.js");
const { TransientAuthError, PendingSessionExpiredError } = await import("@/api/_shared/errors.js");
const { clock } = await import("@/lib/clock.js");

const req = {} as Request;
const res = {} as Response;

const NOW = 1_000_000_000_000;
const REAL_CLOCK_NOW = clock.now;

describe("resolveBearer / bearerForSession", () => {
  beforeEach(() => {
    readSession.mockReset();
    writeSession.mockReset();
    refreshTokens.mockReset();
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clock.now = REAL_CLOCK_NOW;
  });

  it("returns null when there is no session", async () => {
    readSession.mockReturnValue(null);
    await expect(resolveBearer(req, res)).resolves.toBeNull();
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("returns null when the session has no idToken", async () => {
    readSession.mockReturnValue({ expiresAt: NOW + 10 * 60_000 });
    await expect(resolveBearer(req, res)).resolves.toBeNull();
  });

  it("returns the idToken when not near expiry and does not refresh", async () => {
    readSession.mockReturnValue({ idToken: "id-current", expiresAt: NOW + 10 * 60_000 });
    await expect(resolveBearer(req, res)).resolves.toBe("id-current");
    expect(refreshTokens).not.toHaveBeenCalled();
    expect(writeSession).not.toHaveBeenCalled();
  });

  it("returns the idToken (no refresh) when expiresAt is undefined", async () => {
    readSession.mockReturnValue({ idToken: "id-no-exp" });
    await expect(resolveBearer(req, res)).resolves.toBe("id-no-exp");
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("does not refresh when near expiry but there is no refreshToken", async () => {
    readSession.mockReturnValue({ idToken: "id-old", expiresAt: NOW + 30_000 });
    await expect(resolveBearer(req, res)).resolves.toBe("id-old");
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("refreshes near expiry, rotates the cookie, and returns the new idToken", async () => {
    readSession.mockReturnValue({
      idToken: "id-old",
      refreshToken: "refresh-old",
      expiresAt: NOW + 30_000, // < 60s away
    });
    refreshTokens.mockResolvedValue({
      id_token: "id-new",
      access_token: "access-new",
      refresh_token: "refresh-new",
      expires_in: 3600,
    });

    await expect(resolveBearer(req, res)).resolves.toBe("id-new");
    expect(refreshTokens).toHaveBeenCalledWith("refresh-old");
    expect(writeSession).toHaveBeenCalledTimes(1);
    expect(writeSession).toHaveBeenCalledWith(res, {
      idToken: "id-new",
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresAt: NOW + 3600 * 1000,
    });
  });

  it("preserves currentRole across a silent refresh (Profile Contract v2)", async () => {
    readSession.mockReturnValue({
      idToken: "id-old",
      refreshToken: "refresh-old",
      expiresAt: NOW + 30_000,
      currentRole: "GUIDE",
    });
    refreshTokens.mockResolvedValue({
      id_token: "id-new",
      access_token: "access-new",
      refresh_token: "refresh-new",
      expires_in: 3600,
    });

    await expect(resolveBearer(req, res)).resolves.toBe("id-new");
    expect(writeSession).toHaveBeenCalledWith(res, {
      idToken: "id-new",
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresAt: NOW + 3600 * 1000,
      currentRole: "GUIDE",
    });
  });

  it("falls back to the old idToken/refreshToken when the refresh response omits them", async () => {
    readSession.mockReturnValue({
      idToken: "id-old",
      refreshToken: "refresh-old",
      expiresAt: NOW + 30_000,
    });
    refreshTokens.mockResolvedValue({
      access_token: "access-new",
      expires_in: 1800,
      // no id_token, no refresh_token
    });

    await expect(resolveBearer(req, res)).resolves.toBe("id-old");
    expect(writeSession).toHaveBeenCalledWith(res, {
      idToken: "id-old",
      accessToken: "access-new",
      refreshToken: "refresh-old",
      expiresAt: NOW + 1800 * 1000,
    });
  });

  // N2 REPLACED THE OLD ASSERTION HERE. This used to expect `resolves.toBeNull()` for ANY
  // refresh failure, i.e. "a bare Error logs the user out". That was the bug: null makes the
  // caller requireReauth → clearSession → the refresh token is discarded, so a transient
  // Google failure became an unrecoverable logout. An untyped error is now treated as
  // transient (the session survives); only an explicit invalid_grant clears it. Full
  // classification matrix: session-resilience.test.ts.
  it("throws TransientAuthError when the refresh fails for an unrecognised reason", async () => {
    readSession.mockReturnValue({
      idToken: "id-old",
      refreshToken: "refresh-old",
      expiresAt: NOW + 30_000,
    });
    refreshTokens.mockRejectedValue(new Error("refresh failed"));

    await expect(resolveBearer(req, res)).rejects.toBeInstanceOf(TransientAuthError);
    expect(writeSession).not.toHaveBeenCalled();
  });

  it("returns null when the grant is genuinely dead (invalid_grant → re-auth)", async () => {
    readSession.mockReturnValue({
      idToken: "id-old",
      refreshToken: "refresh-old",
      expiresAt: NOW + 30_000,
    });
    refreshTokens.mockRejectedValue(new GoogleTokenError(400, "invalid_grant"));

    await expect(resolveBearer(req, res)).resolves.toBeNull();
    expect(writeSession).not.toHaveBeenCalled();
  });

  /**
   * CTL-97 Task 4 — the central pending-expiry guard. A PENDING session (authenticated with
   * Google, not yet provisioned in Core) carries a 24h ABSOLUTE lifetime; once
   * `clock.now() >= pendingExpiresAt` the guard must throw BEFORE returning any bearer and
   * BEFORE any Core call (there is no Core call inside `bearerForSession` itself — the "no Core
   * call" guarantee is proven end-to-end through `withSession`, see with-session.test.ts).
   */
  describe("pending session expiry guard", () => {
    const PENDING_EXPIRES_AT = NOW + 12 * 60 * 60_000; // arbitrary, well inside a 24h window

    function pendingSession(overrides: Record<string, unknown> = {}) {
      return {
        provisioningStatus: "PENDING",
        pendingSince: PENDING_EXPIRES_AT - 24 * 60 * 60_000,
        pendingExpiresAt: PENDING_EXPIRES_AT,
        idToken: "id-pending",
        ...overrides,
      };
    }

    it("now < pendingExpiresAt → valid, returns the bearer, no throw", async () => {
      clock.now = () => PENDING_EXPIRES_AT - 1;
      readSession.mockReturnValue(pendingSession());

      await expect(resolveBearer(req, res)).resolves.toBe("id-pending");
    });

    it("now === pendingExpiresAt → EXPIRED (boundary)", async () => {
      clock.now = () => PENDING_EXPIRES_AT;
      readSession.mockReturnValue(pendingSession());

      await expect(resolveBearer(req, res)).rejects.toBeInstanceOf(PendingSessionExpiredError);
      expect(writeSession).not.toHaveBeenCalled();
    });

    it("now > pendingExpiresAt → EXPIRED", async () => {
      clock.now = () => PENDING_EXPIRES_AT + 1;
      readSession.mockReturnValue(pendingSession());

      const err: unknown = await resolveBearer(req, res).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PendingSessionExpiredError);
      expect((err as InstanceType<typeof PendingSessionExpiredError>).code).toBe("SESSION_EXPIRED");
    });

    it("a PROVISIONED session ignores pending-shaped fields entirely — state is read from provisioningStatus, never inferred from pendingExpiresAt's presence", async () => {
      // Same "expired" clock value as above, but provisioningStatus is PROVISIONED — must NOT throw.
      clock.now = () => PENDING_EXPIRES_AT + 1;
      readSession.mockReturnValue({
        provisioningStatus: "PROVISIONED",
        idToken: "id-provisioned",
        // A stray pending-looking field that must be ignored outright.
        pendingExpiresAt: PENDING_EXPIRES_AT,
      });

      await expect(resolveBearer(req, res)).resolves.toBe("id-provisioned");
    });
  });

  describe("refresh does not extend a PENDING session's absolute lifetime", () => {
    it("keeps pendingSince/pendingExpiresAt/provisioningStatus UNCHANGED across a near-token-expiry refresh", async () => {
      const pendingExpiresAt = NOW + 1000; // still valid; unrelated to the near-token-expiry check
      const pendingSince = NOW - 1000;
      clock.now = () => NOW;
      readSession.mockReturnValue({
        provisioningStatus: "PENDING",
        pendingSince,
        pendingExpiresAt,
        idToken: "id-old",
        refreshToken: "refresh-old",
        expiresAt: NOW + 30_000, // inside the 5-min refresh window
      });
      refreshTokens.mockResolvedValue({
        id_token: "id-new",
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 3600,
      });

      await expect(resolveBearer(req, res)).resolves.toBe("id-new");
      expect(writeSession).toHaveBeenCalledTimes(1);
      expect(writeSession).toHaveBeenCalledWith(
        res,
        {
          provisioningStatus: "PENDING",
          pendingSince,
          pendingExpiresAt,
          idToken: "id-new",
          accessToken: "access-new",
          refreshToken: "refresh-new",
          expiresAt: NOW + 3600 * 1000,
        },
        1, // remaining seconds until pendingExpiresAt — NOT the default 7-day TTL
      );
    });
  });
});
