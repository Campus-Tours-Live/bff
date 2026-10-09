package com.campustourslive.bff.web;

import com.campustourslive.bff.auth.SessionCookieStore;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import java.util.LinkedHashMap;
import java.util.Map;
@Component
public class ProblemResponses {
    private final SessionCookieStore cookies;
    public ProblemResponses(SessionCookieStore cookies){this.cookies=cookies;}
    public ResponseEntity<Map<String,Object>> problem(int status,String title,String code){
        Map<String,Object> body=new LinkedHashMap<>();body.put("title",title);body.put("status",status);body.put("code",code);
        return ResponseEntity.status(status).contentType(MediaType.valueOf("application/problem+json")).body(body);
    }
    public ResponseEntity<?> requireReauth(HttpServletResponse response){
        cookies.clear(response);response.setHeader("Auth-Required","reauthenticate");
        response.setHeader("Cache-Control","private, no-store");
        return problem(401,"Authentication required","SESSION_EXPIRED");
    }
    public ResponseEntity<?> authUpstreamUnavailable(HttpServletResponse response){
        response.setHeader("Retry-After","5");response.setHeader("Cache-Control","private, no-store");
        return problem(503,"Sign-in service temporarily unavailable","AUTH_UPSTREAM_UNAVAILABLE");
    }
    public ResponseEntity<?> coreUnavailable(){return problem(502,"Upstream service unavailable","CORE_UNAVAILABLE");}
}
