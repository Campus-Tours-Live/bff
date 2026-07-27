import type { Request, Response } from "express";
import {
  type AuthTx,
  type SessionData,
  clearAuthTx,
  clearSession,
  isRole,
  readAuthTx,
  readSession,
  writeAuthTx,
  writeSession,
} from "@/session.js";

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
      writeSession(res as unknown as Response, { idToken: "id-tok" });
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
      writeSession(res as unknown as Response, { idToken: "x" }, 100);
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
      writeSession(res as unknown as Response, { idToken: "x" });
      expect(res.cookies[0]).toMatch(new RegExp(`Max-Age=${60 * 60 * 24 * 7}`, "i"));
    });

    it("round-trips currentRole/onboardingRole (Profile Contract v2 session fields)", () => {
      const res = mockRes();
      const data: SessionData = {
        idToken: "id-tok",
        currentRole: "GUIDE",
        onboardingRole: "PARTICIPANT",
      };
      writeSession(res as unknown as Response, data);
      const req = reqFromSetCookie(res.cookies[0]);
      expect(readSession(req)).toEqual(data);
    });

    it("currentRole/onboardingRole are absent (not undefined-serialized) on an old-shape session", () => {
      const res = mockRes();
      writeSession(res as unknown as Response, { idToken: "id-tok" });
      const req = reqFromSetCookie(res.cookies[0]);
      const session = readSession(req);
      expect(session).not.toBeNull();
      expect(session!.currentRole).toBeUndefined();
      expect(session!.onboardingRole).toBeUndefined();
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
