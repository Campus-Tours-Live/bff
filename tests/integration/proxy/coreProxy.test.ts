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
    it("forwards a generated Idempotency-Key on a mutation", async () => {
      const mock = mockCoreByPath({ "/participant/profile": coreOk({ id: "p1" }) });

      const res = await request(app)
        .patch("/v1/participant/profile")
        .set("Cookie", cookie)
        .set("Origin", WEB_ORIGIN)
        .send({ displayName: "x" });

      expect(res.status).toBe(200);
      const headers = (mock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBeDefined();
      expect(headers["Idempotency-Key"]).not.toBe("");
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
});
