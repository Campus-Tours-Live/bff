import request from "supertest";
import { app } from "@/app.js";
import { cookieNamed } from "./_helpers.js";

/**
 * GET /auth/login drives the REAL Google PKCE helpers (createPkce / randomState /
 * buildAuthorizeUrl) — only the network-touching exchangeCode is mocked elsewhere,
 * so here nothing needs to be stubbed.
 */
describe("GET /auth/login", () => {
  it("redirects (302) to the Google authorize URL and sets a ctl_auth_tx cookie", async () => {
    const res = await request(app).get("/auth/login");

    expect(res.status).toBe(302);
    const location = res.headers.location;
    expect(location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);

    const url = new URL(location);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3001/auth/callback");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // state + code_challenge are randomly generated and present.
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();

    const tx = cookieNamed(res, "ctl_auth_tx");
    expect(tx).toBeDefined();
    expect(tx).toMatch(/^ctl_auth_tx=.+/);
    expect(tx).toMatch(/HttpOnly/i);
    expect(tx).toMatch(/Max-Age=900/i);
  });

  it("defaults intent to signin (no login_hint by default)", async () => {
    const res = await request(app).get("/auth/login");
    const url = new URL(res.headers.location);
    expect(url.searchParams.get("login_hint")).toBeNull();
    // No assertion of intent on the URL (it lives in the encrypted tx cookie);
    // the default-intent behaviour is exercised end-to-end in callback tests.
    expect(cookieNamed(res, "ctl_auth_tx")).toBeDefined();
  });

  it("honors login_hint by adding it to the authorize URL", async () => {
    const res = await request(app).get("/auth/login").query({ login_hint: "user@example.com" });
    const url = new URL(res.headers.location);
    expect(url.searchParams.get("login_hint")).toBe("user@example.com");
  });

  it("accepts intent=signup (still redirects + sets tx)", async () => {
    const res = await request(app)
      .get("/auth/login")
      .query({ intent: "signup", returnTo: "/onboarding/guide" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("accounts.google.com");
    expect(cookieNamed(res, "ctl_auth_tx")).toBeDefined();
  });

  it("redirects regardless of an unsafe returnTo (sanitized into the tx, not the URL)", async () => {
    const res = await request(app)
      .get("/auth/login")
      .query({ returnTo: "https://evil.example/steal" });
    // The open-redirect attempt never reaches the authorize URL; we still get a
    // normal Google redirect and a tx cookie. (safeReturnTo collapses it to the
    // default — verified behaviourally via callback tests.)
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("accounts.google.com");
    expect(cookieNamed(res, "ctl_auth_tx")).toBeDefined();
  });
});
