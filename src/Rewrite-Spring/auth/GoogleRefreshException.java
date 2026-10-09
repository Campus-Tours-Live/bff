package com.campustourslive.bff.auth;

public class GoogleRefreshException extends RuntimeException {
    private final boolean fatal;
    public GoogleRefreshException(boolean fatal, String message) { super(message); this.fatal=fatal; }
    public boolean fatal() { return fatal; }
}
