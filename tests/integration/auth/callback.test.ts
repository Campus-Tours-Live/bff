import { jest } from "@jest/globals";
import request from "supertest";
import { app } from "@/app.js";
import { readSession, type AuthTx, type PendingSessionData } from "@/session.js";
import {
  FAKE_TOKENS,
  cookieNamed,
  isCleared,
  mintAuthTxCookie,
  roleEligibilityResponse,
  usersMeCodedErr,
  usersMeNonJsonErr,
  usersMeResponse,
} from "./_helpers.js";

/**
 * No module mocking: exchangeCode, the Core `GET /users/me` call (CTL-97 Task 5 — replaces the
 * old `POST /session?intent=`), and (on a signup that lacks the requested role) the Core
 * role-eligibility call all go through global.fetch. We stub fetch and route by URL — Google's
 * token endpoint returns a fake TokenSet, Core's `/users/me` returns whatever the test
 * configures, and `/users/me/role-eligibility` (the source of the PARENT→guide gate post
 * Profile Contract v2 / CTL-97) defaults to "eligible" unless a test overrides it. This keeps
 * the REAL google.ts (PKCE, authorize URL, exchangeCode) and the REAL routes.ts.
 */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CORE_USERS_ME_URL = "http://core.test/users/me";
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
 *  session-internal fields (currentRole, accountState, pendingSince/pendingExpiresAt) that
 *  never round-trip through the response body. */
function sessionFrom(pair: string | undefined): ReturnType<typeof readSession> {
  if (!pair) return null;
  return readSession({ headers: { cookie: pair } } as unknown as Parameters<typeof readSession>[0]);
}

/** `currentRole` only exists on a PROVISIONED session — narrows for the 200-branch assertions. */
function currentRoleOf(session: ReturnType<typeof sessionFrom>): string | undefined {
  return session?.accountState === "PROVISIONED" ? session.currentRole : undefined;
}

/** Narrows to the PENDING session shape for the 404-signup-pending assertions below. */
function pendingOf(session: ReturnType<typeof sessionFrom>): PendingSessionData | undefined {
  return session?.accountState === "PENDING" ? session : undefined;
}

const fetchMock = jest.fn<typeof fetch>();
/** What the next Core `GET /users/me` call resolves to (or null/reject). */
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
  coreNext = { kind: "resolve", value: usersMeResponse(200, { roles: ["PARTICIPANT"] }) };
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
    if (url === CORE_USERS_ME_URL) {
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

describe("GET /auth/callback — Core GET /users/me resolution (CTL-97 Task 5 truth table)", () => {
  it("targets the configured Core base with the exchanged Bearer id_token", async () => {
    coreNext = { kind: "resolve", value: usersMeResponse(200, { roles: ["PARTICIPANT"] }) };

    await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin", returnTo: "/dashboard" }));

    const url = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u === CORE_USERS_ME_URL);
    expect(url).toBe(CORE_USERS_ME_URL);
    expect(lastCoreInit?.headers).toMatchObject({ Authorization: "Bearer fake" });
  });

  describe("row: 404 ACCOUNT_NOT_PROVISIONED + signup → PENDING session", () => {
    it("requestedRole=GUIDE → PENDING session + /onboarding/guide, tx cleared", async () => {
      coreNext = { kind: "resolve", value: usersMeCodedErr(404, "ACCOUNT_NOT_PROVISIONED") };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set(
          "Cookie",
          txCookie({ intent: "signup", returnTo: "/onboarding/guide", requestedRole: "GUIDE" }),
        );

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("http://localhost:3001/onboarding/guide");
      expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);

      const sessCookie = cookieNamed(res, "ctl_sess");
      expect(sessCookie).toBeDefined();
      expect(isCleared(sessCookie)).toBe(false);
      const pending = pendingOf(sessionFrom(sessCookie));
      expect(pending).toBeDefined();
      expect(pending!.accountState).toBe("PENDING");
      expect(pending!.idToken).toBe(FAKE_TOKENS.id_token);
      expect(typeof pending!.pendingSince).toBe("number");
      // ~24h absolute lifetime.
      expect(pending!.pendingExpiresAt - pending!.pendingSince).toBe(24 * 60 * 60 * 1000);
    });

    it("requestedRole=PARTICIPANT → PENDING session + /onboarding/participant", async () => {
      coreNext = { kind: "resolve", value: usersMeCodedErr(404, "ACCOUNT_NOT_PROVISIONED") };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set(
          "Cookie",
          txCookie({
            intent: "signup",
            returnTo: "/onboarding/participant",
            requestedRole: "PARTICIPANT",
          }),
        );

      expect(res.headers.location).toBe("http://localhost:3001/onboarding/participant");
      const sessCookie = cookieNamed(res, "ctl_sess");
      expect(pendingOf(sessionFrom(sessCookie))).toBeDefined();
    });

    it("no requestedRole (role-agnostic entry) → PENDING session + /signup/role (pick a role first)", async () => {
      coreNext = { kind: "resolve", value: usersMeCodedErr(404, "ACCOUNT_NOT_PROVISIONED") };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set("Cookie", txCookie({ intent: "signup", returnTo: "/dashboard" }));

      expect(res.headers.location).toBe("http://localhost:3001/signup/role");
      const sessCookie = cookieNamed(res, "ctl_sess");
      expect(pendingOf(sessionFrom(sessCookie))).toBeDefined();
    });

    it("hardening: garbage tx.requestedRole (decrypted-JSON drift) is treated as absent → /signup/role, PENDING session still committed", async () => {
      coreNext = { kind: "resolve", value: usersMeCodedErr(404, "ACCOUNT_NOT_PROVISIONED") };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set(
          "Cookie",
          txCookie({
            intent: "signup",
            returnTo: "/dashboard",
            // A tampered/stale tx cookie has no runtime schema validation on requestedRole.
            requestedRole: "WIZARD" as unknown as AuthTx["requestedRole"],
          }),
        );

      expect(res.headers.location).toBe("http://localhost:3001/signup/role");
      const sessCookie = cookieNamed(res, "ctl_sess");
      expect(pendingOf(sessionFrom(sessCookie))).toBeDefined();
    });
  });

  it("row: 404 ACCOUNT_NOT_PROVISIONED + signin (unregistered) → /signin?error=not_registered, NO session cookie", async () => {
    coreNext = { kind: "resolve", value: usersMeCodedErr(404, "ACCOUNT_NOT_PROVISIONED") };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signin?error=not_registered");
    // NOT just cleared — no ctl_sess Set-Cookie at all (never established, never touched).
    expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });

  it("row: 403 ACCOUNT_SUSPENDED → /signin?error=account_suspended, no session (I8, clearSession defensively)", async () => {
    coreNext = { kind: "resolve", value: usersMeCodedErr(403, "ACCOUNT_SUSPENDED") };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signin?error=account_suspended");
    expect(isCleared(cookieNamed(res, "ctl_sess"))).toBe(true);
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });

  it("row: 403 ACCOUNT_DELETED → /signin?error=account_deleted, no session (I8, clearSession defensively)", async () => {
    coreNext = { kind: "resolve", value: usersMeCodedErr(403, "ACCOUNT_DELETED") };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signin?error=account_deleted");
    expect(isCleared(cookieNamed(res, "ctl_sess"))).toBe(true);
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });

  it("row: 409 ACCOUNT_STATE_INVALID → /signin?error=account_error, no session (integrity error)", async () => {
    coreNext = { kind: "resolve", value: usersMeCodedErr(409, "ACCOUNT_STATE_INVALID") };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signin?error=account_error");
    expect(isCleared(cookieNamed(res, "ctl_sess"))).toBe(true);
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });

  describe("row: everything else → system error, no session (I7 — a 404 with a different/no code is never pending/not_registered)", () => {
    it("404 with a DIFFERENT code (PROFILE_NOT_FOUND) on signin → 502 RESOLVE_FAILED, no session", async () => {
      coreNext = { kind: "resolve", value: usersMeCodedErr(404, "PROFILE_NOT_FOUND") };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set("Cookie", txCookie({ intent: "signin" }));

      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
      expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
      expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
    });

    it("404 with a DIFFERENT code (PROFILE_NOT_FOUND) on signup → STILL a system error, never pending", async () => {
      coreNext = { kind: "resolve", value: usersMeCodedErr(404, "PROFILE_NOT_FOUND") };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
      expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    });

    it("404 with a non-JSON body (no code) → 502 RESOLVE_FAILED, no session", async () => {
      coreNext = { kind: "resolve", value: usersMeNonJsonErr(404) };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
      expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    });

    it("Core 401 (CoreAuthError) → 502 RESOLVE_FAILED, no session", async () => {
      coreNext = { kind: "resolve", value: usersMeCodedErr(401) };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set("Cookie", txCookie({ intent: "signin" }));

      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
      expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    });

    it("Core 503 (CoreError 5xx) → 502 RESOLVE_FAILED, no session", async () => {
      coreNext = { kind: "resolve", value: usersMeCodedErr(503) };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set("Cookie", txCookie({ intent: "signin" }));

      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
      expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    });

    it("Core network failure (fetch rejects — transport CoreError(502)) → 502 RESOLVE_FAILED, no session", async () => {
      coreNext = { kind: "reject", err: new Error("ECONNREFUSED") };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set("Cookie", txCookie());

      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
      expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
      expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
    });

    it("Core 200 with a malformed (non-JSON) body → 502 RESOLVE_FAILED, no session (never crashes on cu.roles)", async () => {
      coreNext = {
        kind: "resolve",
        value: {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => {
            throw new Error("not json");
          },
          text: async () => {
            throw new Error("not json");
          },
        } as unknown as Response,
      };

      const res = await request(app)
        .get("/auth/callback")
        .query({ code: "abc", state: STATE })
        .set("Cookie", txCookie({ intent: "signin", returnTo: "/dashboard" }));

      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
      expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    });
  });

  it("role-eligibility check unreachable (signup, lacks requestedRole) → 502 RESOLVE_FAILED, no session", async () => {
    coreNext = { kind: "resolve", value: usersMeResponse(200, { roles: ["PARTICIPANT"] }) };
    fetchMock.mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === GOOGLE_TOKEN_URL) {
        return { ok: true, status: 200, json: async () => FAKE_TOKENS } as unknown as Response;
      }
      if (url === CORE_USERS_ME_URL) {
        lastCoreInit = init;
        return usersMeResponse(200, { roles: ["PARTICIPANT"] });
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
});

describe("GET /auth/callback — exact bad-state code gating (I8 must not fire on a non-matching code)", () => {
  it("403 with a code OTHER than ACCOUNT_SUSPENDED/ACCOUNT_DELETED → system error (502 RESOLVE_FAILED), NOT the suspended/deleted redirect, no session", async () => {
    coreNext = { kind: "resolve", value: usersMeCodedErr(403, "SOME_OTHER_FORBIDDEN") };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin" }));

    // The catch-all system-error branch (a JSON problem+json response), never the I8
    // suspended/deleted redirect — a non-matching 403 code must not trip that exact-code gate.
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
    expect(res.headers.location).toBeUndefined();
    expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });

  it("409 with a code OTHER than ACCOUNT_STATE_INVALID → system error (502 RESOLVE_FAILED), NOT the account_error redirect, no session", async () => {
    coreNext = { kind: "resolve", value: usersMeCodedErr(409, "SOME_OTHER_CONFLICT") };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signin" }));

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ status: 502, code: "RESOLVE_FAILED" });
    expect(res.headers.location).toBeUndefined();
    expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });
});

describe("GET /auth/callback — intent/requestedRole come ONLY from the signed tx, not the query string", () => {
  it("tx intent=signin (no requestedRole) with ?intent=signup&role=guide on the URL → follows the tx (not_registered), NOT the query (which would PENDING-provision)", async () => {
    // The callback handler never reads req.query.intent/req.query.role — only the decrypted,
    // signed ctl_auth_tx cookie. If it wrongly honored same-named query params, a 404
    // ACCOUNT_NOT_PROVISIONED here would instead commit a PENDING session and redirect to
    // /onboarding/guide (the signup+requestedRole=GUIDE row). Proving it follows the tx: a
    // signin with no requestedRole hitting the same Core response lands on
    // /signin?error=not_registered with NO session at all.
    coreNext = { kind: "resolve", value: usersMeCodedErr(404, "ACCOUNT_NOT_PROVISIONED") };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE, intent: "signup", role: "guide" })
      .set("Cookie", txCookie({ intent: "signin", returnTo: "/dashboard" }));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3001/signin?error=not_registered");
    expect(cookieNamed(res, "ctl_sess")).toBeUndefined();
    expect(isCleared(cookieNamed(res, "ctl_auth_tx"))).toBe(true);
  });
});

describe("GET /auth/callback — success landing + session (row: 200 provisioned)", () => {
  it("signin with roles → /dashboard AND a ctl_sess PROVISIONED session cookie established", async () => {
    coreNext = {
      kind: "resolve",
      value: usersMeResponse(200, { roles: ["PARTICIPANT"] }),
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
    expect(sessionFrom(sess)?.accountState).toBe("PROVISIONED");
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
      if (url === CORE_USERS_ME_URL) {
        return usersMeResponse(200, { roles: ["PARTICIPANT"] });
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
      value: usersMeResponse(200, { roles: ["GUIDE"] }),
    };

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.headers.location).toBe("http://localhost:3001/dashboard");
    const sessCookie = cookieNamed(res, "ctl_sess");
    expect(sessCookie).toBeDefined();
    // Holding the requested role is "effectively a login": currentRole set — and, being on
    // the redirect response's Set-Cookie, this is already persisted (not deferred to a later
    // write) before the browser is sent anywhere.
    expect(sessionFrom(sessCookie)).toMatchObject({ currentRole: "GUIDE" });
  });

  it("signup → /onboarding/guide, lacks GUIDE, eligible → /onboarding/guide with session, no marker", async () => {
    coreNext = {
      kind: "resolve",
      value: usersMeResponse(200, { roles: ["PARTICIPANT"] }),
    };
    // roleEligibilityNext defaults to eligible:true (see beforeEach).

    const res = await request(app)
      .get("/auth/callback")
      .query({ code: "abc", state: STATE })
      .set("Cookie", txCookie({ intent: "signup", returnTo: "/onboarding/guide" }));

    expect(res.headers.location).toBe("http://localhost:3001/onboarding/guide");
    const sessCookie = cookieNamed(res, "ctl_sess");
    expect(sessCookie).toBeDefined();
    // No session marker for the in-progress acquisition — the frontend page guard (a later
    // task) re-derives access statelessly. The session carries tokens only; currentRole stays
    // unset until the account actually holds GUIDE.
    expect(sessionFrom(sessCookie)).toMatchObject({ idToken: FAKE_TOKENS.id_token });
    expect(currentRoleOf(sessionFrom(sessCookie))).toBeUndefined();
  });

  it("signin, lacks the requested role → /signup/role, no currentRole", async () => {
    coreNext = { kind: "resolve", value: usersMeResponse(200, { roles: ["PARTICIPANT"] }) };

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
    expect(currentRoleOf(sessionFrom(sessCookie))).toBeUndefined();
    // Lacking a requested role on signin is not eligibility-gated — no eligibility call.
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).startsWith("http://core.test/users/me/role-eligibility"),
      ),
    ).toBe(false);
  });

  it("signup → /onboarding/participant, lacks PARTICIPANT, eligible → /onboarding/participant with session", async () => {
    coreNext = { kind: "resolve", value: usersMeResponse(200, { roles: [] }) };

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
    coreNext = { kind: "resolve", value: usersMeResponse(200, { roles: ["PARTICIPANT"] }) };

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
    coreNext = { kind: "resolve", value: usersMeResponse(200, { roles: ["GUIDE"] }) };

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
      if (url === CORE_USERS_ME_URL) {
        return usersMeResponse(200, {
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

describe("GET /auth/callback — blocked vs bare-account branches (row: 200 provisioned)", () => {
  it("blocked PARENT→guide → /signup/role?error=parent_no_guide AND NO session (cleared)", async () => {
    // Profile Contract v2 / CTL-97: PARENT status is sourced from Core's authoritative
    // role-eligibility check, not a profile field.
    coreNext = {
      kind: "resolve",
      value: usersMeResponse(200, { roles: ["PARTICIPANT"] }),
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
      value: usersMeResponse(200, { roles: ["PARTICIPANT"] }),
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
  });

  it("non-parent participant → /onboarding/guide is NOT blocked (role-eligibility says eligible)", async () => {
    coreNext = {
      kind: "resolve",
      value: usersMeResponse(200, { roles: ["PARTICIPANT"] }),
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
    coreNext = { kind: "resolve", value: usersMeResponse(200, { roles: [] }) };

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
});
