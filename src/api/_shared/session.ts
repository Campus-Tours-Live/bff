import type { Request, Response } from "express";
import { readSession, writeSession, type SessionData } from "../../session.js";
import { refreshTokens, GoogleTokenError } from "../../auth/google.js";
import { clock } from "../../lib/clock.js";
import { TransientAuthError, PendingSessionExpiredError } from "./errors.js";

/**
 * Refresh this long before expiry. The old 60s was too tight: a token endpoint that takes
 * a few seconds, or one retry, and the window is gone — turning a slow minute at Google
 * into a failed request on a session that was perfectly healthy.
 */
const REFRESH_WINDOW_MS = 5 * 60_000;

/**
 * In-flight refreshes, keyed by the refresh token being redeemed.
 *
 * Without this, a burst of concurrent requests each spend a separate round-trip on the same
 * refresh, and each writes its own `Set-Cookie` (last-write-wins) — wasteful, and it makes
 * the resulting cookie state depend on response ordering.
 *
 * TWO LIMITS, both real — do NOT read this as making refresh-token rotation safe:
 *
 *  1. PER PROCESS only. The session is a stateless encrypted cookie with no shared store,
 *     so behind multiple instances concurrent refreshes remain possible.
 *  2. It does NOT close the stale-cookie window. The map is evicted the moment the flight
 *     settles, so a request that was already in flight carrying the OLD cookie (sent before
 *     the refreshing response's `Set-Cookie` arrived) will redeem the old refresh token
 *     AGAIN on arrival. If Google ever rotated refresh tokens, that second redemption would
 *     come back `invalid_grant` → classified fatal → session cleared: exactly the
 *     unrecoverable logout this file exists to prevent. Low risk today because Google does
 *     not generally rotate them (the `refresh_token ?? session.refreshToken` fallback below
 *     assumes as much), but if that ever changes, coalescing is NOT the defence — retaining
 *     the settled result under a short TTL would be, so a lagging request gets the new
 *     tokens instead of re-redeeming the old ones.
 */
const inFlight = new Map<string, ReturnType<typeof refreshTokens>>();

function refreshOnce(refreshToken: string): ReturnType<typeof refreshTokens> {
  const existing = inFlight.get(refreshToken);
  if (existing) return existing;

  const flight = refreshTokens(refreshToken).finally(() => {
    // Always evict — a retained rejected promise would poison every later attempt.
    inFlight.delete(refreshToken);
  });
  inFlight.set(refreshToken, flight);
  return flight;
}

/**
 * Resolve the Google id_token to forward to Core, silently refreshed near expiry.
 *
 * CENTRAL PENDING-EXPIRY GUARD (CTL-97 Task 4): a PENDING session (authenticated with Google,
 * not yet provisioned in Core) carries a 24h ABSOLUTE lifetime. Once `clock.now() >=
 * pendingExpiresAt`, this throws `PendingSessionExpiredError` BEFORE returning any bearer and
 * BEFORE any Core call — `withSession` (the shared caller of `resolveBearer`) catches it,
 * destroys the cookie, and answers 401 SESSION_EXPIRED, uniformly for every protected `/v1`
 * route. The decoded (expired) session must never be used past this point in the request.
 *
 * State is read from the `provisioningStatus` discriminator ONLY — never inferred from the presence
 * of `pendingExpiresAt` — so a PROVISIONED (or legacy-normalized-provisioned) session ignores
 * pending fields entirely, even if some carried over by accident.
 */
async function bearerForSession(
  session: SessionData | null,
  res: Response,
): Promise<string | null> {
  if (!session) return null;

  if (session.provisioningStatus === "PENDING" && clock.now() >= session.pendingExpiresAt) {
    throw new PendingSessionExpiredError();
  }

  if (!session.idToken) return null;

  const nearExpiry =
    session.expiresAt !== undefined && session.expiresAt - Date.now() < REFRESH_WINDOW_MS;
  if (!nearExpiry || !session.refreshToken) return session.idToken;

  try {
    const tokens = await refreshOnce(session.refreshToken);
    const refreshedTokenFields = {
      idToken: tokens.id_token ?? session.idToken,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? session.refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };

    if (session.provisioningStatus === "PENDING") {
      // A silent token refresh must NEVER move a pending session's absolute lifetime: spread
      // the existing session so provisioningStatus/pendingSince/pendingExpiresAt stay EXACTLY as
      // they were, overwriting only the token fields. Also cap the cookie's own Max-Age at
      // the remaining pending window (not the default 7d) — a refresh must not extend the
      // pending cookie's logical lifetime either.
      const updated = { ...session, ...refreshedTokenFields };
      const maxAgeSec = Math.max(0, Math.ceil((session.pendingExpiresAt - clock.now()) / 1000));
      writeSession(res, updated, maxAgeSec); // rotate session cookie
      return updated.idToken;
    }

    // Spread the existing session FIRST so non-token fields (currentRole) survive a silent
    // refresh — this fires on every near-expiry request, so without the spread a session's
    // current role would be silently forgotten roughly every REFRESH_WINDOW_MS.
    const updated = { ...session, ...refreshedTokenFields };
    writeSession(res, updated); // rotate session cookie
    // Unreachable: the early guard returns null when the session has no idToken, so updated.idToken is truthy here.
    /* istanbul ignore next */
    return updated.idToken ?? null;
  } catch (err) {
    // Only a genuinely dead grant justifies destroying the session (caller → requireReauth
    // → clearSession → the refresh token is gone for good). Anything else — Google 5xx,
    // 429, a network blip, or an exception we don't recognise — keeps the session and
    // surfaces as a retryable failure. Never destroy a refresh token over a bad minute.
    if (err instanceof GoogleTokenError && err.fatal) return null;
    throw new TransientAuthError(err);
  }
}

/**
 * Read + resolve the forward Bearer for this request.
 *
 * - returns a string → forward it
 * - returns null     → no/dead session; caller should `requireReauth`
 * - THROWS TransientAuthError → the session is fine but Google is not; caller should
 *   answer 503 + Retry-After and leave the session alone
 */
export function resolveBearer(req: Request, res: Response): Promise<string | null> {
  return bearerForSession(readSession(req), res);
}
