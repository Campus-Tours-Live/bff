import { jest } from "@jest/globals";
import type { Response as ExpressResponse } from "express";
import request from "supertest";
import { app } from "@/app.js";
import { writeSession } from "@/session.js";
import { cookieNamed, isCleared } from "./_helpers.js";

/**
 * L5#3 — logging out must revoke the Google grant, not just drop our cookie.
 *
 * Clearing `ctl_sess` ends the session *here*. The refresh token inside it stays valid at
 * Google until it expires or is revoked, so anything that ever obtained a copy could keep
 * minting fresh id_tokens for an account whose owner believes they signed out.
 *
 * N2 raised the stakes on this. Before it, a transient Google failure quietly destroyed
 * refresh tokens fairly often; N2 deliberately made them survive. Making them durable
 * without also revoking them on logout means "sign out" leaves a long-lived credential
 * alive — so the two changes belong together.
 *
 * Best-effort by construction: revocation must never be able to prevent, delay, or fail a
 * logout. The user asked to leave.
 */
function sessCookie(session: { idToken?: string; refreshToken?: string }): string {
  const cookies: string[] = [];
  const res = {
    append(name: string, value: string) {
      if (name === "Set-Cookie") cookies.push(value);
      return res;
    },
  };
  writeSession(res as unknown as ExpressResponse, {
    accountState: "PROVISIONED",
    idToken: "id-tok",
    ...session,
  });
  const setCookie = cookies[0];
  if (!setCookie) throw new Error("writeSession did not append a cookie");
  return setCookie.split(";")[0] as string;
}

const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Minimal Response stand-in — revocation is fire-and-forget, so only status is read. */
function okResponse(status = 200): Response {
  return { ok: status >= 200 && status < 300, status } as unknown as Response;
}

let fetchMock: jest.Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = jest.fn<typeof fetch>().mockResolvedValue(okResponse());
  global.fetch = fetchMock;
});

describe("POST /auth/logout — Google grant revocation", () => {
  it("revokes the refresh token at Google", async () => {
    await request(app)
      .post("/auth/logout")
      .set("Cookie", sessCookie({ refreshToken: "rt-live" }));

    const call = fetchMock.mock.calls.find(([url]) => String(url) === REVOKE_URL);
    expect(call).toBeDefined();

    const init = call?.[1] as unknown as RequestInit;
    expect(init.method).toBe("POST");
    expect(new URLSearchParams(init.body as string).get("token")).toBe("rt-live");
  });

  it("still logs out when Google's revoke endpoint fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down") as never);

    const res = await request(app)
      .post("/auth/logout")
      .set("Cookie", sessCookie({ refreshToken: "rt-live" }));

    // The invariant: the user asked to leave, so they leave regardless.
    expect(res.status).toBe(302);
    expect(isCleared(cookieNamed(res, "ctl_sess"))).toBe(true);
  });

  it("still logs out when Google answers non-2xx", async () => {
    fetchMock.mockResolvedValue(okResponse(400));

    const res = await request(app)
      .post("/auth/logout")
      .set("Cookie", sessCookie({ refreshToken: "rt-live" }));

    expect(res.status).toBe(302);
    expect(isCleared(cookieNamed(res, "ctl_sess"))).toBe(true);
  });

  it("does not call Google when the session carries no refresh token", async () => {
    const res = await request(app).post("/auth/logout").set("Cookie", sessCookie({}));

    expect(fetchMock.mock.calls.filter(([url]) => String(url) === REVOKE_URL)).toHaveLength(0);
    expect(res.status).toBe(302);
  });

  it("does not call Google when there is no session at all", async () => {
    const res = await request(app).post("/auth/logout");

    expect(fetchMock.mock.calls.filter(([url]) => String(url) === REVOKE_URL)).toHaveLength(0);
    expect(res.status).toBe(302);
  });
});
