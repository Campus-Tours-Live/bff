package com.campustourslive.bff.client;

public record WriteOptions(String idempotencyKey, String correlationId) {}
