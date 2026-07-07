import request from "supertest";
import { app } from "@/app.js";
import { coreErr, coreOk, mintSessionCookie, mockCoreByPath } from "../_helpers.js";
import { EnvelopedDashboardSchema } from "@/openapi/schemas.js";

describe("GET /v1/dashboard", () => {
  let cookie: string;

  beforeEach(() => {
    cookie = mintSessionCookie();
  });

  it("guide-active session → 200 guide dashboard with offerings and canPublish", async () => {
    mockCoreByPath({
      "/userinfo": coreOk({
        roles: ["GUIDE"],
        activeRole: "GUIDE",
        participantType: null,
        guideStatus: "APPROVED",
      }),
      "/guide/profile": coreOk({ id: "g1", displayName: "Gina Guide" }),
      "/guide/offerings": coreOk([{ id: "o1", title: "Campus Walk" }]),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("guide");
    expect(res.body.data.canPublish).toBe(true);
    expect(res.body.data.guideStatus).toBe("APPROVED");
    expect(res.body.data.guide).toEqual({ id: "g1", displayName: "Gina Guide" });
    expect(res.body.data.offerings).toEqual([{ id: "o1", title: "Campus Walk" }]);
    // Response-shape contract: body ↔ documented envelope schema (loose on Core-forwarded
    // fields, strict on the BFF-owned envelope/kind/canPublish/offerings shape).
    expect(EnvelopedDashboardSchema.safeParse(res.body).success).toBe(true);
  });

  it("guide not yet approved → canPublish false", async () => {
    mockCoreByPath({
      "/userinfo": coreOk({
        roles: ["GUIDE"],
        activeRole: "GUIDE",
        participantType: null,
        guideStatus: "PENDING",
      }),
      "/guide/profile": coreOk({ id: "g1" }),
      "/guide/offerings": coreOk([]),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("guide");
    expect(res.body.data.canPublish).toBe(false);
  });

  it("participant-active session → 200 participant dashboard", async () => {
    mockCoreByPath({
      "/userinfo": coreOk({
        roles: ["PARTICIPANT"],
        activeRole: "PARTICIPANT",
        participantType: "PROSPECTIVE",
        guideStatus: null,
      }),
      "/participant/profile": coreOk({ id: "p1", displayName: "Pat Participant" }),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("participant");
    expect(res.body.data.participant).toEqual({ id: "p1", displayName: "Pat Participant" });
    expect(EnvelopedDashboardSchema.safeParse(res.body).success).toBe(true);
  });

  it("offerings fetch fails for a guide → degrades to offerings:[] (still 200)", async () => {
    mockCoreByPath({
      "/userinfo": coreOk({
        roles: ["GUIDE"],
        activeRole: "GUIDE",
        participantType: null,
        guideStatus: "APPROVED",
      }),
      "/guide/profile": coreOk({ id: "g1" }),
      "/guide/offerings": coreErr(500),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("guide");
    expect(res.body.data.offerings).toEqual([]);
    expect(res.body.data.canPublish).toBe(true);
  });

  it("no cookie → 401 with Auth-Required: reauthenticate", async () => {
    mockCoreByPath({}); // Core should never be called

    const res = await request(app).get("/v1/dashboard");

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
    expect(res.body).toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Core /userinfo returns 401 → 401 + Auth-Required (re-auth)", async () => {
    mockCoreByPath({
      "/userinfo": coreErr(401),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
    expect(res.body).toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
  });

  it("Core /guide/profile 5xx (required read) → 502 CORE_UNAVAILABLE", async () => {
    mockCoreByPath({
      "/userinfo": coreOk({
        roles: ["GUIDE"],
        activeRole: "GUIDE",
        participantType: null,
        guideStatus: "APPROVED",
      }),
      "/guide/profile": coreErr(503),
      "/guide/offerings": coreOk([]),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "CORE_UNAVAILABLE" });
  });

  it("Core /participant/profile 404 (required read) → surfaces the real 404", async () => {
    mockCoreByPath({
      "/userinfo": coreOk({
        roles: ["PARTICIPANT"],
        activeRole: "PARTICIPANT",
        participantType: null,
        guideStatus: null,
      }),
      "/participant/profile": coreErr(404),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("forwards the session id_token as a Bearer to Core /userinfo", async () => {
    const mock = mockCoreByPath({
      "/userinfo": coreOk({
        roles: ["PARTICIPANT"],
        activeRole: "PARTICIPANT",
        participantType: null,
        guideStatus: null,
      }),
      "/participant/profile": coreOk({ id: "p1" }),
    });

    await request(app).get("/v1/dashboard").set("Cookie", cookie);

    const userinfoCall = mock.mock.calls.find(
      (c) => new URL(String(c[0])).pathname === "/userinfo",
    );
    expect(userinfoCall).toBeDefined();
    const init = userinfoCall![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fake-id-token");
  });
});
