package com.campustourslive.bff.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Service;
import java.time.Clock;
import java.util.concurrent.*;
@Service
public class TokenService {
    private static final long REFRESH_WINDOW_MS=5*60_000L;
    private final SessionCookieStore cookies;
    private final GoogleRefreshClient google;
    private final Clock clock;
    private final ConcurrentHashMap<String,CompletableFuture<TokenResult>> inFlight=new ConcurrentHashMap<>();
    public TokenService(SessionCookieStore cookies, GoogleRefreshClient google, Clock clock) {
        this.cookies=cookies;this.google=google;this.clock=clock;
    }
    public String resolveBearer(HttpServletRequest req,HttpServletResponse res) {
        SessionData session=cookies.read(req);
        if(session==null)return null;
        long now=clock.millis();
        if(session.provisioningStatus()==SessionData.ProvisioningStatus.PENDING &&
            session.pendingExpiresAt()!=null && now>=session.pendingExpiresAt()) throw new PendingSessionExpiredException();
        if(session.idToken()==null || session.idToken().isBlank())return null;
        if(session.expiresAt()==null || session.expiresAt()-now>=REFRESH_WINDOW_MS ||
           session.refreshToken()==null || session.refreshToken().isBlank())return session.idToken();
        try {
            CompletableFuture<TokenResult> flight=inFlight.computeIfAbsent(session.refreshToken(), key -> {
                CompletableFuture<TokenResult> future=CompletableFuture.supplyAsync(() -> google.refresh(key));
                future.whenComplete((v,e) -> inFlight.remove(key,future));
                return future;
            });
            TokenResult tokens=flight.join();
            SessionData updated=session.refreshed(tokens,clock.millis());
            Long maxAge=session.provisioningStatus()==SessionData.ProvisioningStatus.PENDING
                ? Math.max(0L,(session.pendingExpiresAt()-clock.millis()+999)/1000):null;
            cookies.write(res,updated,maxAge);
            return updated.idToken();
        } catch(CompletionException e) {
            Throwable cause=e.getCause();
            if(cause instanceof GoogleRefreshException ge && ge.fatal())return null;
            throw new TransientAuthException(cause);
        }
    }
}
