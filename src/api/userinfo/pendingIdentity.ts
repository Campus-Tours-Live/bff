import { IdentityClaimsInvalidError } from "../_shared/errors.js";
import type { SessionData } from "../../session.js";

/**
 * A pending (not-yet-provisioned) identity, derived from the session's Google id_token when
 * Core has no `users` row for this principal yet (`GET /users/me` → 404
 * `ACCOUNT_NOT_PROVISIONED`). `id` is always `null` — there is no Core account id to report.
 * Mirrors the identity fields of {@link ProvisionedUserInfo} (`Me.user`,
 * src/api/_shared/types.ts) but is a SEPARATE type on purpose: bolting `| null` onto the
 * provisioned summary would let `/userinfo` (CTL-97 Task 3) accidentally hand a pending caller
 * fields (`accountStatus`/`ageBand`/`createdAt`) that simply don't exist yet.
 */
export interface PendingUserInfo {
  id: null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
}

/**
 * The provisioned user summary Core's `GET /users/me` actually carries (`Me.user`, see
 * src/api/_shared/types.ts) — repeated here, separately from {@link PendingUserInfo}, so
 * `/userinfo` can discriminate PENDING vs PROVISIONED on `id` (`null` vs `string`) without a
 * union that bolts optionality onto the provisioned shape.
 */
export interface ProvisionedUserInfo {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  accountStatus: string | null;
  ageBand: string | null;
  createdAt: string; // ISO-8601 (UTC)
}

/**
 * Decodes a JWT's middle (payload) segment as base64url→JSON.
 *
 * ⚠️ CLAIM EXTRACTION ONLY. This performs NO signature, issuer, audience, nonce, or expiry
 * verification whatsoever — it blindly trusts whatever bytes sit in the payload segment. That is
 * safe here ONLY because the caller (`pendingIdentityFromSession`) only ever feeds it the
 * `id_token` already sitting in the server-side session, which the OAuth callback obtained
 * directly from Google's token endpoint over TLS (see src/auth/google.ts) — trust was
 * established there, at the exchange, not here.
 *
 * NEVER reuse this to parse a JWT from any untrusted source (a request header, query param,
 * request body, or any other caller-supplied token). Doing so would let a caller hand in an
 * arbitrary unsigned JWT and have its claims accepted at face value. Signature/issuer/audience
 * verification of untrusted tokens belongs in the OAuth callback / token-verification layer,
 * not here.
 */
function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new IdentityClaimsInvalidError("id_token is not a well-formed JWT (expected 3 segments)");
  }

  const payloadSegment = segments[1];
  /* istanbul ignore next -- segments.length === 3 already guarantees index 1 exists; this only
   * satisfies noUncheckedIndexedAccess, it is not a reachable runtime branch. */
  if (payloadSegment === undefined) {
    throw new IdentityClaimsInvalidError(
      "id_token is not a well-formed JWT (empty payload segment)",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  } catch {
    throw new IdentityClaimsInvalidError("id_token payload segment is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new IdentityClaimsInvalidError("id_token payload is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Builds a {@link PendingUserInfo} from the TRUSTED server-side session ONLY — takes a
 * `SessionData`, never a `Request`, header, query param, or any other request-supplied value, so
 * there is no way to pass in an untrusted JWT/email. Reads `session.idToken` (the Google id_token
 * the OAuth callback stored); the `accessToken` field is never read here — Google's access token
 * is opaque and carries no identity claims, so it cannot substitute for the id_token.
 *
 * Throws {@link IdentityClaimsInvalidError} (`code: "IDENTITY_CLAIMS_INVALID"`) when the id_token
 * is absent, malformed, or its payload lacks a verified email — see {@link decodeIdTokenPayload}
 * for why this never re-verifies the token's signature/issuer/audience/nonce/expiry. A pending
 * session whose id_token can't produce a verified email is a system/upstream problem (the OAuth
 * exchange should never have produced such a token), never a normal pending-signin case — callers
 * (CTL-97 Task 3's `/userinfo` PENDING branch) must map this to a 5xx.
 */
export function pendingIdentityFromSession(session: SessionData): PendingUserInfo {
  const idToken = session.idToken;
  if (!idToken) {
    throw new IdentityClaimsInvalidError("session has no id_token");
  }

  const claims = decodeIdTokenPayload(idToken);

  const email = claims.email;
  if (typeof email !== "string") {
    throw new IdentityClaimsInvalidError("id_token is missing the email claim");
  }
  if (claims.email_verified !== true) {
    throw new IdentityClaimsInvalidError(
      "id_token email is not verified (email_verified !== true)",
    );
  }

  const givenName = claims.given_name;
  const familyName = claims.family_name;
  const name = claims.name;

  return {
    id: null,
    email,
    firstName: typeof givenName === "string" ? givenName : null,
    lastName: typeof familyName === "string" ? familyName : null,
    displayName: typeof name === "string" ? name : null,
  };
}
