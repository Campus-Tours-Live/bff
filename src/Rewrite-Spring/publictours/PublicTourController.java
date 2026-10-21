package com.campustourslive.bff.publictours;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Exactly two anonymous discovery routes; no availability, slots, or bookings. */
@RestController
@RequestMapping("/v1/tours")
public class PublicTourController {
    private final PublicTourService service;

    public PublicTourController(PublicTourService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<?> catalog(HttpServletRequest request,
            @RequestHeader(value = "X-Request-Id", required = false) String requestId) {
        return service.catalog(request, requestId);
    }

    @GetMapping("/{tourId}")
    public ResponseEntity<?> detail(HttpServletRequest request,
            @PathVariable String tourId,
            @RequestHeader(value = "X-Request-Id", required = false) String requestId) {
        return service.detail(request, tourId, requestId);
    }
}
