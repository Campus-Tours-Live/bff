//coreProxy.ts
package com.campustourslive.bff.proxy;

import com.campustourslive.bff.config.AppProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;

import java.util.Set;

@RestController
@RequestMapping("/v1")
public class CoreProxyController {

    private static final Set<String> CACHEABLE_META = Set.of(
            "/meta/tour-topics",
            "/meta/tour-features"
    );

    private final AppProperties properties;
    private final RestClient restClient;

    public CoreProxyController(
            AppProperties properties,
            RestClient.Builder builder
    ) {
        this.properties = properties;

        this.restClient = builder
                .baseUrl(properties.coreApiBaseUrl())
                .build();
    }

    @RequestMapping("/**")
    public ResponseEntity<String> proxy(
            HttpServletRequest request,
            @RequestBody(required = false) String body
    ) {

        String path = getCorePath(request);

        if (containsTraversal(request)) {
            return problem(
                    400,
                    "Invalid request path",
                    "BAD_PATH"
            );
        }

        boolean publicRead = isPublicRead(
                request.getMethod(),
                path
        );

        String bearer = null;

        if (!publicRead) {
            bearer = resolveBearer(request);

            if (bearer == null) {
                return problem(
                        401,
                        "Authentication required",
                        "REAUTH_REQUIRED"
                );
            }
        }

        HttpHeaders headers = new HttpHeaders();

        headers.setAccept(
                java.util.List.of(MediaType.APPLICATION_JSON)
        );

        String requestId =
                request.getHeader("X-Request-Id");

        if (requestId != null) {
            headers.set("X-Request-Id", requestId);
        }

        if (bearer != null) {
            headers.setBearerAuth(bearer);
        }

        if (isMutation(request.getMethod())) {
            headers.setContentType(MediaType.APPLICATION_JSON);

            String idempotencyKey =
                    request.getHeader("Idempotency-Key");

            if (idempotencyKey != null) {
                headers.set(
                        "Idempotency-Key",
                        idempotencyKey
                );
            }
        }

        try {
            ResponseEntity<String> upstream =
                    restClient
                            .method(HttpMethod.valueOf(request.getMethod()))
                            .uri(buildTarget(request, path))
                            .headers(h -> h.addAll(headers))
                            .body(body == null ? "" : body)
                            .retrieve()
                            .toEntity(String.class);

            if (upstream.getStatusCode().value() == 401) {
                return problem(
                        401,
                        "Authentication required",
                        "REAUTH_REQUIRED"
                );
            }

            return buildResponse(
                    request,
                    path,
                    upstream
            );

        } catch (Exception e) {
            return problem(
                    502,
                    "Upstream service unavailable",
                    "CORE_UNAVAILABLE"
            );
        }
    }

    private boolean isPublicRead(
            String method,
            String path
    ) {
        if (!method.equals("GET") && !method.equals("HEAD")) {
            return false;
        }

        return path.equals("/tours")
                || path.startsWith("/tours/")
                || path.startsWith("/meta/")
                || path.equals("/universities")
                || path.startsWith("/universities/");
    }

    private boolean isMutation(String method) {
        return !method.equals("GET")
                && !method.equals("HEAD");
    }

    private String getCorePath(HttpServletRequest request) {
        return request.getRequestURI()
                .replaceFirst("^/v1", "");
    }

    private boolean containsTraversal(
            HttpServletRequest request
    ) {
        String uri = request.getRequestURI();

        for (String segment : uri.split("/")) {
            if (segment.equals("..")) {
                return true;
            }
        }

        return false;
    }

    private String buildTarget(
            HttpServletRequest request,
            String path
    ) {
        String query = request.getQueryString();

        return query == null
                ? path
                : path + "?" + query;
    }

    private String resolveBearer(
            HttpServletRequest request
    ) {
        // Implement using the Java SessionService
        // and Google token refresh service.
        return null;
    }

    private ResponseEntity<String> buildResponse(
            HttpServletRequest request,
            String path,
            ResponseEntity<String> upstream
    ) {
        HttpHeaders headers = new HttpHeaders();

        MediaType contentType =
                upstream.getHeaders().getContentType();

        if (contentType != null) {
            headers.setContentType(contentType);
        }

        if (upstream.getStatusCode().is2xxSuccessful()
                && CACHEABLE_META.contains(path)
                && request.getQueryString() == null) {

            headers.setCacheControl(
                    CacheControl.maxAge(
                            java.time.Duration.ofMinutes(5)
                    ).cachePublic()
            );
        }

        return new ResponseEntity<>(
                upstream.getBody(),
                headers,
                upstream.getStatusCode()
        );
    }

    private ResponseEntity<String> problem(
            int status,
            String title,
            String code
    ) {
        String json =
                """
                {
                  "title": "%s",
                  "code": "%s"
                }
                """.formatted(title, code);

        return ResponseEntity
                .status(status)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(json);
    }
}