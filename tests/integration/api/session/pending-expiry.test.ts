import request from "supertest";
import { app } from "@/app.js";
import { mintSessionCookie, mockCoreByPath } from "../../_helpers.js";

/**
 * CTL-97 Task 4 — the central pending-expiry guard, proven end-to-end through a REAL route
 * (not just the `withSession` unit test), so this is the same wiring every protected `/v1`
 * route shares. A PENDING session (authenticated with Google, not yet provisioned in Core)
 * carries a 24h ABSOLUTE lifetime; once it's passed, every protected route must destroy the
 * session and answer 401 SESSION_EXPIRED WITHOUT ever calling Core.
 */
describe("central pending-expiry guard (GET /v1/userinfo as the exercised route)", () => {
  it("an EXPIRED PENDING session → 401 SESSION_EXPIRED, destroys the cookie, and never calls Core", async () => {
    const now = Date.now();
    const cookie = mintSessionCookie({
      accountState: "PENDING",
      pendingSince: now - 25 * 60 * 60 * 1000,
      pendingExpiresAt: now - 1, // already past — the `now > pendingExpiresAt` boundary
    });
    const fetchMock = mockCoreByPath({}); // Core must NEVER be called for this request

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
    expect(fetchMock).not.toHaveBeenCalled();

    const setCookie = (res.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) =>
      c.startsWith("ctl_sess="),
    );
    expect(setCookie).toBeDefined();
    // An expiring Set-Cookie: empty value + Max-Age=0.
    expect(setCookie).toMatch(/^ctl_sess=;/);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it("a PENDING session exactly AT pendingExpiresAt (now === pendingExpiresAt) → also EXPIRED", async () => {
    const now = Date.now();
    const cookie = mintSessionCookie({
      accountState: "PENDING",
      pendingSince: now - 24 * 60 * 60 * 1000,
      pendingExpiresAt: now,
    });
    const fetchMock = mockCoreByPath({});

    const res = await request(app).get("/v1/userinfo").set("Cookie", cookie);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "SESSION_EXPIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
