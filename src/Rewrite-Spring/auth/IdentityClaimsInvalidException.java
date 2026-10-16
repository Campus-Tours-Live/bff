package com.campustourslive.bff.auth;

public class IdentityClaimsInvalidException extends RuntimeException {
    public static final String CODE="IDENTITY_CLAIMS_INVALID";
    public IdentityClaimsInvalidException(String reason) { super("Pending identity claims invalid: " + reason); }
}
