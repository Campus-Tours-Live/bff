package com.campustourslive.bff.userinfo;

import com.campustourslive.bff.userinfo.UserinfoContracts.IdentityClaimsInvalidException;
import com.campustourslive.bff.userinfo.UserinfoContracts.Session;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** CLAIM EXTRACTION ONLY: call exclusively with the trusted session's Google ID token.
 * Never use this class to authenticate an arbitrary request-supplied JWT.
 * OAuth callback/token validation must establish token trust separately.
 */
public final class PendingIdentity {
    private final ObjectMapper mapper;
    public PendingIdentity(ObjectMapper mapper) { this.mapper = mapper; }

    public record PendingUserInfo(Object id, String email, String firstName, String lastName, String displayName) {}

    public PendingUserInfo fromSession(Session session) {
        String token = session == null ? null : session.idToken();
        if (token == null || token.isBlank()) throw new IdentityClaimsInvalidException("session has no id_token");
        String[] parts = token.split("\\.", -1);
        if (parts.length != 3) throw new IdentityClaimsInvalidException("id_token is not a well-formed JWT");
        JsonNode claims;
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(parts[1]);
            claims = mapper.readTree(new String(decoded, StandardCharsets.UTF_8));
        } catch (Exception ex) {
            throw new IdentityClaimsInvalidException("id_token payload segment is not valid JSON");
        }
        if (claims == null || !claims.isObject()) throw new IdentityClaimsInvalidException("id_token payload is not a JSON object");
        JsonNode email = claims.get("email");
        if (email == null || !email.isTextual()) throw new IdentityClaimsInvalidException("id_token is missing the email claim");
        if (!claims.path("email_verified").isBoolean() || !claims.path("email_verified").booleanValue())
            throw new IdentityClaimsInvalidException("id_token email is not verified");
        return new PendingUserInfo(null, email.textValue(), optionalString(claims, "given_name"),
                optionalString(claims, "family_name"), optionalString(claims, "name"));
    }

    private static String optionalString(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isTextual() ? value.textValue() : null;
    }
}
