package com.campustourslive.bff.userinfo;

import com.campustourslive.bff.userinfo.UserinfoContracts.CoreGateway;
import com.campustourslive.bff.userinfo.UserinfoContracts.SessionGateway;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class UserinfoConfiguration {
    @Bean public PendingIdentity pendingIdentity(ObjectMapper mapper) { return new PendingIdentity(mapper); }
    @Bean public UserinfoService userinfoService(CoreGateway core, SessionGateway sessions, PendingIdentity pending) {
        return new UserinfoService(core, sessions, pending);
    }
}
