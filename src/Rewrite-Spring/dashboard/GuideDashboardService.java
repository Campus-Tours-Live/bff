package com.campustourslive.bff.dashboard;

import com.campustourslive.bff.client.CoreApiClient;
import com.campustourslive.bff.config.BusinessConstants;
import com.campustourslive.bff.dto.Me;
import com.campustourslive.bff.web.ApiResponse;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

@Service
public class GuideDashboardService {
    public ResponseEntity<?> getDashboard(HttpServletResponse response, CoreApiClient.Bound core, Me me) {
        // Two Core reads run concurrently. Profile is required; offerings are best effort.
        CompletableFuture<Map> guideFuture = CompletableFuture.supplyAsync(() -> core.getGuideProfile(Map.class));
        CompletableFuture<List> offeringsFuture = CompletableFuture.supplyAsync(() -> core.getOfferings(List.class))
                .exceptionally(error -> List.of());
        Map<?, ?> guide;
        try { guide = guideFuture.join(); }
        catch (CompletionException e) { throw propagate(e); }
        List<?> offerings = offeringsFuture.join();
        Object rawStatus = guide == null ? null : guide.get("guideStatus");
        String guideStatus = rawStatus instanceof String value ? value : null;
        GuideDashboardData data = new GuideDashboardData("guide", guide, guideStatus,
                BusinessConstants.PUBLISHABLE_STATUS.equals(guideStatus), offerings, me.user().createdAt());
        return ResponseEntity.ok(ApiResponse.of(data, requestId(response)));
    }

    private static RuntimeException propagate(CompletionException e) {
        Throwable cause = e.getCause();
        return cause instanceof RuntimeException re ? re : new IllegalStateException(cause);
    }

    static String requestId(HttpServletResponse response) {
        return response.getHeader("X-Request-Id");
    }

    public record GuideDashboardData(String kind, Map<?, ?> guide, String guideStatus,
                                     boolean canPublish, List<?> offerings, String createdAt) {}
}
