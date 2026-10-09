package com.campustourslive.bff.dto;

import java.util.List;
public record Userinfo(Me.User user, List<String> roles, Role currentRole) {}
