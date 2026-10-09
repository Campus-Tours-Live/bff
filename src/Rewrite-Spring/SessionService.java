package com.campustourslive.bff.session;

import com.campustourslive.bff.config.AppProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Arrays;
import java.util.Base64;

@Service
public class SessionService {

    private static final String SESSION_COOKIE = "ctl_sess";
    private static final String TX_COOKIE = "ctl_auth_tx";

    private static final Duration PENDING_TTL = Duration.ofHours(24);
    private static final Duration PROVISIONED_TTL = Duration.ofDays(7);
    private static final Duration AUTH_TX_TTL = Duration.ofMinutes(15);

    private final ObjectMapper objectMapper;
    private final AppProperties properties;
    private final Clock clock;
    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public SessionService(
            ObjectMapper objectMapper,
            AppProperties properties
    ) throws Exception {
        this.objectMapper = objectMapper;
        this.properties = properties;
        this.clock = Clock.systemUTC();

        byte[] keyBytes = MessageDigest
                .getInstance("SHA-256")
                .digest(properties.sessionSecret().getBytes(StandardCharsets.UTF_8));

        this.key = new SecretKeySpec(keyBytes, "AES");
    }

    private String encrypt(Object value) {
        try {
            byte[] iv = new byte[12];
            random.nextBytes(iv);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.ENCRYPT_MODE,
                    key,
                    new GCMParameterSpec(128, iv)
            );

            byte[] json = objectMapper.writeValueAsBytes(value);
            byte[] encrypted = cipher.doFinal(json);

            byte[] output = new byte[iv.length + encrypted.length];

            System.arraycopy(iv, 0, output, 0, iv.length);
            System.arraycopy(
                    encrypted,
                    0,
                    output,
                    iv.length,
                    encrypted.length
            );

            return Base64.getUrlEncoder()
                    .withoutPadding()
                    .encodeToString(output);

        } catch (Exception e) {
            throw new IllegalStateException(
                    "Unable to encrypt session",
                    e
            );
        }
    }

    private byte[] decrypt(String token) {
        try {
            byte[] raw = Base64.getUrlDecoder().decode(token);

            byte[] iv = Arrays.copyOfRange(raw, 0, 12);
            byte[] encrypted = Arrays.copyOfRange(raw, 12, raw.length);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    key,
                    new GCMParameterSpec(128, iv)
            );

            return cipher.doFinal(encrypted);

        } catch (Exception e) {
            return null;
        }
    }

    public void writeSession(
            HttpServletResponse response,
            SessionData session
    ) {
        Duration maxAge =
                session instanceof PendingSession
                        ? PENDING_TTL
                        : PROVISIONED_TTL;

        writeCookie(
                response,
                SESSION_COOKIE,
                encrypt(session),
                maxAge
        );
    }

    public void clearSession(HttpServletResponse response) {
        writeCookie(
                response,
                SESSION_COOKIE,
                "",
                Duration.ZERO
        );
    }

    private void writeCookie(
            HttpServletResponse response,
            String name,
            String value,
            Duration maxAge
    ) {
        ResponseCookie cookie = ResponseCookie
                .from(name, value)
                .httpOnly(true)
                .secure(isProduction())
                .sameSite("Lax")
                .path("/")
                .maxAge(maxAge)
                .build();

        response.addHeader(
                "Set-Cookie",
                cookie.toString()
        );
    }

    private boolean isProduction() {
        return false; // wire this to your Spring environment/profile
    }
}