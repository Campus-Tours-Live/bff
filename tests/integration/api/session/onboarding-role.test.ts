import request from "supertest";
import { app } from "@/app.js";
import { readSession } from "@/session.js";
import { coreErr, coreOk, mintSessionCookie, mockCoreByPath } from "../../_helpers.js";
import { EnvelopedOnboardingRoleSchema } from "@/openapi/schemas.js";

/** Core `GET /users/me` (Profile Contract v2): pure identity + held roles. */
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

/** Core `GET /users/me/role-eligibility?role=` (Profile Contract v2). */
function roleEligibilityOk(eligible: boolean, reason: string | null = null) {
  return coreOk({ eligible, reason });
}

/** Decrypt a `ctl_sess=...` Set-Cookie pair via the REAL readSession. */
function sessionFrom(pair: string | undefined): ReturnType<typeof readSession> {
  if (!pair) return null;
  return readSession({ headers: { cookie: pair } } as unknown as Parameters<typeof readSession>[0]);
}

function ctlSessCookieFrom(res: request.Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith("ctl_sess="))?.split(";")[0];
}

describe("POST /v1/session/onboarding-role", () => {
  it("invalid/missing role → 400 INVALID_ROLE, no Core call, session unchanged", async () => {
    const cookie = mintSessionCookie();
    const mock = mockCoreByPath({});

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Cookie", cookie)
      .send({ role: "ADMIN" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 400, code: "INVALID_ROLE" });
    expect(mock).not.toHaveBeenCalled();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("missing role body → 400 INVALID_ROLE", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({});

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Cookie", cookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_ROLE" });
  });

  it("role already held → 409 ROLE_ALREADY_HELD, no eligibility call, session unchanged", async () => {
    const cookie = mintSessionCookie({ currentRole: "PARTICIPANT" });
    const mock = mockCoreByPath({ "/users/me": usersMeOk(["GUIDE", "PARTICIPANT"]) });

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ status: 409, code: "ROLE_ALREADY_HELD" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    // Only /users/me should be hit — the "already held" branch short-circuits before eligibility.
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("PARENT participant not eligible for GUIDE → 403 with Core's typed reason, session unchanged", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/users/me/role-eligibility": roleEligibilityOk(false, "PARENT_CANNOT_BECOME_GUIDE"),
    });

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ status: 403, code: "PARENT_CANNOT_BECOME_GUIDE" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("not eligible with no Core reason → 403 falls back to ROLE_NOT_ELIGIBLE", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/users/me/role-eligibility": roleEligibilityOk(false, null),
    });

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ status: 403, code: "ROLE_NOT_ELIGIBLE" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("eligible → 200, session saved (Set-Cookie present) BEFORE the response, onboardingRole set", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/users/me/role-eligibility": roleEligibilityOk(true),
    });

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { onboardingRole: "GUIDE" },
      meta: { requestId: expect.any(String) },
    });
    expect(EnvelopedOnboardingRoleSchema.safeParse(res.body).success).toBe(true);

    const rotated = ctlSessCookieFrom(res);
    expect(rotated).toBeDefined();
    expect(sessionFrom(rotated)).toMatchObject({ onboardingRole: "GUIDE" });
    // currentRole must NOT be touched by this endpoint.
    expect(sessionFrom(rotated)?.currentRole).toBeUndefined();

    // A follow-up read on the persisted cookie reflects the write.
    expect(sessionFrom(rotated)?.onboardingRole).toBe("GUIDE");
  });

  it("no cookie → 401 + Auth-Required (before role validation)", async () => {
    mockCoreByPath({});

    const res = await request(app).post("/v1/session/onboarding-role").send({ role: "GUIDE" });

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
    expect(res.body).toMatchObject({ code: "SESSION_EXPIRED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("disabled/suspended account (Core 403 ACCOUNT_NOT_ACTIVE on /users/me) → 403 propagated", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({
      "/users/me": coreErr(403, { title: "ACCOUNT_NOT_ACTIVE", status: 403 }),
    });

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(403);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("Core /users/me 401 → 401 + Auth-Required (re-auth)", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": coreErr(401) });

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
  });

  it("Core /users/me 5xx → 502 CORE_UNAVAILABLE", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": coreErr(503) });

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "CORE_UNAVAILABLE" });
  });

  it("Core role-eligibility 5xx → 502 CORE_UNAVAILABLE", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/users/me/role-eligibility": coreErr(503),
    });

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "CORE_UNAVAILABLE" });
  });

  it("rejects a cross-site POST (CSRF)", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": usersMeOk(["PARTICIPANT"]) });

    const res = await request(app)
      .post("/v1/session/onboarding-role")
      .set("Origin", "https://evil.example")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "CSRF_BLOCKED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
