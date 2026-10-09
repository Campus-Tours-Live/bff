package com.campustourslive.bff.auth;

public interface GoogleRefreshClient {
    TokenResult refresh(String refreshToken) throws GoogleRefreshException;
}
