package com.campustourslive.bff.auth;

import com.campustourslive.bff.dto.Role;
/** Expiry timestamps use epoch milliseconds, as in the original BFF. */
public record SessionData(String idToken, String accessToken, String refreshToken,
    Long expiresAt, ProvisioningStatus provisioningStatus, Long pendingSince,
    Long pendingExpiresAt, Role currentRole) {
    public enum ProvisioningStatus { PENDING, PROVISIONED }
    public SessionData refreshed(TokenResult t, long now) {
        return new SessionData(t.idToken()!=null?t.idToken():idToken, t.accessToken(),
            t.refreshToken()!=null?t.refreshToken():refreshToken,
            now + t.expiresInSeconds()*1000L, provisioningStatus, pendingSince, pendingExpiresAt, currentRole);
    }
}
