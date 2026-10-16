package com.campustourslive.bff.bookings;

import com.campustourslive.bff.web.AuthenticatedHandlers;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Java equivalent of routes.ts. Mutations use the shared mutation error policy. */
@RestController
@RequestMapping("/v1/bookings")
public class ParticipantBookingController {
    private final AuthenticatedHandlers authenticated;
    private final ParticipantBookingService bookings;

    public ParticipantBookingController(
            AuthenticatedHandlers authenticated, ParticipantBookingService bookings) {
        this.authenticated = authenticated;
        this.bookings = bookings;
    }

    @PostMapping
    public ResponseEntity<?> create(
            @RequestBody(required = false) Object body,
            HttpServletRequest request, HttpServletResponse response) {
        return authenticated.withMutation(request, response,
                core -> bookings.createBooking(request, response, core, body));
    }

    @PostMapping("/{id}/cancel")
    public ResponseEntity<?> cancel(
            @PathVariable String id,
            @RequestBody(required = false) Object body,
            HttpServletRequest request, HttpServletResponse response) {
        return authenticated.withMutation(request, response,
                core -> bookings.cancelBooking(request, response, core, id, body));
    }
}
