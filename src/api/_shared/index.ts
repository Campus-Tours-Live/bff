/** Barrel for the shared building blocks behind the BFF's aggregation endpoints —
 *  auth resolution, the Core client, the success/error envelopes, and shared types. */
export { requireReauth, authUpstreamUnavailable } from "./reauth.js";
export { resolveBearer } from "./session.js";
export { CoreClient } from "./core-client.js";
export type { CoreWriteEnvelope } from "./core-client.js";
export { CoreAuthError, CoreError, TransientAuthError } from "./errors.js";
export { sendData, coreUnavailable, assertShapeInDev } from "./envelope.js";
export { withSession } from "./with-session.js";
export { withMutation } from "./with-mutation.js";
export type { Me, Json } from "./types.js";
export { PUBLISHABLE_STATUS } from "./constants.js";
export {
  toZ,
  reshapeBooking,
  reshapeOccurrence,
  reshapeSlot,
  reshapeAffectedBooking,
} from "./reshape.js";
export type {
  CoreBookingDetail,
  BookingResponse,
  CoreOccurrence,
  OccurrenceResponse,
  CoreSlot,
  SlotResponse,
  CoreAffectedBooking,
  AffectedBookingResponse,
} from "./reshape.js";
export { writeOpts } from "./write-opts.js";
