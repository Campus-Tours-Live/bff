package com.campustourslive.bff.client;

public class CoreAuthException extends RuntimeException {
    public CoreAuthException() { super("Core authentication required"); }
}
