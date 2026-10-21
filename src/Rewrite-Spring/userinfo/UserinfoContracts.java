package com.campustourslive.bff.userinfo;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;

/** Adapters to the previously converted authentication/session and Core HTTP modules. */
public final class UserinfoContracts {
    private UserinfoContracts() {}

    public enum ProvisioningStatus { PENDING, PROVISIONED }
    public enum Role { GUIDE, PARTICIPANT }
    public enum HeldRole { GUIDE, PARTICIPANT, ADMIN, SUPPORT }

    public record Session(ProvisioningStatus provisioningStatus, String idToken, Role currentRole) {}
    public record CoreMe(JsonNode user, List<String> roles) {}

    public interface SessionGateway {
        /** Returns the trusted, decrypted BFF session, or null if unauthenticated. */
        Session requireAuthenticated(HttpServletRequest request, HttpServletResponse response);
        /** Write a provisioned session, preserving existing OAuth tokens and expiry policy. */
        void convertToProvisioned(HttpServletResponse response, Session original, Role currentRole);
        /** Write a role change, preserving all other session fields. */
        void updateCurrentRole(HttpServletResponse response, Session original, Role currentRole);
        void clear(HttpServletResponse response);
    }

    public interface CoreGateway {
        /** GET /users/me with the session's resolved bearer; unwrap Core's {data} envelope. */
        CoreMe getCurrentUser(HttpServletRequest request, HttpServletResponse response);
    }

    public static class CoreFailure extends RuntimeException {
        private final int status;
        private final String code;
        private final String rawBody;
        private final String contentType;
        public CoreFailure(int status, String code, String rawBody, String contentType) {
            super("Core returned HTTP " + status + " (" + code + ")");
            this.status = status; this.code = code; this.rawBody = rawBody; this.contentType = contentType;
        }
        public int status() { return status; }
        public String code() { return code; }
        public String rawBody() { return rawBody; }
        public String contentType() { return contentType; }
    }

    public static class IdentityClaimsInvalidException extends RuntimeException {
        public IdentityClaimsInvalidException(String message) { super(message); }
    }
    public static class UpstreamContractViolationException extends RuntimeException {}
    public static class SessionConversionException extends RuntimeException {
        public SessionConversionException(Throwable cause) { super(cause); }
    }
}
