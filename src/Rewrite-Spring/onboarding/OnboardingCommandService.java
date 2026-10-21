package com.campustourslive.bff.onboarding;

import com.campustourslive.bff.auth.SessionCookieStore;
import com.campustourslive.bff.auth.SessionData;
import com.campustourslive.bff.client.CoreApiClient;
import com.campustourslive.bff.dto.Role;
import com.campustourslive.bff.web.WriteOptionsFactory;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Java port of handler.ts. Core owns held roles; the BFF owns currentRole. */
@Service
public class OnboardingCommandService {
    private final SessionCookieStore sessions;
    private final Set<String> heldRoleValues;

    /** Supply the EXACT four HeldRoleEnum values from openapi/schemas.ts. */
    public OnboardingCommandService(SessionCookieStore sessions,
            @Value("${app.onboarding.held-roles:}") List<String> heldRoleValues) {
        this.sessions = sessions;
        this.heldRoleValues = Set.copyOf(heldRoleValues);
    }

    public ResponseEntity<?> onboard(String routeRole, HttpServletRequest request,
            HttpServletResponse response, CoreApiClient.Bound core, Object requestBody) {
        Role expectedRole = switch (routeRole) {
            case "guide" -> Role.GUIDE;
            case "participant" -> Role.PARTICIPANT;
            default -> throw new IllegalArgumentException("Unsupported onboarding route");
        };

        // Core 4xx exceptions intentionally propagate to AuthenticatedHandlers.withMutation.
        // Never modify the BFF session before a successful Core response is validated.
        JsonNode coreResult = core.post("/users/me/roles/" + routeRole,
                requestBody, WriteOptionsFactory.from(request, response), JsonNode.class);

        if (!validCoreResponse(coreResult, expectedRole)) {
            return problem(502, "Upstream contract violation", "UPSTREAM_CONTRACT_VIOLATION");
        }

        SessionData current = sessions.read(request);
        // AuthenticatedHandlers guarantees an authenticated bearer. Fail closed if the
        // corresponding cookie is unexpectedly missing, rather than forging a session.
        if (current == null) {
            return problem(500, "Session conversion failed", "SESSION_CONVERSION_FAILED");
        }
        SessionData provisioned = new SessionData(current.idToken(), current.accessToken(),
                current.refreshToken(), current.expiresAt(),
                SessionData.ProvisioningStatus.PROVISIONED,
                current.pendingSince(), current.pendingExpiresAt(), expectedRole);

        if (!writeWithOneRetry(response, provisioned)) {
            // Core role grant has ALREADY happened; client must reconcile using GET /v1/userinfo.
            return problem(500, "Session conversion failed", "SESSION_CONVERSION_FAILED");
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("provisioningStatus", "PROVISIONED");
        data.put("user", coreResult.get("user"));
        data.put("roles", coreResult.get("roles"));
        data.put("currentRole", expectedRole.name());
        data.put("acquiredRole", expectedRole.name());
        data.put("profile", coreResult.get("profile"));
        return ResponseEntity.status(201).body(Map.of("data", data,
                "meta", Map.of("requestId", requestId(response))));
    }

    private boolean validCoreResponse(JsonNode root, Role expected) {
        if (root == null || !root.isObject()) return false;
        JsonNode user = root.path("user");
        JsonNode id = user.path("id");
        if (!user.isObject() || !id.isTextual() || id.textValue().isEmpty()) return false;
        JsonNode roles = root.path("roles");
        if (!roles.isArray() || roles.isEmpty() || heldRoleValues.size() != 4) return false;
        for (JsonNode role : roles) {
            if (!role.isTextual() || !heldRoleValues.contains(role.textValue())) return false;
        }
        JsonNode acquired = root.path("acquiredRole");
        if (!acquired.isTextual() || !expected.name().equals(acquired.textValue())) return false;
        boolean found = false;
        for (JsonNode role : roles) {
            if (expected.name().equals(role.textValue())) found = true;
        }
        return found && root.has("profile");
    }

    private boolean writeWithOneRetry(HttpServletResponse response, SessionData session) {
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                // A provisioned cookie uses the normal session TTL, not the pending cutoff.
                sessions.write(response, session, null);
                return true;
            } catch (RuntimeException ex) {
                if (attempt == 1) return false;
            }
        }
        return false;
    }

    private static String requestId(HttpServletResponse response) {
        String id = response.getHeader("X-Request-Id");
        return id == null ? "" : id;
    }

    private static ResponseEntity<?> problem(int status, String title, String code) {
        return ResponseEntity.status(status)
                .header("Content-Type", "application/problem+json")
                .body(Map.of("title", title, "status", status, "code", code));
    }
}
