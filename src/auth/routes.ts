import { Router } from "express";
import { config } from "../config.js";
import {
  clearAuthTx,
  clearSession,
  isRole,
  readAuthTx,
  readSession,
  writeAuthTx,
  writePendingSession,
  writeSession,
  type Role,
  type ProvisionedSessionData,
} from "../session.js";
import {
  buildAuthorizeUrl,
  createPkce,
  exchangeCode,
  randomState,
  revokeRefreshToken,
} from "./google.js";
import { sendProblem } from "../util/problem.js";
import { csrfGuard } from "../util/csrf.js";
import { CoreClient, CoreError, type Me, type RoleEligibility } from "../api/_shared/index.js";

export const authRouter: Router = Router();

// Canonical returnTo policy — mirror of the web app's sanitizeReturnTo. Only
// site-relative paths under known authenticated roots are allowed (defends
// against open redirect via absolute / protocol-relative / backslash values).
const DEFAULT_RETURN_TO = "/dashboard";
const ALLOWED_RETURN_ROOTS = [
  "/dashboard",
  "/profile",
  "/support",
  "/staff",
  "/onboarding",
  "/guide",
];

// Exported for unit testing — this is the open-redirect defence, so it earns a
// direct test of the allowlist (the route handlers below are its only callers).
export function safeReturnTo(raw: string | undefined): string {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    raw.includes("://")
  ) {
    return DEFAULT_RETURN_TO;
  }
  const cut = raw.search(/[?#]/);
  const pathname = cut === -1 ? raw : raw.slice(0, cut);
  const allowed = ALLOWED_RETURN_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
  return allowed ? raw : DEFAULT_RETURN_TO;
}
function webUrl(path: string): string {
  return new URL(path, config.webBaseUrl).toString();
}

/** Consumer home after auth. Both roles share /dashboard; the current role decides
 *  the view client-side. Single source for the path. */
const CONSUMER_HOME = "/dashboard";

/**
 * Where to land after auth when there is NO requested role to reason about (a role-agnostic
 * entry, or one already resolved to a role-specific destination by the callback). Pure — the
 * session mutation (currentRole) lives in the callback, not here.
 *   - holds any role     → the specific allow-listed page the user came from (safeRt), or
 *                          CONSUMER_HOME when returnTo was absent/default
 *   - holds no role yet  → role selection with a "continue signup" notice (not a rejection —
 *                          the session is kept so the account can finish picking a role)
 */
// Exported for unit testing — the no-target-role landing decision.
export function landingFor(returnTo: string, roles: string[]): string {
  // Re-validate here too: landingFor is exported and unit-tested with raw values, and the
  // returnTo honoured below must never trust an un-sanitised path (open-redirect defence).
  // safeReturnTo is idempotent, so this is a no-op on the already-sanitised callback value.
  const safeRt = safeReturnTo(returnTo);
  if (roles.length > 0) return safeRt !== DEFAULT_RETURN_TO ? safeRt : CONSUMER_HOME;
  return "/signup/role?error=complete_signup";
}

/**
 * Legacy fallback for `requestedRole` when the login entry didn't set one explicitly (an older
 * client, or a link built before `?role=` existed). Derives a role purely from the onboarding
 * area `returnTo` points at.
 *
 * TODO(CTL-97): remove legacy returnTo inference once entries pass ?role=
 */
function inferLegacyRole(returnTo: string): Role | null {
  const safeRt = safeReturnTo(returnTo);
  if (safeRt.startsWith("/onboarding/guide")) return "GUIDE";
  if (safeRt.startsWith("/onboarding/participant")) return "PARTICIPANT";
  return null;
}

/**
 * GET /auth/login — start Google sign-in.
 * Query: returnTo, intent (signup|signin), role (GUIDE|PARTICIPANT, optional), login_hint
 * (optional email hint).
 */
authRouter.get("/login", (req, res) => {
  const returnTo = safeReturnTo(req.query.returnTo as string | undefined);
  const intent = req.query.intent === "signup" ? "signup" : "signin";
  // Written explicitly by THIS entry point — the callback's source of truth for
  // `requestedRole`, not derived from `returnTo` (see inferLegacyRole's TODO for the fallback).
  const requestedRole = isRole(req.query.role) ? req.query.role : undefined;

  const { verifier, challenge } = createPkce();
  const state = randomState();
  writeAuthTx(res, { state, codeVerifier: verifier, returnTo, intent, requestedRole });
  const url = buildAuthorizeUrl({
    state,
    codeChallenge: challenge,
    loginHint: req.query.login_hint as string | undefined,
  });
  return res.redirect(url);
});

/** GET /auth/callback — Google redirect target. */
authRouter.get("/callback", async (req, res) => {
  // 1) The provider returned an error. Don't surface a raw problem+json page — send
  //    the user back into the UI. access_denied = they cancelled the Google consent,
  //    so return them quietly to where they started (the page that held the
  //    "Continue with Google" button). Other (genuine) errors → the sign-in page with
  //    a generic notice so they can retry.
  const error = req.query.error as string | undefined;
  const errorDescription = req.query.error_description as string | undefined;
  if (error) {
    console.warn(`[auth/callback] provider error: ${error} — ${errorDescription ?? ""}`);
    const tx = readAuthTx(req);
    clearAuthTx(res);
    const entry =
      tx?.intent === "signup"
        ? tx.returnTo.startsWith("/onboarding/guide")
          ? "/signup/guide"
          : tx.returnTo.startsWith("/onboarding/participant")
            ? "/signup/participant"
            : "/signup/role"
        : "/signin";
    if (error === "access_denied") return res.redirect(webUrl(entry));
    return res.redirect(webUrl("/signin?error=auth_failed"));
  }

  const tx = readAuthTx(req);
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  // 2) No transaction cookie — usually it expired (took too long) or the browser
  //    didn't send it. Distinct from a state mismatch so the user knows to retry.
  if (!tx) {
    console.warn("[auth/callback] missing ctl_auth_tx cookie (expired or not sent)");
    clearAuthTx(res);
    return sendProblem(res, 400, "Login session expired — please start again.", {
      code: "AUTH_TX_MISSING",
    });
  }

  // 3) Genuine mismatch / missing code.
  if (!code || !state || state !== tx.state) {
    console.warn(
      `[auth/callback] state check failed: code=${Boolean(code)} state=${Boolean(state)} match=${state === tx.state}`,
    );
    clearAuthTx(res);
    return sendProblem(res, 400, "Invalid authentication state", { code: "AUTH_STATE_INVALID" });
  }

  // 3b) The tx cookie is decrypted JSON with no runtime schema validation, so a stale/tampered
  // value could carry a garbage `intent`. Reject explicitly — NEVER default to "signup" (that
  // would silently provision an account for what was meant to be a signin).
  if (tx.intent !== "signup" && tx.intent !== "signin") {
    console.warn(`[auth/callback] invalid tx intent: ${String(tx.intent)}`);
    clearAuthTx(res);
    return sendProblem(res, 400, "Invalid authentication state", { code: "AUTH_INTENT_INVALID" });
  }

  let tokens;
  try {
    tokens = await exchangeCode(code, tx.codeVerifier);
  } catch {
    clearAuthTx(res);
    return sendProblem(res, 502, "Authentication failed", { code: "AUTH_EXCHANGE_FAILED" });
  }

  // Resolve account state against Core BEFORE establishing a session (CTL-97 Task 5): a signup
  // provisions a new account, a signin requires an existing one — `GET /users/me` (Profile
  // Contract v2) tells us which by its status+code, never by trusting `tx.intent` alone. The
  // ephemeral pre-decision token-exchange result above must NOT reach a cookie until this
  // branch below has decided the outcome (see the truth table in the Task 5 brief / I7-I8).
  const bearer = tokens.id_token ?? "";
  // requestedRole is written explicitly by GET /auth/login, NOT derived from returnTo — the tx
  // cookie is decrypted JSON with no runtime schema validation, so a stale/tampered value could
  // carry a garbage role; re-validate with `isRole` before it can reach any redirect decision.
  // inferLegacyRole is a stopgap for entries that predate `?role=`.
  // TODO(CTL-97): remove legacy returnTo inference once entries pass ?role=
  const requestedRole: Role | null =
    (isRole(tx.requestedRole) ? tx.requestedRole : undefined) ?? inferLegacyRole(tx.returnTo);

  let cu: Me;
  try {
    cu = await new CoreClient(bearer).getCurrentUser<Me>();
  } catch (err) {
    if (err instanceof CoreError && err.status === 404 && err.code === "ACCOUNT_NOT_PROVISIONED") {
      if (tx.intent === "signup") {
        // Brand-new signup: Google auth succeeded, Core has no `users` row yet. Commit a
        // PENDING session (24h absolute TTL) so onboarding (and a `/userinfo`-backed page
        // guard) sees an authenticated-but-unprovisioned identity — this is NOT a rejection.
        writePendingSession(res, {
          idToken: tokens.id_token,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
        });
        clearAuthTx(res);
        const dest = requestedRole
          ? requestedRole === "GUIDE"
            ? "/onboarding/guide"
            : "/onboarding/participant"
          : "/signup/role";
        console.log(`[auth/callback] signup, not yet provisioned → PENDING session → ${dest}`);
        return res.redirect(webUrl(dest));
      }
      // Signing in with a Google account that was never registered — NOT a signup, so no
      // session (pending or otherwise) is established.
      clearAuthTx(res);
      return res.redirect(webUrl("/signin?error=not_registered"));
    }
    if (
      err instanceof CoreError &&
      err.status === 403 &&
      (err.code === "ACCOUNT_SUSPENDED" || err.code === "ACCOUNT_DELETED")
    ) {
      // I8: a suspended/deleted account must never keep (or gain) a session.
      clearAuthTx(res);
      clearSession(res);
      const errorParam = err.code === "ACCOUNT_SUSPENDED" ? "account_suspended" : "account_deleted";
      return res.redirect(webUrl(`/signin?error=${errorParam}`));
    }
    if (err instanceof CoreError && err.status === 409 && err.code === "ACCOUNT_STATE_INVALID") {
      // Integrity error — Core sees this account in a state it can't reconcile. No session.
      clearAuthTx(res);
      clearSession(res);
      return res.redirect(webUrl("/signin?error=account_error"));
    }
    // Everything else — a 404 with a DIFFERENT/no code, CoreAuthError (401), a CoreError 5xx,
    // or a transport failure (CoreError 502) — is a system error, never reinterpreted as
    // not_registered or pending (I7). No session established or kept.
    clearAuthTx(res);
    return sendProblem(res, 502, "Account resolution failed", { code: "RESOLVE_FAILED" });
  }

  // Defensive: a 200 whose body failed to parse as JSON resolves `cu` to `null` rather than
  // throwing (CoreClient's unwrap falls back to the raw, unparseable body) — treat that the
  // same as any other unusable Core response (system error, no session) rather than crashing
  // on `cu.roles` below.
  if (!cu || !Array.isArray(cu.roles)) {
    clearAuthTx(res);
    return sendProblem(res, 502, "Account resolution failed", { code: "RESOLVE_FAILED" });
  }
  const roles = cu.roles;

  // Tokens established regardless of role outcome below — the role fields are set/left unset
  // per branch, then the WHOLE session (tokens + role) is written once, before the redirect
  // (see the persistence-order note above writeSession further down). Reaching this point means
  // `GET /users/me` returned 200 — Core confirmed the account exists (`cu` above).
  const session: ProvisionedSessionData = {
    accountState: "PROVISIONED",
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };

  let dest: string;
  // A blocked action (PARENT→guide → /signup/role?error=parent_no_guide) is a rejection, not a
  // login: don't establish a session, so the user stays logged out.
  let blocked = false;

  if (requestedRole && roles.includes(requestedRole)) {
    // Holds the requested role already — effectively a login into that role (signin or signup).
    session.currentRole = requestedRole;
    dest = CONSUMER_HOME;
  } else if (requestedRole && tx.intent === "signup") {
    // Lacks it, trying to acquire it via signup — gate on Core's authoritative eligibility
    // check (e.g. a PARENT participant may never become a GUIDE) rather than a profile field.
    let eligibility: RoleEligibility;
    try {
      eligibility = await new CoreClient(bearer).getRoleEligibility<RoleEligibility>(requestedRole);
    } catch {
      clearAuthTx(res);
      return sendProblem(res, 502, "Account resolution failed", { code: "RESOLVE_FAILED" });
    }
    if (!eligibility.eligible) {
      // Any ineligible reason blocks — PARENT→guide gets its specific error destination;
      // every other reason (e.g. ROLE_ALREADY_HELD) falls back to the generic role-select page.
      dest =
        eligibility.reason === "PARENT_CANNOT_BECOME_GUIDE"
          ? "/signup/role?error=parent_no_guide"
          : "/signup/role";
      blocked = true;
    } else {
      dest = requestedRole === "GUIDE" ? "/onboarding/guide" : "/onboarding/participant";
    }
  } else if (requestedRole) {
    // Lacks it, signin — can't sign in as a role the account doesn't hold.
    dest = "/signup/role";
  } else {
    // No requested role (a role-agnostic entry). A single held role initialises currentRole
    // HERE, explicitly — not silently on the next /userinfo read. Zero or multiple held roles
    // leave currentRole unset (frontend shows role selection on `currentRole === null`).
    const onlyRole = roles.length === 1 ? roles[0] : undefined;
    if (isRole(onlyRole)) session.currentRole = onlyRole;
    dest = landingFor(tx.returnTo, roles);
  }

  clearAuthTx(res);
  if (blocked) {
    clearSession(res);
  } else {
    writeSession(res, session);
  }
  console.log(
    `[auth/callback] roles=[${roles}] requestedRole=${requestedRole ?? "-"} → ${dest}` +
      `${blocked ? " (no session)" : ""}`,
  );
  return res.redirect(webUrl(dest));
});

/** POST /auth/logout — clear the local session and return to the web app. POST-only + CSRF-guarded:
 *  logout is a state change, so a GET would be forgeable cross-site (SameSite=Lax allows a top-level
 *  navigation GET) to force-log-out a user. */
function logout(req: import("express").Request, res: import("express").Response) {
  // Revoke the Google grant before dropping our cookie, so "sign out" also ends the
  // credential at Google rather than only here. Deliberately NOT awaited: it is best-effort
  // and must not delay the redirect the user is waiting on.
  const session = readSession(req);
  if (session?.refreshToken) void revokeRefreshToken(session.refreshToken);
  clearSession(res);
  return res.redirect(config.webBaseUrl);
}
authRouter.post("/logout", csrfGuard, logout);

/** GET /auth/session — lightweight auth check for the web app (no Core call). */
authRouter.get("/session", (req, res) => {
  const session = readSession(req);
  res.json({ authenticated: Boolean(session?.idToken) });
});
