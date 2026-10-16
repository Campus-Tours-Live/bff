package com.campustourslive.bff.web;

import com.campustourslive.bff.auth.*;
import com.campustourslive.bff.client.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import java.util.function.Function;
@Component
public class AuthenticatedHandlers {
    private final TokenService tokens;
    private final SessionCookieStore cookies;
    private final CoreApiClient core;
    private final ProblemResponses problems;
    public AuthenticatedHandlers(TokenService tokens,SessionCookieStore cookies,CoreApiClient core,ProblemResponses problems){
        this.tokens=tokens;this.cookies=cookies;this.core=core;this.problems=problems;
    }
    public ResponseEntity<?> withSession(HttpServletRequest req,HttpServletResponse res,
        Function<CoreApiClient.Bound,ResponseEntity<?>> handler){return execute(req,res,handler,false);}
    public ResponseEntity<?> withMutation(HttpServletRequest req,HttpServletResponse res,
        Function<CoreApiClient.Bound,ResponseEntity<?>> handler){return execute(req,res,handler,true);}
    private ResponseEntity<?> execute(HttpServletRequest req,HttpServletResponse res,
        Function<CoreApiClient.Bound,ResponseEntity<?>> handler,boolean mutation){
        String bearer;
        try {bearer=tokens.resolveBearer(req,res);}
        catch(TransientAuthException e){return problems.authUpstreamUnavailable(res);}
        catch(PendingSessionExpiredException e){cookies.clear(res);return problems.problem(401,"Session expired",PendingSessionExpiredException.CODE);}
        if(bearer==null)return problems.requireReauth(res);
        try {return handler.apply(core.withBearer(bearer));}
        catch(CoreAuthException e){return problems.requireReauth(res);}
        catch(CoreApiException e){
            if(!mutation){
                if(e.status()==403 && ("ACCOUNT_SUSPENDED".equals(e.code()) || "ACCOUNT_DELETED".equals(e.code()))){
                    cookies.clear(res);return problems.problem(403,"ACCOUNT_SUSPENDED".equals(e.code())?"Account suspended":"Account deleted",e.code());
                }
                if(e.status()==409 && "ACCOUNT_STATE_INVALID".equals(e.code())){
                    cookies.clear(res);return problems.problem(409,"Account state invalid",e.code());
                }
            }
            if(e.status()>=500)return problems.coreUnavailable();
            if(mutation){
                ResponseEntity.BodyBuilder builder=ResponseEntity.status(e.status());
                if(e.contentType()!=null)builder.header("Content-Type",e.contentType());
                return builder.body(e.body()==null?"":e.body());
            }
            return problems.problem(e.status(),"Upstream request failed","UPSTREAM_ERROR");
        }
        catch(Exception e){return problems.problem(500,"Internal server error","INTERNAL");}
    }
}
