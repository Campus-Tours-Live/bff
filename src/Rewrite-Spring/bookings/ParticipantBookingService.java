package com.campustourslive.bff.bookings;

import com.campustourslive.bff.client.CoreApiClient;
import com.campustourslive.bff.dto.BookingDtos.BookingResponse;
import com.campustourslive.bff.dto.BookingDtos.CoreBookingDetail;
import com.campustourslive.bff.mapper.BookingMapper;
import com.campustourslive.bff.web.ApiResponse;
import com.campustourslive.bff.web.WriteOptionsFactory;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Java equivalent of participant.ts: forward the write and reshape Core's booking. */
@Service
public class ParticipantBookingService {

    public ResponseEntity<ApiResponse<BookingResponse>> createBooking(
            HttpServletRequest request, HttpServletResponse response,
            CoreApiClient.Bound core, Object body) {
        CoreBookingDetail raw = core.post("/bookings", body,
                WriteOptionsFactory.from(request, response), CoreBookingDetail.class);
        return sendBooking(raw, response);
    }

    public ResponseEntity<ApiResponse<BookingResponse>> cancelBooking(
            HttpServletRequest request, HttpServletResponse response,
            CoreApiClient.Bound core, String id, Object body) {
        // encodeURIComponent() equivalent for a path segment: URLEncoder encodes spaces
        // as '+', so replace them with '%20' for URI path-segment semantics.
        String encodedId = URLEncoder.encode(id, StandardCharsets.UTF_8)
                .replace("+", "%20");
        CoreBookingDetail raw = core.post("/bookings/" + encodedId + "/cancel", body,
                WriteOptionsFactory.from(request, response), CoreBookingDetail.class);
        return sendBooking(raw, response);
    }

    private ResponseEntity<ApiResponse<BookingResponse>> sendBooking(
            CoreBookingDetail raw, HttpServletResponse response) {
        BookingResponse booking = BookingMapper.reshapeBooking(raw);
        return ResponseEntity.ok(ApiResponse.of(booking, response.getHeader("X-Request-Id")));
    }
}
