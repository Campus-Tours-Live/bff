import request from "supertest";
import { app } from "@/app.js";
import { coreErr, coreOk, mintSessionCookie, mockCoreByPath } from "../../_helpers.js";
import { EnvelopedDashboardSchema } from "@/openapi/schemas.js";

/** Core `GET /users/me` (Profile Contract v2): pure identity + held roles — no `activeRole`
 *  (that's bff session state now; set it via `mintSessionCookie({ activeRole })`). */
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

describe("GET /v1/dashboard", () => {
  let cookie: string;

  beforeEach(() => {
    cookie = mintSessionCookie();
  });

  it("guide-active session → 200 guide dashboard with offerings and canPublish", async () => {
    cookie = mintSessionCookie({ activeRole: "GUIDE" });
    mockCoreByPath({
      "/users/me": usersMeOk(["GUIDE"]),
      "/guide/profile": coreOk({
        id: "g1",
        displayName: "Gina Guide",
        applicationStatus: "VERIFIED",
      }),
      "/guide/offerings": coreOk([{ id: "o1", title: "Campus Walk" }]),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("guide");
    expect(res.body.data.canPublish).toBe(true);
    expect(res.body.data.guideStatus).toBe("VERIFIED");
    expect(res.body.data.guide).toEqual({
      id: "g1",
      displayName: "Gina Guide",
      applicationStatus: "VERIFIED",
    });
    expect(res.body.data.offerings).toEqual([{ id: "o1", title: "Campus Walk" }]);
    // Response-shape contract: body ↔ documented envelope schema (loose on Core-forwarded
    // fields, strict on the BFF-owned envelope/kind/canPublish/offerings shape).
    expect(EnvelopedDashboardSchema.safeParse(res.body).success).toBe(true);
  });

  it("guide not yet approved → canPublish false", async () => {
    cookie = mintSessionCookie({ activeRole: "GUIDE" });
    mockCoreByPath({
      "/users/me": usersMeOk(["GUIDE"]),
      "/guide/profile": coreOk({ id: "g1", applicationStatus: "PENDING" }),
      "/guide/offerings": coreOk([]),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("guide");
    expect(res.body.data.canPublish).toBe(false);
  });

  it("participant-active session → 200 participant dashboard", async () => {
    cookie = mintSessionCookie({ activeRole: "PARTICIPANT" });
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/participant/profile": coreOk({ id: "p1", displayName: "Pat Participant" }),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("participant");
    expect(res.body.data.participant).toEqual({ id: "p1", displayName: "Pat Participant" });
    expect(EnvelopedDashboardSchema.safeParse(res.body).success).toBe(true);
  });

  it("no activeRole in the session → defaults to the participant dashboard (documented default)", async () => {
    // cookie (from beforeEach) carries no activeRole at all.
    mockCoreByPath({
      "/users/me": usersMeOk([]),
      "/participant/profile": coreOk({ id: "p1" }),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("participant");
  });

  it("participant with no next tour (Core returns { data: null }) → 200, nextTour null", async () => {
    // Regression: CoreClient must unwrap null envelope data to null, not return the whole
    // { data: null } envelope — otherwise the dashboard reshapes it and throws a 500.
    cookie = mintSessionCookie({ activeRole: "PARTICIPANT" });
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/participant/profile": coreOk({ id: "p1" }),
      "/bookings/next-tour": coreOk(null),
      "/bookings/upcoming": coreOk([]),
      "/bookings/pending-actions": coreOk({
        paymentsToFinish: 0,
        waitingForGuide: 0,
        reviewsToWrite: 0,
      }),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("participant");
    expect(res.body.data.nextTour).toBeNull();
    expect(res.body.data.upcomingBookings).toEqual([]);
  });

  it("offerings fetch fails for a guide → degrades to offerings:[] (still 200)", async () => {
    cookie = mintSessionCookie({ activeRole: "GUIDE" });
    mockCoreByPath({
      "/users/me": usersMeOk(["GUIDE"]),
      "/guide/profile": coreOk({ id: "g1", applicationStatus: "VERIFIED" }),
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

  it("Core /users/me returns 401 → 401 + Auth-Required (re-auth)", async () => {
    mockCoreByPath({
      "/users/me": coreErr(401),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(401);
    expect(res.headers["auth-required"]).toBe("reauthenticate");
    expect(res.body).toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
  });

  it("Core /guide/profile 5xx (required read) → 502 CORE_UNAVAILABLE", async () => {
    cookie = mintSessionCookie({ activeRole: "GUIDE" });
    mockCoreByPath({
      "/users/me": usersMeOk(["GUIDE"]),
      "/guide/profile": coreErr(503),
      "/guide/offerings": coreOk([]),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "CORE_UNAVAILABLE" });
  });

  it("Core /participant/profile 404 (required read) → surfaces the real 404", async () => {
    cookie = mintSessionCookie({ activeRole: "PARTICIPANT" });
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/participant/profile": coreErr(404),
    });

    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("reshapes dashboard bookings into Contract-A field names", async () => {
    cookie = mintSessionCookie({ activeRole: "PARTICIPANT" });
    const coreB = {
      id: "b1",
      status: "CONFIRMED",
      scheduledAt: "2026-08-01T15:00:00Z",
      offeringId: "o1",
      offeringTitle: "T",
      guideName: "G",
      guideResponseDeadline: null,
      universityName: "U",
      durationMin: 45,
      priceCents: 3000,
      currency: "USD",
    };
    mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/participant/profile": coreOk({ id: "p1" }),
      "/bookings/next-tour": coreOk(coreB),
      "/bookings/upcoming": coreOk([coreB]),
      "/bookings/pending-actions": coreOk({
        paymentsToFinish: 0,
        waitingForGuide: 1,
        reviewsToWrite: 0,
      }),
    });
    const res = await request(app).get("/v1/dashboard").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.nextTour.durationMinutes).toBe(45);
    expect(res.body.data.nextTour.tourTitle).toBe("T");
    expect(res.body.data.nextTour.price).toEqual({ amount: 3000, currency: "USD" });
    expect(res.body.data.nextTour).not.toHaveProperty("priceCents");
    expect(res.body.data.upcomingBookings[0].scheduledStartAt).toBe("2026-08-01T15:00:00Z");
    expect(res.body.data.upcomingBookings[0].scheduledEndAt).toBe("2026-08-01T15:45:00Z");
  });

  it("forwards the session id_token as a Bearer to Core /users/me", async () => {
    cookie = mintSessionCookie({ activeRole: "PARTICIPANT" });
    const mock = mockCoreByPath({
      "/users/me": usersMeOk(["PARTICIPANT"]),
      "/participant/profile": coreOk({ id: "p1" }),
    });

    await request(app).get("/v1/dashboard").set("Cookie", cookie);

    const usersMeCall = mock.mock.calls.find((c) => new URL(String(c[0])).pathname === "/users/me");
    expect(usersMeCall).toBeDefined();
    const init = usersMeCall![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fake-id-token");
  });
});
