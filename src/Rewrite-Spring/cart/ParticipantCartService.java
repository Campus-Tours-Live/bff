package com.campustourslive.bff.cart;

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

import java.util.Arrays;
import java.util.List;

/** Java equivalent of the participant cart handlers. */
@Service
public class ParticipantCartService {

    public ResponseEntity<ApiResponse<List<BookingResponse>>> getCart(
            CoreApiClient.Bound core, HttpServletResponse response) {
        CoreBookingDetail[] raw = core.get("/cart", CoreBookingDetail[].class);
        return listResponse(raw, response);
    }

    public ResponseEntity<ApiResponse<BookingResponse>> addCartItem(
            CoreApiClient.Bound core, Object body,
            HttpServletRequest request, HttpServletResponse response) {
        CoreBookingDetail raw = core.post("/cart/items", body,
                WriteOptionsFactory.from(request, response), CoreBookingDetail.class);
        return ResponseEntity.ok(ApiResponse.of(
                BookingMapper.reshapeBooking(raw), response.getHeader("X-Request-Id")));
    }

    public ResponseEntity<ApiResponse<List<BookingResponse>>> removeCartItem(
            CoreApiClient.Bound core, String id,
            HttpServletRequest request, HttpServletResponse response) {
        // Match the original TypeScript: interpolate the id without an extra encoding step.
        CoreBookingDetail[] raw = core.del("/cart/items/" + id,
                WriteOptionsFactory.from(request, response), CoreBookingDetail[].class);
        return listResponse(raw, response);
    }

    public ResponseEntity<ApiResponse<List<BookingResponse>>> checkout(
            CoreApiClient.Bound core,
            HttpServletRequest request, HttpServletResponse response) {
        // The original checkout POST sends an empty JSON object, not an absent body.
        CoreBookingDetail[] raw = core.post("/cart/checkout", java.util.Map.of(),
                WriteOptionsFactory.from(request, response), CoreBookingDetail[].class);
        return listResponse(raw, response);
    }

    private ResponseEntity<ApiResponse<List<BookingResponse>>> listResponse(
            CoreBookingDetail[] raw, HttpServletResponse response) {
        List<BookingResponse> items = raw == null ? List.of() :
                Arrays.stream(raw).map(BookingMapper::reshapeBooking).toList();
        return ResponseEntity.ok(ApiResponse.of(items, response.getHeader("X-Request-Id")));
    }
}
