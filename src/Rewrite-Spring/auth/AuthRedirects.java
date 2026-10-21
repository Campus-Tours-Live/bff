package com.campustourslive.bff.auth;

import java.util.List;

/** Mirrors routes.ts returnTo allowlist and landing decisions. */
public final class AuthRedirects {
    private AuthRedirects() {}
    public static final String DEFAULT_RETURN_TO = "/dashboard";
    private static final List<String> ROOTS = List.of(
            "/dashboard", "/profile", "/support", "/staff", "/onboarding", "/guide");

    public static String safeReturnTo(String raw) {
        if (raw == null || !raw.startsWith("/") || raw.startsWith("//")
                || raw.contains("\\") || raw.contains("://")) return DEFAULT_RETURN_TO;
        int question = raw.indexOf('?');
        int hash = raw.indexOf('#');
        int cut = question < 0 ? hash : (hash < 0 ? question : Math.min(question, hash));
        String path = cut < 0 ? raw : raw.substring(0, cut);
        return ROOTS.stream().anyMatch(root -> path.equals(root) || path.startsWith(root + "/"))
                ? raw : DEFAULT_RETURN_TO;
    }
    public static String landingFor(String returnTo, List<String> roles) {
        String safe = safeReturnTo(returnTo);
        if (roles != null && !roles.isEmpty()) return safe.equals(DEFAULT_RETURN_TO) ? "/dashboard" : safe;
        return "/signup/role?error=complete_signup";
    }
    public static AuthPorts.Role inferLegacyRole(String returnTo) {
        String safe = safeReturnTo(returnTo);
        if (safe.startsWith("/onboarding/guide")) return AuthPorts.Role.GUIDE;
        if (safe.startsWith("/onboarding/participant")) return AuthPorts.Role.PARTICIPANT;
        return null;
    }
    public static AuthPorts.Role parseRole(String raw) {
        try { return AuthPorts.Role.valueOf(raw); }
        catch (Exception e) { return null; }
    }
}
