package com.campustourslive.bff.dashboard;

import com.campustourslive.bff.auth.SessionCookieStore;
import com.campustourslive.bff.auth.SessionData;
import com.campustourslive.bff.client.CoreApiClient;
import com.campustourslive.bff.dto.Me;
import com.campustourslive.bff.dto.Role;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

/** The active role is BFF session state, not part of Core /users/me. */
@Service
public class DashboardService {
    private final SessionCookieStore sessions;
    private final GuideDashboardService guides;
    private final ParticipantDashboardService participants;

    public DashboardService(SessionCookieStore sessions, GuideDashboardService guides,
                            ParticipantDashboardService participants) {
        this.sessions = sessions;
        this.guides = guides;
        this.participants = participants;
    }

    public ResponseEntity<?> getDashboard(HttpServletRequest request, HttpServletResponse response,
                                          CoreApiClient.Bound core) {
        Me me = core.getCurrentUser(Me.class); // Required: errors propagate to withSession.
        SessionData session = sessions.read(request);
        Role role = session != null && session.provisioningStatus() == SessionData.ProvisioningStatus.PROVISIONED
                ? session.currentRole() : null;
        return role == Role.GUIDE ? guides.getDashboard(response, core, me)
                : participants.getDashboard(response, core, me);
    }
}
