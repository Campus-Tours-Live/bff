import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Minimal Google OAuth 2.0 / OIDC Authorization-Code + PKCE helpers (no SDK).
 * The id_token returned here is a JWT (signed by Google) that the Core API
 * validates against Google's JWKS — that's what the BFF forwards as the Bearer.
 */
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(crypto.randomBytes(16));
}

/** Build the Google /authorize URL. `loginHint` pre-fills the account chooser. */
export function buildAuthorizeUrl(opts: {
  state: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    scope: "openid email profile",
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline", // request a refresh token
    prompt: "consent", // ensure a refresh token is issued on re-consent
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

/**
 * A failed call to Google's token endpoint, typed so the caller can tell a genuinely dead
 * grant from a transient upstream problem.
 *
 * This distinction is load-bearing: the only correct response to a dead grant is to clear
 * the session, and the only correct response to Google having a bad minute is to keep it.
 * Conflating them (which a bare `Error` forced) means one Google 5xx permanently logs a
 * user out, because clearing the session discards the refresh token — there is then
 * nothing left to retry with.
 */
export class GoogleTokenError extends Error {
  constructor(
    /** HTTP status from Google, or 0 when the request never completed (network failure). */
    readonly status: number,
    /** Google's `error` field, when the body was JSON and carried one. */
    readonly code?: string,
    /** Google's `error_description`, or a short note for transport failures. */
    readonly description?: string,
  ) {
    super(`Google token request failed: ${status}${code ? ` (${code})` : ""}`);
    this.name = "GoogleTokenError";
  }

  /**
   * True only when retrying is pointless because the grant/client is genuinely rejected.
   *
   * Deliberately a strict ALLOWLIST, not a status-code range: an unparseable body, an
   * unfamiliar error code, or any 4xx we don't recognise stays transient. Wrongly keeping
   * a session costs one extra 401 later; wrongly clearing one costs the user their session
   * irrecoverably. The asymmetry decides the default.
   */
  get fatal(): boolean {
    return this.code === "invalid_grant" || this.code === "invalid_client";
  }
}

/** Google's token endpoint expects application/x-www-form-urlencoded. */
async function postToken(body: Record<string, string>): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  } catch (cause) {
    // Never reached Google (DNS, TCP, TLS, timeout) — always retryable.
    throw new GoogleTokenError(0, undefined, cause instanceof Error ? cause.message : "network");
  }

  if (!res.ok) {
    // Read the body: it is the ONLY place Google says `invalid_grant`. A non-JSON body
    // (proxy/CDN HTML error page) leaves `code` undefined, i.e. transient.
    let code: string | undefined;
    let description: string | undefined;
    try {
      const parsed = (await res.json()) as { error?: string; error_description?: string };
      code = parsed?.error;
      description = parsed?.error_description;
    } catch {
      /* non-JSON error body — leave code undefined so it classifies as transient */
    }
    throw new GoogleTokenError(res.status, code, description);
  }

  return (await res.json()) as TokenSet;
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
  return postToken({
    grant_type: "authorization_code",
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: config.google.redirectUri,
    code_verifier: codeVerifier,
  });
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return postToken({
    grant_type: "refresh_token",
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    refresh_token: refreshToken,
  });
}

/**
 * Best-effort revocation of a Google grant at logout.
 *
 * Clearing our session cookie ends the session HERE. The refresh token inside it stays valid
 * at Google until it expires or is revoked, so anyone holding a copy could keep minting
 * id_tokens for an account whose owner believes they signed out. Revoking the refresh token
 * invalidates the whole grant, access tokens included.
 *
 * This became load-bearing once refresh tokens were made durable: `bearerForSession` now keeps
 * them across a transient Google outage instead of discarding them (see the failure
 * classification there). Durable credentials that no logout revokes would outlive the "sign
 * out" the user trusted, so the two changes belong together.
 *
 * Note this revokes the GRANT, not one token — other sessions of the same user for this OAuth
 * client end too.
 *
 * NEVER allowed to fail, delay, or block a logout: the user asked to leave, and an
 * unreachable Google is not a reason to keep them signed in. Errors are swallowed on
 * purpose; the local session is cleared either way.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
  } catch {
    // Best effort — see above. A failed revocation must not keep the user signed in.
  }
}
