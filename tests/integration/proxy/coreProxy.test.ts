import { jest } from "@jest/globals";
import request from "supertest";
import { app } from "@/app.js";
import { coreErr, coreOk, mintSessionCookie, mockCoreByPath, pathOf } from "../_helpers.js";

const WEB_ORIGIN = "http://localhost:3001"; // WEB_ORIGIN from tests/setup.ts

describe("coreProxy (/v1/* passthrough)", () => {
  let cookie: string;

  beforeEach(() => {
    cookie = mintSessionCookie();
  });

  describe("GET passthrough", () => {
    it("proxies to the stripped Core path with a Bearer header and passes the response through", async () => {
      const mock = mockCoreByPath({
        "/guide/profile": coreOk({ id: "g1", displayName: "Gina" }),
      });

      const res = await request(app).get("/v1/guide/profile").set("Cookie", cookie);

      expect(res.status).toBe(200);
      // coreProxy passes the raw upstream body through verbatim (the { data } envelope).
      expect(res.body).toEqual({ data: { id: "g1", displayName: "Gina" } });

      expect(mock).toHaveBeenCalledTimes(1);
      const [url, init] = mock.mock.calls[0]!;
      expect(String(url)).toBe("http://core.test/guide/profile");
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer fake-id-token");
      expect(headers["X-Request-Id"]).toBeDefined();
    });

    it("passes the upstream status code through (e.g. 404)", async () => {
      mockCoreByPath({ "/guide/profile": coreErr(404, { title: "Not found" }) });

      const res = await request(app).get("/v1/guide/profile").set("Cookie", cookie);

      expect(res.status).toBe(404);
    });

    it("relays a Core 409 ROLE_NOT_ELIGIBLE on the participant PATCH verbatim — status + code (CTL-97 Minor-3)", async () => {
      // ParticipantService's GUIDE⊕PARENT exclusion on the PATCH participant_type change now
      // throws ConflictException.roleNotEligible -> 409 (aligned with the onboarding command's
      // 409), not 422. PATCH /v1/participant/profile is served by this transparent proxy, so the
      // coded problem+json must reach the frontend UNCHANGED — status AND `code`/`role` — because
      // the frontend keys terminal error UI on the machine code, never the 422 status or the text.
      mockCoreByPath({
        "/participant/profile": coreErr(409, {
          code: "ROLE_NOT_ELIGIBLE",
          role: "PARTICIPANT",
          title: "Not eligible for role: PARTICIPANT",
        }),
      });

      const res = await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .send({ participantType: "PARENT" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ROLE_NOT_ELIGIBLE");
      expect(res.body.role).toBe("PARTICIPANT");
    });

    it("proxies a different resource path (/universities) preserving the query string", async () => {
      const mock = mockCoreByPath({ "/universities": coreOk([{ id: "u1" }]) });

      const res = await request(app).get("/v1/universities?q=mit").set("Cookie", cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [{ id: "u1" }] });
      const url = String(mock.mock.calls[0]![0]);
      expect(url).toBe("http://core.test/universities?q=mit");
    });

    it("passes universityImageUrl through the /v1/tours proxy verbatim (public read, no session)", async () => {
      // CTL-16 (Contract A honesty): the bff proxies /v1/tours transparently — it never
      // parses/reshapes the Core response — so a new Core field just needs to survive the
      // round trip unchanged. Uses the real Core PagedResponse<TourSummaryResponse> shape
      // (items/page/size/totalElements/totalPages) so a future re-wrap of GET /v1/tours
      // would break this test rather than silently drop the field.
      const mock = mockCoreByPath({
        "/tours": coreOk({
          items: [
            {
              id: "o1",
              universityImageUrl: "https://r2.example/Yale%20University.png",
            },
          ],
          page: 0,
          size: 1,
          totalElements: 1,
          totalPages: 1,
        }),
      });

      // Deliberately no `.set("Cookie", cookie)` — GET /v1/tours is a public read
      // (isPublicGet), so this also pins that no session is required.
      const res = await request(app).get("/v1/tours");

      expect(res.status).toBe(200);
      expect(res.body.data.items[0].universityImageUrl).toBe(
        "https://r2.example/Yale%20University.png",
      );
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it("no session → 401 + Auth-Required (no Core call)", async () => {
      mockCoreByPath({});

      const res = await request(app).get("/v1/guide/profile");

      expect(res.status).toBe(401);
      expect(res.headers["auth-required"]).toBe("reauthenticate");
      expect(res.body).toMatchObject({ code: "SESSION_EXPIRED" });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("Core returns 401 → 401 + Auth-Required (re-auth, not pass-through)", async () => {
      mockCoreByPath({ "/guide/profile": coreErr(401) });

      const res = await request(app).get("/v1/guide/profile").set("Cookie", cookie);

      expect(res.status).toBe(401);
      expect(res.headers["auth-required"]).toBe("reauthenticate");
      expect(res.body).toMatchObject({ code: "SESSION_EXPIRED" });
    });

    it("Core unreachable (fetch rejects) → 502 CORE_UNAVAILABLE", async () => {
      global.fetch = jest
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

      const res = await request(app).get("/v1/guide/profile").set("Cookie", cookie);

      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ code: "CORE_UNAVAILABLE" });
    });

    /**
     * CTL-97 Task 4 (review fix) — the central pending-expiry guard must be enforced uniformly
     * on proxied `/v1/*` routes too, not just `withSession` reads. Mirrors
     * `tests/integration/api/session/pending-expiry.test.ts`, but through `coreProxy` (the third
     * `resolveBearer` call site), which previously only handled `TransientAuthError` in its catch
     * — a `PendingSessionExpiredError` fell through to a bare `throw err`, which Express 4 does
     * not route to error middleware from an async handler.
     */
    it("an EXPIRED PENDING session on a proxied route (GET /v1/guide/profile) → 401 SESSION_EXPIRED, destroys the cookie, and never calls Core", async () => {
      const now = Date.now();
      const pendingCookie = mintSessionCookie({
        provisioningStatus: "PENDING",
        pendingSince: now - 25 * 60 * 60 * 1000,
        pendingExpiresAt: now - 1,
      });
      const fetchMock = mockCoreByPath({}); // Core must NEVER be called for this request

      const res = await request(app).get("/v1/guide/profile").set("Cookie", pendingCookie);

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
  });

  // M1: the public/private decision and the upstream target must agree on ONE canonical path, so a
  // traversal cannot present a private resource as a `/tours/...` public read (which would forward
  // it anonymously, with no bearer).
  describe("path canonicalisation / traversal", () => {
    it("a `..` traversal never reaches Core as a public read (client collapses it; still private)", async () => {
      mockCoreByPath({});

      // HTTP clients collapse `..` before it hits the wire, so this arrives as
      // /v1/guide/offerings — a private path. (The literal, un-collapsed form a raw client could
      // send is rejected with 400 BAD_PATH; see the coreProxy unit test.)
      const res = await request(app).get("/v1/tours/../guide/offerings");

      expect(res.status).toBe(401);
      expect(res.headers["auth-required"]).toBe("reauthenticate");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("an encoded traversal is canonicalised, so a private path still requires a bearer", async () => {
      mockCoreByPath({});

      // %2e%2e decodes to `..`. Under the old naive `/v1` strip this path would still
      // startsWith("/tours/") → classified public → proxied anonymously.
      const res = await request(app).get("/v1/tours/%2e%2e/guide/offerings");

      expect(res.status).toBe(401);
      expect(res.headers["auth-required"]).toBe("reauthenticate");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("allows a slug that merely CONTAINS dots (the guard is segment-aware, not a substring match)", async () => {
      const mock = mockCoreByPath({ "/tours/foo..bar": coreOk({ id: "t1" }) });

      const res = await request(app).get("/v1/tours/foo..bar");

      expect(res.status).toBe(200);
      expect(String(mock.mock.calls[0]![0])).toBe("http://core.test/tours/foo..bar");
    });

    it("forwards the canonical path upstream, preserving the query string", async () => {
      const mock = mockCoreByPath({ "/guide/offerings": coreOk([{ id: "o1" }]) });

      const res = await request(app)
        .get("/v1/tours/%2e%2e/guide/offerings?page=2")
        .set("Cookie", cookie);

      expect(res.status).toBe(200);
      // The authorized path and the forwarded path are the same canonical path.
      expect(String(mock.mock.calls[0]![0])).toBe("http://core.test/guide/offerings?page=2");
    });
  });

  describe("CSRF protection on state-changing methods", () => {
    it("PATCH with a cross-site Origin → 403 CSRF_BLOCKED (no Core call)", async () => {
      mockCoreByPath({});

      const res = await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .set("Origin", "http://evil.example")
        .send({ displayName: "x" });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "CSRF_BLOCKED" });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("POST with a cross-site Origin → 403 CSRF_BLOCKED", async () => {
      mockCoreByPath({});

      const res = await request(app)
        .post("/v1/guide/offerings")
        .set("Cookie", cookie)
        .set("Origin", "http://evil.example")
        .send({ title: "x" });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "CSRF_BLOCKED" });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("PATCH with a same-origin Origin → allowed, proxied to Core", async () => {
      const mock = mockCoreByPath({ "/participant/profile": coreOk({ id: "p1" }) });

      const res = await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .set("Origin", WEB_ORIGIN)
        .send({ displayName: "x" });

      expect(res.status).toBe(200);
      expect(mock).toHaveBeenCalledTimes(1);
      expect(pathOf(mock.mock.calls[0]![0])).toBe("/participant/profile");
    });

    it("PATCH with no Origin header → allowed (SameSite cookie guards)", async () => {
      const mock = mockCoreByPath({ "/participant/profile": coreOk({ id: "p1" }) });

      const res = await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .send({ displayName: "x" });

      expect(res.status).toBe(200);
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it("a cross-site Referer (no Origin) also blocks the mutation", async () => {
      mockCoreByPath({});

      const res = await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .set("Referer", "http://evil.example/page")
        .send({ displayName: "x" });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "CSRF_BLOCKED" });
    });

    it("a cross-site Origin on a safe GET is NOT blocked", async () => {
      mockCoreByPath({ "/guide/profile": coreOk({ id: "g1" }) });

      const res = await request(app)
        .get("/v1/guide/profile")
        .set("Cookie", cookie)
        .set("Origin", "http://evil.example");

      expect(res.status).toBe(200);
    });
  });

  describe("mutations", () => {
    it("does NOT mint an Idempotency-Key when the client sends none", async () => {
      const mock = mockCoreByPath({ "/participant/profile": coreOk({ id: "p1" }) });

      const res = await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .set("Origin", WEB_ORIGIN)
        .send({ displayName: "x" });

      expect(res.status).toBe(200);
      const headers = (mock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      // The BFF forwards a client key but never mints one — a per-request UUID would defeat the
      // Core's dedupe (unique every time). Keyless ⇒ no header ⇒ Core passthrough.
      expect(headers["Idempotency-Key"]).toBeUndefined();
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("honours a client-provided Idempotency-Key", async () => {
      const mock = mockCoreByPath({ "/participant/profile": coreOk({ id: "p1" }) });

      await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .set("Origin", WEB_ORIGIN)
        .set("Idempotency-Key", "client-key-123")
        .send({ displayName: "x" });

      const headers = (mock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBe("client-key-123");
    });

    it("forwards the JSON body to Core on a mutation", async () => {
      const mock = mockCoreByPath({ "/participant/profile": coreOk({ id: "p1" }) });

      await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .set("Origin", WEB_ORIGIN)
        .send({ displayName: "Pat" });

      const init = mock.mock.calls[0]![1] as RequestInit;
      expect(init.method).toBe("PATCH");
      expect(init.body).toBe(JSON.stringify({ displayName: "Pat" }));
    });

    it("a GET does NOT carry an Idempotency-Key", async () => {
      const mock = mockCoreByPath({ "/guide/profile": coreOk({ id: "g1" }) });

      await request(app).get("/v1/guide/profile").set("Cookie", cookie);

      const headers = (mock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBeUndefined();
    });

    it("forwards the Bearer token on a mutation (not just GETs)", async () => {
      const mock = mockCoreByPath({ "/participant/profile": coreOk({ id: "p1" }) });

      await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .set("Origin", WEB_ORIGIN)
        .send({ displayName: "x" });

      const headers = (mock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer fake-id-token");
    });

    it("a body-less mutation does NOT send a body to Core", async () => {
      const mock = mockCoreByPath({ "/participant/profile": coreOk({ id: "p1" }) });

      await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .set("Origin", WEB_ORIGIN);
      // no .send() → req.body is {} → hasBody false

      const init = mock.mock.calls[0]![1] as RequestInit;
      expect(init.body).toBeUndefined();
    });
  });

  describe("correlation id", () => {
    it("forwards an inbound X-Request-Id to Core and echoes it on the response", async () => {
      const mock = mockCoreByPath({ "/guide/profile": coreOk({ id: "g1" }) });

      const res = await request(app)
        .get("/v1/guide/profile")
        .set("Cookie", cookie)
        .set("X-Request-Id", "req-abc-123");

      const headers = (mock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["X-Request-Id"]).toBe("req-abc-123");
      expect(res.headers["x-request-id"]).toBe("req-abc-123");
    });
  });

  describe("upstream response handling", () => {
    it("echoes a non-JSON upstream content-type onto the response", async () => {
      const csv = {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/csv" }),
        text: async () => "a,b\n1,2",
      } as unknown as Response;
      mockCoreByPath({ "/exports/data": csv });

      const res = await request(app).get("/v1/exports/data").set("Cookie", cookie);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.text).toBe("a,b\n1,2");
    });

    it("passes the body through when the upstream sends no content-type", async () => {
      const noType = {
        ok: true,
        status: 200,
        headers: new Headers(), // no content-type → res.type() is skipped
        text: async () => "raw-body",
      } as unknown as Response;
      mockCoreByPath({ "/raw": noType });

      const res = await request(app).get("/v1/raw").set("Cookie", cookie);

      expect(res.status).toBe(200);
      expect(res.text).toBe("raw-body");
    });

    it("passes a Core 403 through (authorization failure, NOT re-auth)", async () => {
      mockCoreByPath({ "/guide/offerings": coreErr(403, { title: "Forbidden" }) });

      const res = await request(app).get("/v1/guide/offerings").set("Cookie", cookie);

      expect(res.status).toBe(403);
      // Must NOT be turned into the 401/SESSION_EXPIRED re-auth signal.
      expect(res.headers["auth-required"]).toBeUndefined();
    });
  });

  describe("CSRF edge cases", () => {
    it("blocks a mutation whose Referer is unparseable (no Origin)", async () => {
      mockCoreByPath({});

      const res = await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .set("Referer", "::::not-a-valid-url")
        .send({ displayName: "x" });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "CSRF_BLOCKED" });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("GET /v1/meta/enrollment-years — cache header fidelity", () => {
    it("relays Core's computed Cache-Control unchanged", async () => {
      // Core contracts this value near the year boundary; the proxy must not flatten it.
      mockCoreByPath({
        "/meta/enrollment-years": coreOk(
          { entryYear: { min: 2016, max: 2027 } },
          { "cache-control": "public, max-age=3600" },
        ),
      });

      const res = await request(app).get("/v1/meta/enrollment-years");

      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    });

    it("does not impose the static-meta 5-minute policy on it", async () => {
      mockCoreByPath({
        "/meta/enrollment-years": coreOk({}, { "cache-control": "public, max-age=86400" }),
      });

      const res = await request(app).get("/v1/meta/enrollment-years");

      // 300 is the flat policy the proxy owns for tour-topics/tour-features. Applying it here
      // would move the caching decision out of Core — the only place that knows when the year
      // turns over.
      expect(res.headers["cache-control"]).not.toContain("max-age=300");
      expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    });

    it("still owns the policy for the static vocabularies (unchanged)", async () => {
      mockCoreByPath({
        "/meta/tour-topics": coreOk([], { "cache-control": "public, max-age=999999" }),
      });

      const res = await request(app).get("/v1/meta/tour-topics");

      // Regression guard: this path's policy is deliberately the proxy's, not Core's.
      expect(res.headers["cache-control"]).toBe("public, max-age=300");
    });

    it("does not relay Cache-Control for paths in neither set", async () => {
      mockCoreByPath({
        "/meta/universities": coreOk([], { "cache-control": "public, max-age=999999" }),
      });

      const res = await request(app).get("/v1/meta/universities?q=north");

      expect(res.headers["cache-control"]).toBeUndefined();
    });

    /**
     * This plan assumes `isPublicGet` already covers `/meta/` and therefore adds no auth wiring —
     * an assumption nothing currently asserts. Pin it: rules are public configuration, and a later
     * tightening of isPublicGet must not silently turn a config endpoint into a logged-in one.
     * The form needs these rules to render its fields at all, so a 401 here is not a degraded
     * experience, it is a blank pair of inputs.
     */
    it("serves the rules anonymously — no session cookie required", async () => {
      const mock = mockCoreByPath({
        "/meta/enrollment-years": coreOk(
          {
            entryYear: { min: 2016, max: 2027 },
            maxYearsToGraduate: [],
            defaultMaxYearsToGraduate: 8,
          },
          { "cache-control": "public, max-age=86400" },
        ),
      });

      // Deliberately NO .set("Cookie", ...).
      const res = await request(app).get("/v1/meta/enrollment-years");

      expect(res.status).toBe(200);
      // Named URL, not a bare toHaveBeenCalled(): auth resolution can produce its own upstream
      // traffic, so "something was called" would not prove THIS request reached Core.
      expect(mock.mock.calls.some(([url]) => String(url).includes("/meta/enrollment-years"))).toBe(
        true,
      );
    });

    /**
     * Fail-closed the other way: when Core sends no Cache-Control, the bff must send none either.
     * Written as a regression guard against a future
     * `upstreamCacheControl ?? "public, max-age=300"`, which reads like a harmless default and
     * would quietly restore the bff-owned policy this task exists to remove.
     */
    it("does not invent a Cache-Control when Core omits one", async () => {
      mockCoreByPath({
        "/meta/enrollment-years": coreOk({
          entryYear: { min: 2016, max: 2027 },
          maxYearsToGraduate: [],
          defaultMaxYearsToGraduate: 8,
        }),
      });

      const res = await request(app).get("/v1/meta/enrollment-years");

      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBeUndefined();
    });
  });
});
