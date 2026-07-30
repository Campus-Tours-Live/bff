import { jest } from "@jest/globals";
import { writeSession, type SessionData } from "@/session.js";

/**
 * Mint a real session cookie via the production `writeSession`, then extract the
 * `ctl_sess=...` pair for supertest's `.set("Cookie", ...)`. The idToken value is
 * irrelevant in these tests because the Core network is mocked. `overrides` lets a test set
 * session-only fields like `currentRole` (Profile Contract v2) or flip the whole session to
 * PENDING (`provisioningStatus`, `pendingSince`, `pendingExpiresAt` — CTL-97 Task 4) — passed
 * through as-is (untyped-cast-friendly, hence `Record<string, unknown>` rather than
 * `Partial<SessionData>`) so a test can also mint a deliberately GARBAGE `currentRole` to
 * exercise the `isRole` guard, or a deliberately-malformed pending shape.
 */
export function mintSessionCookie(overrides: Record<string, unknown> = {}): string {
  const cookies: string[] = [];
  const res = { append: (_k: string, v: string) => cookies.push(v) };
  writeSession(
    res as never,
    {
      provisioningStatus: "PROVISIONED",
      idToken: "fake-id-token",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 3_600_000,
      ...overrides,
    } as SessionData,
  );
  const cookie = cookies.find((c) => c.startsWith("ctl_sess="));
  if (!cookie) throw new Error("writeSession did not append a ctl_sess cookie");
  return cookie.split(";")[0]!;
}

/**
 * A successful Core response wrapping `payload` in the `{ data }` envelope the BFF unwraps.
 * `headers` lets a test layer extra upstream response headers (e.g. `cache-control`) on top of
 * the default `content-type`, for tests asserting header-fidelity through the proxy — without a
 * second, parallel mocking style for the same upstream stub.
 */
export function coreOk(payload: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json", ...headers }),
    json: async () => ({ data: payload }),
    text: async () => JSON.stringify({ data: payload }),
  } as unknown as Response;
}

/** A Core error response (ok:false) carrying `status`. */
export function coreErr(status: number, payload: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

/** The pathname (e.g. "/userinfo") of a fetch call's URL argument. */
export function pathOf(url: unknown): string {
  return new URL(String(url)).pathname;
}

/**
 * Install a `global.fetch` mock that dispatches Core requests by URL pathname.
 * `routes` maps a stripped Core path to the Response to return; unmatched paths
 * reject so a test fails loudly rather than silently.
 */
export function mockCoreByPath(routes: Record<string, Response>): jest.Mock<typeof fetch> {
  const mock = jest.fn<typeof fetch>(async (url) => {
    const path = pathOf(url);
    const res = routes[path];
    if (!res) throw new Error(`No mock Core route for ${path}`);
    return res;
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}
