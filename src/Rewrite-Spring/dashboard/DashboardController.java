package com.campustourslive.bff.dashboard;

import com.campustourslive.bff.web.AuthenticatedHandlers;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Equivalent to routes.ts + dashboard.handler.ts. */
@RestController
public class DashboardController {
    private final AuthenticatedHandlers authenticated;
    private final DashboardService dashboards;

    public DashboardController(AuthenticatedHandlers authenticated, DashboardService dashboards) {
        this.authenticated = authenticated;
        this.dashboards = dashboards;
    }

    @GetMapping("/v1/dashboard")
    public ResponseEntity<?> getDashboard(HttpServletRequest request, HttpServletResponse response) {
        return authenticated.withSession(request, response,
                core -> dashboards.getDashboard(request, response, core));
    }
}
