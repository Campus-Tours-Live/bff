import request from "supertest";
import { app } from "@/app.js";

const WEB_ORIGIN = "http://localhost:3001"; // WEB_ORIGIN from tests/setup.ts

describe("app (smoke)", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", auth: "google" });
  });

  it("unknown route → 404 problem+json", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("correlation id", () => {
  it("honours an inbound X-Request-Id", async () => {
    const res = await request(app).get("/health").set("X-Request-Id", "fixed-id-1");
    expect(res.headers["x-request-id"]).toBe("fixed-id-1");
  });

  it("generates an X-Request-Id when none is supplied", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });
});

describe("CORS", () => {
  it("echoes the allow-origin headers for the configured web origin", async () => {
    const res = await request(app).get("/health").set("Origin", WEB_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["vary"]).toBe("Origin");
  });

  it("does NOT set allow-origin for a foreign origin", async () => {
    const res = await request(app).get("/health").set("Origin", "http://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers a CORS preflight (OPTIONS) with 204", async () => {
    const res = await request(app).options("/v1/participant/profile").set("Origin", WEB_ORIGIN);
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });
});

describe("error handler", () => {
  it("turns a thrown body-parse error into a 500 problem+json", async () => {
    const res = await request(app)
      .post("/v1/participant/profile")
      .set("Content-Type", "application/json")
      .send("{ not valid json");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ status: 500, code: "INTERNAL" });
  });
});
