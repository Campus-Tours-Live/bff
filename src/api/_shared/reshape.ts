/** Normalise a timestamp (epoch ms or an ISO-8601 string, any offset) to the canonical UTC
 *  `Z` form with no millis (e.g. `2026-08-01T15:00:00Z`), so every instant-bearing field the
 *  bff returns uses the same notation regardless of how Core serialises it (offset vs `Z`,
 *  millis vs none). Shared by every reshaper below (CTL-49). */
export function toZ(input: string | number): string {
  return new Date(input).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The Core `BookingDetailResponse` shape (Contract B) the bff receives. */
export interface CoreBookingDetail {
  id: string;
  status: string;
  scheduledAt: string;
  offeringId: string;
  offeringTitle: string;
  guideName: string;
  guideResponseDeadline: string | null;
  universityName: string;
  durationMin: number;
  priceCents: number;
  currency: string;
}

/** Contract-A booking shape the bff returns to the browser. */
export interface BookingResponse {
  id: string;
  status: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  durationMinutes: number;
  tourOfferingId: string;
  tourTitle: string;
  guideName: string;
  guideResponseDeadline: string | null;
  universityName: string;
  price: { amount: number; currency: string };
}

/** Reshape one Core booking into Contract A (renames + computed end + money object). */
export function reshapeBooking(c: CoreBookingDetail): BookingResponse {
  // Normalise BOTH times to the same canonical form (UTC, no millis) so start and end never
  // diverge in notation regardless of how Core serialises `scheduledAt` (offset vs Z, millis).
  const startMs = new Date(c.scheduledAt).getTime();
  return {
    id: c.id,
    status: c.status,
    scheduledStartAt: toZ(startMs),
    scheduledEndAt: toZ(startMs + c.durationMin * 60_000),
    durationMinutes: c.durationMin,
    tourOfferingId: c.offeringId,
    tourTitle: c.offeringTitle,
    guideName: c.guideName,
    guideResponseDeadline: c.guideResponseDeadline,
    universityName: c.universityName,
    price: { amount: c.priceCents, currency: c.currency },
  };
}

/** The Core `ResolvedOccurrence` / `SlotResponse` shape (Contract B): an absolute UTC instant
 *  interval. Core's DTOs for occurrences and slots are structurally identical (both just
 *  `{ startAt, endAt }` `Instant`s), so the bff shares one Core-side type and one reshaper for
 *  both (see `reshapeSlot` below). */
export interface CoreOccurrence {
  startAt: string;
  endAt: string;
}

/** Contract-A occurrence/slot shape the bff returns to the browser: both instants normalized
 *  to canonical UTC `Z` (CTL-49) so the frontend renders them viewer-local. */
export interface OccurrenceResponse {
  startAt: string;
  endAt: string;
}

/** Reshape one Core occurrence into Contract A (normalize both instants to UTC `Z`). Used by
 *  the resolved-availability read (`GET /v1/availability`). */
export function reshapeOccurrence(c: CoreOccurrence): OccurrenceResponse {
  return { startAt: toZ(c.startAt), endAt: toZ(c.endAt) };
}

/** The Core `SlotResponse` shape (Contract B) — identical `{ startAt, endAt }` shape to
 *  `CoreOccurrence` (see comment above), aliased rather than redeclared. */
export type CoreSlot = CoreOccurrence;

/** Contract-A slot shape the bff returns to the browser — identical to `OccurrenceResponse`. */
export type SlotResponse = OccurrenceResponse;

/** Reshape one Core slot into Contract A. Occurrences and slots share the same
 *  `{ startAt, endAt }` shape at both Core and Contract-A, so this reuses `reshapeOccurrence`
 *  under a name the participant-slots route (Task 4) imports directly. */
export const reshapeSlot: (c: CoreSlot) => SlotResponse = reshapeOccurrence;

/** The Core `AffectedBookingResponse` shape (Contract B) carried in
 *  `AvailabilityWriteResponse.affectedBookings` — bookings whose schedule shifted or were
 *  cancelled as a side effect of an availability rule/exception/settings write. */
export interface CoreAffectedBooking {
  bookingId: string;
  bookingNumber: string;
  status: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
}

/** Contract-A affected-booking shape the bff returns in an availability write's
 *  `affectedBookings` warning list: both scheduled instants normalized to UTC `Z` (CTL-49);
 *  `bookingId`/`bookingNumber`/`status` pass through unchanged. */
export interface AffectedBookingResponse {
  bookingId: string;
  bookingNumber: string;
  status: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
}

/** Reshape one Core affected-booking into Contract A (normalize both scheduled instants to
 *  UTC `Z`; pass the rest through). Used by the availability write routes (Task 2). */
export function reshapeAffectedBooking(c: CoreAffectedBooking): AffectedBookingResponse {
  return {
    bookingId: c.bookingId,
    bookingNumber: c.bookingNumber,
    status: c.status,
    scheduledStartAt: toZ(c.scheduledStartAt),
    scheduledEndAt: toZ(c.scheduledEndAt),
  };
}
