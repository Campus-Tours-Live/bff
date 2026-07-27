import request from "supertest";
import { app } from "@/app.js";
import { coreErr, coreOk, mintSessionCookie, mockCoreByPath } from "../../_helpers.js";
import { EnvelopedProgressSchema } from "@/openapi/schemas.js";

/** Core `GET /users/me` (Profile Contract v2): pure identity + held roles — no `activeRole`
 *  (onboarding progress is keyed by the TARGET role, so it never reads activeRole at all). */
function usersMeOk(roles: string[]) {
  return coreOk({
    user: {
      id: "u1",
      firstName: "Pat",
      lastName: "Participant",
      displayName: "Pat Participant",
      email: "pat@example.com",
      accountStatus: "ACTIVE",
      ageBand: "ADULT",
      createdAt: "2025-03-15T00:00:00.000Z",
    },
    roles,
  });
}

describe("GET /v1/onboarding", () => {
  let cookie: string;

  beforeEach(() => {
    cookie = mintSessionCookie();
  });

  it("?role=guide → 200 guide progress derived from /guide/profile", async () => {
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/guide/profile": coreOk({ applicationStatus: "PENDING" }),
    });

    const res = await request(app).get("/v1/onboarding?role=guide").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("guide");
    expect(res.body.data.started).toBe(true);
    expect(res.body.data.complete).toBe(true); // PENDING != DRAFT/null → submitted
    expect(res.body.data.applicationStatus).toBe("PENDING");
    expect(res.body.data.verificationStatus).toBeNull();
    // Response-shape contract: body ↔ documented Progress envelope schema.
    expect(EnvelopedProgressSchema.safeParse(res.body).success).toBe(true);
  });

  it("?role=guide with no guide profile yet → not started", async () => {
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/guide/profile": coreErr(404),
    });

    const res = await request(app).get("/v1/onboarding?role=guide").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("guide");
    expect(res.body.data.started).toBe(false);
    expect(res.body.data.complete).toBe(false);
    expect(res.body.data.canSubmit).toBe(true);
  });

  it("?role=participant → 200 participant progress (complete when holds PARTICIPANT)", async () => {
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/participant/profile": coreOk({ type: "PROSPECTIVE" }),
    });

    const res = await request(app).get("/v1/onboarding?role=participant").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("participant");
    expect(res.body.data.complete).toBe(true);
    expect(res.body.data.canSubmit).toBe(false);
    expect(EnvelopedProgressSchema.safeParse(res.body).success).toBe(true);
  });

  it("?role=participant without the role yet → incomplete", async () => {
    mockCoreByPath({
      "/users/me": usersMeOk(["GUIDE"]),
      "/participant/profile": coreErr(404),
    });

    const res = await request(app).get("/v1/onboarding?role=participant").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.complete).toBe(false);
    expect(res.body.data.canSubmit).toBe(true);
  });

  it("brand-new user (no roles yet) → participant onboarding not started, incomplete", async () => {
    mockCoreByPath({
      "/users/me": usersMeOk([]),
      "/participant/profile": coreErr(404),
    });

    const res = await request(app).get("/v1/onboarding?role=participant").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("participant");
    expect(res.body.data.started).toBe(false);
    expect(res.body.data.complete).toBe(false);
    expect(res.body.data.canSubmit).toBe(true);
    expect(EnvelopedProgressSchema.safeParse(res.body).success).toBe(true);
  });

  it("brand-new user (no roles, no guide profile) → guide onboarding not started, incomplete", async () => {
    mockCoreByPath({
      "/users/me": usersMeOk([]),
      "/guide/profile": coreErr(404),
    });

    const res = await request(app).get("/v1/onboarding?role=guide").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("guide");
    expect(res.body.data.started).toBe(false);
    expect(res.body.data.complete).toBe(false);
    expect(res.body.data.canSubmit).toBe(true);
    expect(res.body.data.applicationStatus).toBeNull();
    expect(EnvelopedProgressSchema.safeParse(res.body).success).toBe(true);
  });

  it("role accepted case-insensitively (GUIDE)", async () => {
    mockCoreByPath({
      "/users/me": usersMeOk(["GUIDE"]),
      "/guide/profile": coreOk({ applicationStatus: "APPROVED" }),
    });

    const res = await request(app).get("/v1/onboarding?role=GUIDE").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("guide");
  });

  it("missing role → 422 INVALID_ROLE (no Core call)", async () => {
    mockCoreByPath({});

    const res = await request(app).get("/v1/onboarding").set("Cookie", cookie);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ status: 422, code: "INVALID_ROLE" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("invalid role → 422 INVALID_ROLE", async () => {
    mockCoreByPath({});

    const res = await request(app).get("/v1/onboarding?role=admin").set("Cookie", cookie);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ status: 422, code: "INVALID_ROLE" });
  });

  it("no cookie → 401 + Auth-Required (before role validation)", async () => {
    mockCoreByPath({});

    const res = await request(app).get("/v1/onboarding?role=guide");

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
    expect(res.body).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("Core /users/me 401 → 401 + Auth-Required", async () => {
    mockCoreByPath({ "/users/me": coreErr(401) });

    const res = await request(app).get("/v1/onboarding?role=guide").set("Cookie", cookie);

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
  });
});
