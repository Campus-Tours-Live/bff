package com.campustourslive.bff.userinfo;

import com.campustourslive.bff.userinfo.UserinfoContracts.*;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Implements the BFF-owned PENDING/PROVISIONED userinfo contract. */
public final class UserinfoService {
    private static final Set<String> ALLOWED = Set.of("GUIDE", "PARTICIPANT", "ADMIN", "SUPPORT");
    private final CoreGateway core;
    private final SessionGateway sessions;
    private final PendingIdentity pendingIdentity;

    public UserinfoService(CoreGateway core, SessionGateway sessions, PendingIdentity pendingIdentity) {
        this.core = core; this.sessions = sessions; this.pendingIdentity = pendingIdentity;
    }

    public Map<String, Object> getUserinfo(HttpServletRequest request, HttpServletResponse response) {
        // The gateway must enforce the existing withSession semantics (bearer refresh, 401,
        // pending absolute expiry, transient 503) before any Core request is attempted.
        Session session = sessions.requireAuthenticated(request, response);
        if (session == null) throw new UnauthorizedException();
        CoreMe me;
        try {
            me = core.getCurrentUser(request, response);
        } catch (CoreFailure error) {
            if (error.status() == 404 && "ACCOUNT_NOT_PROVISIONED".equals(error.code())) {
                // Read-only: do not refresh/reset the pending session's absolute 24-hour TTL.
                java.util.Map<String, Object> pending = new java.util.LinkedHashMap<>();
                pending.put("provisioningStatus", "PENDING");
                pending.put("user", pendingIdentity.fromSession(session));
                pending.put("roles", List.of());
                pending.put("currentRole", null);
                return pending;
            }
            throw error;
        }

        if (me == null || me.user() == null || !me.user().isObject() ||
                !validId(me.user()) || !validRoles(me.roles())) {
            throw new UpstreamContractViolationException();
        }
        List<String> held = me.roles();
        List<Role> switchable = new ArrayList<>();
        if (held.contains("GUIDE")) switchable.add(Role.GUIDE);
        if (held.contains("PARTICIPANT")) switchable.add(Role.PARTICIPANT);

        Role prior = session.provisioningStatus() == ProvisioningStatus.PROVISIONED ? session.currentRole() : null;
        Role repaired = prior != null && switchable.contains(prior) ? prior
                : switchable.size() == 1 ? switchable.get(0) : null;
        try {
            if (session.provisioningStatus() == ProvisioningStatus.PENDING) {
                sessions.convertToProvisioned(response, session, repaired);
            } else if (prior != repaired) {
                sessions.updateCurrentRole(response, session, repaired);
            }
        } catch (RuntimeException failure) {
            throw new SessionConversionException(failure);
        }
        // LinkedHashMap supports null currentRole; Map.of does not.
        java.util.Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("provisioningStatus", "PROVISIONED");
        result.put("user", me.user());
        result.put("roles", held);
        result.put("currentRole", repaired == null ? null : repaired.name());
        return result;
    }

    private static boolean validId(JsonNode user) {
        JsonNode id = user.get("id");
        return id != null && id.isTextual() && !id.textValue().isEmpty();
    }
    private static boolean validRoles(List<String> roles) {
        return roles != null && !roles.isEmpty() && roles.stream().allMatch(ALLOWED::contains);
    }
    public static class UnauthorizedException extends RuntimeException {}
}
