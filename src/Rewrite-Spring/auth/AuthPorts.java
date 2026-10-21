package com.campustourslive.bff.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Map;

/** Adapters to the previously converted encrypted-cookie and Core-client modules. */
public final class AuthPorts {
    private AuthPorts() {}
    public enum Role { GUIDE, PARTICIPANT }
    public enum Intent { signup, signin }
    public enum ProvisioningStatus { PENDING, PROVISIONED }

    public record AuthTransaction(String state, String codeVerifier, String returnTo,
                                  Intent intent, Role requestedRole) {}
    public record Session(ProvisioningStatus provisioningStatus, String idToken,
                          String accessToken, String refreshToken, long expiresAt,
                          Role currentRole) {}
    public record CoreUser(String id, Map<String,Object> fields) {}
    public record Me(CoreUser user, List<String> roles) {}
    public record Eligibility(boolean eligible, String reason) {}

    public interface SessionStore {
        void writeAuthTransaction(HttpServletResponse response, AuthTransaction tx);
        AuthTransaction readAuthTransaction(HttpServletRequest request);
        void clearAuthTransaction(HttpServletResponse response);
        Session readSession(HttpServletRequest request);
        void writePendingSession(HttpServletResponse response, Session session);
        void writeSession(HttpServletResponse response, Session session);
        void clearSession(HttpServletResponse response);
    }
    public interface CoreAccounts {
        Me getCurrentUser(String googleIdToken) throws CoreFailure;
        Eligibility getRoleEligibility(String googleIdToken, Role role) throws CoreFailure;
    }
    public static class CoreFailure extends RuntimeException {
        public final int status;
        public final String code;
        public CoreFailure(int status, String code, String message) {
            super(message); this.status = status; this.code = code;
        }
        public boolean is(int expectedStatus, String expectedCode) {
            return status == expectedStatus && expectedCode.equals(code);
        }
    }
}
