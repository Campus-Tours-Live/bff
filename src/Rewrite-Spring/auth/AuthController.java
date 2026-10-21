package com.campustourslive.bff.auth;

import com.campustourslive.bff.auth.AuthPorts.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;

/** Equivalent to auth/routes.ts. Spring Security must enforce CSRF on POST /auth/logout. */
@RestController
@RequestMapping("/auth")
public class AuthController {
    private final GoogleOAuthClient google;
    private final SessionStore sessions;
    private final CoreAccounts core;
    private final String webBaseUrl;

    public AuthController(GoogleOAuthClient google, SessionStore sessions, CoreAccounts core,
                          @Value("${web.base-url}") String webBaseUrl) {
        this.google = google; this.sessions = sessions; this.core = core; this.webBaseUrl = webBaseUrl;
    }

    @GetMapping("/login")
    public ResponseEntity<Void> login(@RequestParam(required=false) String returnTo,
                                      @RequestParam(required=false) String intent,
                                      @RequestParam(required=false) String role,
                                      @RequestParam(name="login_hint", required=false) String loginHint,
                                      HttpServletResponse response) {
        String safe = AuthRedirects.safeReturnTo(returnTo);
        Intent chosenIntent = "signup".equals(intent) ? Intent.signup : Intent.signin;
        Role requested = AuthRedirects.parseRole(role);
        var pkce = GoogleOAuthClient.createPkce();
        String state = GoogleOAuthClient.randomState();
        sessions.writeAuthTransaction(response, new AuthTransaction(state, pkce.verifier(), safe, chosenIntent, requested));
        return redirect(google.buildAuthorizeUrl(state, pkce.challenge(), loginHint));
    }

    @GetMapping("/callback")
    public ResponseEntity<?> callback(@RequestParam(required=false) String error,
                                      @RequestParam(name="error_description", required=false) String errorDescription,
                                      @RequestParam(required=false) String code,
                                      @RequestParam(required=false) String state,
                                      HttpServletRequest request, HttpServletResponse response) {
        if (error != null && !error.isEmpty()) {
            AuthTransaction tx = sessions.readAuthTransaction(request);
            sessions.clearAuthTransaction(response);
            String entry = "/signin";
            if (tx != null && tx.intent() == Intent.signup) {
                entry = tx.returnTo().startsWith("/onboarding/guide") ? "/signup/guide"
                        : tx.returnTo().startsWith("/onboarding/participant") ? "/signup/participant" : "/signup/role";
            }
            return webRedirect("access_denied".equals(error) ? entry : "/signin?error=auth_failed");
        }
        AuthTransaction tx = sessions.readAuthTransaction(request);
        if (tx == null) {
            sessions.clearAuthTransaction(response);
            return problem(400, "Login session expired — please start again.", "AUTH_TX_MISSING");
        }
        if (code == null || code.isEmpty() || state == null || !state.equals(tx.state())) {
            sessions.clearAuthTransaction(response);
            return problem(400, "Invalid authentication state", "AUTH_STATE_INVALID");
        }
        if (tx.intent() == null) {
            sessions.clearAuthTransaction(response);
            return problem(400, "Invalid authentication state", "AUTH_INTENT_INVALID");
        }
        GoogleOAuthClient.TokenSet tokens;
        try { tokens = google.exchangeCode(code, tx.codeVerifier()); }
        catch (Exception e) {
            sessions.clearAuthTransaction(response);
            return problem(502, "Authentication failed", "AUTH_EXCHANGE_FAILED");
        }
        String bearer = tokens == null || tokens.idToken() == null ? "" : tokens.idToken();
        Role requestedRole = tx.requestedRole() != null ? tx.requestedRole() : AuthRedirects.inferLegacyRole(tx.returnTo());
        Me me;
        try { me = core.getCurrentUser(bearer); }
        catch (CoreFailure e) {
            if (e.is(404, "ACCOUNT_NOT_PROVISIONED")) {
                sessions.clearAuthTransaction(response);
                if (tx.intent() == Intent.signup) {
                    sessions.writePendingSession(response, tokenSession(ProvisioningStatus.PENDING, tokens, null));
                    String destination = requestedRole == Role.GUIDE ? "/onboarding/guide"
                            : requestedRole == Role.PARTICIPANT ? "/onboarding/participant" : "/signup/role";
                    return webRedirect(destination);
                }
                return webRedirect("/signin?error=not_registered");
            }
            if (e.is(403, "ACCOUNT_SUSPENDED") || e.is(403, "ACCOUNT_DELETED")) {
                sessions.clearAuthTransaction(response);
                sessions.clearSession(response);
                return webRedirect(e.is(403, "ACCOUNT_SUSPENDED")
                        ? "/signin?error=account_suspended" : "/signin?error=account_deleted");
            }
            if (e.is(409, "ACCOUNT_STATE_INVALID")) {
                sessions.clearAuthTransaction(response);
                sessions.clearSession(response);
                return webRedirect("/signin?error=account_error");
            }
            sessions.clearAuthTransaction(response);
            return problem(502, "Account resolution failed", "RESOLVE_FAILED");
        } catch (Exception e) {
            sessions.clearAuthTransaction(response);
            return problem(502, "Account resolution failed", "RESOLVE_FAILED");
        }
        if (me == null || me.roles() == null) {
            sessions.clearAuthTransaction(response);
            return problem(502, "Account resolution failed", "RESOLVE_FAILED");
        }
        List<String> roles = me.roles();
        Role currentRole = null;
        String destination;
        boolean blocked = false;
        if (requestedRole != null && roles.contains(requestedRole.name())) {
            currentRole = requestedRole;
            destination = "/dashboard";
        } else if (requestedRole != null && tx.intent() == Intent.signup) {
            Eligibility eligibility;
            try { eligibility = core.getRoleEligibility(bearer, requestedRole); }
            catch (Exception e) {
                sessions.clearAuthTransaction(response);
                return problem(502, "Account resolution failed", "RESOLVE_FAILED");
            }
            if (eligibility == null) {
                sessions.clearAuthTransaction(response);
                return problem(502, "Account resolution failed", "RESOLVE_FAILED");
            }
            if (!eligibility.eligible()) {
                destination = "PARENT_CANNOT_BECOME_GUIDE".equals(eligibility.reason())
                        ? "/signup/role?error=parent_no_guide" : "/signup/role";
                blocked = true;
            } else {
                destination = requestedRole == Role.GUIDE ? "/onboarding/guide" : "/onboarding/participant";
            }
        } else if (requestedRole != null) {
            destination = "/signup/role";
        } else {
            if (roles.size() == 1) currentRole = AuthRedirects.parseRole(roles.get(0));
            destination = AuthRedirects.landingFor(tx.returnTo(), roles);
        }
        sessions.clearAuthTransaction(response);
        if (blocked) sessions.clearSession(response);
        else sessions.writeSession(response, tokenSession(ProvisioningStatus.PROVISIONED, tokens, currentRole));
        return webRedirect(destination);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        Session session = sessions.readSession(request);
        if (session != null && session.refreshToken() != null && !session.refreshToken().isEmpty()) {
            String refresh = session.refreshToken();
            CompletableFuture.runAsync(() -> google.revokeRefreshToken(refresh));
        }
        sessions.clearSession(response);
        return redirect(URI.create(webBaseUrl));
    }

    @GetMapping("/session")
    public Map<String,Boolean> session(HttpServletRequest request) {
        Session session = sessions.readSession(request);
        return Map.of("authenticated", session != null && session.idToken() != null && !session.idToken().isEmpty());
    }

    private Session tokenSession(ProvisioningStatus status, GoogleOAuthClient.TokenSet t, Role role) {
        return new Session(status, t.idToken(), t.accessToken(), t.refreshToken(),
                Instant.now().toEpochMilli() + t.expiresIn() * 1000, role);
    }
    private ResponseEntity<Void> webRedirect(String path) { return redirect(URI.create(webBaseUrl).resolve(path)); }
    private static ResponseEntity<Void> redirect(URI uri) {
        return ResponseEntity.status(HttpStatus.FOUND).location(uri).build();
    }
    private static ResponseEntity<Map<String,Object>> problem(int status, String title, String code) {
        return ResponseEntity.status(status).contentType(MediaType.valueOf("application/problem+json"))
                .body(Map.of("type", "about:blank", "title", title, "status", status, "code", code));
    }
}
