package com.campustourslive.bff.mapper;

import com.campustourslive.bff.dto.BookingDtos.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
public final class BookingMapper {
    private BookingMapper() {}
    public static String toZ(String input) { return Instant.parse(input).truncatedTo(ChronoUnit.SECONDS).toString(); }
    public static BookingResponse reshapeBooking(CoreBookingDetail c) {
        Instant start = Instant.parse(c.scheduledAt());
        return new BookingResponse(c.id(), c.status(), toZ(c.scheduledAt()),
            start.plus(c.durationMin(), ChronoUnit.MINUTES).truncatedTo(ChronoUnit.SECONDS).toString(),
            c.durationMin(), c.offeringId(), c.offeringTitle(), c.guideName(),
            c.guideResponseDeadline(), c.universityName(), new Price(c.priceCents(), c.currency()));
    }
    public static Occurrence reshapeOccurrence(Occurrence c) { return new Occurrence(toZ(c.startAt()), toZ(c.endAt())); }
    public static Occurrence reshapeSlot(Occurrence c) { return reshapeOccurrence(c); }
    public static AffectedBooking reshapeAffectedBooking(AffectedBooking c) {
        return new AffectedBooking(c.bookingId(), c.bookingNumber(), c.status(),
            toZ(c.scheduledStartAt()), toZ(c.scheduledEndAt()));
    }
}
