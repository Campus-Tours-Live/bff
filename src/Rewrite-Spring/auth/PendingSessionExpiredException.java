package com.campustourslive.bff.auth;

public class PendingSessionExpiredException extends RuntimeException {
    public static final String CODE="SESSION_EXPIRED";
    public PendingSessionExpiredException() { super("Pending session expired"); }
}
