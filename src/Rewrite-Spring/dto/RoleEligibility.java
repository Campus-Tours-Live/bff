package com.campustourslive.bff.dto;

public record RoleEligibility(boolean eligible, Reason reason) {
    public enum Reason { PARENT_CANNOT_BECOME_GUIDE, ROLE_ALREADY_HELD }
}
