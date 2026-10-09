package com.campustourslive.bff.web;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import java.util.function.Predicate;
@Component
public class EnvelopeService {
    private final Environment environment;
    public EnvelopeService(Environment environment){this.environment=environment;}
    public <T> ApiResponse<T> sendData(T data,String requestId,Predicate<T> shapeValidator){
        if(shapeValidator!=null && !java.util.Arrays.asList(environment.getActiveProfiles()).contains("prod")
            && !shapeValidator.test(data)){
            System.err.println("[response-shape] payload does not match documented schema");
            if(java.util.Arrays.asList(environment.getActiveProfiles()).contains("test"))
                throw new IllegalStateException("Response shape mismatch");
        }
        return ApiResponse.of(data,requestId);
    }
}
