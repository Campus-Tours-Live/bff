import crypto from "node:crypto";
import * as cookie from "cookie";
import type { Request, Response } from "express";
import { config } from "./config.js";

/**
 * Encrypted, httpOnly, SameSite cookie session. The OAuth tokens stay server-side
 * inside this encrypted cookie and are never exposed to browser JS — the BFF's core
 * defence against token theft via XSS. Encrypted with AES-256-GCM using a key derived
 * from SESSION_SECRET, so the session is self-contained: no external store needed.
 */
const SESSION_COOKIE = "ctl_sess";
const KEY = crypto.createHash("sha256").update(config.sessionSecret).digest(); // 32 bytes

/**
 * The two role values Core's `/users/me` (and thus `user_roles`) actually uses. Profile
 * Contract v2: `currentRole` is per-SESSION bff state, never a DB/Core value — Core only tells
 * us which roles an account HOLDS; which one is "active" in THIS browser session lives here.
 */
export type Role = "GUIDE" | "PARTICIPANT";

/**
 * Guards an untrusted value (a decrypted-but-otherwise-unvalidated session field) against the
 * two real Core role values. `SessionData.currentRole`/`onboardingRole` are typed as `Role`, but
 * the cookie is just decrypted JSON — an older session shape (serialized before these fields
 * existed), a stale/renamed role value, or any other drift must not be trusted as a real role.
 */
export function isRole(x: unknown): x is Role {
  return x === "GUIDE" || x === "PARTICIPANT";
}

export interface SessionData {
  /** Google OIDC id_token (a JWT) — this is what the BFF forwards to the Core. */
  idToken?: string;
  /** Google access token (not used by the Core; kept for completeness). */
  accessToken?: string;
  refreshToken?: string;
  /** epoch ms when the tokens expire. */
  expiresAt?: number;
  /**
   * The role this session is currently using — must be a role the account HOLDS (∈ Core
   * `/users/me` roles); controls the app shell of an established role and is surfaced by the
   * bff-owned `GET /userinfo` (src/api/userinfo). Optional so existing serialized sessions
   * (from before this field existed) stay valid — absent just means "no current role yet".
   */
  currentRole?: Role;
  /**
   * A role the account does NOT yet hold, authorising only that role's onboarding while it is
   * being acquired (set by the login callback — CTL-97 Task 1.5-BFF2; unused beyond this type
   * for now). Deliberately NEVER surfaced by `GET /userinfo` — it is internal routing state,
   * not part of the bootstrap contract.
   */
  onboardingRole?: Role;
}

function encrypt(payload: object): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

function decrypt(token: string): SessionData | null {
  try {
    const raw = Buffer.from(token, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(out) as SessionData;
  } catch {
    return null;
  }
}

export function readSession(req: Request): SessionData | null {
  const cookies = cookie.parse(req.headers.cookie ?? "");
  const token = cookies[SESSION_COOKIE];
  return token ? decrypt(token) : null;
}

export function writeSession(res: Response, data: SessionData, maxAgeSec = 60 * 60 * 24 * 7): void {
  res.append(
    "Set-Cookie",
    cookie.serialize(SESSION_COOKIE, encrypt(data), {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProd,
      path: "/",
      maxAge: maxAgeSec,
    }),
  );
}

export function clearSession(res: Response): void {
  res.append(
    "Set-Cookie",
    cookie.serialize(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProd,
      path: "/",
      maxAge: 0,
    }),
  );
}

/** A short-lived encrypted cookie holding PKCE/login transaction state. */
const TX_COOKIE = "ctl_auth_tx";
export interface AuthTx {
  state: string;
  codeVerifier: string;
  returnTo: string;
  /** "signup" provisions a new account; "signin" requires an existing one. */
  intent: "signup" | "signin";
  /**
   * The role `GET /auth/login` was entered for, written explicitly by that entry point (CTL-97
   * Task 1.5-BFF2) — NOT derived from `returnTo` (which only decides the post-success
   * destination). Absent when the entry was role-agnostic (e.g. a generic "Sign in" link).
   */
  requestedRole?: Role;
}

export function writeAuthTx(res: Response, tx: AuthTx): void {
  res.append(
    "Set-Cookie",
    cookie.serialize(TX_COOKIE, encrypt(tx), {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProd,
      path: "/",
      maxAge: 900, // 15 min
    }),
  );
}

export function readAuthTx(req: Request): AuthTx | null {
  const cookies = cookie.parse(req.headers.cookie ?? "");
  const token = cookies[TX_COOKIE];
  if (!token) return null;
  return decrypt(token) as unknown as AuthTx | null;
}

export function clearAuthTx(res: Response): void {
  res.append(
    "Set-Cookie",
    cookie.serialize(TX_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProd,
      path: "/",
      maxAge: 0,
    }),
  );
}
