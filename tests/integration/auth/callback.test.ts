import { jest } from "@jest/globals";
import request from "supertest";
import { app } from "@/app.js";
import { readSession, type AuthTx } from "@/session.js";
import {
  FAKE_TOKENS,
  cookieNamed,
  coreResponse,
  isCleared,
  mintAuthTxCookie,
  roleEligibilityResponse,
} from "./_helpers.js";

/**
 * No module mocking: exchangeCode, the Core /session call, and (on a signup that lacks the
 * requested role) the Core role-eligibility call all go through global.fetch. We stub fetch
 * and route by URL — Google's token endpoint returns a fake TokenSet, Core's /session
 * returns whatever the test configures, and `/users/me/role-eligibility` (the source of the
 * PARENT→guide gate post Profile Contract v2 / CTL-97) defaults to "eligible" unless a test
 * overrides it. This keeps the REAL google.ts (PKCE, authorize URL, exchangeCode) and the
 * REAL routes.ts.
 */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CORE_SESSION_PREFIX = "http://core.test/session";
const CORE_ROLE_ELIGIBILITY_PREFIX = "http://core.test/users/me/role-eligibility";

const STATE = "test-state-value";
const baseTx: AuthTx = {
  state: STATE,
  codeVerifier: "test-verifier",
  returnTo: "/dashboard",
  intent: "signin",
};

function txCookie(overrides: Partial<AuthTx> = {}): string {
  return mintAuthTxCookie({ ...baseTx, ...overrides });
}

/** Decrypt a `ctl_sess=...` Set-Cookie pair via the REAL readSession, so a test can assert on
 *  session-internal fields (currentRole/onboardingRole) that never round-trip through the
 *  response body. */
function sessionFrom(pair: string | undefined): ReturnType<typeof readSession> {
  if (!pair) return null;
  return readSession({ headers: { cookie: pair } } as unknown as Parameters<typeof readSession>[0]);
}

const fetchMock = jest.fn<typeof fetch>();
/** What the next Core /session call resolves to (or null/reject). */
let coreNext: { kind: "resolve"; value: Response } | { kind: "reject"; err: unknown };
/** What the next Core /users/me/role-eligibility call resolves to. Defaults to eligible — most
 *  scenarios below aren't exercising the PARENT gate. */
let roleEligibilityNext: Response;
/** Whether the Google token exchange should succeed. */
let tokenOk: boolean;
/** Captured Core call args for assertions. */
let lastCoreInit: RequestInit | undefined;

beforeEach(() => {
  tokenOk = true;
  coreNext = { kind: "resolve", value: coreResponse(200, { roles: ["PARTICIPANT"] }) };
  roleEligibilityNext = roleEligibilityResponse(200, { eligible: true, reason: null });
  lastCoreInit = undefined;

  fetchMock.mockReset();
  fetchMock.mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === GOOGLE_TOKEN_URL) {
      if (!tokenOk)
        return { ok: false, status: 400, json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => FAKE_TOKENS } as unknown as Response;
    }
    if (url.startsWith(CORE_SESSION_PREFIX)) {
      lastCoreInit = init;
      if (coreNext.kind === "reject") throw coreNext.err;
      return coreNext.value;
    }
    if (url.startsWith(CORE_ROLE_ELIGIBILITY_PREFIX)) {
      return roleEligibilityNext;
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as unknown as typeof fetch);

  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("GET /auth/callback — provider errors", () => {
  it("access_denied (signin tx) → redirects to /signin, no problem+json, tx cleared", async () => {
    const res = await request(app)
      .get("/auth/callback")
      .query({ error: "access_denied" })
      .set("Cookie", txCookie({ intent: "signin" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signin");
    expect(res.headers["content-type"]).not.toContain("problem+json");
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("access_denied (signup → /onboarding/guide) → redirects to /signup/guide", async () => {
    const res = await request(app)
      .get("/auth/callback")
      .query({ error: "access_denied" })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signup/guide");
  });

  it("access_denied (signup → /onboarding/participant) → redirects to /signup/participant", async () => {
    const res = await request(app)
      .get("/auth/callback")
      .query({ error: "access_denied" })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/participant" }));

    expect(res.headers.location).toBe("http://localhost:3001/signup/participant");
  });

  it("access_denied (signup, other returnTo) → redirects to /signup/role", async () => {
    const res = await request(app)
      .get("/auth/callback")
      .query({ error: "access_denied" })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/dashboard" }));

    expect(res.headers.location).toBe("http://localhost:3001/signup/role");
  });

  it("access_denied with NO tx cookie → falls back to /signin", async () => {
    const res = await request(app).get("/auth/callback").query({ error: "access_denied" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signin");
    expect(res.headers["content-type"]).not.toContain("problem+json");
  });

  it("other provider error (server_error) → /signin?error=auth_failed", async () => {
    const res = await request(app)
      .get("/auth/callback")
      .query({ error: "server_error" })
      .set("Cookie", txCookie({ intent: "signin" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signin?error=auth_failed");
  });

  it("other provider error even on a signup tx → still /signin?error=auth_failed", async () => {
    const res = await request(app)
      .get("/auth/callback")
      .query({ error: "invalid_request" })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.headers.location).toBe("http://localhost:3001/signin?error=auth_failed");
  });
});

describe("GET /auth/callback — validation failures", () => {
  it("missing tx cookie → 400 problem+json AUTH_TX_MISSING", async () => {
    const res = await request(app).get("/auth/callback").query({ code: "abc", state: STATE });

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body).toMatchObject({ status: 400, code: "AUTH_TX_MISSING" });
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });

  it("state mismatch → 400 AUTH_STATE_INVALID", async () => {
    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: "wrong-state" })
      .set("Cookie", txCookie());

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 400, code: "AUTH_STATE_INVALID" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing code → 400 AUTH_STATE_INVALID", async () => {
    const res = await request(app)
      .get("/auth/callback")
      .query({ state: STATE })
      .set("Cookie", txCookie());

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 400, code: "AUTH_STATE_INVALID" });
  });

  it("missing state → 400 AUTH_STATE_INVALID", async () => {
    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc" })
      .set("Cookie", txCookie());

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 400, code: "AUTH_STATE_INVALID" });
  });

  it("invalid/garbage tx intent → 400 AUTH_INTENT_INVALID, rejected (never defaulted to signup)", async () => {
    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      // A tampered/stale tx cookie has no runtime schema validation — `intent` could be
      // anything. Cast past the AuthTx type to model that.
      .set("Cookie", txCookie({ intent: "bogus" as unknown as AuthTx["intent"] }));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 400, code: "AUTH_INTENT_INVALID" });
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
    // Rejected before any Core/token call — never silently treated as signup.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /auth/callback — token exchange", () => {
  it("exchangeCode rejects (Google token endpoint !ok) → 502 AUTH_EXCHANGE_FAILED, no session", async () => {
    tokenOk = false;

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie());

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ status: 502, code: "AUTH_EXCHANGE_FAILED" });
    expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
    // Core was never reached — only the (failed) token call happened.
    expect(lastCoreInit).toBeUndefined();
  });
});

describe("GET /auth/callback — Core /session resolution", () => {
  it("Core 404 on signin (unregistered) → /signin?error=not_registered, NO session cookie", async () => {
    coreNext = { kind: "resolve", value: coreResponse(404, undefined) };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signin?error=not_registered");
    expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);

    // Core called with the configured base + intent + bearer id_token.
    expect(lastCoreInit?.method).toBe("POST");
    expect((lastCoreInit?.headers as Record<string, string>).Authorization).toBe("Bearer fake");
  });

  it("Core network failure (fetch rejects) → 502 CORE_UNAVAILABLE, no session", async () => {
    coreNext = { kind: "reject", err: new Error("ECONNREFUSED") };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie());

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ status: 502, code: "CORE_UNAVAILABLE" });
    expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
  });

  it("Core non-ok, non-404 (500) → 502 RESOLVE_FAILED, no session", async () => {
    coreNext = { kind: "resolve", value: coreResponse(500, undefined) };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie());

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
    expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
  });

  it("role-eligibility check unreachable (signup, lacks requestedRole) → 502 RESOLVE_FAILED, no session", async () => {
    coreNext = { kind: "resolve", value: coreResponse(200, { roles: ["PARTICIPANT"] }) };
    fetchMock.mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === GOOGLE_TOKEN_URL) {
        return { ok: true, status: 200, json: async () => FAKE_TOKENS } as unknown as Response;
      }
      if (url.startsWith(CORE_SESSION_PREFIX)) {
        lastCoreInit = init;
        return coreResponse(200, { roles: ["PARTICIPANT"] });
      }
      if (url.startsWith(CORE_ROLE_ELIGIBILITY_PREFIX)) {
        throw new Error("ECONNREFUSED");
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as unknown as typeof fetch);

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
    expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });

  it("targets the configured Core base with the tx intent in the query", async () => {
    coreNext = { kind: "resolve", value: coreResponse(200, { roles: ["PARTICIPANT"] }) };

    await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/participant" }));

    const url = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.startsWith(CORE_SESSION_PREFIX));
    expect(url).toBe("http://core.test/session?intent=signup");
  });
});

describe("GET /auth/callback — success landing + session", () => {
  it("signin with roles → /dashboard AND a ctl_sess session cookie established", async () => {
    coreNext = {
      kind: "resolve",
      value: coreResponse(200, {
        roles: ["PARTICIPANT"],
        currentRole: "PARTICIPANT",
      }),
    };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin", returnTo: "/dashboard" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/dashboard");

    const sess = cookieNamed(res, "ctl_sess");
    expect(sess).toBeDefined();
    expect(sess).toMatch(/^ctl_sess=.+/);
    expect(sess).toMatch(/HttpOnly/i);
    expect(isCleared(sess)).toBe(false);
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });

  it("token response without id_token → still resolves (covers the empty-Bearer fallback)", async () => {
    // Google's token endpoint returns no id_token → routes.ts falls back to an empty Bearer.
    fetchMock.mockImplementation((async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === GOOGLE_TOKEN_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "a", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (url.startsWith(CORE_SESSION_PREFIX)) {
        return coreResponse(200, { roles: ["PARTICIPANT"], currentRole: "PARTICIPANT" });
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as unknown as typeof fetch);

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin", returnTo: "/dashboard" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/dashboard");
  });

  it("signup → /onboarding/guide, already holds GUIDE → /dashboard, currentRole set pre-redirect", async () => {
    coreNext = {
      kind: "resolve",
      value: coreResponse(200, { roles: ["GUIDE"] }),
    };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.headers.location).toBe("http://localhost:3001/dashboard");
    const sessCookie = cookieNamed(res, "ctl_sess");
    expect(sessCookie).toBeDefined();
    // Holding the requested role is "effectively a login": currentRole set, onboardingRole
    // cleared — and, being on the redirect response's Set-Cookie, this is already persisted
    // (not deferred to a later write) before the browser is sent anywhere.
    expect(sessionFrom(sessCookie)).toMatchObject({ currentRole: "GUIDE" });
    expect(sessionFrom(sessCookie)?.onboardingRole).toBeUndefined();
  });

  it("signup → /onboarding/guide, lacks GUIDE, eligible → /onboarding/guide with session", async () => {
    coreNext = {
      kind: "resolve",
      value: coreResponse(200, { roles: ["PARTICIPANT"] }),
    };
    // roleEligibilityNext defaults to eligible:true (see beforeEach).

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.headers.location).toBe("http://localhost:3001/onboarding/guide");
    const sessCookie = cookieNamed(res, "ctl_sess");
    expect(sessCookie).toBeDefined();
    // The in-progress marker that authorizes GET /v1/onboarding?role=guide before GUIDE is held.
    expect(sessionFrom(sessCookie)).toMatchObject({ onboardingRole: "GUIDE" });
    expect(sessionFrom(sessCookie)?.currentRole).toBeUndefined();
  });

  it("signin, lacks the requested role → /signup/role, no onboardingRole", async () => {
    coreNext = { kind: "resolve", value: coreResponse(200, { roles: ["PARTICIPANT"] }) };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set(
        "Cookie",
        txCookie({ intent: "signin", returnTo: "/dashboard", requestedRole: "GUIDE" }),
      );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signup/role");
    const sessCookie = cookieNamed(res, "ctl_sess");
    expect(sessCookie).toBeDefined();
    expect(sessionFrom(sessCookie)?.currentRole).toBeUndefined();
    expect(sessionFrom(sessCookie)?.onboardingRole).toBeUndefined();
    // Lacking a requested role on signin is not eligibility-gated — no eligibility call.
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).startsWith("http://core.test/users/me/role-eligibility"),
      ),
    ).toBe(false);
  });

  it("signup → /onboarding/participant, lacks PARTICIPANT, eligible → /onboarding/participant with session", async () => {
    coreNext = { kind: "resolve", value: coreResponse(200, { roles: [] }) };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/participant" }));

    expect(res.headers.location).toBe("http://localhost:3001/onboarding/participant");
    expect(cookieNamed(res, "ctl_sess")).toBeDefined();
  });

  it("uses the entry's explicit requestedRole over inferring one from returnTo", async () => {
    // returnTo looks like a guide-onboarding link, but the entry explicitly requested
    // PARTICIPANT — the explicit tx field must win over inferLegacyRole(returnTo).
    coreNext = { kind: "resolve", value: coreResponse(200, { roles: ["PARTICIPANT"] }) };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set(
        "Cookie",
        txCookie({
          intent: "signin",
          returnTo: "/onboarding/guide",
          requestedRole: "PARTICIPANT",
        }),
      );

    // Held PARTICIPANT → role home, not guide onboarding (which inferLegacyRole would imply).
    expect(res.headers.location).toBe("http://localhost:3001/dashboard");
    expect(cookieNamed(res, "ctl_sess")).toBeDefined();
  });

  it("session cookie (with the role) is set on the redirect, and a replayed /userinfo reflects it", async () => {
    coreNext = { kind: "resolve", value: coreResponse(200, { roles: ["GUIDE"] }) };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin", returnTo: "/dashboard" }));

    expect(res.status).toBe(302);
    const sessCookie = cookieNamed(res, "ctl_sess");
    expect(sessCookie).toBeDefined(); // Set-Cookie present ON the redirect response itself.

    // Replay it as a fresh request — currentRole must already be visible, proving the write
    // happened BEFORE the redirect (no separate "await save" the client could race).
    fetchMock.mockImplementation((async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "http://core.test/users/me") {
        return coreResponse(200, {
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
          roles: ["GUIDE"],
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as unknown as typeof fetch);

    const userinfo = await request(app).get("/v1/userinfo").set("Cookie", sessCookie!);
    expect(userinfo.status).toBe(200);
    expect(userinfo.body.data.currentRole).toBe("GUIDE");
  });
});

describe("GET /auth/callback — blocked vs bare-account branches", () => {
  it("blocked PARENT→guide → /signup/role?error=parent_no_guide AND NO session (cleared)", async () => {
    // Profile Contract v2 / CTL-97: PARENT status is sourced from Core's authoritative
    // role-eligibility check, not a profile field.
    coreNext = {
      kind: "resolve",
      value: coreResponse(200, { roles: ["PARTICIPANT"] }),
    };
    roleEligibilityNext = roleEligibilityResponse(200, {
      eligible: false,
      reason: "PARENT_CANNOT_BECOME_GUIDE",
    });

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signup/role?error=parent_no_guide");
    // clearSession path: ctl_sess present but cleared (maxAge 0), never established.
    expect(isCleared(cookieNamed(res, "ctl_sess"))).toBe(true);
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });

  it("blocked, non-PARENT ineligible reason → generic /signup/role AND NO session (cleared)", async () => {
    // The eligibility gate must be generic (any !eligible blocks), not PARENT-reason-specific —
    // otherwise a reason like ROLE_ALREADY_HELD would silently fall through into onboarding.
    coreNext = {
      kind: "resolve",
      value: coreResponse(200, { roles: ["PARTICIPANT"] }),
    };
    roleEligibilityNext = roleEligibilityResponse(200, {
      eligible: false,
      reason: "ROLE_ALREADY_HELD",
    });

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signup/role");
    const sessCookie = cookieNamed(res, "ctl_sess");
    // clearSession path: ctl_sess present but cleared (maxAge 0), never established.
    expect(isCleared(sessCookie)).toBe(true);
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
    expect(sessionFrom(sessCookie)?.onboardingRole).toBeUndefined();
  });

  it("non-parent participant → /onboarding/guide is NOT blocked (role-eligibility says eligible)", async () => {
    coreNext = {
      kind: "resolve",
      value: coreResponse(200, { roles: ["PARTICIPANT"] }),
    };
    // roleEligibilityNext defaults to eligible:true (see beforeEach).

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/onboarding/guide");
    expect(cookieNamed(res, "ctl_sess")).toBeDefined();
    expect(isCleared(cookieNamed(res, "ctl_sess"))).toBe(false);
  });

  it("bare account signin (roles=[]) → /signup/role?error=complete_signup WITH a session", async () => {
    coreNext = { kind: "resolve", value: coreResponse(200, { roles: [] }) };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin", returnTo: "/dashboard" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signup/role?error=complete_signup");
    const sess = cookieNamed(res, "ctl_sess");
    expect(sess).toBeDefined();
    expect(isCleared(sess)).toBe(false);
  });

  it("malformed Core JSON body (json throws) → treated as no roles → complete_signup with session", async () => {
    coreNext = {
      kind: "resolve",
      value: {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response,
    };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin", returnTo: "/dashboard" }));

    expect(res.headers.location).toBe("http://localhost:3001/signup/role?error=complete_signup");
    expect(cookieNamed(res, "ctl_sess")).toBeDefined();
  });
});
