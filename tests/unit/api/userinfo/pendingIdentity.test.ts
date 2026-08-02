import { describe, expect, it } from "@jest/globals";
import { IdentityClaimsInvalidError } from "@/api/_shared/errors.js";
import {
  pendingIdentityFromSession,
  type PendingUserInfo,
} from "@/api/userinfo/pendingIdentity.js";
import type { SessionData } from "@/session.js";

/** Base64url-encodes a JSON value the way a JWT segment does. */
function seg(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Builds a `header.payload.signature` id_token fixture. The signature is never verified by
 *  this helper (that stays the OAuth callback's job), so any dummy string is fine. */
function makeIdToken(claims: Record<string, unknown>): string {
  return `${seg({ alg: "RS256", typ: "JWT" })}.${seg(claims)}.dummy-signature`;
}

const FULL_CLAIMS = {
  email: "ana@example.com",
  email_verified: true,
  given_name: "Ana",
  family_name: "Silva",
  name: "Ana Silva",
};

describe("pendingIdentityFromSession", () => {
  it("maps a full id_token's claims to a PendingUserInfo with id: null", () => {
    const session: SessionData = {
      provisioningStatus: "PROVISIONED",
      idToken: makeIdToken(FULL_CLAIMS),
    };

    const result = pendingIdentityFromSession(session);

    const expected: PendingUserInfo = {
      id: null,
      email: "ana@example.com",
      firstName: "Ana",
      lastName: "Silva",
      displayName: "Ana Silva",
    };
    expect(result).toEqual(expected);
  });

  it("maps a missing given_name claim to firstName: null (not an error)", () => {
    const { given_name: _given_name, ...rest } = FULL_CLAIMS;
    const session: SessionData = { provisioningStatus: "PROVISIONED", idToken: makeIdToken(rest) };

    expect(pendingIdentityFromSession(session).firstName).toBeNull();
  });

  it("maps a missing family_name claim to lastName: null (not an error)", () => {
    const { family_name: _family_name, ...rest } = FULL_CLAIMS;
    const session: SessionData = { provisioningStatus: "PROVISIONED", idToken: makeIdToken(rest) };

    expect(pendingIdentityFromSession(session).lastName).toBeNull();
  });

  it("maps a missing name claim to displayName: null (not an error)", () => {
    const { name: _name, ...rest } = FULL_CLAIMS;
    const session: SessionData = { provisioningStatus: "PROVISIONED", idToken: makeIdToken(rest) };

    expect(pendingIdentityFromSession(session).displayName).toBeNull();
  });

  it("throws IdentityClaimsInvalidError (code IDENTITY_CLAIMS_INVALID) when the email claim is missing", () => {
    const { email: _email, ...rest } = FULL_CLAIMS;
    const session: SessionData = { provisioningStatus: "PROVISIONED", idToken: makeIdToken(rest) };

    expect(() => pendingIdentityFromSession(session)).toThrow(IdentityClaimsInvalidError);
    try {
      pendingIdentityFromSession(session);
      throw new Error("expected pendingIdentityFromSession to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(IdentityClaimsInvalidError);
      expect((err as IdentityClaimsInvalidError).code).toBe("IDENTITY_CLAIMS_INVALID");
    }
  });

  it("throws IdentityClaimsInvalidError when email_verified is false", () => {
    const session: SessionData = {
      provisioningStatus: "PROVISIONED",
      idToken: makeIdToken({ ...FULL_CLAIMS, email_verified: false }),
    };

    expect(() => pendingIdentityFromSession(session)).toThrow(IdentityClaimsInvalidError);
  });

  it('throws IdentityClaimsInvalidError when email_verified is the string "true" (strict boolean required)', () => {
    const session: SessionData = {
      provisioningStatus: "PROVISIONED",
      idToken: makeIdToken({ ...FULL_CLAIMS, email_verified: "true" }),
    };

    expect(() => pendingIdentityFromSession(session)).toThrow(IdentityClaimsInvalidError);
  });

  it("throws IdentityClaimsInvalidError when email_verified is missing", () => {
    const { email_verified: _email_verified, ...rest } = FULL_CLAIMS;
    const session: SessionData = { provisioningStatus: "PROVISIONED", idToken: makeIdToken(rest) };

    expect(() => pendingIdentityFromSession(session)).toThrow(IdentityClaimsInvalidError);
  });

  it("throws IdentityClaimsInvalidError for a malformed id_token (not 3 dot-separated segments)", () => {
    const session: SessionData = { provisioningStatus: "PROVISIONED", idToken: "only-one-segment" };

    expect(() => pendingIdentityFromSession(session)).toThrow(IdentityClaimsInvalidError);
  });

  it("throws IdentityClaimsInvalidError for a malformed id_token (payload segment is not valid base64)", () => {
    const session: SessionData = {
      provisioningStatus: "PROVISIONED",
      idToken: `${seg({ alg: "RS256" })}.%%%not-base64%%%.dummy-signature`,
    };

    expect(() => pendingIdentityFromSession(session)).toThrow(IdentityClaimsInvalidError);
  });

  it("throws IdentityClaimsInvalidError for a malformed id_token (payload decodes to non-JSON text)", () => {
    const session: SessionData = {
      provisioningStatus: "PROVISIONED",
      idToken: `${seg({ alg: "RS256" })}.${Buffer.from("not json at all").toString("base64url")}.dummy-signature`,
    };

    expect(() => pendingIdentityFromSession(session)).toThrow(IdentityClaimsInvalidError);
  });

  it("throws IdentityClaimsInvalidError when the payload decodes to non-object JSON (e.g. a bare number)", () => {
    const session: SessionData = {
      provisioningStatus: "PROVISIONED",
      idToken: `${seg({ alg: "RS256" })}.${Buffer.from("42").toString("base64url")}.dummy-signature`,
    };

    expect(() => pendingIdentityFromSession(session)).toThrow(IdentityClaimsInvalidError);
  });

  it("throws IdentityClaimsInvalidError when the session has no idToken", () => {
    const session: SessionData = { provisioningStatus: "PROVISIONED" };

    expect(() => pendingIdentityFromSession(session)).toThrow(IdentityClaimsInvalidError);
  });

  it("reads only the session's idToken — an accessToken present without an idToken is never used as a substitute", () => {
    const session: SessionData = {
      provisioningStatus: "PROVISIONED",
      accessToken: makeIdToken(FULL_CLAIMS),
    };

    expect(() => pendingIdentityFromSession(session)).toThrow(IdentityClaimsInvalidError);
  });

  it("takes only the server-side session (type-level guard: no request/header/query param accepted)", () => {
    // If this compiles, `pendingIdentityFromSession`'s parameter is (at most) `SessionData` —
    // a plain object literal satisfies it; no `Request`, header bag, or query object is needed.
    const session: SessionData = {
      provisioningStatus: "PROVISIONED",
      idToken: makeIdToken(FULL_CLAIMS),
    };
    const result: PendingUserInfo = pendingIdentityFromSession(session);
    expect(result.id).toBeNull();
  });
});
