import type { Request, Response } from "express";
import {
  type AuthTx,
  type PendingSessionData,
  type SessionData,
  clearAuthTx,
  clearSession,
  convertToProvisioned,
  isRole,
  readAuthTx,
  readSession,
  writeAuthTx,
  writePendingSession,
  writeSession,
} from "@/session.js";
import { clock } from "@/lib/clock.js";

/** A res that records every Set-Cookie value appended. */
function mockRes() {
  const cookies: string[] = [];
  const res = {
    cookies,
    append(name: string, value: string) {
      if (name === "Set-Cookie") cookies.push(value);
      return res;
    },
  };
  return res;
}

/** Build a req whose `headers.cookie` is the serialized Set-Cookie value. */
function reqFromSetCookie(setCookie: string): Request {
  // A Set-Cookie value looks like "name=value; Path=/; ...". The Cookie header
  // a browser would echo back is just the leading "name=value" pair.
  const pair = setCookie.split(";")[0];
  return { headers: { cookie: pair } } as unknown as Request;
}

function reqWithCookie(cookie: string | undefined): Request {
  return { headers: { cookie } } as unknown as Request;
}

describe("session cookie", () => {
  describe("writeSession / readSession", () => {
    it("round-trips a SessionData", () => {
      const res = mockRes();
      const data: SessionData = {
        accountState: "PROVISIONED",
        idToken: "id-tok",
        accessToken: "acc-tok",
        refreshToken: "ref-tok",
        expiresAt: 1234567890,
      };
      writeSession(res as unknown as Response, data);

      const setCookie = res.cookies[0];
      expect(setCookie).toMatch(/^ctl_sess=/);

      const req = reqFromSetCookie(setCookie);
      expect(readSession(req)).toEqual(data);
    });

    it("returns null for a tampered / garbage ctl_sess cookie", () => {
      const req = reqWithCookie("ctl_sess=not-a-valid-token");
      expect(readSession(req)).toBeNull();
    });

    it("returns null when the cookie is tampered after a valid write", () => {
      const res = mockRes();
      writeSession(res as unknown as Response, { accountState: "PROVISIONED", idToken: "id-tok" });
      const setCookie = res.cookies[0];
      const value = setCookie.split(";")[0].slice("ctl_sess=".length);
      // Flip a character so the GCM auth tag no longer verifies.
      const tampered = value.slice(0, -1) + (value.endsWith("A") ? "B" : "A");
      const req = reqWithCookie(`ctl_sess=${tampered}`);
      expect(readSession(req)).toBeNull();
    });

    it("returns null when the cookie is missing", () => {
      expect(readSession(reqWithCookie(undefined))).toBeNull();
      expect(readSession(reqWithCookie(""))).toBeNull();
      expect(readSession(reqWithCookie("other=1"))).toBeNull();
    });

    it("sets a cookie with httpOnly, sameSite=lax, path=/, maxAge and no secure in test", () => {
      const res = mockRes();
      writeSession(res as unknown as Response, { accountState: "PROVISIONED", idToken: "x" }, 100);
      const setCookie = res.cookies[0];
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toMatch(/Max-Age=100/i);
      // config.isProd is false in test → no Secure attribute.
      expect(setCookie).not.toMatch(/Secure/i);
    });

    it("uses the default maxAge (7 days) when none is given", () => {
      const res = mockRes();
      writeSession(res as unknown as Response, { accountState: "PROVISIONED", idToken: "x" });
      expect(res.cookies[0]).toMatch(new RegExp(`Max-Age=${60 * 60 * 24 * 7}`, "i"));
    });

    it("round-trips currentRole (Profile Contract v2 session field)", () => {
      const res = mockRes();
      const data: SessionData = {
        accountState: "PROVISIONED",
        idToken: "id-tok",
        currentRole: "GUIDE",
      };
      writeSession(res as unknown as Response, data);
      const req = reqFromSetCookie(res.cookies[0]);
      expect(readSession(req)).toEqual(data);
    });

    it("currentRole is absent (not undefined-serialized) on an old-shape session", () => {
      const res = mockRes();
      writeSession(res as unknown as Response, { accountState: "PROVISIONED", idToken: "id-tok" });
      const req = reqFromSetCookie(res.cookies[0]);
      const session = readSession(req);
      expect(session).not.toBeNull();
      expect(session?.accountState).toBe("PROVISIONED");
      expect(
        session?.accountState === "PROVISIONED" ? session.currentRole : "wrong-branch",
      ).toBeUndefined();
    });
  });

  describe("isRole", () => {
    it.each(["GUIDE", "PARTICIPANT"] as const)("accepts %s", (role) => {
      expect(isRole(role)).toBe(true);
    });

    it.each([
      "guide", // wrong case
      "participant",
      "ADMIN",
      "",
      null,
      undefined,
      42,
      {},
      ["GUIDE"],
    ])("rejects garbage/stale value %p", (value) => {
      expect(isRole(value)).toBe(false);
    });
  });

  describe("clearSession", () => {
    it("sets the cookie with maxAge 0", () => {
      const res = mockRes();
      clearSession(res as unknown as Response);
      const setCookie = res.cookies[0];
      expect(setCookie).toMatch(/^ctl_sess=;/);
      expect(setCookie).toMatch(/Max-Age=0/i);
      expect(setCookie).toContain("HttpOnly");
    });
  });

  /**
   * CTL-97 Task 4 — CRITICAL cutover requirement: a cookie written by code that pre-dates the
   * `accountState` discriminator (`{ idToken, refreshToken, expiresAt, currentRole? }`, no
   * `accountState` at all) must normalize to PROVISIONED on read, and must NOT be logged out —
   * every session in the wild today IS an established, provisioned account.
   */
  describe("legacy sessions (pre-Task-4 cookies with no accountState)", () => {
    it("a legacy cookie (no accountState) normalizes to PROVISIONED on read and still returns its bearer", () => {
      const res = mockRes();
      // Deliberately bypass the SessionData type to simulate a cookie written by code that
      // predates the `accountState` field entirely — the real legacy shape.
      const legacyPayload = {
        idToken: "legacy-id-tok",
        refreshToken: "legacy-refresh-tok",
        expiresAt: 1234567890,
      } as unknown as SessionData;
      writeSession(res as unknown as Response, legacyPayload);

      const req = reqFromSetCookie(res.cookies[0]);
      const session = readSession(req);

      expect(session).toEqual({
        accountState: "PROVISIONED",
        idToken: "legacy-id-tok",
        refreshToken: "legacy-refresh-tok",
        expiresAt: 1234567890,
      });
      // Still usable as a bearer source — the whole point of normalizing rather than rejecting.
      expect(session?.idToken).toBe("legacy-id-tok");
    });

    it("a legacy cookie that already carried currentRole keeps it, now under accountState: PROVISIONED", () => {
      const res = mockRes();
      const legacyPayload = {
        idToken: "legacy-id-tok",
        currentRole: "GUIDE",
      } as unknown as SessionData;
      writeSession(res as unknown as Response, legacyPayload);

      const req = reqFromSetCookie(res.cookies[0]);
      const session = readSession(req);
      expect(session).toEqual({
        accountState: "PROVISIONED",
        idToken: "legacy-id-tok",
        currentRole: "GUIDE",
      });
    });
  });

  describe("writePendingSession (CTL-97 Task 4 — 24h absolute pending lifetime)", () => {
    const REAL_NOW = clock.now;

    afterEach(() => {
      clock.now = REAL_NOW;
    });

    it("writes accountState PENDING with pendingSince/pendingExpiresAt from the SERVER clock (not token iat), 24h apart", () => {
      const FIXED_NOW = 1_700_000_000_000;
      clock.now = () => FIXED_NOW;

      const res = mockRes();
      writePendingSession(res as unknown as Response, {
        idToken: "id-tok",
        refreshToken: "refresh-tok",
        expiresAt: FIXED_NOW + 3_600_000,
      });

      const req = reqFromSetCookie(res.cookies[0]);
      const session = readSession(req);

      expect(session?.accountState).toBe("PENDING");
      const pending = session as PendingSessionData;
      expect(pending.pendingSince).toBe(FIXED_NOW);
      expect(pending.pendingExpiresAt).toBe(FIXED_NOW + 24 * 60 * 60 * 1000);
      // Carries the token fields forward.
      expect(pending.idToken).toBe("id-tok");
      expect(pending.refreshToken).toBe("refresh-tok");
      expect(pending.expiresAt).toBe(FIXED_NOW + 3_600_000);
      // NO currentRole — there is no Core account yet to have chosen one.
      expect((pending as unknown as { currentRole?: unknown }).currentRole).toBeUndefined();
    });

    it("sets the cookie's own Max-Age to 24h", () => {
      clock.now = () => 1_700_000_000_000;
      const res = mockRes();
      writePendingSession(res as unknown as Response, { idToken: "id-tok" });
      expect(res.cookies[0]).toMatch(new RegExp(`Max-Age=${60 * 60 * 24}\\b`, "i"));
    });
  });

  describe("convertToProvisioned (CTL-97 Task 4)", () => {
    it("drops the pending fields, sets currentRole, and restores the normal 7d TTL", () => {
      const res = mockRes();
      const pending: PendingSessionData = {
        accountState: "PENDING",
        pendingSince: 1_700_000_000_000,
        pendingExpiresAt: 1_700_086_400_000,
        idToken: "id-tok",
        refreshToken: "refresh-tok",
        expiresAt: 1_700_003_600_000,
      };

      convertToProvisioned(res as unknown as Response, pending, "GUIDE");

      const setCookie = res.cookies[0];
      expect(setCookie).toMatch(new RegExp(`Max-Age=${60 * 60 * 24 * 7}\\b`, "i"));

      const req = reqFromSetCookie(setCookie);
      const session = readSession(req);
      expect(session).toEqual({
        accountState: "PROVISIONED",
        currentRole: "GUIDE",
        idToken: "id-tok",
        refreshToken: "refresh-tok",
        expiresAt: 1_700_003_600_000,
      });
      // The pending-only fields must be GONE, not just falsy.
      expect(session).not.toHaveProperty("pendingSince");
      expect(session).not.toHaveProperty("pendingExpiresAt");
    });

    it("accepts a plain token-fields object (no prior SessionData) and sets currentRole undefined when omitted", () => {
      const res = mockRes();
      convertToProvisioned(res as unknown as Response, { idToken: "id-tok" });

      const req = reqFromSetCookie(res.cookies[0]);
      const session = readSession(req);
      expect(session?.accountState).toBe("PROVISIONED");
      expect(
        session?.accountState === "PROVISIONED" ? session.currentRole : "wrong-branch",
      ).toBeUndefined();
    });
  });

  describe("auth-tx cookie", () => {
    const tx: AuthTx = {
      state: "the-state",
      codeVerifier: "the-verifier",
      returnTo: "/dashboard",
      intent: "signup",
    };

    it("writeAuthTx / readAuthTx round-trips an AuthTx", () => {
      const res = mockRes();
      writeAuthTx(res as unknown as Response, tx);
      const setCookie = res.cookies[0];
      expect(setCookie).toMatch(/^ctl_auth_tx=/);
      expect(setCookie).toMatch(/Max-Age=900/i);

      const req = reqFromSetCookie(setCookie);
      expect(readAuthTx(req)).toEqual(tx);
    });

    it("readAuthTx returns null when missing", () => {
      expect(readAuthTx(reqWithCookie(undefined))).toBeNull();
      expect(readAuthTx(reqWithCookie("ctl_sess=x"))).toBeNull();
    });

    it("readAuthTx returns null for a garbage tx cookie", () => {
      expect(readAuthTx(reqWithCookie("ctl_auth_tx=garbage"))).toBeNull();
    });

    it("clearAuthTx sets maxAge 0", () => {
      const res = mockRes();
      clearAuthTx(res as unknown as Response);
      const setCookie = res.cookies[0];
      expect(setCookie).toMatch(/^ctl_auth_tx=;/);
      expect(setCookie).toMatch(/Max-Age=0/i);
    });
  });
});
