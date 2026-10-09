package com.campustourslive.bff.availability;

import java.util.List;

/** Core wire DTOs. Local times and dates are intentionally strings. */
public final class AvailabilityDtos {
    private AvailabilityDtos() {}
    public record Rule(String id, int dayOfWeek, String startLocal, int windowMin,
                       String timezone, String effectiveFrom, String effectiveTo, boolean active) {}
    public record ExceptionEntry(String id, String exceptionDate, String kind,
                                 String startLocal, int windowMin, String reason) {}
    public record Settings(String guideId, String acceptanceMode, int responseDeadlineMin,
                           int minNoticeMin, int maxAdvanceDays, int bufferBeforeMin,
                           int bufferAfterMin, List<Integer> durationsOffered,
                           String timezone, String updatedAt) {}
    public record Occurrence(String startAt, String endAt) {}
    public record Resolved(List<Rule> rules, List<Occurrence> occurrences,
                           List<String> dstGapDays, boolean bookable, boolean hasWeeklyHours) {}
    public record Trimmed(String kind, String startLocal, int windowMin) {}
    public record PreviewDay(String date, List<Occurrence> resultingWindows,
                             List<Trimmed> trimmed, boolean inert) {}
    public record Preview(List<PreviewDay> days, boolean valid, String message) {}
    public record AffectedBooking(String bookingId, String bookingNumber, String status,
                                  String scheduledStartAt, String scheduledEndAt) {}
}
