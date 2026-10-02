package com.campustourslive.bff.session;

public record AuthTransaction(
        String state,
        String codeVerifier,
        String returnTo,
        AuthIntent intent,
        Role requestedRole
) {
    public enum AuthIntent {
        SIGNUP,
        SIGNIN
    }
}