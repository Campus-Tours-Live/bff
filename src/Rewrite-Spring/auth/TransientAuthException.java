package com.campustourslive.bff.auth;

public class TransientAuthException extends RuntimeException {
    public TransientAuthException(Throwable cause) { super("Token refresh temporarily unavailable", cause); }
}
