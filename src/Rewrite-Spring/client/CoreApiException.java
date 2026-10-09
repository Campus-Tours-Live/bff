package com.campustourslive.bff.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.LinkedHashMap;
public class CoreApiException extends RuntimeException {
    private final int status;
    private final String body, contentType, code, title, detail;
    private final Map<String,Object> properties;
    public CoreApiException(int status) { this(status, null, null, null, null, null, Map.of()); }
    private CoreApiException(int status, String body, String contentType, String code,
                             String title, String detail, Map<String,Object> properties) {
        super("Core error " + status); this.status=status; this.body=body;
        this.contentType=contentType; this.code=code; this.title=title; this.detail=detail;
        this.properties=properties;
    }
    public static CoreApiException fromResponse(int status, String body, String contentType, ObjectMapper mapper) {
        String code=null,title=null,detail=null; Map<String,Object> extras=new LinkedHashMap<>();
        if (body!=null && contentType!=null && contentType.toLowerCase().contains("json")) {
            try {
                JsonNode node=mapper.readTree(body);
                if (node!=null && node.isObject()) {
                    code=text(node,"code"); title=text(node,"title"); detail=text(node,"detail");
                    node.properties().forEach(e -> {
                        if (!java.util.Set.of("code","title","detail","status","type").contains(e.getKey()))
                            extras.put(e.getKey(),mapper.convertValue(e.getValue(),Object.class));
                    });
                }
            } catch(Exception ignored) { /* Non-JSON errors have no structured fields. */ }
        }
        return new CoreApiException(status,body,contentType,code,title,detail,extras);
    }
    private static String text(JsonNode n,String key) { JsonNode v=n.get(key);return v!=null && v.isTextual()?v.asText():null; }
    public int status(){return status;} public String body(){return body;}
    public String contentType(){return contentType;} public String code(){return code;}
    public String title(){return title;} public String detail(){return detail;}
    public Map<String,Object> properties(){return properties;}
}
