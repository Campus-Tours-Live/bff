import express from "express";
import request from "supertest";
import { app } from "@/app.js";
import type { Role } from "@/session.js";
import { coreErr, coreOk, mintSessionCookie, mockCoreByPath } from "../../_helpers.js";
import { EnvelopedUserinfoSchema } from "@/openapi/schemas.js";

/** Core `GET /users/me` (Profile Contract v2): pure identity + held roles, no `currentRole`. */
function usersMeOk(roles: string[]) {
  return coreOk({
    user: {
      id: "u1",
      firstName: "Gina",
      lastName: "Guide",
      displayName: "Gina Guide",
      email: "gina@example.com",
      accountStatus: "ACTIVE",
      ageBand: "ADULT",
      createdAt: "2025-03-15T00:00:00.000Z",
    },
    roles,
  });
}

/** A Core 404/403/409 problem+json error carrying a stable `code` (CTL-97 I7/I8 branching). */
function coreCodedErr(status: number, code: string, title = "Error") {
  return coreErr(status, { title, status, code });
}

/** A Core error response whose body is NOT JSON (content-type text/plain) — I7 requires this
 *  is NEVER treated as pending, even on a 404. */
function coreErrNonJson(status: number, body = "Not Found"): Response {
  return {
    ok: false,
    status,
    headers: new Headers({ "content-type": "text/plain" }),
    json: async () => {
      throw new Error("not json");
    },
    text: async () => body,
  } as unknown as Response;
}

/** Base64url-encodes a JSON value the way a JWT segment does (mirrors pendingIdentity.test.ts). */
function seg(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Builds a `header.payload.signature` id_token fixture with a verified email — the shape
 *  `pendingIdentityFromSession` needs to produce a PendingUserInfo without throwing. */
function makeIdToken(claims: Record<string, unknown>): string {
  return `${seg({ alg: "RS256", typ: "JWT" })}.${seg(claims)}.dummy-signature`;
}

const PENDING_ID_TOKEN = makeIdToken({
  email: "ana@example.com",
  email_verified: true,
  given_name: "Ana",
  family_name: "Silva",
  name: "Ana Silva",
});

/** Mint a PENDING (not-yet-provisioned) session cookie with a usable id_token. */
function mintPendingCookie(overrides: Record<string, unknown> = {}): string {
  const now = Date.now();
  return mintSessionCookie({
    accountState: "PENDING",
    idToken: PENDING_ID_TOKEN,
    pendingSince: now,
    pendingExpiresAt: now + 24 * 60 * 60 * 1000,
    ...overrides,
  });
}

/** Extract just the `ctl_sess=...` pair from a supertest response's Set-Cookie header(s), the
 *  same trimming `mintSessionCookie` does, so a test can replay it as the NEXT request's cookie. */
function ctlSessCookieFrom(res: request.Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith("ctl_sess="))?.split(";")[0];
}

describe("GET /v1/userinfo — PROVISIONED", () => {
  it("composes Core identity/roles with the session's currentRole (accountState: PROVISIONED)", async () => {
    const cookie = mintSessionCookie({ currentRole: "GUIDE" });
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE", "PARTICIPANT"]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.accountState).toBe("PROVISIONED");
    expect(res.body.data.user).toMatchObject({ id: "u1", displayName: "Gina Guide" });
    expect(res.body.data.roles).toEqual(["GUIDE", "PARTICIPANT"]);
    expect(res.body.data.currentRole).toBe("GUIDE");
    expect(res.body.meta.requestId).toBeTruthy();
    expect(EnvelopedUserinfoSchema.safeParse(res.body).success).toBe(true);
    // The held-and-valid case is an ordinary read — must not touch the session store.
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("no currentRole + multiple held roles, none valid → currentRole: null, no session write", async () => {
    const cookie = mintSessionCookie(); // no currentRole at all
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE", "PARTICIPANT"]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.currentRole).toBeNull();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("deterministic repair: session role not held, but the account holds EXACTLY one role → adopts it and persists", async () => {
    // Session says GUIDE, but Core (authoritative) says the account only holds PARTICIPANT.
    // Per the CTL-97 Task 3 deterministic repair, a single held role is adopted directly —
    // this is NOT the "clear to null" case (that only applies when >1 role is held).
    const staleCookie = mintSessionCookie({ currentRole: "GUIDE" });
    mockCoreByPath({ "/users/me": usersMeOk(["PARTICIPANT"]) });

    const first = await request(app).get("/v1/userinfo").set("Cookie", staleCookie);

    expect(first.status).toBe(200);
    expect(first.body.data.currentRole).toBe("PARTICIPANT");
    const rotatedCookie = ctlSessCookieFrom(first);
    expect(rotatedCookie).toBeDefined(); // the repaired value WAS persisted

    // Replay with the rotated cookie: now already correct, so a second call must not write again.
    mockCoreByPath({ "/users/me": usersMeOk(["PARTICIPANT"]) });
    const second = await request(app).get("/v1/userinfo").set("Cookie", rotatedCookie!);

    expect(second.status).toBe(200);
    expect(second.body.data.currentRole).toBe("PARTICIPANT");
    expect(second.headers["set-cookie"]).toBeUndefined();
  });

  it("isRole rejects a garbage/stale stored value: with >1 held role this clears to null and persists", async () => {
    const garbageCookie = mintSessionCookie({ currentRole: "ADMIN" as unknown as Role });
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE", "PARTICIPANT"]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", garbageCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.currentRole).toBeNull();
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("no cookie → 401 with Auth-Required: reauthenticate", async () => {
    mockCoreByPath({});

    const res = await request(app).get("/v1/userinfo");

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
    expect(res.body).toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Core /users/me 401 → 401 + Auth-Required (re-auth)", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": coreErr(401) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
  });

  it("Core /users/me 5xx → 502 CORE_UNAVAILABLE", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": coreErr(503) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "CORE_UNAVAILABLE" });
  });

  it("forwards the session id_token as a Bearer to Core /users/me", async () => {
    const cookie = mintSessionCookie();
    const mock = mockCoreByPath({ "/users/me": usersMeOk(["GUIDE"]) });

    await request(app).get("/v1/userinfo").set("Cookie", cookie);

    const call = mock.mock.calls.find((c) => new URL(String(c[0])).pathname === "/users/me");
    expect(call).toBeDefined();
    const headers = (call![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fake-id-token");
  });
});

describe("GET /v1/userinfo — upstream Core-contract violations (never a signin, never pending)", () => {
  it("Core 200 with roles: [] → 502 UPSTREAM_CONTRACT_VIOLATION, not a PROVISIONED or PENDING body", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": usersMeOk([]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "UPSTREAM_CONTRACT_VIOLATION" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("Core 200 with a missing user.id → 502 UPSTREAM_CONTRACT_VIOLATION", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({
      "/users/me": coreOk({
        user: { firstName: "Gina", lastName: null, displayName: null, email: null },
        roles: ["GUIDE"],
      }),
    });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "UPSTREAM_CONTRACT_VIOLATION" });
  });

  it("Core 200 with a non-string user.id → 502 UPSTREAM_CONTRACT_VIOLATION", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({
      "/users/me": coreOk({ user: { id: 12345 }, roles: ["GUIDE"] }),
    });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "UPSTREAM_CONTRACT_VIOLATION" });
  });

  it("Core 200 with an unknown role value → 502 UPSTREAM_CONTRACT_VIOLATION", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": usersMeOk(["ADMIN"]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "UPSTREAM_CONTRACT_VIOLATION" });
  });
});

describe("GET /v1/userinfo — PENDING (CTL-97 defer-provisioning)", () => {
  it("Core 404 ACCOUNT_NOT_PROVISIONED → PENDING body (id null, roles [], currentRole null)", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me": coreCodedErr(404, "ACCOUNT_NOT_PROVISIONED", "Account not provisioned"),
    });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      accountState: "PENDING",
      user: {
        id: null,
        email: "ana@example.com",
        firstName: "Ana",
        lastName: "Silva",
        displayName: "Ana Silva",
      },
      roles: [],
      currentRole: null,
    });
    expect(EnvelopedUserinfoSchema.safeParse(res.body).success).toBe(true);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("repeated pending calls emit NO Set-Cookie and leave pendingSince/pendingExpiresAt unchanged", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me": coreCodedErr(404, "ACCOUNT_NOT_PROVISIONED"),
    });
    const first = await request(app).get("/v1/userinfo").set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.headers["set-cookie"]).toBeUndefined();

    // Same (un-rotated) cookie replayed — if the handler had written anything, this second
    // call would be operating on a DIFFERENT (rotated) cookie; the absence of any Set-Cookie
    // above already proves pendingSince/pendingExpiresAt could not have moved.
    mockCoreByPath({
      "/users/me": coreCodedErr(404, "ACCOUNT_NOT_PROVISIONED"),
    });
    const second = await request(app).get("/v1/userinfo").set("Cookie", cookie);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(second.headers["set-cookie"]).toBeUndefined();
  });

  it("Core 404 with a DIFFERENT code (e.g. PROFILE_NOT_FOUND) is NOT pending — propagated as a generic 404 (I7)", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({ "/users/me": coreCodedErr(404, "PROFILE_NOT_FOUND", "Profile not found") });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(res.body.data).toBeUndefined();
  });

  it("Core 404 with a non-JSON body is NOT pending — propagated as a generic 404 (I7)", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({ "/users/me": coreErrNonJson(404) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("PENDING session whose Core call now 200s (already provisioned elsewhere) → repairs to PROVISIONED", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE"]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.accountState).toBe("PROVISIONED");
    expect(res.body.data.currentRole).toBe("GUIDE");
    expect(EnvelopedUserinfoSchema.safeParse(res.body).success).toBe(true);
    // convertToProvisioned always writes (drops pendingSince/pendingExpiresAt, restores 7d TTL).
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie).toBeDefined();
    expect(setCookie.find((c) => c.startsWith("ctl_sess="))).toMatch(
      new RegExp(`Max-Age=${60 * 60 * 24 * 7}\\b`),
    );
  });

  it("PENDING session repaired to PROVISIONED with >1 held role and no valid prior role → currentRole: null", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE", "PARTICIPANT"]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.accountState).toBe("PROVISIONED");
    expect(res.body.data.currentRole).toBeNull();
    expect(res.headers["set-cookie"]).toBeDefined();
  });
});

describe("GET /v1/userinfo — I8 destroy-on-bad-account-state (via the shared with-session guard)", () => {
  it.each(["ACCOUNT_SUSPENDED", "ACCOUNT_DELETED"] as const)(
    "Core 403 %s → destroys the session (expiring Set-Cookie) + coded 403",
    async (code) => {
      const cookie = mintSessionCookie();
      mockCoreByPath({ "/users/me": coreCodedErr(403, code) });

      const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code });
      const setCookie = res.headers["set-cookie"] as unknown as string[];
      expect(setCookie).toBeDefined();
      const ctlSess = setCookie.find((c) => c.startsWith("ctl_sess="));
      expect(ctlSess).toMatch(/Max-Age=0\b/i);
    },
  );

  it("Core 409 ACCOUNT_STATE_INVALID → destroys the session (expiring Set-Cookie) + coded 409", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": coreCodedErr(409, "ACCOUNT_STATE_INVALID") });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "ACCOUNT_STATE_INVALID" });
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie).toBeDefined();
    const ctlSess = setCookie.find((c) => c.startsWith("ctl_sess="));
    expect(ctlSess).toMatch(/Max-Age=0\b/i);
  });
});

describe("GET /v1/userinfo — session-repair write failure (provisioned branch)", () => {
  /**
   * Simulates a session-write failure the way Express itself would surface one — `res.append`
   * throwing (e.g. headers already flushed) — rather than mocking `@/session.js` (which would
   * bypass the REAL `writeSession`/`convertToProvisioned` encrypt path this test wants to
   * exercise faithfully). `express.response` is the prototype merged into every response
   * instance (see express/lib/response.js), so patching it here affects every request made
   * while patched, and ONLY while patched — restored in `afterEach` so no other test in the
   * suite is affected.
   */
  const originalAppend = express.response.append;

  afterEach(() => {
    express.response.append = originalAppend;
  });

  it("a repair that requires a session write, but the write throws → 500 SESSION_CONVERSION_FAILED (never a stale PROVISIONED body)", async () => {
    // Session says GUIDE, but the account only holds PARTICIPANT — deterministic repair adopts
    // PARTICIPANT, which differs from the stored value, so the handler attempts a session write.
    const cookie = mintSessionCookie({ currentRole: "GUIDE" });
    mockCoreByPath({ "/users/me": usersMeOk(["PARTICIPANT"]) });

    express.response.append = () => {
      throw new Error("simulated header-write failure");
    };

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: "SESSION_CONVERSION_FAILED" });
  });

  it("a PENDING session repaired to PROVISIONED, but the write throws → 500 SESSION_CONVERSION_FAILED", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE"]) });

    express.response.append = () => {
      throw new Error("simulated header-write failure");
    };

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: "SESSION_CONVERSION_FAILED" });
  });
});
