import type { Response } from "express";
import request from "supertest";
import { app } from "@/app.js";
import { writeSession } from "@/session.js";
import { cookieNamed, isCleared } from "./_helpers.js";

/** Mint a real, valid ctl_sess cookie pair via the production writeSession. */
function sessCookie(idToken = "id-tok"): string {
  const cookies: string[] = [];
  const res = {
    append(name: string, value: string) {
      if (name === "Set-Cookie") cookies.push(value);
      return res;
    },
  };
  writeSession(res as unknown as Response, { idToken });
  const setCookie = cookies[0];
  if (!setCookie) throw new Error("writeSession did not append a cookie");
  return setCookie.split(";")[0] as string;
}

describe("GET/POST /auth/logout", () => {
  it("GET clears the session and redirects to the web base url", async () => {
    const res = await request(app).get("/auth/logout").set("Cookie", sessCookie());

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001");
    expect(isCleared(cookieNamed(res, "ctl_sess"))).toBe(true);
  });

  it("POST clears the session and redirects to the web base url", async () => {
    const res = await request(app).post("/auth/logout").set("Cookie", sessCookie());

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001");
    expect(isCleared(cookieNamed(res, "ctl_sess"))).toBe(true);
  });

  it("clears the session even when no session cookie was present", async () => {
    const res = await request(app).get("/auth/logout");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001");
    expect(isCleared(cookieNamed(res, "ctl_sess"))).toBe(true);
  });
});

describe("GET /auth/session", () => {
  it("returns authenticated:true for a valid session with an idToken", async () => {
    const res = await request(app)
      .get("/auth/session")
      .set("Cookie", sessCookie("a-real-id-token"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: true });
  });

  it("returns authenticated:false when no session cookie is present", async () => {
    const res = await request(app).get("/auth/session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it("returns authenticated:false for a garbage / tampered session cookie", async () => {
    const res = await request(app).get("/auth/session").set("Cookie", "ctl_sess=not-a-valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it("returns authenticated:false for a valid session lacking an idToken", async () => {
    // Build a session whose payload has no idToken (e.g. accessToken only).
    const cookies: string[] = [];
    const res = {
      append(name: string, value: string) {
        if (name === "Set-Cookie") cookies.push(value);
        return res;
      },
    };
    writeSession(res as unknown as Response, { accessToken: "only-access" });
    const pair = (cookies[0] as string).split(";")[0] as string;

    const out = await request(app).get("/auth/session").set("Cookie", pair);
    expect(out.body).toEqual({ authenticated: false });
  });
});
