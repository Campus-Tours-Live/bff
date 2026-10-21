package com.campustourslive.bff.userinfo;

import com.campustourslive.bff.userinfo.UserinfoContracts.*;
import com.campustourslive.bff.userinfo.UserinfoService.UnauthorizedException;
import jakarta.servlet.http.HttpServletResponse;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Scope to UserinfoController so existing global BFF error handling is unaffected. */
@RestControllerAdvice(assignableTypes = UserinfoController.class)
public class UserinfoExceptionHandler {
    private final SessionGateway sessions;
    public UserinfoExceptionHandler(SessionGateway sessions) { this.sessions = sessions; }

    @ExceptionHandler(UpstreamContractViolationException.class)
    public ResponseEntity<?> invalidCore() { return problem(502, "Upstream contract violation", "UPSTREAM_CONTRACT_VIOLATION"); }

    @ExceptionHandler(SessionConversionException.class)
    public ResponseEntity<?> sessionWrite() { return problem(500, "Session conversion failed", "SESSION_CONVERSION_FAILED"); }

    @ExceptionHandler(IdentityClaimsInvalidException.class)
    public ResponseEntity<?> identityClaims() { return problem(500, "Invalid identity claims", "IDENTITY_CLAIMS_INVALID"); }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<?> unauthorized(HttpServletResponse response) {
        sessions.clear(response);
        response.setHeader("Auth-Required", "reauthenticate");
        response.setHeader("Cache-Control", "private, no-store");
        return problem(401, "Session expired", "SESSION_EXPIRED");
    }

    @ExceptionHandler(CoreFailure.class)
    public ResponseEntity<?> coreError(CoreFailure failure, HttpServletResponse response) {
        int status = failure.status();
        String code = failure.code();
        if (status == 401) {
            sessions.clear(response);
            response.setHeader("Auth-Required", "reauthenticate");
            response.setHeader("Cache-Control", "private, no-store");
            return problem(401, "Session expired", "SESSION_EXPIRED");
        }
        if ((status == 403 && ("ACCOUNT_SUSPENDED".equals(code) || "ACCOUNT_DELETED".equals(code))) ||
                (status == 409 && "ACCOUNT_STATE_INVALID".equals(code))) {
            sessions.clear(response);
            return problem(status, "Account unavailable", code);
        }
        if (status >= 500) return problem(502, "Upstream service unavailable", "CORE_UNAVAILABLE");
        return problem(status, "Upstream error", "UPSTREAM_ERROR");
    }

    private static ResponseEntity<Map<String, Object>> problem(int status, String title, String code) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", "about:blank"); body.put("title", title);
        body.put("status", status); body.put("code", code);
        return ResponseEntity.status(HttpStatusCode.valueOf(status))
                .contentType(MediaType.parseMediaType("application/problem+json")).body(body);
    }
}
