package com.campustourslive.bff.availability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import java.time.Instant;
import java.time.format.DateTimeFormatter;

/** Only absolute instants are normalized; local wall-clock fields remain unchanged. */
@Component
public class AvailabilityMapper {
    private final ObjectMapper mapper;
    public AvailabilityMapper(ObjectMapper mapper) { this.mapper = mapper; }
    private String toZ(String input) {
        return DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss'Z'")
            .withZone(java.time.ZoneOffset.UTC).format(Instant.parse(input));
    }
    private void instant(ObjectNode node, String key) {
        if (node.hasNonNull(key)) node.put(key, toZ(node.get(key).asText()));
    }
    public JsonNode settings(JsonNode raw) {
        ObjectNode copy = raw.deepCopy(); instant(copy, "updatedAt"); return copy;
    }
    public JsonNode occurrence(JsonNode raw) {
        ObjectNode copy = raw.deepCopy(); instant(copy, "startAt"); instant(copy, "endAt"); return copy;
    }
    public JsonNode occurrences(JsonNode raw) {
        ArrayNode out = mapper.createArrayNode();
        raw.forEach(item -> out.add(occurrence(item)));
        return out;
    }
    public JsonNode affectedBookings(JsonNode raw) {
        ArrayNode out = mapper.createArrayNode();
        raw.forEach(item -> {
            ObjectNode copy = item.deepCopy();
            instant(copy, "scheduledStartAt"); instant(copy, "scheduledEndAt"); out.add(copy);
        });
        return out;
    }
    public JsonNode resolved(JsonNode raw) {
        ObjectNode copy = raw.deepCopy();
        copy.set("occurrences", occurrences(raw.get("occurrences")));
        return copy;
    }
    public JsonNode preview(JsonNode raw) {
        ObjectNode copy = raw.deepCopy();
        ArrayNode days = mapper.createArrayNode();
        raw.get("days").forEach(day -> {
            ObjectNode d = day.deepCopy();
            d.set("resultingWindows", occurrences(day.get("resultingWindows")));
            days.add(d);
        });
        copy.set("days", days); return copy;
    }
}
