package com.campustourslive.bff.auth;

public record TokenResult(String idToken, String accessToken, String refreshToken, long expiresInSeconds) {}
