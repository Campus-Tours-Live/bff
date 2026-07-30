import express from "express";
import request from "supertest";
import { app } from "@/app.js";
import { readSession } from "@/session.js";
import { coreErr, coreOk, mintSessionCookie, mockCoreByPath, pathOf } from "../../_helpers.js";
import { EnvelopedOnboardingCommandSchema } from "@/openapi/schemas.js";

/** A successful Core `POST /users/me/roles/{guide|participant}` 201 body — the enveloped
 *  `OnboardingResponse` (Profile Contract v2 onboarding command). Core sends NO `accountState`
 *  and NO `currentRole` — both are bff session state (Core's account-lifecycle status is on
 *  `user.accountStatus`). The bff SYNTHESIZES its own `accountState: "PROVISIONED"` discriminator
 *  + `currentRole`; the two must never be confused (see the not-verbatim assertions below). */
function coreOnboardingOk(overrides: Record<string, unknown> = {}) {
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
    roles: ["GUIDE"],
    acquiredRole: "GUIDE",
    profile: { guideStatus: "PENDING" },
    ...overrides,
  });
}

/** A Core problem+json error carrying a stable `code` (mirrors userinfo.test.ts's helper). */
function coreCodedErr(status: number, code: string, title = "Error") {
  return coreErr(status, { title, status, code });
}

/** Mint a PENDING (not-yet-provisioned) session cookie — the ordinary onboarding-command
 *  caller. No id_token claims are needed here (unlike userinfo's PENDING branch): every test
 *  below either mocks the onboarding POST directly, or — for the I11 recovery test — has Core's
 *  `/users/me` 200 BEFORE `pendingIdentityFromSession` would ever be reached. */
function mintPendingCookie(overrides: Record<string, unknown> = {}): string {
  const now = Date.now();
  return mintSessionCookie({
    accountState: "PENDING",
    idToken: "fake-id-token",
    pendingSince: now,
    pendingExpiresAt: now + 24 * 60 * 60 * 1000,
    ...overrides,
  });
}

function ctlSessCookieFrom(res: request.Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith("ctl_sess="))?.split(";")[0];
}

function sessionFrom(pair: string | undefined): ReturnType<typeof readSession> {
  if (!pair) return null;
  return readSession({ headers: { cookie: pair } } as unknown as Parameters<typeof readSession>[0]);
}

describe("POST /v1/users/me/roles/guide — two concrete routes, no generic :role", () => {
  it("the two concrete routes exist (guide + participant)", async () => {
    const guideCookie = mintPendingCookie();
    mockCoreByPath({ "/users/me/roles/guide": coreOnboardingOk() });
    const guideRes = await request(app)
      .post("/v1/users/me/roles/guide")
      .set("Cookie", guideCookie)
      .send({});
    expect(guideRes.status).toBe(201);

    const participantCookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me/roles/participant": coreOnboardingOk({
        roles: ["PARTICIPANT"],
        acquiredRole: "PARTICIPANT",
        profile: { type: "STUDENT" },
      }),
    });
    const participantRes = await request(app)
      .post("/v1/users/me/roles/participant")
      .set("Cookie", participantCookie)
      .send({});
    expect(participantRes.status).toBe(201);
  });

  it("no generic :role route — an unknown role passes through to the transparent Core proxy untouched", async () => {
    // If a generic `:role` route existed here, this would be intercepted by the
    // onboarding-command handler (which would either envelope a success or emit its own coded
    // problem+json on a Core 4xx). Instead it must fall through to `coreProxy`, which relays
    // Core's raw body VERBATIM — no `{ data, meta }` envelope — proving no such route exists.
    const cookie = mintSessionCookie();
    mockCoreByPath({
      "/users/me/roles/wizard": coreErr(404, { title: "Not Found", status: 404 }),
    });

    const res = await request(app).post("/v1/users/me/roles/wizard").set("Cookie", cookie).send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ title: "Not Found", status: 404 });
  });
});

describe("POST /v1/users/me/roles/{role} — forwards to Core with the session bearer", () => {
  it("forwards the role body to Core POST /users/me/roles/guide with the session Bearer; a PENDING (non-expired) session is accepted", async () => {
    const cookie = mintPendingCookie();
    const mock = mockCoreByPath({ "/users/me/roles/guide": coreOnboardingOk() });

    const res = await request(app)
      .post("/v1/users/me/roles/guide")
      .set("Cookie", cookie)
      .send({ bio: "Loves the maker space", universities: [{ universityId: "uni_mit" }] });

    expect(res.status).toBe(201);
    const call = mock.mock.calls.find((c) => pathOf(c[0]) === "/users/me/roles/guide");
    expect(call).toBeDefined();
    const init = call![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fake-id-token");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      bio: "Loves the maker space",
      universities: [{ universityId: "uni_mit" }],
    });
  });
});

describe("POST /v1/users/me/roles/{role} — Core 201 success, session conversion, response shape", () => {
  it("converts the session (PENDING -> PROVISIONED, currentRole=acquiredRole, pending fields gone, 7d TTL) and returns 201 OnboardingCommandResponse — NOT Core's body verbatim", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({ "/users/me/roles/guide": coreOnboardingOk() });

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(201);
    // NOT Core's body verbatim: Core's 201 has NO accountState and NO currentRole at all (its
    // lifecycle status is on user.accountStatus); the bff SYNTHESIZES its own session
    // discriminator accountState "PROVISIONED" AND a currentRole it itself added — proving the
    // response is constructed by the bff, never passed through.
    expect(res.body.data.accountState).toBe("PROVISIONED");
    expect(res.body.data.currentRole).toBe("GUIDE");
    expect(res.body.data.acquiredRole).toBe("GUIDE");
    expect(res.body.data.roles).toEqual(["GUIDE"]);
    expect(res.body.data.user).toMatchObject({ id: "u1", displayName: "Gina Guide" });
    expect(res.body.data.profile).toEqual({ guideStatus: "PENDING" });
    expect(EnvelopedOnboardingCommandSchema.safeParse(res.body).success).toBe(true);

    const rotated = ctlSessCookieFrom(res);
    expect(rotated).toBeDefined();
    const session = sessionFrom(rotated);
    expect(session).toMatchObject({ accountState: "PROVISIONED", currentRole: "GUIDE" });
    expect(session).not.toHaveProperty("pendingSince");
    expect(session).not.toHaveProperty("pendingExpiresAt");
    const rawSetCookie = res.headers["set-cookie"] as unknown as string[];
    expect(rawSetCookie.find((c) => c.startsWith("ctl_sess="))).toMatch(
      new RegExp(`Max-Age=${60 * 60 * 24 * 7}\\b`),
    );
  });

  it("acquiring a SECOND role from an already-PROVISIONED session also converts (re-stamps) currentRole", async () => {
    const cookie = mintSessionCookie({ currentRole: "PARTICIPANT" });
    mockCoreByPath({
      "/users/me/roles/guide": coreOnboardingOk({ roles: ["PARTICIPANT", "GUIDE"] }),
    });

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(201);
    expect(res.body.data.currentRole).toBe("GUIDE");
    expect(res.body.data.roles).toEqual(["PARTICIPANT", "GUIDE"]);
    const session = sessionFrom(ctlSessCookieFrom(res));
    expect(session).toMatchObject({ currentRole: "GUIDE" });
  });
});

describe("POST /v1/users/me/roles/{role} — session conversion failure (500) + I11 recovery", () => {
  const originalAppend = express.response.append;

  afterEach(() => {
    express.response.append = originalAppend;
  });

  it("Core 201 but the session write fails (even after a retry) -> 500 SESSION_CONVERSION_FAILED, no success body, Core NOT re-called", async () => {
    const cookie = mintPendingCookie();
    const mock = mockCoreByPath({ "/users/me/roles/guide": coreOnboardingOk() });

    express.response.append = () => {
      throw new Error("simulated header-write failure");
    };

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: "SESSION_CONVERSION_FAILED" });
    expect(res.body.data).toBeUndefined();
    // Core was called exactly once for the onboarding command — no rollback call, no re-call.
    const onboardingCalls = mock.mock.calls.filter((c) => pathOf(c[0]) === "/users/me/roles/guide");
    expect(onboardingCalls).toHaveLength(1);
  });

  it("a transient session-write failure is retried ONCE synchronously and succeeds on the second attempt", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({ "/users/me/roles/guide": coreOnboardingOk() });

    let calls = 0;
    express.response.append = function (
      this: typeof express.response,
      ...args: Parameters<typeof originalAppend>
    ) {
      calls += 1;
      if (calls === 1) throw new Error("simulated transient failure");
      return originalAppend.apply(this, args);
    } as typeof originalAppend;

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(201);
    expect(res.body.data.currentRole).toBe("GUIDE");
    expect(calls).toBe(2);
  });

  it("I11 same-device recovery: Core 201 -> session write fails -> bff 500 -> the NEXT GET /v1/userinfo (same still-pending cookie) sees Core now provisioned -> repairs PENDING to PROVISIONED", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({ "/users/me/roles/guide": coreOnboardingOk() });

    express.response.append = () => {
      throw new Error("simulated header-write failure");
    };

    const commandRes = await request(app)
      .post("/v1/users/me/roles/guide")
      .set("Cookie", cookie)
      .send({});

    expect(commandRes.status).toBe(500);
    expect(commandRes.body).toMatchObject({ code: "SESSION_CONVERSION_FAILED" });
    // The failed conversion must NOT have rotated the cookie — the client still holds the
    // original PENDING cookie afterward (nothing else to replay).
    expect(commandRes.headers["set-cookie"]).toBeUndefined();

    // Restore the real session store before the recovery read — /userinfo's own repair write
    // must succeed for this to demonstrate recovery, not another 500.
    express.response.append = originalAppend;

    mockCoreByPath({
      "/users/me": coreOk({
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
        roles: ["GUIDE"],
      }),
    });

    const userinfoRes = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(userinfoRes.status).toBe(200);
    expect(userinfoRes.body.data.accountState).toBe("PROVISIONED");
    expect(userinfoRes.body.data.currentRole).toBe("GUIDE");
    const repaired = sessionFrom(ctlSessCookieFrom(userinfoRes));
    expect(repaired).toMatchObject({ accountState: "PROVISIONED", currentRole: "GUIDE" });
  });
});

describe("POST /v1/users/me/roles/{role} — Core 4xx relays verbatim, session never converted", () => {
  it("Core 409 ROLE_ALREADY_GRANTED -> relayed with its code, session NOT converted (currentRole not set)", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me/roles/guide": coreCodedErr(409, "ROLE_ALREADY_GRANTED", "Role already granted"),
    });

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "ROLE_ALREADY_GRANTED" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    // The original cookie still decodes as PENDING — never converted.
    expect(sessionFrom(cookie)).toMatchObject({ accountState: "PENDING" });
  });

  it("Core 409 ROLE_NOT_ELIGIBLE -> relayed verbatim (status + code)", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me/roles/guide": coreCodedErr(409, "ROLE_NOT_ELIGIBLE", "Not eligible"),
    });

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "ROLE_NOT_ELIGIBLE" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("Core 422 VALIDATION_FAILED -> relayed verbatim (status + code)", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me/roles/participant": coreCodedErr(422, "VALIDATION_FAILED", "Validation failed"),
    });

    const res = await request(app)
      .post("/v1/users/me/roles/participant")
      .set("Cookie", cookie)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});

describe("POST /v1/users/me/roles/{role} — Core 201 with a garbage body -> 502 UPSTREAM_CONTRACT_VIOLATION, session never converted", () => {
  it("acquiredRole not present in roles", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me/roles/guide": coreOnboardingOk({ roles: ["PARTICIPANT"], acquiredRole: "GUIDE" }),
    });

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "UPSTREAM_CONTRACT_VIOLATION" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("non-string user.id", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me/roles/guide": coreOnboardingOk({ user: { id: 12345 } }),
    });

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "UPSTREAM_CONTRACT_VIOLATION" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("a genuinely unknown role in `roles`", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me/roles/guide": coreOnboardingOk({ roles: ["GUIDE", "WIZARD"] }),
    });

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "UPSTREAM_CONTRACT_VIOLATION" });
  });

  it("acquiredRole does not match the route's role (hit /guide, Core says acquiredRole PARTICIPANT)", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me/roles/guide": coreOnboardingOk({
        roles: ["GUIDE", "PARTICIPANT"],
        acquiredRole: "PARTICIPANT",
      }),
    });

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "UPSTREAM_CONTRACT_VIOLATION" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("acquiredRole is not a switchable Role at all (e.g. a staff role)", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({
      "/users/me/roles/guide": coreOnboardingOk({
        roles: ["GUIDE", "ADMIN"],
        acquiredRole: "ADMIN",
      }),
    });

    const res = await request(app).post("/v1/users/me/roles/guide").set("Cookie", cookie).send({});

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "UPSTREAM_CONTRACT_VIOLATION" });
  });
});

describe("POST /v1/users/me/roles/{role} — CSRF", () => {
  it("rejects a cross-site POST", async () => {
    const cookie = mintPendingCookie();
    mockCoreByPath({ "/users/me/roles/guide": coreOnboardingOk() });

    const res = await request(app)
      .post("/v1/users/me/roles/guide")
      .set("Origin", "https://evil.example")
      .set("Cookie", cookie)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "CSRF_BLOCKED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("POST /v1/users/me/roles/{role} — no session", () => {
  it("no cookie -> 401 + Auth-Required (before any Core call)", async () => {
    mockCoreByPath({});

    const res = await request(app).post("/v1/users/me/roles/guide").send({});

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
