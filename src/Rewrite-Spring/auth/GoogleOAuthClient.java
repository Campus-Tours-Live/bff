package com.campustourslive.bff.auth;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;

/** Equivalent to google.ts; Google ID tokens are passed to Core, which verifies their signatures. */
@Component
public class GoogleOAuthClient {
    private static final String AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN = "https://oauth2.googleapis.com/token";
    private static final String REVOKE = "https://oauth2.googleapis.com/revoke";
    private static final SecureRandom RANDOM = new SecureRandom();
    private final RestClient http;
    private final String clientId, clientSecret, redirectUri;

    public GoogleOAuthClient(RestClient.Builder builder,
                             @Value("${google.client-id}") String clientId,
                             @Value("${google.client-secret}") String clientSecret,
                             @Value("${google.redirect-uri}") String redirectUri) {
        this.http = builder.build();
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
    }

    public record Pkce(String verifier, String challenge) {}
    public record TokenSet(@JsonProperty("access_token") String accessToken,
                           @JsonProperty("refresh_token") String refreshToken,
                           @JsonProperty("expires_in") long expiresIn,
                           @JsonProperty("id_token") String idToken) {}

    public static class GoogleTokenException extends RuntimeException {
        public final int status;
        public final String code;
        public final String description;
        public GoogleTokenException(int status, String code, String description) {
            super("Google token request failed: " + status + (code == null ? "" : " (" + code + ")"));
            this.status = status;
            this.code = code;
            this.description = description;
        }
        /** Only these known grant/client rejections invalidate a durable session. */
        public boolean fatal() { return "invalid_grant".equals(code) || "invalid_client".equals(code); }
    }

    private static String randomUrlSafe(int bytes) {
        byte[] value = new byte[bytes];
        RANDOM.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }
    public static Pkce createPkce() {
        String verifier = randomUrlSafe(32);
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return new Pkce(verifier, Base64.getUrlEncoder().withoutPadding().encodeToString(digest));
        } catch (Exception e) { throw new IllegalStateException("SHA-256 unavailable", e); }
    }
    public static String randomState() { return randomUrlSafe(16); }

    public URI buildAuthorizeUrl(String state, String challenge, String loginHint) {
        var b = UriComponentsBuilder.fromUriString(AUTHORIZE)
                .queryParam("response_type", "code")
                .queryParam("client_id", clientId)
                .queryParam("redirect_uri", redirectUri)
                .queryParam("scope", "openid email profile")
                .queryParam("state", state)
                .queryParam("code_challenge", challenge)
                .queryParam("code_challenge_method", "S256")
                .queryParam("access_type", "offline")
                .queryParam("prompt", "consent");
        if (loginHint != null && !loginHint.isBlank()) b.queryParam("login_hint", loginHint);
        return b.encode().build().toUri();
    }

    public TokenSet exchangeCode(String code, String verifier) {
        return postToken(Map.of("grant_type", "authorization_code", "code", code,
                "client_id", clientId, "client_secret", clientSecret,
                "redirect_uri", redirectUri, "code_verifier", verifier));
    }
    public TokenSet refreshTokens(String refreshToken) {
        return postToken(Map.of("grant_type", "refresh_token", "client_id", clientId,
                "client_secret", clientSecret, "refresh_token", refreshToken));
    }
    private TokenSet postToken(Map<String,String> params) {
        try {
            return http.post().uri(TOKEN).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form(params)).retrieve().body(TokenSet.class);
        } catch (RestClientResponseException e) {
            String code = null, description = null;
            try {
                var json = new com.fasterxml.jackson.databind.ObjectMapper().readTree(e.getResponseBodyAsString());
                if (json.path("error").isTextual()) code = json.get("error").asText();
                if (json.path("error_description").isTextual()) description = json.get("error_description").asText();
            } catch (Exception ignored) { /* Unrecognized error is transient. */ }
            throw new GoogleTokenException(e.getStatusCode().value(), code, description);
        } catch (Exception e) {
            throw new GoogleTokenException(0, null, e.getMessage());
        }
    }
    /** Call asynchronously from logout; failure must never delay clearing the local session. */
    public void revokeRefreshToken(String refreshToken) {
        try {
            http.post().uri(REVOKE).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form(Map.of("token", refreshToken))).retrieve().toBodilessEntity();
        } catch (Exception ignored) { /* best effort */ }
    }
    private static String form(Map<String,String> values) {
        var parts = new org.springframework.util.LinkedMultiValueMap<String,String>();
        values.forEach(parts::add);
        return new org.springframework.util.LinkedMultiValueMap<>(parts).toSingleValueMap().entrySet().stream()
                .map(e -> java.net.URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "="
                        + java.net.URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(java.util.stream.Collectors.joining("&"));
    }
}
