import request from "supertest";
import { app } from "@/app.js";
import { readSession } from "@/session.js";
import { coreErr, coreOk, mintSessionCookie, mockCoreByPath } from "../../_helpers.js";
import { EnvelopedActiveRoleSchema } from "@/openapi/schemas.js";

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

/** Decrypt a `ctl_sess=...` Set-Cookie pair via the REAL readSession. */
function sessionFrom(pair: string | undefined): ReturnType<typeof readSession> {
  if (!pair) return null;
  return readSession({ headers: { cookie: pair } } as unknown as Parameters<typeof readSession>[0]);
}

function ctlSessCookieFrom(res: request.Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith("ctl_sess="))?.split(";")[0];
}

describe("POST /v1/session/active-role", () => {
  it("invalid/missing role → 400 INVALID_ROLE, no Core call, session unchanged", async () => {
    const cookie = mintSessionCookie();
    const mock = mockCoreByPath({});

    const res = await request(app)
      .post("/v1/session/active-role")
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

    const res = await request(app).post("/v1/session/active-role").set("Cookie", cookie).send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_ROLE" });
  });

  it("valid role but not held → 403 ROLE_NOT_HELD, session unchanged", async () => {
    const cookie = mintSessionCookie({ activeRole: "PARTICIPANT" });
    mockCoreByPath({ "/users/me": usersMeOk(["PARTICIPANT"]) });

    const res = await request(app)
      .post("/v1/session/active-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ status: 403, code: "ROLE_NOT_HELD" });
    // A rejected switch must not touch the cookie.
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("held role → 200, session saved (Set-Cookie present) BEFORE the response, matching onboardingRole cleared", async () => {
    const cookie = mintSessionCookie({ onboardingRole: "GUIDE" });
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE", "PARTICIPANT"]) });

    const res = await request(app)
      .post("/v1/session/active-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { activeRole: "GUIDE" },
      meta: { requestId: expect.any(String) },
    });
    expect(EnvelopedActiveRoleSchema.safeParse(res.body).success).toBe(true);

    const rotated = ctlSessCookieFrom(res);
    expect(rotated).toBeDefined();
    expect(sessionFrom(rotated)).toMatchObject({ activeRole: "GUIDE" });
    expect(sessionFrom(rotated)?.onboardingRole).toBeUndefined();
  });

  it("held role, onboardingRole set for a DIFFERENT role → only activeRole changes, onboardingRole untouched", async () => {
    const cookie = mintSessionCookie({ onboardingRole: "PARTICIPANT" });
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE", "PARTICIPANT"]) });

    const res = await request(app)
      .post("/v1/session/active-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(200);
    const rotated = ctlSessCookieFrom(res);
    expect(sessionFrom(rotated)).toMatchObject({
      activeRole: "GUIDE",
      onboardingRole: "PARTICIPANT",
    });
  });

  it("held role, no onboardingRole set → just sets activeRole", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": usersMeOk(["PARTICIPANT"]) });

    const res = await request(app)
      .post("/v1/session/active-role")
      .set("Cookie", cookie)
      .send({ role: "PARTICIPANT" });

    expect(res.status).toBe(200);
    const rotated = ctlSessCookieFrom(res);
    expect(sessionFrom(rotated)).toMatchObject({ activeRole: "PARTICIPANT" });
  });

  it("no cookie → 401 + Auth-Required (before role validation)", async () => {
    mockCoreByPath({});

    const res = await request(app).post("/v1/session/active-role").send({ role: "GUIDE" });

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
      .post("/v1/session/active-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(403);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("Core /users/me 401 → 401 + Auth-Required (re-auth)", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": coreErr(401) });

    const res = await request(app)
      .post("/v1/session/active-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
  });

  it("Core /users/me 5xx → 502 CORE_UNAVAILABLE", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": coreErr(503) });

    const res = await request(app)
      .post("/v1/session/active-role")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "CORE_UNAVAILABLE" });
  });

  it("rejects a cross-site POST (CSRF)", async () => {
    const cookie = mintSessionCookie();
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE"]) });

    const res = await request(app)
      .post("/v1/session/active-role")
      .set("Origin", "https://evil.example")
      .set("Cookie", cookie)
      .send({ role: "GUIDE" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "CSRF_BLOCKED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
