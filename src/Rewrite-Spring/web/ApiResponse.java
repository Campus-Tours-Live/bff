package com.campustourslive.bff.web;

public record ApiResponse<T>(T data, Meta meta) {
    public record Meta(String requestId) {}
    public static <T> ApiResponse<T> of(T data,String requestId) {return new ApiResponse<>(data,new Meta(requestId));}
}
