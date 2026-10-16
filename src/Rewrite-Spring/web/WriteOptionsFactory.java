package com.campustourslive.bff.web;

import com.campustourslive.bff.client.WriteOptions;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
public final class WriteOptionsFactory {
    private WriteOptionsFactory() {}
    public static WriteOptions from(HttpServletRequest req,HttpServletResponse res){
        return new WriteOptions(req.getHeader("Idempotency-Key"),res.getHeader("X-Request-Id"));
    }
}
