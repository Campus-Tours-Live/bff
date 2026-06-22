import type { Request, Response } from "express";
import { readSession, writeSession, type SessionData } from "../../session.js";
import { refreshTokens } from "../../auth/google.js";

/** Resolve the Google id_token to forward to Core, silently refreshed near expiry. */
async function bearerForSession(
  session: SessionData | null,
  res: Response,
): Promise<string | null> {
  if (!session || !session.idToken) return null;
  const nearExpiry = session.expiresAt !== undefined && session.expiresAt - Date.now() < 60_000;
  if (nearExpiry && session.refreshToken) {
    try {
      const tokens = await refreshTokens(session.refreshToken);
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
    } catch {
      return null; // force re-auth
    }
  }
  return session.idToken;
}

/** Read + resolve the forward Bearer for this request. null → caller should requireReauth. */
export function resolveBearer(req: Request, res: Response): Promise<string | null> {
  return bearerForSession(readSession(req), res);
}
