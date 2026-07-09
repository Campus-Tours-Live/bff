/** The Core `BookingDetailResponse` shape (Contract B) the bff receives. */
export interface CoreBookingDetail {
  id: string;
  status: string;
  scheduledAt: string;
  timezone: string;
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
  displayTimeZone: string;
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
  const end = new Date(new Date(c.scheduledAt).getTime() + c.durationMin * 60_000).toISOString();
  return {
    id: c.id,
    status: c.status,
    scheduledStartAt: c.scheduledAt,
    scheduledEndAt: end,
    displayTimeZone: c.timezone,
    durationMinutes: c.durationMin,
    tourOfferingId: c.offeringId,
    tourTitle: c.offeringTitle,
    guideName: c.guideName,
    guideResponseDeadline: c.guideResponseDeadline,
    universityName: c.universityName,
    price: { amount: c.priceCents, currency: c.currency },
  };
}
