package com.campustourslive.bff.session;

public record PendingSession(
        String idToken,
        String accessToken,
        String refreshToken,
        Long expiresAt,
        long pendingSince,
        long pendingExpiresAt
) implements SessionData {
}