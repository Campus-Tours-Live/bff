import crypto from "node:crypto";
import * as cookie from "cookie";
import type { Request, Response } from "express";
import { config } from "./config.js";
import { clock } from "./lib/clock.js";

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
 * two real Core role values. `SessionData.currentRole` is typed as `Role`, but the cookie is
 * just decrypted JSON — an older session shape (serialized before this field existed), a
 * stale/renamed role value, or any other drift must not be trusted as a real role.
 */
export function isRole(x: unknown): x is Role {
  return x === "GUIDE" || x === "PARTICIPANT";
}

/**
 * Fields common to BOTH account states — the OAuth token material. Optional throughout so a
 * session can exist mid-flow without every field (and so legacy sessions, serialized before
 * some field existed, stay valid).
 */
interface SessionTokenFields {
  /** Google OIDC id_token (a JWT) — this is what the BFF forwards to the Core. */
  idToken?: string;
  /** Google access token (not used by the Core; kept for completeness). */
  accessToken?: string;
  refreshToken?: string;
  /** epoch ms when the tokens expire. */
  expiresAt?: number;
}

/**
 * An authenticated-but-not-yet-provisioned account (CTL-97 defer-provisioning): Google sign-in
 * succeeded, but Core has no `users` row for this principal yet. Carries a 24h ABSOLUTE
 * lifetime (`pendingExpiresAt`, set once at `writePendingSession` time from server clock — a
 * token refresh must never move it, see `bearerForSession`). Deliberately has NO `currentRole`:
 * there is no Core account yet, so there is no role to have chosen.
 */
export interface PendingSessionData extends SessionTokenFields {
  provisioningStatus: "PENDING";
  /** epoch ms this session first became PENDING (server clock, NOT the id_token's `iat`). */
  pendingSince: number;
  /** epoch ms this session's PENDING state absolutely expires — the central guard in
   *  `resolveBearer`/`bearerForSession` rejects with 401 SESSION_EXPIRED once
   *  `clock.now() >= pendingExpiresAt`, unconditionally (no Core call). */
  pendingExpiresAt: number;
}

/** An established, provisioned account — Core has a `users` row for this principal. */
export interface ProvisionedSessionData extends SessionTokenFields {
  provisioningStatus: "PROVISIONED";
  /**
   * The role this session is currently using — must be a role the account HOLDS (∈ Core
   * `/users/me` roles); controls the app shell of an established role and is surfaced by the
   * bff-owned `GET /userinfo` (src/api/userinfo). Optional so existing serialized sessions
   * (from before this field existed) stay valid — absent just means "no current role yet".
   */
  currentRole?: Role;
}

/**
 * Explicit discriminated union on `provisioningStatus` (CTL-97 Task 4) — so every consumer reads
 * account state from the discriminator, never infers it from the presence of `pendingSince` /
 * `currentRole`. See `readSession`'s legacy-normalization comment: a decrypted cookie written
 * BEFORE this field existed has no `provisioningStatus` at all and must still resolve as
 * `PROVISIONED` (every session in the wild today IS an established, provisioned one).
 */
export type SessionData = PendingSessionData | ProvisionedSessionData;

/** 24h absolute lifetime for a PENDING session (CTL-97 defer-provisioning). */
const PENDING_TTL_SEC = 60 * 60 * 24;
/** The pre-existing 7d TTL for an established, PROVISIONED session. */
const PROVISIONED_TTL_SEC = 60 * 60 * 24 * 7;

function encrypt(payload: object): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

/** Decrypts to whatever JSON payload was encrypted — `SessionData` (possibly a pre-Task-4
 *  legacy shape with no `provisioningStatus`) or an `AuthTx`, depending on which cookie the caller
 *  is reading. Returns `null` on any failure (tampered/garbage token) or missing input. */
function decrypt(token: string): unknown {
  try {
    const raw = Buffer.from(token, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * Normalizes a decrypted, otherwise-untyped session payload into the `SessionData`
 * discriminated union — the ONE place that boundary is crossed, so every consumer downstream
 * (readSession's callers) sees a well-formed union member.
 *
 * CRITICAL — legacy sessions: cookies written before CTL-97 Task 4 carry
 * `{ idToken, refreshToken, expiresAt, currentRole? }` with NO `provisioningStatus` at all. Treating
 * an absent (or any unrecognised) `provisioningStatus` as PROVISIONED is deliberate: every session
 * that exists today, sight-unseen, IS an established, provisioned account — there was no
 * PENDING concept before this change — so no existing logged-in user is logged out on cutover.
 */
function normalizeSession(raw: unknown): SessionData {
  const obj = raw as Record<string, unknown>;
  if (obj.provisioningStatus === "PENDING") {
    // Trust boundary: this cookie is our own encrypted payload; the same blind-trust cast
    // decrypt() always used (`JSON.parse(out) as SessionData`) now lives here instead.
    return obj as unknown as PendingSessionData;
  }
  return { ...obj, provisioningStatus: "PROVISIONED" } as ProvisionedSessionData;
}

export function readSession(req: Request): SessionData | null {
  const cookies = cookie.parse(req.headers.cookie ?? "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const raw = decrypt(token);
  return raw === null ? null : normalizeSession(raw);
}

export function writeSession(
  res: Response,
  data: SessionData,
  maxAgeSec = PROVISIONED_TTL_SEC,
): void {
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

/**
 * Starts (or restarts) a PENDING session: authenticated with Google, not yet provisioned in
 * Core. `pendingSince`/`pendingExpiresAt` are stamped from the injectable `clock` (server
 * time), NEVER from the id_token's `iat` — the id_token is Google's, not ours, and its clock
 * skew/lifetime has nothing to do with how long the BFF should keep a pending signup around.
 * 24h absolute cookie TTL, matching the account-level absolute lifetime enforced by the
 * central guard in `resolveBearer`/`bearerForSession`.
 */
export function writePendingSession(res: Response, data: SessionTokenFields): void {
  const now = clock.now();
  const session: PendingSessionData = {
    provisioningStatus: "PENDING",
    pendingSince: now,
    pendingExpiresAt: now + PENDING_TTL_SEC * 1000,
    idToken: data.idToken,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
  };
  writeSession(res, session, PENDING_TTL_SEC);
}

/**
 * Converts a PENDING session to PROVISIONED — Core just confirmed the account exists (an
 * onboarding 201, or a `/userinfo` repair that discovers Core already knows this account).
 * Drops the pending-only fields (`pendingSince`/`pendingExpiresAt`) entirely — they mean
 * nothing once the account is provisioned — sets `currentRole`, and restores the normal 7d
 * TTL. Carries only the token fields forward from `data` (a full prior `SessionData`
 * structurally satisfies `SessionTokenFields`, so the caller can pass `readSession(req)`
 * directly).
 */
export function convertToProvisioned(
  res: Response,
  data: SessionTokenFields,
  currentRole?: Role,
): void {
  const session: ProvisionedSessionData = {
    provisioningStatus: "PROVISIONED",
    currentRole,
    idToken: data.idToken,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
  };
  writeSession(res, session);
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
  return decrypt(token) as AuthTx | null;
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
