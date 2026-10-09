package com.campustourslive.bff.dto;

import java.util.List;
public record Me(User user, List<String> roles) {
    public record User(String id, String firstName, String lastName, String displayName,
                       String email, String accountStatus, String ageBand, String createdAt) {}
}
