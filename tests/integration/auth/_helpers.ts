import type { Response as ExpressResponse } from "express";
import { type AuthTx, writeAuthTx } from "@/session.js";

/** A minimal res that records appended Set-Cookie values. */
function recordingRes() {
  const cookies: string[] = [];
  const res = {
    append(name: string, value: string) {
      if (name === "Set-Cookie") cookies.push(value);
      return res;
    },
  };
  return { res: res as unknown as ExpressResponse, cookies };
}

/**
 * Mint a real `ctl_auth_tx` cookie by driving the production `writeAuthTx`, then
 * return the bare `name=value` pair suitable for a request `Cookie` header.
 */
export function mintAuthTxCookie(tx: AuthTx): string {
  const { res, cookies } = recordingRes();
  writeAuthTx(res, tx);
  const setCookie = cookies[0];
  if (!setCookie) throw new Error("writeAuthTx did not append a Set-Cookie");
  const pair = setCookie.split(";")[0];
  if (!pair) throw new Error("could not extract ctl_auth_tx pair");
  return pair; // e.g. "ctl_auth_tx=<encrypted>"
}

/** Collapse supertest's Set-Cookie header (string | string[] | undefined) to an array. */
export function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? (raw as string[]) : [String(raw)];
}

/** The first Set-Cookie line whose cookie name matches, or undefined. */
export function cookieNamed(
  res: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${name}=`));
}

/** True if a Set-Cookie clears the named cookie (empty value + Max-Age=0). */
export function isCleared(setCookie: string | undefined): boolean {
  if (!setCookie) return false;
  return /=;|=\s*;/.test(setCookie) && /Max-Age=0/i.test(setCookie);
}

/** A fake Google token set, matching google.ts's TokenSet shape. */
export const FAKE_TOKENS = {
  id_token: "fake",
  access_token: "a",
  refresh_token: "r",
  expires_in: 3600,
} as const;

/** Build a Core `GET /users/me`-style fetch Response stub (Profile Contract v2, CTL-97 Task 5):
 *  `{ user, roles }` — no `currentRole` (that's bff session state, decided by the callback).
 *  Carries `headers`/`text` (not just `json`) so a non-ok response round-trips through
 *  `CoreError.fromResponse` the same way the real `CoreClient` does. */
export function usersMeResponse(
  status: number,
  body?: { user?: unknown; roles?: string[] },
): Response {
  const payload = body === undefined ? {} : { data: body };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

/** A Core `GET /users/me` problem+json error carrying a stable `code` — the discriminant the
 *  callback's truth table (I7/I8) branches on (`ACCOUNT_NOT_PROVISIONED`, `ACCOUNT_SUSPENDED`,
 *  `ACCOUNT_DELETED`, `ACCOUNT_STATE_INVALID`, or any other/absent code for the system-error
 *  catch-all row). */
export function usersMeCodedErr(status: number, code?: string, title = "Error"): Response {
  const payload = code === undefined ? { title, status } : { title, status, code };
  return {
    ok: false,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

/** A Core `GET /users/me` error whose body is NOT JSON (content-type text/plain) — I7 requires
 *  this is NEVER treated as pending/not_registered, even on a 404. */
export function usersMeNonJsonErr(status: number, body = "Not Found"): Response {
  return {
    ok: false,
    status,
    headers: new Headers({ "content-type": "text/plain" }),
    json: async () => {
      throw new Error("not json");
    },
    text: async () => body,
  } as unknown as Response;
}

/** Build a Core /participant/profile-style fetch Response stub — the source of
 *  `type` (e.g. "PARENT") post Profile Contract v2. */
export function participantProfileResponse(
  status: number,
  body?: { type?: string | null },
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (body === undefined ? {} : { data: body }),
  } as unknown as Response;
}

/** Build a Core `GET /users/me/role-eligibility?role=`-style fetch Response stub (CTL-97
 *  Task 1.5-BFF2) — the source of the PARENT→guide gate, replacing the old participant-profile
 *  check. `reason` is `RoleIneligibilityReason`, null when eligible. */
export function roleEligibilityResponse(
  status: number,
  body?: { eligible: boolean; reason: string | null },
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (body === undefined ? {} : { data: body }),
  } as unknown as Response;
}
