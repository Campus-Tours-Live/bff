package com.campustourslive.bff.client;

import com.campustourslive.bff.config.CoreProperties;
import com.campustourslive.bff.dto.CoreWriteEnvelope;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.ResourceAccessException;
import java.util.function.Consumer;
@Component
public class CoreApiClient {
    private final RestClient client;
    private final ObjectMapper mapper;
    public CoreApiClient(RestClient.Builder builder, CoreProperties properties, ObjectMapper mapper) {
        this.client=builder.baseUrl(properties.baseUrl()).build();this.mapper=mapper;
    }
    public Bound withBearer(String bearer) {return new Bound(bearer);}
    public final class Bound {
        private final String bearer;
        private Bound(String bearer){this.bearer=bearer;}
        public <T> T get(String path, Class<T> type){return decode(send(HttpMethod.GET,path,null,null),type,true);}
        public <T> T getCurrentUser(Class<T> t){return get("/users/me",t);}
        public <T> T getRoleEligibility(String role,Class<T> t){return get("/users/me/role-eligibility?role="+java.net.URLEncoder.encode(role,java.nio.charset.StandardCharsets.UTF_8),t);}
        public <T> T getGuideProfile(Class<T> t){return get("/guide/profile",t);}
        public <T> T getOfferings(Class<T> t){return get("/guide/offerings",t);}
        public <T> T getParticipantProfile(Class<T> t){return get("/participant/profile",t);}
        public <T> T getNextTour(Class<T> t){return get("/bookings/next-tour",t);}
        public <T> T getUpcomingBookings(Class<T> t){return get("/bookings/upcoming",t);}
        public <T> T getPendingActions(Class<T> t){return get("/bookings/pending-actions",t);}
        public <T> T post(String path,Object body,WriteOptions opts,Class<T> t){return decode(send(HttpMethod.POST,path,body,opts),t,true);}
        public <T> T del(String path,WriteOptions opts,Class<T> t){return decode(send(HttpMethod.DELETE,path,null,opts),t,true);}
        public <T> T postFull(String path,Object body,WriteOptions opts,Class<T> t){return decode(send(HttpMethod.POST,path,body,opts),t,false);}
        public <T> T patchFull(String path,Object body,WriteOptions opts,Class<T> t){return decode(send(HttpMethod.PATCH,path,body,opts),t,false);}
        public <T> T delFull(String path,WriteOptions opts,Class<T> t){return decode(send(HttpMethod.DELETE,path,null,opts),t,false);}
        private String send(HttpMethod method,String path,Object body,WriteOptions opts){
            try {
                RestClient.RequestBodySpec spec=client.method(method).uri(path).headers(h -> {
                    h.setBearerAuth(bearer);h.setAccept(java.util.List.of(MediaType.APPLICATION_JSON));
                    if(opts!=null){if(opts.idempotencyKey()!=null)h.set("Idempotency-Key",opts.idempotencyKey());
                        if(opts.correlationId()!=null)h.set("X-Request-Id",opts.correlationId());}
                    if(body!=null)h.setContentType(MediaType.APPLICATION_JSON);
                });
                if(body!=null)spec.body(body);
                return spec.exchange((req,res) -> {
                    int status=res.getStatusCode().value();
                    String raw=new String(res.getBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
                    if(status==401)throw new CoreAuthException();
                    if(status<200 || status>=300)throw CoreApiException.fromResponse(status,raw,
                        res.getHeaders().getFirst(HttpHeaders.CONTENT_TYPE),mapper);
                    return raw;
                });
            } catch(CoreAuthException | CoreApiException e){throw e;}
              catch(Exception e){throw new CoreApiException(502);}
        }
        private <T> T decode(String raw,Class<T> type,boolean unwrap){
            try {
                if(raw==null || raw.isBlank())return null;
                JsonNode node=mapper.readTree(raw);
                if(unwrap && node!=null && node.isObject() && node.has("data"))node=node.get("data");
                return node==null || node.isNull()?null:mapper.treeToValue(node,type);
            }catch(Exception e){throw new IllegalStateException("Invalid Core response",e);}
        }
    }
}
