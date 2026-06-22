import { jest } from "@jest/globals";
import type { Request, Response } from "express";

const readSession = jest.fn();
const writeSession = jest.fn();
const refreshTokens = jest.fn();

jest.unstable_mockModule("@/session.js", () => ({
  readSession: (...args: unknown[]) => readSession(...args),
  writeSession: (...args: unknown[]) => writeSession(...args),
}));
jest.unstable_mockModule("@/auth/google.js", () => ({
  refreshTokens: (...args: unknown[]) => refreshTokens(...args),
}));

const { resolveBearer } = await import("@/api/_shared/session.js");

const req = {} as Request;
const res = {} as Response;

const NOW = 1_000_000_000_000;

describe("resolveBearer / bearerForSession", () => {
  beforeEach(() => {
    readSession.mockReset();
    writeSession.mockReset();
    refreshTokens.mockReset();
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it("returns null when the refresh throws (force re-auth)", async () => {
    readSession.mockReturnValue({
      idToken: "id-old",
      refreshToken: "refresh-old",
      expiresAt: NOW + 30_000,
    });
    refreshTokens.mockRejectedValue(new Error("refresh failed"));

    await expect(resolveBearer(req, res)).resolves.toBeNull();
    expect(writeSession).not.toHaveBeenCalled();
  });
});
