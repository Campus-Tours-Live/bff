package com.campustourslive.bff.onboarding;

import com.campustourslive.bff.web.AuthenticatedHandlers;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Java port of routes.ts: deliberately two concrete routes, not /{role}. */
@RestController
@RequestMapping("/v1/users/me/roles")
public class OnboardingCommandController {
    private final AuthenticatedHandlers authenticated;
    private final OnboardingCommandService onboarding;

    public OnboardingCommandController(AuthenticatedHandlers authenticated,
            OnboardingCommandService onboarding) {
        this.authenticated = authenticated;
        this.onboarding = onboarding;
    }

    @PostMapping("/guide")
    public ResponseEntity<?> guide(@RequestBody(required = false) Object body,
            HttpServletRequest request, HttpServletResponse response) {
        return authenticated.withMutation(request, response,
                core -> onboarding.onboard("guide", request, response, core, body));
    }

    @PostMapping("/participant")
    public ResponseEntity<?> participant(@RequestBody(required = false) Object body,
            HttpServletRequest request, HttpServletResponse response) {
        return authenticated.withMutation(request, response,
                core -> onboarding.onboard("participant", request, response, core, body));
    }
}
