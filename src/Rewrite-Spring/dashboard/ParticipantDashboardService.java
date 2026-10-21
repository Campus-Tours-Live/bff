package com.campustourslive.bff.dashboard;

import com.campustourslive.bff.client.CoreApiClient;
import com.campustourslive.bff.dto.BookingDtos.BookingResponse;
import com.campustourslive.bff.dto.BookingDtos.CoreBookingDetail;
import com.campustourslive.bff.dto.Me;
import com.campustourslive.bff.mapper.BookingMapper;
import com.campustourslive.bff.web.ApiResponse;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

@Service
public class ParticipantDashboardService {
    public ResponseEntity<?> getDashboard(HttpServletResponse response, CoreApiClient.Bound core, Me me) {
        // Profile is required; next tour, upcoming bookings, and pending actions are best effort.
        CompletableFuture<Map> profileFuture = CompletableFuture.supplyAsync(() -> core.getParticipantProfile(Map.class));
        CompletableFuture<CoreBookingDetail> nextFuture = CompletableFuture
                .supplyAsync(() -> core.getNextTour(CoreBookingDetail.class)).exceptionally(error -> null);
        CompletableFuture<CoreBookingDetail[]> upcomingFuture = CompletableFuture
                .supplyAsync(() -> core.getUpcomingBookings(CoreBookingDetail[].class)).exceptionally(error -> null);
        CompletableFuture<Map> pendingFuture = CompletableFuture
                .supplyAsync(() -> core.getPendingActions(Map.class)).exceptionally(error -> null);
        Map<?, ?> profile;
        try { profile = profileFuture.join(); }
        catch (CompletionException e) { throw propagate(e); }
        CoreBookingDetail next = nextFuture.join();
        CoreBookingDetail[] upcoming = upcomingFuture.join();
        List<BookingResponse> bookings = upcoming == null ? List.of() :
                Arrays.stream(upcoming).map(BookingMapper::reshapeBooking).toList();
        ParticipantDashboardData data = new ParticipantDashboardData("participant", profile,
                next == null ? null : BookingMapper.reshapeBooking(next), bookings,
                pendingFuture.join(), me.user().createdAt());
        return ResponseEntity.ok(ApiResponse.of(data, GuideDashboardService.requestId(response)));
    }

    private static RuntimeException propagate(CompletionException e) {
        Throwable cause = e.getCause();
        return cause instanceof RuntimeException re ? re : new IllegalStateException(cause);
    }

    public record ParticipantDashboardData(String kind, Map<?, ?> participant,
                                           BookingResponse nextTour, List<BookingResponse> upcomingBookings,
                                           Map<?, ?> pendingActions, String createdAt) {}
}
