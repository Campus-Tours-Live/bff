package com.campustourslive.bff.availability;

import com.campustourslive.bff.client.CoreApiClient;
import com.campustourslive.bff.client.WriteOptions;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** Calls Core without duplicating Core's scheduling, DST, or authorization logic. */
@Service
public class AvailabilityService {
    private final ObjectMapper mapper;
    private final AvailabilityMapper transform;
    public AvailabilityService(ObjectMapper mapper, AvailabilityMapper transform) {
        this.mapper=mapper; this.transform=transform;
    }
    private String encode(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }
    public String query(String path, Map<String,String> parameters) {
        StringBuilder result=new StringBuilder(path); boolean first=true;
        for(var entry:parameters.entrySet()) {
            if(entry.getValue()==null)continue;
            result.append(first?'?':'&').append(encode(entry.getKey())).append('=').append(encode(entry.getValue()));
            first=false;
        }
        return result.toString();
    }
    public JsonNode get(CoreApiClient.Bound core,String path) { return core.get(path,JsonNode.class); }
    public JsonNode post(CoreApiClient.Bound core,String path,JsonNode body,WriteOptions opts) {
        return core.postFull(path,body,opts,JsonNode.class);
    }
    public JsonNode patch(CoreApiClient.Bound core,String path,JsonNode body,WriteOptions opts) {
        return core.patchFull(path,body,opts,JsonNode.class);
    }
    public JsonNode delete(CoreApiClient.Bound core,String path,WriteOptions opts) {
        return core.delFull(path,opts,JsonNode.class);
    }
    public JsonNode writeResult(JsonNode full, boolean settings) {
        ObjectNode out=mapper.createObjectNode();
        JsonNode data=full.get("data");
        out.set("data", settings ? transform.settings(data) : data);
        out.set("affectedBookings",transform.affectedBookings(full.get("affectedBookings")));
        return out;
    }
    public JsonNode settings(JsonNode data) {return transform.settings(data);}
    public JsonNode resolved(JsonNode data) {return transform.resolved(data);}
    public JsonNode preview(JsonNode data) {return transform.preview(data);}
    public JsonNode slots(JsonNode data) {return transform.occurrences(data);}
}
