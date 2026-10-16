package com.campustourslive.bff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
@ConfigurationProperties(prefix = "app.core")
public record CoreProperties(String baseUrl) {}
