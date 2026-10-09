package com.campustourslive.bff.session;

public sealed interface SessionData
        permits PendingSession, ProvisionedSession {

    String idToken();

    String accessToken();

    String refreshToken();

    Long expiresAt();
}