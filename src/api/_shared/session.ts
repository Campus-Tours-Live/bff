import type { Request, Response } from "express";
import { readSession, writeSession, type SessionData } from "../../session.js";
import { refreshTokens, GoogleTokenError } from "../../auth/google.js";
import { TransientAuthError } from "./errors.js";

/**
 * Refresh this long before expiry. The old 60s was too tight: a token endpoint that takes
 * a few seconds, or one retry, and the window is gone — turning a slow minute at Google
 * into a failed request on a session that was perfectly healthy.
 */
const REFRESH_WINDOW_MS = 5 * 60_000;

/**
 * In-flight refreshes, keyed by the refresh token being redeemed.
 *
 * Without this, a burst of concurrent requests each redeem the SAME refresh token. Google
 * may rotate it, in which case every writer but the last persists a refresh token that is
 * already invalid — manufacturing exactly the dead session this task exists to prevent.
 *
 * LIMIT, by design: the session is a stateless encrypted cookie with no shared store, so
 * this coalesces PER PROCESS only. It covers the common same-instance burst; it is not a
 * distributed guarantee, and behind multiple instances concurrent refreshes remain
 * possible. Fixing that properly needs a shared store and is out of scope here.
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

/** Resolve the Google id_token to forward to Core, silently refreshed near expiry. */
async function bearerForSession(
  session: SessionData | null,
  res: Response,
): Promise<string | null> {
  if (!session || !session.idToken) return null;

  const nearExpiry =
    session.expiresAt !== undefined && session.expiresAt - Date.now() < REFRESH_WINDOW_MS;
  if (!nearExpiry || !session.refreshToken) return session.idToken;

  try {
    const tokens = await refreshOnce(session.refreshToken);
    const updated: SessionData = {
      idToken: tokens.id_token ?? session.idToken,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? session.refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
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
