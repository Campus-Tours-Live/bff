import request from "supertest";
import { app } from "@/app.js";
import type { Role } from "@/session.js";
import { coreErr, coreOk, mintSessionCookie, mockCoreByPath } from "../../_helpers.js";
import { EnvelopedUserinfoSchema } from "@/openapi/schemas.js";

/** Core `GET /users/me` (Profile Contract v2): pure identity + held roles, no `activeRole`. */
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

/** Extract just the `ctl_sess=...` pair from a supertest response's Set-Cookie header(s), the
 *  same trimming `mintSessionCookie` does, so a test can replay it as the NEXT request's cookie. */
function ctlSessCookieFrom(res: request.Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith("ctl_sess="))?.split(";")[0];
}

describe("GET /v1/userinfo", () => {
  it("composes Core identity/roles with the session's activeRole", async () => {
    const cookie = mintSessionCookie({ activeRole: "GUIDE" });
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE", "PARTICIPANT"]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: "u1", displayName: "Gina Guide" });
    expect(res.body.data.roles).toEqual(["GUIDE", "PARTICIPANT"]);
    expect(res.body.data.activeRole).toBe("GUIDE");
    expect(res.body.meta.requestId).toBeTruthy();
    expect(EnvelopedUserinfoSchema.safeParse(res.body).success).toBe(true);
    // The held-and-valid case is an ordinary read — must not touch the session store.
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("no activeRole in the session → activeRole: null, and does not write the session", async () => {
    const cookie = mintSessionCookie(); // no activeRole at all
    mockCoreByPath({ "/users/me": usersMeOk(["PARTICIPANT"]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.activeRole).toBeNull();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("never surfaces onboardingRole, even when set", async () => {
    const cookie = mintSessionCookie({ activeRole: "PARTICIPANT", onboardingRole: "GUIDE" });
    mockCoreByPath({ "/users/me": usersMeOk(["PARTICIPANT"]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.activeRole).toBe("PARTICIPANT");
    expect(res.body.data).not.toHaveProperty("onboardingRole");
  });

  it("a role the account no longer holds is cleared, persisted, and stays cleared on a later call", async () => {
    // Session says GUIDE, but Core (the authoritative source) says the account only holds
    // PARTICIPANT now — e.g. the GUIDE role was revoked after this session was minted.
    const staleCookie = mintSessionCookie({ activeRole: "GUIDE" });
    mockCoreByPath({ "/users/me": usersMeOk(["PARTICIPANT"]) });

    const first = await request(app).get("/v1/userinfo").set("Cookie", staleCookie);

    expect(first.status).toBe(200);
    expect(first.body.data.activeRole).toBeNull();
    const rotatedCookie = ctlSessCookieFrom(first);
    expect(rotatedCookie).toBeDefined(); // the stale value WAS persisted (Set-Cookie written)

    // Replay with the rotated cookie: the stale activeRole must not reappear, and this second,
    // now-clean call must not write the session again (nothing left to clear).
    mockCoreByPath({ "/users/me": usersMeOk(["PARTICIPANT"]) });
    const second = await request(app).get("/v1/userinfo").set("Cookie", rotatedCookie!);

    expect(second.status).toBe(200);
    expect(second.body.data.activeRole).toBeNull();
    expect(second.headers["set-cookie"]).toBeUndefined();
  });

  it("isRole rejects a garbage/stale stored value the same way (cleared + persisted)", async () => {
    const garbageCookie = mintSessionCookie({ activeRole: "ADMIN" as unknown as Role });
    mockCoreByPath({ "/users/me": usersMeOk(["GUIDE"]) });

    const res = await request(app).get("/v1/userinfo").set("Cookie", garbageCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.activeRole).toBeNull();
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
    const mock = mockCoreByPath({ "/users/me": usersMeOk([]) });

    await request(app).get("/v1/userinfo").set("Cookie", cookie);

    const call = mock.mock.calls.find((c) => new URL(String(c[0])).pathname === "/users/me");
    expect(call).toBeDefined();
    const headers = (call![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fake-id-token");
  });
});
