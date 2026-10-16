package com.campustourslive.bff.dto;

public final class BookingDtos {
    private BookingDtos() {}
    public record CoreBookingDetail(String id, String status, String scheduledAt,
          String offeringId, String offeringTitle, String guideName, String guideResponseDeadline,
          String universityName, int durationMin, long priceCents, String currency) {}
    public record Price(long amount, String currency) {}
    public record BookingResponse(String id, String status, String scheduledStartAt,
          String scheduledEndAt, int durationMinutes, String tourOfferingId, String tourTitle,
          String guideName, String guideResponseDeadline, String universityName, Price price) {}
    public record Occurrence(String startAt, String endAt) {}
    public record AffectedBooking(String bookingId, String bookingNumber, String status,
          String scheduledStartAt, String scheduledEndAt) {}
}
