package com.campustourslive.bff.availability;

import com.campustourslive.bff.client.CoreApiClient;
import com.campustourslive.bff.client.WriteOptions;
import com.campustourslive.bff.web.AuthenticatedHandlers;
import com.campustourslive.bff.web.WriteOptionsFactory;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;

/** The /v1 availability and participant-slot routes from routes.ts. */
@RestController
@RequestMapping("/v1")
public class AvailabilityController {
    private final AuthenticatedHandlers auth;
    private final AvailabilityService service;
    public AvailabilityController(AuthenticatedHandlers auth, AvailabilityService service) {
        this.auth=auth;this.service=service;
    }
    private String requestId(HttpServletResponse response) {return response.getHeader("X-Request-Id");}
    private ResponseEntity<?> read(HttpServletRequest req,HttpServletResponse res,Function<CoreApiClient.Bound,JsonNode> action) {
        return auth.withSession(req,res,core -> ResponseEntity.ok(Map.of("data",action.apply(core),"meta",Map.of("requestId",requestId(res)==null?"":requestId(res)))));
    }
    private ResponseEntity<?> preview(HttpServletRequest req,HttpServletResponse res,Function<CoreApiClient.Bound,JsonNode> action) {
        return auth.withMutation(req,res,core -> ResponseEntity.ok(Map.of("data",action.apply(core),"meta",Map.of("requestId",requestId(res)==null?"":requestId(res)))));
    }
    private ResponseEntity<?> write(HttpServletRequest req,HttpServletResponse res,Function<CoreApiClient.Bound,JsonNode> action) {
        return auth.withMutation(req,res,core -> {
            JsonNode result=action.apply(core);
            Map<String,Object> envelope=new LinkedHashMap<>();
            envelope.put("data",result.get("data"));
            envelope.put("affectedBookings",result.get("affectedBookings"));
            envelope.put("meta",Map.of("requestId",requestId(res)==null?"":requestId(res)));
            return ResponseEntity.ok(envelope);
        });
    }
    private WriteOptions opts(HttpServletRequest req,HttpServletResponse res) {return WriteOptionsFactory.from(req,res);}
    private Map<String,String> params(String... values) {
        Map<String,String> p=new LinkedHashMap<>();
        for(int i=0;i<values.length;i+=2)if(values[i+1]!=null)p.put(values[i],values[i+1]);
        return p;
    }
    @GetMapping("/availability")
    public ResponseEntity<?> getAvailability(HttpServletRequest req,HttpServletResponse res,
            @RequestParam(required=false) String from,@RequestParam(required=false) String to) {
        return read(req,res,c->service.resolved(service.get(c,service.query("/availability",params("from",from,"to",to)))));
    }
    @GetMapping("/availability/preview")
    public ResponseEntity<?> getPreview(HttpServletRequest req,HttpServletResponse res,
            @RequestParam(required=false) String dateFrom,@RequestParam(required=false) String dateTo,
            @RequestParam(required=false) String kind,@RequestParam(required=false) String startLocal,
            @RequestParam(required=false) String windowMin) {
        return preview(req,res,c->service.preview(service.get(c,service.query("/availability/preview",
            params("dateFrom",dateFrom,"dateTo",dateTo,"kind",kind,"startLocal",startLocal,"windowMin",windowMin)))));
    }
    /** Read-only POST preview; intentionally does not require mutation CSRF guard. */
    @PostMapping("/availability/preview")
    public ResponseEntity<?> multiPreview(HttpServletRequest req,HttpServletResponse res,@RequestBody JsonNode body) {
        return preview(req,res,c->service.preview(c.post("/availability/preview",body,opts(req,res),JsonNode.class)));
    }
    @GetMapping("/availability/rules")
    public ResponseEntity<?> getRules(HttpServletRequest req,HttpServletResponse res) {
        return read(req,res,c->service.get(c,"/availability/rules"));
    }
    @PostMapping("/availability/rules")
    public ResponseEntity<?> createRule(HttpServletRequest req,HttpServletResponse res,@RequestBody JsonNode body) {
        return write(req,res,c->service.writeResult(service.post(c,"/availability/rules",body,opts(req,res)),false));
    }
    @PatchMapping("/availability/rules/{id}")
    public ResponseEntity<?> updateRule(HttpServletRequest req,HttpServletResponse res,@PathVariable String id,@RequestBody JsonNode body) {
        return write(req,res,c->service.writeResult(service.patch(c,"/availability/rules/"+encodeId(id),body,opts(req,res)),false));
    }
    private String encodeId(String id) {return java.net.URLEncoder.encode(id,java.nio.charset.StandardCharsets.UTF_8);}
    @DeleteMapping("/availability/rules/{id}")
    public ResponseEntity<?> deleteRule(HttpServletRequest req,HttpServletResponse res,@PathVariable String id) {
        return write(req,res,c->service.writeResult(service.delete(c,"/availability/rules/"+encodeId(id),opts(req,res)),false));
    }
    @PostMapping("/availability/rules/replace")
    public ResponseEntity<?> replaceRules(HttpServletRequest req,HttpServletResponse res,@RequestBody JsonNode body) {
        return write(req,res,c->service.writeResult(service.post(c,"/availability/rules/replace",body,opts(req,res)),false));
    }
    @PostMapping("/availability/overrides/replace")
    public ResponseEntity<?> replaceOverrides(HttpServletRequest req,HttpServletResponse res,@RequestBody JsonNode body) {
        return write(req,res,c->service.writeResult(service.post(c,"/availability/overrides/replace",body,opts(req,res)),false));
    }
    @GetMapping("/availability/exceptions")
    public ResponseEntity<?> getExceptions(HttpServletRequest req,HttpServletResponse res) {
        return read(req,res,c->service.get(c,"/availability/exceptions"));
    }
    @PostMapping("/availability/exceptions")
    public ResponseEntity<?> createException(HttpServletRequest req,HttpServletResponse res,@RequestBody JsonNode body) {
        return write(req,res,c->service.writeResult(service.post(c,"/availability/exceptions",body,opts(req,res)),false));
    }
    @PatchMapping("/availability/exceptions/{id}")
    public ResponseEntity<?> updateException(HttpServletRequest req,HttpServletResponse res,@PathVariable String id,@RequestBody JsonNode body) {
        return write(req,res,c->service.writeResult(service.patch(c,"/availability/exceptions/"+encodeId(id),body,opts(req,res)),false));
    }
    @DeleteMapping("/availability/exceptions/{id}")
    public ResponseEntity<?> deleteException(HttpServletRequest req,HttpServletResponse res,@PathVariable String id) {
        return write(req,res,c->service.writeResult(service.delete(c,"/availability/exceptions/"+encodeId(id),opts(req,res)),false));
    }
    @GetMapping("/availability/settings")
    public ResponseEntity<?> getSettings(HttpServletRequest req,HttpServletResponse res) {
        return read(req,res,c->service.settings(service.get(c,"/availability/settings")));
    }
    @PatchMapping("/availability/settings")
    public ResponseEntity<?> updateSettings(HttpServletRequest req,HttpServletResponse res,@RequestBody JsonNode body) {
        return write(req,res,c->service.writeResult(service.patch(c,"/availability/settings",body,opts(req,res)),true));
    }
    @GetMapping("/offerings/{id}/slots")
    public ResponseEntity<?> getSlots(HttpServletRequest req,HttpServletResponse res,@PathVariable String id,
            @RequestParam(required=false) String from,@RequestParam(required=false) String to) {
        return read(req,res,c->service.slots(service.get(c,service.query("/offerings/"+encodeId(id)+"/slots",params("from",from,"to",to)))));
    }
}
