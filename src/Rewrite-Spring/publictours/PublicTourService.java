package com.campustourslive.bff.publictours;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/** Public discovery only: never forwards incoming cookies or authorization headers. */
@Service
public class PublicTourService {
    private final HttpClient httpClient;
    private final String coreApiBaseUrl;

    public PublicTourService(@Value("${core.api-base-url}") String coreApiBaseUrl) {
        this.coreApiBaseUrl = coreApiBaseUrl.replaceAll("/+$", "");
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    public ResponseEntity<?> catalog(HttpServletRequest request, String requestId) {
        return relay(request, "/tours", requestId);
    }

    public ResponseEntity<?> detail(HttpServletRequest request, String tourId, String requestId) {
        return relay(request, "/tours/" + encodePathSegment(tourId), requestId);
    }

    private ResponseEntity<?> relay(HttpServletRequest request, String corePath, String requestId) {
        String query = request.getQueryString();
        String suffix = (query == null || query.isEmpty()) ? "" : "?" + query;
        String id = (requestId == null || requestId.isBlank()) ? UUID.randomUUID().toString() : requestId;
        try {
            HttpRequest upstreamRequest = HttpRequest.newBuilder()
                    .uri(URI.create(coreApiBaseUrl + corePath + suffix))
                    .timeout(Duration.ofSeconds(30))
                    .header(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                    .header("X-Request-Id", id)
                    .GET()
                    .build();
            HttpResponse<byte[]> upstream = httpClient.send(upstreamRequest, HttpResponse.BodyHandlers.ofByteArray());
            ResponseEntity.BodyBuilder response = ResponseEntity.status(upstream.statusCode());
            upstream.headers().firstValue(HttpHeaders.CONTENT_TYPE)
                    .ifPresent(value -> response.header(HttpHeaders.CONTENT_TYPE, value));
            return response.body(upstream.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return unavailable();
        } catch (Exception e) {
            return unavailable();
        }
    }

    private static ResponseEntity<?> unavailable() {
        return ResponseEntity.status(502)
                .contentType(MediaType.valueOf("application/problem+json"))
                .body(Map.of(
                        "type", "about:blank",
                        "title", "Upstream service unavailable",
                        "status", 502,
                        "code", "CORE_UNAVAILABLE"));
    }

    /** Percent-encode a single URL path segment, including '/' and '%' characters. */
    private static String encodePathSegment(String value) {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        StringBuilder result = new StringBuilder();
        final char[] hex = "0123456789ABCDEF".toCharArray();
        for (byte b : bytes) {
            int c = b & 0xff;
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' ||
                    c == '!' || c == '$' || c == '&' || c == '\'' || c == '(' || c == ')' ||
                    c == '*' || c == '+' || c == ',' || c == ';' || c == '=' || c == ':' || c == '@') {
                result.append((char) c);
            } else {
                result.append('%').append(hex[c >>> 4]).append(hex[c & 15]);
            }
        }
        return result.toString();
    }
}
