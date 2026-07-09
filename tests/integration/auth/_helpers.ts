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

/** Build a Core /session-style fetch Response stub. */
export function coreResponse(
  status: number,
  body?: { roles?: string[]; activeRole?: string | null; participantType?: string | null },
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (body === undefined ? {} : { data: body }),
  } as unknown as Response;
}
