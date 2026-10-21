package com.campustourslive.bff.userinfo;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
public class UserinfoController {
    private final UserinfoService service;
    public UserinfoController(UserinfoService service) { this.service = service; }

    @GetMapping("/userinfo")
    public ResponseEntity<Map<String, Object>> getUserinfo(HttpServletRequest request, HttpServletResponse response) {
        Map<String, Object> data = service.getUserinfo(request, response);
        Map<String, Object> meta = new LinkedHashMap<>();
        Object requestId = response.getHeader("X-Request-Id");
        if (requestId != null) meta.put("requestId", requestId);
        return ResponseEntity.ok(Map.of("data", data, "meta", meta));
    }
}
