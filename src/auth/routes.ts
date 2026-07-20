import { Router } from "express";
import { config } from "../config.js";
import {
  clearAuthTx,
  clearSession,
  readAuthTx,
  readSession,
  writeAuthTx,
  writeSession,
} from "../session.js";
import { buildAuthorizeUrl, createPkce, exchangeCode, randomState } from "./google.js";
import { sendProblem } from "../util/problem.js";

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

/** Consumer home after auth. Both roles share /dashboard; the active role decides
 *  the view client-side. Single source for the path. */
const CONSUMER_HOME = "/dashboard";

/**
 * Where to land after auth. The signup area the user entered implies a TARGET
 * role (via returnTo); combined with the roles they actually hold:
 *   - hold the target role            → that role's home (it's effectively a login)
 *   - lack it, and may acquire it     → that role's onboarding (add the role)
 *   - lack it, PARENT→guide excluded  → /signup/role with a notice
 *   - no target (signin)              → an existing role's home, else pick a role
 */
// Exported for unit testing — the role-routing core (the callback's only landing
// decision). `activeRole` is currently unread but kept for a stable signature.
export function landingFor(
  returnTo: string,
  roles: string[],
  activeRole: string | null,
  participantType: string | null,
): string {
  // Re-validate here too: landingFor is exported and unit-tested with raw values, and the
  // returnTo honoured below must never trust an un-sanitised path (open-redirect defence).
  // safeReturnTo is idempotent, so this is a no-op on the already-sanitised callback value.
  const safeRt = safeReturnTo(returnTo);

  const targetRole = safeRt.startsWith("/onboarding/guide")
    ? "GUIDE"
    : safeRt.startsWith("/onboarding/participant")
      ? "PARTICIPANT"
      : null;

  if (targetRole) {
    if (roles.includes(targetRole)) return CONSUMER_HOME;
    if (targetRole === "GUIDE" && participantType === "PARENT") {
      return "/signup/role?error=parent_no_guide";
    }
    return targetRole === "GUIDE" ? "/onboarding/guide" : "/onboarding/participant";
  }

  // A returning user who already holds a role: land them back on the specific allow-listed page
  // they came from (safeRt), not always /dashboard. Fall back to home when returnTo was
  // absent/default (safeRt === DEFAULT_RETURN_TO).
  if (roles.length > 0) return safeRt !== DEFAULT_RETURN_TO ? safeRt : CONSUMER_HOME;
  // Account exists but holds no role yet (e.g. signed up then abandoned onboarding,
  // now signing in) → send to role selection with a notice. This is a continuation,
  // not a rejection (see the session handling in the callback).
  return "/signup/role?error=complete_signup";
}

/**
 * GET /auth/login — start Google sign-in.
 * Query: returnTo, intent (signup|signin), login_hint (optional email hint).
 */
authRouter.get("/login", (req, res) => {
  const returnTo = safeReturnTo(req.query.returnTo as string | undefined);
  const intent = req.query.intent === "signup" ? "signup" : "signin";

  const { verifier, challenge } = createPkce();
  const state = randomState();
  writeAuthTx(res, { state, codeVerifier: verifier, returnTo, intent });
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
  let tokens;
  try {
    tokens = await exchangeCode(code, tx.codeVerifier);
  } catch {
    clearAuthTx(res);
    return sendProblem(res, 502, "Authentication failed", { code: "AUTH_EXCHANGE_FAILED" });
  }

  // Enforce signup vs signin against the Core BEFORE establishing a session:
  // signup provisions a new account; signin requires an existing one (404).
  let resolve: Response;
  try {
    resolve = await fetch(`${config.coreApiBaseUrl}/session?intent=${tx.intent}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.id_token ?? ""}`, Accept: "application/json" },
    });
  } catch {
    clearAuthTx(res);
    return sendProblem(res, 502, "Account resolution failed", { code: "CORE_UNAVAILABLE" });
  }

  console.log(`[auth/callback] intent=${tx.intent} core /session -> ${resolve.status}`);
  if (resolve.status === 404) {
    // Signing in with a Google account that was never registered.
    clearAuthTx(res);
    return res.redirect(webUrl("/signin?error=not_registered"));
  }
  if (!resolve.ok) {
    clearAuthTx(res);
    return sendProblem(res, 502, "Account resolution failed", { code: "RESOLVE_FAILED" });
  }

  // Role-aware landing (see landingFor): entering a role's signup when you don't
  // hold that role takes you to ITS onboarding (acquire it), not a silent login.
  const resolved = (await resolve.json().catch(() => null)) as {
    data?: { roles?: string[]; activeRole?: string | null; participantType?: string | null };
  } | null;
  const roles = resolved?.data?.roles ?? [];
  const activeRole = resolved?.data?.activeRole ?? null;
  const participantType = resolved?.data?.participantType ?? null;

  const dest = landingFor(tx.returnTo, roles, activeRole, participantType);
  clearAuthTx(res);

  // A blocked action (PARENT→guide → /signup/role?error=parent_no_guide) is a
  // rejection, not a login: don't establish a session, so the user stays logged out.
  // (complete_signup is NOT blocked — the bare account keeps its session so it can
  // finish picking a role.)
  const blocked = dest.includes("error=parent_no_guide");
  if (blocked) {
    clearSession(res);
  } else {
    writeSession(res, {
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
  }
  console.log(`[auth/callback] roles=[${roles}] → ${dest}${blocked ? " (no session)" : ""}`);
  return res.redirect(webUrl(dest));
});

/** GET/POST /auth/logout — clear the local session and return to the web app. */
function logout(_req: import("express").Request, res: import("express").Response) {
  clearSession(res);
  return res.redirect(config.webBaseUrl);
}
authRouter.get("/logout", logout);
authRouter.post("/logout", logout);

/** GET /auth/session — lightweight auth check for the web app (no Core call). */
authRouter.get("/session", (req, res) => {
  const session = readSession(req);
  res.json({ authenticated: Boolean(session?.idToken) });
});
