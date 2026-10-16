package com.campustourslive.bff.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
/** Connect to the encrypted-cookie session implementation from the other module. */
public interface SessionCookieStore {
    SessionData read(HttpServletRequest request);
    void write(HttpServletResponse response, SessionData session, Long maxAgeSeconds);
    void clear(HttpServletResponse response);
}
