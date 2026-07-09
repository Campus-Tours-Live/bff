import { afterEach, describe, expect, it, jest } from "@jest/globals";
import crypto from "node:crypto";
import {
  buildAuthorizeUrl,
  createPkce,
  exchangeCode,
  randomState,
  refreshTokens,
  type TokenSet,
} from "@/auth/google.js";

// Mirrors tests/setup.ts — the values config.ts reads for the Google client.
const CLIENT_ID = "test-google-client-id";
const CLIENT_SECRET = "test-google-client-secret";
const REDIRECT_URI = "http://localhost:3001/auth/callback";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTHORIZE_ORIGIN = "https://accounts.google.com";

/** A URL-safe base64url string contains only [A-Za-z0-9_-] (no +, /, or =). */
function isUrlSafe(s: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(s);
}

describe("createPkce", () => {
  it("returns a verifier and challenge", () => {
    const { verifier, challenge } = createPkce();
    expect(typeof verifier).toBe("string");
    expect(typeof challenge).toBe("string");
    expect(verifier.length).toBeGreaterThan(0);
    expect(challenge.length).toBeGreaterThan(0);
  });

  it("produces a URL-safe verifier and challenge (no +, /, or =)", () => {
    const { verifier, challenge } = createPkce();
    expect(isUrlSafe(verifier)).toBe(true);
    expect(isUrlSafe(challenge)).toBe(true);
  });

  it("derives the challenge as the base64url SHA-256 of the verifier", () => {
    const { verifier, challenge } = createPkce();
    const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("produces a different verifier on each call (randomness)", () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe("randomState", () => {
  it("returns a non-empty URL-safe string", () => {
    const state = randomState();
    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(0);
    expect(isUrlSafe(state)).toBe(true);
  });

  it("returns a different value on two calls", () => {
    expect(randomState()).not.toBe(randomState());
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds a Google authorize URL with the expected static params", () => {
    const url = new URL(buildAuthorizeUrl({ state: "st8", codeChallenge: "chal" }));
    expect(url.origin).toBe(AUTHORIZE_ORIGIN);
    expect(url.pathname).toBe("/o/oauth2/v2/auth");

    const p = url.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
  });

  it("forwards the provided state and code_challenge", () => {
    const url = new URL(buildAuthorizeUrl({ state: "my-state", codeChallenge: "my-challenge" }));
    expect(url.searchParams.get("state")).toBe("my-state");
    expect(url.searchParams.get("code_challenge")).toBe("my-challenge");
  });

  it("includes login_hint when provided", () => {
    const url = new URL(
      buildAuthorizeUrl({
        state: "s",
        codeChallenge: "c",
        loginHint: "user@example.com",
      }),
    );
    expect(url.searchParams.get("login_hint")).toBe("user@example.com");
  });

  it("omits login_hint when not provided", () => {
    const url = new URL(buildAuthorizeUrl({ state: "s", codeChallenge: "c" }));
    expect(url.searchParams.has("login_hint")).toBe(false);
  });

  it("URL-encodes special characters in params", () => {
    const url = new URL(buildAuthorizeUrl({ state: "a b&c=d", codeChallenge: "x/y+z" }));
    // Round-tripping through URL/searchParams must yield the original values.
    expect(url.searchParams.get("state")).toBe("a b&c=d");
    expect(url.searchParams.get("code_challenge")).toBe("x/y+z");
  });
});

/** Build a Response-like object for a mocked fetch. */
function fetchResponse(ok: boolean, status: number, json: unknown): Response {
  return {
    ok,
    status,
    json: async () => json,
  } as unknown as Response;
}

/** Parse the x-www-form-urlencoded body passed to a mocked fetch call. */
function bodyParams(mockFetch: jest.Mock): URLSearchParams {
  const init = mockFetch.mock.calls[0][1] as RequestInit;
  return new URLSearchParams(init.body as string);
}

describe("exchangeCode", () => {
  const tokenSet: TokenSet = {
    access_token: "at-123",
    refresh_token: "rt-456",
    expires_in: 3600,
    id_token: "idt-789",
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("POSTs to the Google token endpoint with form-urlencoded content type", async () => {
    const mockFetch = jest.fn<typeof fetch>(async () => fetchResponse(true, 200, tokenSet));
    global.fetch = mockFetch as unknown as typeof fetch;

    await exchangeCode("auth-code", "verifier-xyz");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TOKEN_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("sends the authorization_code grant body with code, secret, redirect and verifier", async () => {
    const mockFetch = jest.fn(async () => fetchResponse(true, 200, tokenSet));
    global.fetch = mockFetch as unknown as typeof fetch;

    await exchangeCode("auth-code", "verifier-xyz");

    const body = bodyParams(mockFetch);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("client_secret")).toBe(CLIENT_SECRET);
    expect(body.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(body.get("code_verifier")).toBe("verifier-xyz");
    // refresh_token is not part of the code-exchange grant.
    expect(body.has("refresh_token")).toBe(false);
  });

  it("returns the parsed token JSON on success", async () => {
    const mockFetch = jest.fn(async () => fetchResponse(true, 200, tokenSet));
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await exchangeCode("auth-code", "verifier-xyz");
    expect(result).toEqual(tokenSet);
  });

  it("throws when the token endpoint responds non-ok", async () => {
    const mockFetch = jest.fn(async () => fetchResponse(false, 400, { error: "invalid_grant" }));
    global.fetch = mockFetch as unknown as typeof fetch;

    await expect(exchangeCode("bad-code", "verifier")).rejects.toThrow(
      /Google token request failed: 400/,
    );
  });
});

describe("refreshTokens", () => {
  const tokenSet: TokenSet = {
    access_token: "at-new",
    expires_in: 3600,
    id_token: "idt-new",
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("POSTs to the Google token endpoint", async () => {
    const mockFetch = jest.fn<typeof fetch>(async () => fetchResponse(true, 200, tokenSet));
    global.fetch = mockFetch as unknown as typeof fetch;

    await refreshTokens("rt-existing");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(TOKEN_URL);
  });

  it("sends the refresh_token grant body with the token, client id and secret", async () => {
    const mockFetch = jest.fn(async () => fetchResponse(true, 200, tokenSet));
    global.fetch = mockFetch as unknown as typeof fetch;

    await refreshTokens("rt-existing");

    const body = bodyParams(mockFetch);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-existing");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("client_secret")).toBe(CLIENT_SECRET);
    // No PKCE verifier or redirect_uri on a refresh.
    expect(body.has("code_verifier")).toBe(false);
    expect(body.has("redirect_uri")).toBe(false);
  });

  it("returns the parsed token JSON on success", async () => {
    const mockFetch = jest.fn(async () => fetchResponse(true, 200, tokenSet));
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await refreshTokens("rt-existing");
    expect(result).toEqual(tokenSet);
  });

  it("throws when the token endpoint responds non-ok", async () => {
    const mockFetch = jest.fn(async () => fetchResponse(false, 401, { error: "invalid_grant" }));
    global.fetch = mockFetch as unknown as typeof fetch;

    await expect(refreshTokens("expired-rt")).rejects.toThrow(/Google token request failed: 401/);
  });
});
