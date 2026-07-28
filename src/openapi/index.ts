/**
 * OpenAPI 3.1 spec for Contract A — the frontend-facing surface the BFF owns.
 *
 * Single source of truth: every request/response shape is a Zod schema (see ./schemas.ts),
 * so the SAME schemas drive the docs AND runtime validation (the
 * dev-only response-shape assertions in src/api/_shared/envelope.ts). We build the
 * document in code with @asteasolutions/zod-to-openapi, so it works identically from src/
 * (tsx/jest) and the compiled dist/ (no filesystem/source scanning like swagger-jsdoc).
 *
 * Every operation below is registered through the helper DSL (./helpers.ts:
 * apiRoute + enveloped + problemXXX), which BAKES IN the conventions (envelope, problem+json,
 * session security, required summary/description/tags). Do NOT call registry.registerPath
 * directly — go through apiRoute so a new endpoint can't drift from the house style.
 *
 * Scope: only the BFF-OWNED paths (the /auth/* lifecycle and the /v1 aggregation
 * composites). Everything else under /v1/* is a transparent proxy to the Core API and
 * is intentionally NOT re-documented here — see `externalDocs` for the Core spec.
 */
import { z } from "zod";
import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import {
  registry,
  coreApiBaseUrl,
  CoreRoleEnum,
  Dashboard,
  SessionStatus,
  Userinfo,
  CurrentRoleSchema,
  SetCurrentRoleRequestSchema,
  problem,
  guideDashboardExample,
  participantDashboardExample,
  userinfoExample,
  currentRoleExample,
  envelope,
  writeEnvelope,
  BookingResponseSchema,
  BookingListSchema,
  CreateBookingRequestSchema,
  CancelBookingRequestSchema,
  CreateAvailabilityRuleRequestSchema,
  UpdateAvailabilityRuleRequestSchema,
  AvailabilityRuleResponseSchema,
  CreateAvailabilityExceptionRequestSchema,
  UpdateAvailabilityExceptionRequestSchema,
  AvailabilityExceptionResponseSchema,
  UpdateAvailabilitySettingsRequestSchema,
  AvailabilitySettingsResponseSchema,
  AvailabilityOccurrenceSchema,
  ResolvedAvailabilityResponseSchema,
  ExceptionKindEnum,
  OverridePreviewResponseSchema,
  OverrideMultiPreviewRequestSchema,
  OverrideReplaceRequestSchema,
  RulesReplaceRequestSchema,
} from "./schemas.js";
import {
  apiRoute,
  enveloped,
  envelopedWrite,
  problem400,
  problem401,
  problem403,
  problem404,
  problem409,
  problem422,
  problem502,
  problemResponse,
} from "./helpers.js";

// Re-export the schema surface so consumers (handlers, tests) have one import site.
export * from "./schemas.js";

// --- Paths (all registered via the helper DSL) ---

// --- Public marketplace discovery ---
//
// These two reads intentionally relay Core's discovery envelope verbatim instead of reshaping it.
const CoreTourSummarySchema = z.object({
  id: z.string().uuid().openapi({ description: "Tour offering UUID." }),
  title: z.string().openapi({ description: "Public tour title." }),
  slug: z.string().openapi({ description: "URL-safe tour slug." }),
  topic: z.string().openapi({ description: "Controlled tour-topic code." }),
  universityId: z.string().uuid().openapi({ description: "University UUID." }),
  universityName: z.string().openapi({ description: "University display name." }),
  guideId: z.string().uuid().openapi({ description: "Guide profile UUID." }),
  guideDisplayName: z.string().openapi({ description: "Guide's public display name." }),
  durationMin: z.number().int().positive().openapi({ description: "Tour duration in minutes." }),
  priceCents: z.number().int().nonnegative().openapi({ description: "Price in minor units." }),
  currency: z.string().length(3).openapi({ description: "ISO 4217 currency code." }),
  avgRating: z.number().openapi({ description: "Average review rating." }),
  reviewCount: z.number().int().nonnegative().openapi({ description: "Number of reviews." }),
});

const CoreTourDetailSchema = CoreTourSummarySchema.extend({
  description: z.string().nullable().openapi({ description: "Public tour description." }),
  languages: z.array(z.string()).openapi({ description: "BCP-47 tour language tags." }),
  universitySlug: z.string().openapi({ description: "University URL-safe slug." }),
  universityCity: z.string().nullable().openapi({ description: "University city." }),
  universityRegion: z.string().nullable().openapi({ description: "University region or state." }),
  guideBio: z.string().nullable().openapi({ description: "Guide's public biography." }),
});

const CoreTourMetaSchema = z.object({
  requestId: z.string().openapi({ description: "Core response correlation id." }),
  timestamp: z.string().openapi({ description: "Core response timestamp in UTC." }),
});

function coreEnvelope<T extends z.ZodType>(data: T) {
  return z.object({
    data,
    meta: CoreTourMetaSchema,
  });
}

function coreEnvelopeExample<T>(data: T) {
  return {
    data,
    meta: {
      requestId: "4b9cb75a-2c07-4dd6-9f38-437d0c49f6f5",
      timestamp: "2026-07-18T21:00:00Z",
    },
  };
}

const tourSummaryExample = {
  id: "8cc1d6ed-dad7-45bc-b0f1-6e1c8b177ec3",
  title: "North Campus highlights",
  slug: "north-campus-highlights",
  topic: "GENERAL_CAMPUS",
  universityId: "4cc1d6ed-dad7-45bc-b0f1-6e1c8b177ec3",
  universityName: "North Coast University",
  guideId: "6cc1d6ed-dad7-45bc-b0f1-6e1c8b177ec3",
  guideDisplayName: "Maya Chen",
  durationMin: 60,
  priceCents: 4200,
  currency: "USD",
  avgRating: 4.8,
  reviewCount: 24,
};

const tourDetailExample = {
  ...tourSummaryExample,
  description: "A student-led walk through North Coast University's most popular landmarks.",
  languages: ["en-US"],
  universitySlug: "north-coast",
  universityCity: "Arcata",
  universityRegion: "CA",
  guideBio: "Computer science student and campus ambassador.",
};

// Public tour reads relay Core validation problems verbatim; unlike BFF-generated problems,
// these do not carry a BFF `code` or `requestId` field.
const invalidTourQueryExample = {
  type: "about:blank",
  title: "Invalid sort: NEWEST",
  status: 422,
};

const invalidTourIdExample = {
  type: "about:blank",
  title: "Validation failed",
  status: 422,
  detail: "Invalid value for 'tourId'",
};

const tourNotFoundExample = {
  type: "about:blank",
  title: "Tour not found",
  status: 404,
};

apiRoute({
  method: "get",
  path: "/v1/tours",
  protected: false,
  tags: ["Tours"],
  summary: "Search public marketplace tours",
  description:
    "Anonymous marketplace discovery. Relays Core's ACTIVE offerings from VERIFIED guides " +
    "without reading or forwarding a BFF session. Query filters are passed through verbatim; " +
    "see the Core API specification for the field-level response contract.",
  request: {
    query: z.object({
      universityId: z
        .string()
        .uuid()
        .optional()
        .openapi({ description: "University UUID filter." }),
      topic: z.string().optional().openapi({ description: "Tour topic-code filter." }),
      q: z.string().optional().openapi({ description: "Free-text search query." }),
      sort: z
        .enum(["RECOMMENDED", "PRICE_ASC", "PRICE_DESC", "RATING"])
        .optional()
        .openapi({ description: "Marketplace sort order." }),
      limit: z.coerce.number().int().optional().openapi({
        description: "Maximum number of results to return; Core clamps integer values to 1-50.",
      }),
    }),
  },
  responses: {
    200: {
      description: "Core's marketplace summary envelope, relayed verbatim.",
      content: {
        "application/json": {
          schema: coreEnvelope(z.array(CoreTourSummarySchema)),
          example: coreEnvelopeExample([tourSummaryExample]),
        },
      },
    },
    422: problemResponse("Core rejected a discovery query parameter.", invalidTourQueryExample),
    502: problem502("The Core API was unreachable."),
  },
});

apiRoute({
  method: "get",
  path: "/v1/tours/{tourId}",
  protected: false,
  tags: ["Tours"],
  summary: "Get a public marketplace tour",
  description:
    "Anonymous marketplace detail read. Relays Core's discoverable ACTIVE offering detail " +
    "without reading or forwarding a BFF session. It does not expose availability, slots, " +
    "or booking data.",
  request: {
    params: z.object({
      tourId: z.string().uuid().openapi({ description: "Tour offering UUID." }),
    }),
  },
  responses: {
    200: {
      description: "Core's marketplace detail envelope, relayed verbatim.",
      content: {
        "application/json": {
          schema: coreEnvelope(CoreTourDetailSchema),
          example: coreEnvelopeExample(tourDetailExample),
        },
      },
    },
    404: problemResponse("No discoverable tour has this id.", tourNotFoundExample),
    422: problemResponse("Core rejected the tour id.", invalidTourIdExample),
    502: problem502("The Core API was unreachable."),
  },
});

// GET /v1/userinfo
apiRoute({
  method: "get",
  path: "/v1/userinfo",
  tags: ["Session"],
  summary: "Signed-in identity, held roles, and the current role",
  description:
    "Bootstrap/session read the frontend calls on every page load. BFF-OWNED aggregation " +
    "(Profile Contract v2) — no longer a transparent Core proxy: it composes Core account " +
    "identity + held roles (`GET /users/me`) with THIS bff session's `currentRole`, which " +
    "Core does not know (it's per-session state, never a DB value; the Google id_token " +
    "carries no app role either). `currentRole` is re-validated against the roles Core just " +
    "returned on every call — a role the account no longer holds (revoked/suspended), or any " +
    "stale/invalid stored value, is reported as `null`, and only THAT case clears it from the " +
    "session and persists the change; an ordinary call does not write the session (it must " +
    "not extend the cookie's TTL on every page load). `onboardingRole` (in-progress role " +
    "acquisition) is deliberately never surfaced here — it is internal routing state, not " +
    "part of the bootstrap contract.",
  responses: {
    200: enveloped(Userinfo, {
      description: "Identity + roles + current role, wrapped in the standard success envelope.",
      examples: {
        currentRole: { summary: "Session with a current role", value: userinfoExample },
        noCurrentRole: {
          summary: "Signed in, no current role chosen yet",
          value: envelope({ ...userinfoExample.data, currentRole: null }),
        },
      },
    }),
    401: problem401(
      "No/expired session or a Core 401 (also sets `Auth-Required: reauthenticate`).",
    ),
    502: problem502("The Core API was unreachable or returned a 5xx."),
  },
});

// GET /v1/dashboard
apiRoute({
  method: "get",
  path: "/v1/dashboard",
  tags: ["Dashboard"],
  summary: "Role-shaped signed-in home",
  description:
    "The signed-in home, aggregated from several Core reads and discriminated by `kind` " +
    "(`guide` | `participant`). The current role is read from THIS bff session (Profile " +
    "Contract v2 — `currentRole` is per-session state, never a Core value or an id_token " +
    "claim); guide and participant share this one endpoint. The " +
    "guide variant fans out profile + offerings and adds a computed `canPublish` gate " +
    "(true only when VERIFIED); the participant variant fans out profile + next tour + " +
    "upcoming bookings + pending actions (each best-effort). The frontend calls this to render " +
    "`/dashboard`.\n\n" +
    "**Auth:** requires the `ctl_sess` session cookie. Swagger UI can only exercise it if the " +
    "browser is already signed in (see `GET /auth/login`) — the httpOnly cookie can't be pasted.",
  responses: {
    200: enveloped(Dashboard, {
      description: "Dashboard payload, wrapped in the standard success envelope.",
      examples: {
        guide: { summary: "Guide dashboard", value: guideDashboardExample },
        participant: { summary: "Participant dashboard", value: participantDashboardExample },
      },
    }),
    401: problem401(
      "No/expired session or a Core 401 (also sets `Auth-Required: reauthenticate`).",
    ),
    502: problem502("The Core API was unreachable or returned a 5xx."),
  },
});

// POST /v1/session/current-role
apiRoute({
  method: "post",
  path: "/v1/session/current-role",
  tags: ["Session"],
  summary: "Switch this session's current role",
  description:
    "Manually switches THIS bff session's `currentRole` to a role the account holds. `roles` are " +
    "re-validated against Core `GET /users/me` on EVERY call — never cached in the session (a " +
    "second staleable copy). If the account was mid-acquisition of this same role " +
    "(`session.onboardingRole === role`, e.g. onboarding just succeeded), that in-progress " +
    "marker is cleared HERE — the handler owns this cleanup, not the frontend. Core has no " +
    "current-role endpoint and never learns which role a session has chosen.\n\n" +
    "A role the account does not hold → 403 with the session left UNCHANGED. A " +
    "disabled/suspended account surfaces as a Core 403 (`ACCOUNT_NOT_ACTIVE`, carried in " +
    "`Problem.title`) via the same generic 4xx passthrough.\n\n" +
    "**CSRF-guarded** (state-changing mutation) — a cross-site POST is rejected.",
  request: {
    body: {
      content: {
        "application/json": { schema: SetCurrentRoleRequestSchema, example: { role: "GUIDE" } },
      },
    },
  },
  responses: {
    200: enveloped(CurrentRoleSchema, {
      description: "The now-current role, wrapped in the standard success envelope.",
      example: currentRoleExample,
    }),
    400: problem400(
      "INVALID_ROLE",
      "role must be 'GUIDE' or 'PARTICIPANT'",
      "`role` was missing or not a recognised role value.",
    ),
    403: problem403(
      "ROLE_NOT_HELD",
      "Role not held by this account",
      "The account does not currently hold the requested role (session left unchanged), or the " +
        "account is disabled (Core `ACCOUNT_NOT_ACTIVE`).",
    ),
  },
});

// --- Booking / cart (participant) ---

const bookingExample = {
  id: "b1",
  status: "WAITING_FOR_GUIDE",
  scheduledStartAt: "2026-08-01T15:00:00Z",
  scheduledEndAt: "2026-08-01T16:00:00Z",
  durationMinutes: 60,
  tourOfferingId: "o1",
  tourTitle: "North Campus highlights",
  guideName: "Maya Chen",
  guideResponseDeadline: "2026-07-30T15:00:00Z",
  universityName: "North Coast University",
  price: { amount: 4200, currency: "USD" },
};

const cancelledBookingExample = { ...bookingExample, status: "CANCELLED" };

const cartItemExample = { ...bookingExample, status: "IN_CART" };

// POST /v1/bookings
apiRoute({
  method: "post",
  path: "/v1/bookings",
  tags: ["Booking"],
  summary: "Create a booking",
  description: "Creates a booking for a bookable offering and returns it in Contract-A shape.",
  request: { body: { content: { "application/json": { schema: CreateBookingRequestSchema } } } },
  responses: {
    200: enveloped(BookingResponseSchema, {
      description: "The created booking.",
      example: envelope(bookingExample),
    }),
    422: problem422(
      "BOOKING_VALIDATION",
      "Validation failed",
      "Bad fields, window violated, or the slot was just taken.",
    ),
    409: problem409("BOOKING_CONFLICT", "Conflict", "Concurrent modification — please retry."),
  },
});

// POST /v1/bookings/{id}/cancel
apiRoute({
  method: "post",
  path: "/v1/bookings/{id}/cancel",
  tags: ["Booking"],
  summary: "Cancel a booking",
  description:
    "Cancels an existing booking owned by the caller and returns it in Contract-A shape.",
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Booking id.", example: "b1" }),
    }),
    body: { content: { "application/json": { schema: CancelBookingRequestSchema } } },
  },
  responses: {
    200: enveloped(BookingResponseSchema, {
      description: "The cancelled booking.",
      example: envelope(cancelledBookingExample),
    }),
    422: problem422(
      "BOOKING_NOT_CANCELLABLE",
      "Cannot cancel",
      "The booking is in a state that can no longer be cancelled.",
    ),
    404: problem404(
      "BOOKING_NOT_FOUND",
      "Not found",
      "No booking exists with this id for the caller.",
    ),
    409: problem409("BOOKING_CONFLICT", "Conflict", "Concurrent modification — please retry."),
  },
});

// GET /v1/cart
apiRoute({
  method: "get",
  path: "/v1/cart",
  tags: ["Booking"],
  summary: "Get the current cart",
  description:
    "Returns the caller's current cart — bookings not yet checked out — in Contract-A shape.",
  responses: {
    200: enveloped(BookingListSchema, {
      description: "The caller's cart items.",
      example: envelope([cartItemExample]),
    }),
  },
});

// POST /v1/cart/items
apiRoute({
  method: "post",
  path: "/v1/cart/items",
  tags: ["Booking"],
  summary: "Add an item to the cart",
  description: "Adds a bookable offering to the caller's cart and returns the new cart item.",
  request: { body: { content: { "application/json": { schema: CreateBookingRequestSchema } } } },
  responses: {
    200: enveloped(BookingResponseSchema, {
      description: "The added cart item.",
      example: envelope(cartItemExample),
    }),
    422: problem422(
      "BOOKING_VALIDATION",
      "Validation failed",
      "Bad fields, window violated, or the slot was just taken.",
    ),
  },
});

// DELETE /v1/cart/items/{id}
apiRoute({
  method: "delete",
  path: "/v1/cart/items/{id}",
  tags: ["Booking"],
  summary: "Remove an item from the cart",
  description: "Removes a cart item owned by the caller and returns the remaining cart.",
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Cart item (booking) id.", example: "b1" }),
    }),
  },
  responses: {
    200: enveloped(BookingListSchema, {
      description: "The remaining cart items.",
      example: envelope([{ ...cartItemExample, id: "b2" }]),
    }),
    404: problem404(
      "CART_ITEM_NOT_FOUND",
      "Not found",
      "No cart item exists with this id for the caller.",
    ),
  },
});

// POST /v1/cart/checkout
apiRoute({
  method: "post",
  path: "/v1/cart/checkout",
  tags: ["Booking"],
  summary: "Check out the cart",
  description: "Checks out every item in the caller's cart, finalizing them into bookings.",
  responses: {
    200: enveloped(BookingListSchema, {
      description: "The finalized bookings.",
      example: envelope([bookingExample]),
    }),
    422: problem422(
      "CART_VALIDATION",
      "Validation failed",
      "The cart is empty, or an item is no longer bookable.",
    ),
    409: problem409("BOOKING_CONFLICT", "Conflict", "Concurrent modification — please retry."),
  },
});

// --- Availability (guide CRUD + resolved read; participant slots) — CTL-56 ---
//
// Generic routes: role is enforced by Core's authz, not this router, so these carry no
// audience prefix (mirrors the Booking/cart module above). Reads use the framework's generic
// read-error mapping (any Core 4xx surfaces with its real status and code `UPSTREAM_ERROR`,
// via withSession) — see the slots 403/404 examples below; writes relay a Core 4xx verbatim
// (via withMutation), so the 404/422 examples below illustrate Core's real error shape.

const ruleExample = {
  id: "r1",
  dayOfWeek: 1,
  startLocal: "09:00",
  windowMin: 120,
  timezone: "America/Los_Angeles",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  active: true,
};

const exceptionExample = {
  id: "e1",
  exceptionDate: "2026-08-01",
  kind: "UNAVAILABLE",
  startLocal: "09:00",
  windowMin: 60,
  reason: "Holiday",
};

const settingsExample = {
  guideId: "g1",
  acceptanceMode: "AUTO",
  responseDeadlineMin: 60,
  minNoticeMin: 120,
  maxAdvanceDays: 30,
  bufferBeforeMin: 10,
  bufferAfterMin: 10,
  durationsOffered: [30, 60],
  timezone: "America/Los_Angeles",
  updatedAt: "2026-07-01T12:00:00Z",
};

const occurrenceExample = { startAt: "2026-08-01T15:00:00Z", endAt: "2026-08-01T16:00:00Z" };

const affectedBookingExample = {
  bookingId: "b1",
  bookingNumber: "BK-001",
  status: "CONFIRMED",
  scheduledStartAt: "2026-08-01T15:00:00Z",
  scheduledEndAt: "2026-08-01T16:00:00Z",
};

const resolvedAvailabilityExample = {
  rules: [ruleExample],
  occurrences: [occurrenceExample],
  dstGapDays: ["2026-03-08"],
  bookable: true,
  hasWeeklyHours: true,
};

const overrideReplaceRequestExample = {
  date: "2026-07-12",
  kind: "UNAVAILABLE",
  windows: [{ startLocal: "09:00", windowMin: 60 }],
};

const rulesReplaceRequestExample = {
  dayOfWeek: 1,
  windows: [{ startLocal: "09:00", windowMin: 60 }],
};

/** A read-side 4xx: the generic `withSession` mapping (real status, code `UPSTREAM_ERROR`). */
const upstreamErrorProblem = (status: number, title: string) =>
  problemResponse(title, problem(status, title, "UPSTREAM_ERROR"));

// GET /v1/availability/rules
apiRoute({
  method: "get",
  path: "/v1/availability/rules",
  tags: ["Availability"],
  summary: "List a guide's recurring availability rules",
  description:
    "Returns the guide's weekly recurring availability windows, forwarded from Core " +
    "unchanged — the wall-clock fields (`startLocal`, `windowMin`, `effectiveFrom`/`effectiveTo`) " +
    "carry no absolute instant, so CTL-49 does not touch this shape. Guide-only; role is " +
    "enforced by Core.",
  responses: {
    200: enveloped(z.array(AvailabilityRuleResponseSchema), {
      description: "The guide's availability rules.",
      example: envelope([ruleExample]),
    }),
  },
});

// POST /v1/availability/rules
apiRoute({
  method: "post",
  path: "/v1/availability/rules",
  tags: ["Availability"],
  summary: "Create a recurring availability rule",
  description:
    "Creates a new weekly recurring availability window. The write may shift or invalidate " +
    "existing bookings that no longer fit the guide's availability — those are reported back " +
    "in `affectedBookings` (a warning list, not an error).",
  request: {
    body: { content: { "application/json": { schema: CreateAvailabilityRuleRequestSchema } } },
  },
  responses: {
    200: envelopedWrite(AvailabilityRuleResponseSchema, {
      description: "The created rule, plus any bookings affected by the change.",
      example: writeEnvelope(ruleExample),
    }),
    422: problem422(
      "AVAILABILITY_RULE_VALIDATION",
      "Validation failed",
      "Bad fields, or the rule overlaps an existing one.",
    ),
  },
});

// PATCH /v1/availability/rules/{id}
apiRoute({
  method: "patch",
  path: "/v1/availability/rules/{id}",
  tags: ["Availability"],
  summary: "Update a recurring availability rule",
  description:
    "Partially updates one of the guide's recurring rules and returns it, plus any bookings " +
    "affected by the change.",
  request: {
    params: z.object({ id: z.string().openapi({ description: "Rule id.", example: "r1" }) }),
    body: { content: { "application/json": { schema: UpdateAvailabilityRuleRequestSchema } } },
  },
  responses: {
    200: envelopedWrite(AvailabilityRuleResponseSchema, {
      description: "The updated rule, plus any bookings affected by the change.",
      example: writeEnvelope({ ...ruleExample, active: false }),
    }),
    404: problem404(
      "AVAILABILITY_RULE_NOT_FOUND",
      "Not found",
      "No rule exists with this id for the caller.",
    ),
    422: problem422(
      "AVAILABILITY_RULE_VALIDATION",
      "Validation failed",
      "Bad fields, or the update overlaps an existing rule.",
    ),
  },
});

// DELETE /v1/availability/rules/{id}
apiRoute({
  method: "delete",
  path: "/v1/availability/rules/{id}",
  tags: ["Availability"],
  summary: "Delete a recurring availability rule",
  description:
    "Deletes one of the guide's recurring rules and returns the remaining rules, plus any " +
    "bookings affected by the change.",
  request: {
    params: z.object({ id: z.string().openapi({ description: "Rule id.", example: "r1" }) }),
  },
  responses: {
    200: envelopedWrite(z.array(AvailabilityRuleResponseSchema), {
      description: "The remaining rules, plus any bookings affected by the deletion.",
      example: writeEnvelope([], [affectedBookingExample]),
    }),
    404: problem404(
      "AVAILABILITY_RULE_NOT_FOUND",
      "Not found",
      "No rule exists with this id for the caller.",
    ),
  },
});

// POST /v1/availability/rules/replace
apiRoute({
  method: "post",
  path: "/v1/availability/rules/replace",
  tags: ["Availability"],
  summary: "Atomically replace one weekday's recurring availability rules",
  description:
    "Atomically replaces the guide's ACTIVE recurring rules for a single `dayOfWeek` with " +
    "exactly the supplied `windows`, in one Core transaction; every other weekday is left " +
    "untouched. An EMPTY `windows` list clears that weekday's rules. Each inserted rule takes " +
    "the guide's settings timezone, an open-ended effective range starting today, and is " +
    "active — there is deliberately no `timezone`/`effectiveFrom`/`effectiveTo`/`kind` field on " +
    "this request, unlike the rule create/patch routes above. Per-window validation (e.g. a " +
    "window may not cross midnight) runs BEFORE any mutation; overlapping or touching windows " +
    "are NOT rejected — they are accepted and coalesced (merged) into disjoint maximal rules, " +
    "the same accept-and-resolve behavior as a single-rule create. The write may shift or " +
    "invalidate existing bookings that no longer fit; those are reported in `affectedBookings` " +
    "(a warning list, not an error). A Core 4xx relays VERBATIM.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: RulesReplaceRequestSchema,
          example: rulesReplaceRequestExample,
        },
      },
    },
  },
  responses: {
    200: envelopedWrite(z.array(AvailabilityRuleResponseSchema), {
      description: "The weekday's resulting active rules, plus any bookings affected.",
      example: writeEnvelope([ruleExample], [affectedBookingExample]),
    }),
    422: problem422(
      "AVAILABILITY_RULE_VALIDATION",
      "Validation failed",
      "dayOfWeek missing or out of range (0-6), or a window's startLocal/windowMin missing or " +
        "invalid (including a window crossing midnight). Overlapping or touching windows are " +
        "NOT a 422 — they are coalesced (merged) into disjoint rules and the replace succeeds " +
        "(200). Rejected before any mutation, so prior rules are left intact.",
    ),
  },
});

// GET /v1/availability/exceptions
apiRoute({
  method: "get",
  path: "/v1/availability/exceptions",
  tags: ["Availability"],
  summary: "List a guide's availability exceptions",
  description:
    "Returns the guide's one-off date overrides (blocked or extra windows), forwarded from " +
    "Core unchanged — same wall-clock rationale as the rules above. Guide-only; role is " +
    "enforced by Core.",
  responses: {
    200: enveloped(z.array(AvailabilityExceptionResponseSchema), {
      description: "The guide's availability exceptions.",
      example: envelope([exceptionExample]),
    }),
  },
});

// POST /v1/availability/exceptions
apiRoute({
  method: "post",
  path: "/v1/availability/exceptions",
  tags: ["Availability"],
  summary: "Create a one-off availability exception",
  description:
    "Creates a one-off date override (UNAVAILABLE blocks a window or the whole day; " +
    "ADDITIONAL adds an extra one-off window) and returns it, plus any bookings affected by " +
    "the change. The caller supplies EITHER `exceptionDate` (a single date) OR both " +
    "`dateFrom`/`dateTo` (an inclusive multi-day range, capped at 366 days) — never a mix; " +
    "`kind`/`startLocal`/`windowMin` are always required (there is no separate ALL_DAY kind — " +
    'an all-day block is `startLocal: "00:00"`, `windowMin: 1440`).',
  request: {
    body: {
      content: { "application/json": { schema: CreateAvailabilityExceptionRequestSchema } },
    },
  },
  responses: {
    200: envelopedWrite(AvailabilityExceptionResponseSchema, {
      description: "The created exception, plus any bookings affected by the change.",
      example: writeEnvelope(exceptionExample),
    }),
    422: problem422(
      "AVAILABILITY_EXCEPTION_VALIDATION",
      "Validation failed",
      "Bad fields, e.g. a missing `startLocal`/`windowMin` on an ADDITIONAL exception.",
    ),
  },
});

// PATCH /v1/availability/exceptions/{id}
apiRoute({
  method: "patch",
  path: "/v1/availability/exceptions/{id}",
  tags: ["Availability"],
  summary: "Update an availability exception",
  description:
    "Replaces one of the guide's exceptions and returns it, plus any bookings affected by the " +
    "change. This is NOT a partial patch — Core rebuilds the exception from the request, so " +
    "`kind`/`startLocal`/`windowMin` are required exactly as on create, and the caller must " +
    "supply EITHER `exceptionDate` OR both `dateFrom`/`dateTo`, never a mix.",
  request: {
    params: z.object({ id: z.string().openapi({ description: "Exception id.", example: "e1" }) }),
    body: {
      content: { "application/json": { schema: UpdateAvailabilityExceptionRequestSchema } },
    },
  },
  responses: {
    200: envelopedWrite(AvailabilityExceptionResponseSchema, {
      description: "The updated exception, plus any bookings affected by the change.",
      example: writeEnvelope({ ...exceptionExample, reason: "Storm" }),
    }),
    404: problem404(
      "AVAILABILITY_EXCEPTION_NOT_FOUND",
      "Not found",
      "No exception exists with this id for the caller.",
    ),
    422: problem422(
      "AVAILABILITY_EXCEPTION_VALIDATION",
      "Validation failed",
      "Bad fields on the update.",
    ),
  },
});

// DELETE /v1/availability/exceptions/{id}
apiRoute({
  method: "delete",
  path: "/v1/availability/exceptions/{id}",
  tags: ["Availability"],
  summary: "Delete an availability exception",
  description:
    "Deletes one of the guide's exceptions and returns the remaining exceptions, plus any " +
    "bookings affected by the change.",
  request: {
    params: z.object({ id: z.string().openapi({ description: "Exception id.", example: "e1" }) }),
  },
  responses: {
    200: envelopedWrite(z.array(AvailabilityExceptionResponseSchema), {
      description: "The remaining exceptions, plus any bookings affected by the deletion.",
      example: writeEnvelope([], [affectedBookingExample]),
    }),
    404: problem404(
      "AVAILABILITY_EXCEPTION_NOT_FOUND",
      "Not found",
      "No exception exists with this id for the caller.",
    ),
  },
});

// POST /v1/availability/overrides/replace
apiRoute({
  method: "post",
  path: "/v1/availability/overrides/replace",
  tags: ["Availability"],
  summary: "Atomically replace one day's date-specific overrides for a kind",
  description:
    "Atomically replaces ONE kind's date-specific overrides for a single `date` with exactly " +
    "the supplied `windows`, in one Core transaction. The guide's existing same-kind exceptions " +
    "for the date are dropped and replaced (other-kind exceptions on that date are preserved, " +
    "trimmed only where a new window overlaps); an EMPTY `windows` list clears that kind for the " +
    "day. Unlike the exception create/patch routes there is deliberately NO date-range field — " +
    "just a single `date` plus a `windows` list. The write may shift or invalidate existing " +
    "bookings that no longer fit; those are reported in `affectedBookings` (a warning list, not " +
    "an error). A Core 4xx (e.g. a window crossing midnight) relays VERBATIM.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: OverrideReplaceRequestSchema,
          example: overrideReplaceRequestExample,
        },
      },
    },
  },
  responses: {
    200: envelopedWrite(z.array(AvailabilityExceptionResponseSchema), {
      description: "The date's resulting overrides for the kind, plus any bookings affected.",
      example: writeEnvelope([exceptionExample], [affectedBookingExample]),
    }),
    422: problem422(
      "AVAILABILITY_OVERRIDE_VALIDATION",
      "Validation failed",
      "date/kind missing or invalid, or a window's startLocal/windowMin missing or invalid " +
        "(including a window crossing midnight). Rejected before any mutation, so a prior " +
        "override is left intact.",
    ),
  },
});

// GET /v1/availability/settings
apiRoute({
  method: "get",
  path: "/v1/availability/settings",
  tags: ["Availability"],
  summary: "Get a guide's booking-acceptance and scheduling-window settings",
  description:
    "Returns the guide's settings; `updatedAt` is normalized to canonical UTC `Z` (CTL-49), " +
    "every other field forwarded from Core unchanged.",
  responses: {
    200: enveloped(AvailabilitySettingsResponseSchema, {
      description: "The guide's settings.",
      example: envelope(settingsExample),
    }),
  },
});

// PATCH /v1/availability/settings
apiRoute({
  method: "patch",
  path: "/v1/availability/settings",
  tags: ["Availability"],
  summary: "Update a guide's booking-acceptance and scheduling-window settings",
  description:
    "Partially updates the guide's settings and returns them (`updatedAt` reshaped to UTC " +
    "`Z`), plus any bookings affected by the change (e.g. a shrunk notice/buffer window).",
  request: {
    body: {
      content: { "application/json": { schema: UpdateAvailabilitySettingsRequestSchema } },
    },
  },
  responses: {
    200: envelopedWrite(AvailabilitySettingsResponseSchema, {
      description: "The updated settings, plus any bookings affected by the change.",
      example: writeEnvelope({ ...settingsExample, acceptanceMode: "MANUAL" }, [
        affectedBookingExample,
      ]),
    }),
    422: problem422(
      "AVAILABILITY_SETTINGS_VALIDATION",
      "Validation failed",
      "Bad fields, e.g. a non-positive duration or deadline.",
    ),
  },
});

// GET /v1/availability
apiRoute({
  method: "get",
  path: "/v1/availability",
  tags: ["Availability"],
  summary: "Get a guide's resolved availability",
  description:
    "Resolves the guide's active rules against exceptions and existing bookings into " +
    "coalesced, disjoint, ascending occurrences over the requested window (`occurrences` " +
    "reshaped to canonical UTC `Z`, CTL-49) and reports any DST gap-days (a local calendar " +
    "day a spring-forward transition eliminates). Core's `from`/`to` window is " +
    "anchored in the GUIDE's own timezone, so `from`/`to` are forwarded verbatim and the " +
    "response covers exactly the requested guide-local window. Also carries the backend-derived " +
    "readiness flags `bookable`/`hasWeeklyHours` (CTL-54 B1) verbatim — this bff never " +
    "recomputes availability. This is the CTL-55 frontend contract.",
  request: {
    query: z.object({
      from: z
        .string()
        .optional()
        .openapi({
          description:
            "Inclusive window start (ISO date), interpreted in the guide's own timezone and " +
            "forwarded to Core unchanged.",
          example: "2026-08-01",
        }),
      to: z
        .string()
        .optional()
        .openapi({
          description:
            "Inclusive window end (ISO date), interpreted in the guide's own timezone and " +
            "forwarded to Core unchanged.",
          example: "2026-08-31",
        }),
    }),
  },
  responses: {
    200: enveloped(ResolvedAvailabilityResponseSchema, {
      description: "The guide's resolved availability.",
      example: envelope(resolvedAvailabilityExample),
    }),
  },
});

// GET /v1/offerings/{id}/slots
apiRoute({
  method: "get",
  path: "/v1/offerings/{id}/slots",
  tags: ["Availability"],
  summary: "List an offering's bookable slots",
  description:
    "Participant-facing bookable slots for a tour offering, reshaped to canonical UTC `Z` " +
    "(CTL-49). `from`/`to` are forwarded to Core verbatim and interpreted in the guide's own " +
    "timezone. Role PARTICIPANT is enforced by Core.",
  request: {
    params: z.object({ id: z.string().openapi({ description: "Offering id.", example: "off1" }) }),
    query: z.object({
      from: z.string().optional().openapi({
        description: "Inclusive window start (ISO date), forwarded to Core verbatim.",
        example: "2026-08-01",
      }),
      to: z.string().optional().openapi({
        description: "Inclusive window end (ISO date), forwarded to Core verbatim.",
        example: "2026-08-31",
      }),
    }),
  },
  responses: {
    200: enveloped(z.array(AvailabilityOccurrenceSchema), {
      description: "The offering's bookable slots.",
      example: envelope([occurrenceExample]),
    }),
    403: upstreamErrorProblem(403, "Non-participant caller"),
    404: upstreamErrorProblem(404, "Offering not found or inactive"),
  },
});

const overridePreviewExample = {
  days: [
    {
      date: "2026-07-18",
      resultingWindows: [{ startAt: "2026-07-18T16:00:00Z", endAt: "2026-07-18T16:30:00Z" }],
      trimmed: [{ kind: "ADDITIONAL", startLocal: "09:00", windowMin: 30 }],
      inert: false,
    },
  ],
  valid: true,
  message: null,
};

// GET /v1/availability/preview
apiRoute({
  method: "get",
  path: "/v1/availability/preview",
  tags: ["Availability"],
  summary: "Preview a proposed date-specific availability override (dry-run)",
  description:
    "Read-only, non-persisting dry-run of a proposed date-specific override (`kind`/" +
    "`startLocal`/`windowMin`) across `[dateFrom, dateTo]` (CTL-54 v2.1) — does not create " +
    "anything. Each day's `resultingWindows` is reshaped to canonical UTC `Z` (CTL-49); " +
    "`trimmed`/`valid`/`message` pass through unchanged. Unlike the resolved-availability read " +
    "above, `dateFrom`/`dateTo` are forwarded to Core verbatim, NOT widened — they are the " +
    "EXACT range the caller is proposing to create, so widening them would silently change " +
    "what's being previewed. Guide-only; role is enforced by Core.\n\n" +
    "**4xx relay:** this route is wrapped so a Core 4xx (e.g. a range over 366 dates, or " +
    "windows that cross midnight) reaches the caller VERBATIM — real status, real message — " +
    "rather than a generic `UPSTREAM_ERROR` body, because the message is what tells a guide " +
    "what to change.",
  request: {
    query: z.object({
      dateFrom: z.string().openapi({
        description: "ISO-8601 first date (inclusive) of the proposed override.",
        example: "2026-07-18",
      }),
      dateTo: z.string().openapi({
        description: "ISO-8601 last date (inclusive) of the proposed override.",
        example: "2026-07-18",
      }),
      kind: ExceptionKindEnum.openapi({
        description:
          "UNAVAILABLE blocks the window (or whole day); ADDITIONAL proposes an extra window.",
        example: "ADDITIONAL",
      }),
      startLocal: z.string().openapi({
        description: "Wall-clock start time of day, 24h `HH:mm`, in the guide's account timezone.",
        example: "09:00",
      }),
      windowMin: z.string().openapi({
        description: "Window length in minutes (> 0), as a query-string integer.",
        example: "60",
      }),
    }),
  },
  responses: {
    200: enveloped(OverridePreviewResponseSchema, {
      description: "Per-date dry-run result of the proposed override.",
      example: envelope(overridePreviewExample),
    }),
    403: upstreamErrorProblem(403, "Non-guide caller"),
    422: upstreamErrorProblem(422, "Invalid preview params/range (e.g. a range over 366 dates)"),
  },
});

const overrideMultiPreviewRequestExample = {
  dateFrom: "2026-07-18",
  dateTo: "2026-07-19",
  kind: "ADDITIONAL",
  windows: [
    { startLocal: "09:00", windowMin: 60 },
    { startLocal: "14:00", windowMin: 60 },
  ],
  replaceExisting: true,
};

const overrideMultiPreviewExample = {
  days: [
    {
      date: "2026-07-18",
      resultingWindows: [
        { startAt: "2026-07-18T16:00:00Z", endAt: "2026-07-18T17:00:00Z" },
        { startAt: "2026-07-18T21:00:00Z", endAt: "2026-07-18T22:00:00Z" },
      ],
      trimmed: [],
      inert: false,
    },
    {
      date: "2026-07-19",
      resultingWindows: [
        { startAt: "2026-07-19T16:00:00Z", endAt: "2026-07-19T17:00:00Z" },
        { startAt: "2026-07-19T21:00:00Z", endAt: "2026-07-19T22:00:00Z" },
      ],
      trimmed: [],
      inert: false,
    },
  ],
  valid: true,
  message: null,
};

// POST /v1/availability/preview
apiRoute({
  method: "post",
  path: "/v1/availability/preview",
  tags: ["Availability"],
  summary: "Preview a proposed multi-window date-specific availability override (dry-run)",
  description:
    "Read-only, non-persisting dry-run of a proposed date-specific override built from MANY " +
    "time windows applied together (`windows[]`) across `[dateFrom, dateTo]` — the multi-window " +
    "sibling of `GET /v1/availability/preview` above, needed because a window list doesn't fit " +
    "in a query string. `guideId` is server-resolved from the session; never part of the body. " +
    "The response shape is IDENTICAL to the single-window GET preview's: each day's " +
    "`resultingWindows` is reshaped to canonical UTC `Z` (CTL-49); `trimmed`/`valid`/`message` " +
    "pass through unchanged. `dateFrom`/`dateTo`/`windows` are forwarded to Core verbatim, NOT " +
    "widened or validated here — they are the EXACT proposal being previewed, and Core is the " +
    "source of truth for a bad/empty `windows` array or an out-of-range span. Guide-only; role " +
    "is enforced by Core.\n\n" +
    "**No CSRF guard:** unlike this API's other POST routes, this one carries no CSRF check — " +
    "it mutates no state (a dry-run), so a cross-site-triggered call can compute a result but " +
    "not read it back (no CORS) and persists nothing.\n\n" +
    "**4xx relay:** this route is wrapped so a Core 4xx (e.g. empty `windows` or a " +
    "cross-midnight span) reaches the caller VERBATIM — real status, real message — rather " +
    "than a generic `UPSTREAM_ERROR` body, because the message is what tells a guide what to " +
    "change.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: OverrideMultiPreviewRequestSchema,
          example: overrideMultiPreviewRequestExample,
        },
      },
    },
  },
  responses: {
    200: enveloped(OverridePreviewResponseSchema, {
      description: "Per-date dry-run result of the proposed multi-window override.",
      example: envelope(overrideMultiPreviewExample),
    }),
    403: upstreamErrorProblem(403, "Non-guide caller"),
    422: upstreamErrorProblem(422, "Invalid windows/range (e.g. empty windows[], cross-midnight)"),
  },
});

// GET /auth/login
apiRoute({
  method: "get",
  path: "/auth/login",
  tags: ["Auth"],
  summary: "Start Google sign-in",
  description:
    "Begins the OAuth 2.0 / OIDC Authorization Code + PKCE flow and 302-redirects the browser to " +
    "Google's authorization endpoint. Sets a short-lived `ctl_auth_tx` transaction cookie holding " +
    "the PKCE verifier, state, sanitized `returnTo`, `intent`, and `requestedRole` (CTL-97). This " +
    "is the entry point you use to obtain a session cookie so protected endpoints become " +
    "exercisable from `/docs`.",
  request: {
    query: z.object({
      returnTo: z
        .string()
        .optional()
        .openapi({
          description:
            "Site-relative path to land on after auth. Allowlisted (must start with one of " +
            "/dashboard, /profile, /support, /staff, /onboarding, /guide); anything else falls " +
            "back to /dashboard.",
          example: "/onboarding/guide",
        }),
      intent: z.enum(["signup", "signin"]).optional().openapi({
        description:
          "`signup` provisions a new account against Core; `signin` requires an existing one.",
        example: "signin",
      }),
      role: CoreRoleEnum.optional().openapi({
        description:
          "The role this entry is for (CTL-97) — written into the auth transaction and read " +
          "back by the callback to decide currentRole/onboardingRole initialisation. Preferred " +
          "over inferring a role from `returnTo` (a legacy, marked-for-removal fallback).",
        example: "GUIDE",
      }),
      login_hint: z.string().optional().openapi({
        description: "Optional email hint forwarded to Google to pre-fill the account chooser.",
        example: "ada@example.edu",
      }),
    }),
  },
  responses: {
    302: {
      description:
        "Redirect to Google's authorization endpoint. The `Location` header is Google's " +
        "`/o/oauth2/v2/auth` URL with client_id, PKCE challenge, state, and scopes.",
    },
  },
});

// GET /auth/callback
apiRoute({
  method: "get",
  path: "/auth/callback",
  tags: ["Auth"],
  summary: "Google OAuth redirect target",
  description:
    "Handles Google's redirect: validates PKCE state against `ctl_auth_tx`, exchanges the code for " +
    "tokens, resolves the account against Core `/session?intent=` (enforcing signup vs signin), then " +
    "302-redirects into the web app. On success it establishes the `ctl_sess` session cookie and " +
    "initialises this session's role state from `requestedRole` (written by `GET /auth/login`, " +
    "CTL-97): holding it → `currentRole` (role home); lacking it on signup (and eligible — see " +
    "Core role-eligibility) → `onboardingRole` + that role's onboarding; lacking it on signin → " +
    "`/signup/role`; no `requestedRole` with exactly one held role → `currentRole` initialised to " +
    "it; otherwise role selection. Provider errors and role-blocked cases (e.g. PARENT→guide) " +
    "redirect back into the UI WITHOUT a session. You don't call this directly — Google does.",
  request: {
    query: z.object({
      code: z
        .string()
        .optional()
        .openapi({ description: "Authorization code from Google.", example: "4/0AY0e-g7..." }),
      state: z.string().optional().openapi({
        description: "PKCE state, matched against the `ctl_auth_tx` cookie.",
        example: "n0nc3-r4nd0m-state",
      }),
      error: z.string().optional().openapi({
        description: "Provider error code (e.g. access_denied when the user cancels consent).",
        example: "access_denied",
      }),
      error_description: z.string().optional().openapi({
        description: "Human-readable provider error detail.",
        example: "The user denied the request.",
      }),
    }),
  },
  responses: {
    302: {
      description:
        "Redirect into the web app. `Location` depends on the outcome: on success the role-aware " +
        "landing (e.g. /dashboard, /onboarding/guide) with `ctl_sess` set; on a cancelled/failed " +
        "provider error or an unregistered signin, a UI page (e.g. /signin?error=not_registered) " +
        "with NO session.",
    },
    400: problem400(
      "AUTH_TX_MISSING",
      "Login session expired — please start again.",
      "Missing/expired `ctl_auth_tx` transaction cookie (`AUTH_TX_MISSING`), missing code / " +
        "invalid state (`AUTH_STATE_INVALID`), or a missing/invalid `intent` on the transaction " +
        "(`AUTH_INTENT_INVALID`) — never defaulted to signup.",
    ),
    502: problem502(
      "Token exchange (`AUTH_EXCHANGE_FAILED`) or account resolution against Core " +
        "(`CORE_UNAVAILABLE` / `RESOLVE_FAILED`) failed — the latter also covers a failed " +
        "role-eligibility check on a signup that lacks `requestedRole`.",
      problem(502, "Account resolution failed", "CORE_UNAVAILABLE"),
    ),
  },
});

// POST /auth/logout — POST-only + CSRF-guarded (a GET logout would be forgeable cross-site).
for (const method of ["post"] as const) {
  apiRoute({
    method,
    path: "/auth/logout",
    tags: ["Auth"],
    summary: "Clear the session",
    description:
      "Clears the `ctl_sess` cookie and 302-redirects to the web app base URL. POST-only and " +
      "CSRF-guarded — logout is a state change, so a GET would be cross-site forgeable.",
    responses: {
      302: {
        description:
          "Redirect to the web app base URL (`Location: <WEB_BASE_URL>`). The local session is " +
          "cleared and the Google grant is revoked best-effort.",
      },
    },
  });
}

// GET /auth/session
apiRoute({
  method: "get",
  path: "/auth/session",
  tags: ["Auth"],
  summary: "Lightweight auth check",
  description:
    "Reports whether a valid session cookie carrying an id_token is present. Makes NO Core call and " +
    "is deliberately NOT wrapped in the `{ data, meta }` envelope — the frontend polls it to decide " +
    "whether to show signed-in UI. Always 200 (the boolean says it all).",
  responses: {
    200: {
      description: "Whether the caller currently has an authenticated session.",
      content: {
        "application/json": {
          schema: SessionStatus,
          examples: {
            authenticated: { summary: "Signed in", value: { authenticated: true } },
            anonymous: { summary: "Not signed in", value: { authenticated: false } },
          },
        },
      },
    },
  },
});

// --- Document ---

const generator = new OpenApiGeneratorV31(registry.definitions);

/**
 * The generated OpenAPI 3.1 document. Served at GET /openapi.json and rendered by
 * Swagger UI at GET /docs (see src/app.ts).
 */
export const openapiSpec = generator.generateDocument({
  openapi: "3.1.0",
  info: {
    title: "CampusToursLive BFF — Contract A",
    version: "0.1.0",
    contact: {
      name: "CampusToursLive Engineering",
      url: "https://github.com/Campus-Tours-Live/bff",
    },
    description:
      "The frontend-facing API the BFF owns: the Google sign-in lifecycle (`/auth/*`) and the " +
      "`/v1` aggregation composites (`/v1/dashboard`).\n\n" +
      "### Response shapes\n" +
      '- **Success** aggregation responses use the envelope `{ "data": <payload>, "meta": ' +
      '{ "requestId": "<uuid>" } }`. `meta.requestId` echoes the `X-Request-Id` header for tracing.\n' +
      "- **Errors** are always RFC 7807 `application/problem+json`: `{ title, status, code, requestId, " +
      "detail? }`. Switch on the stable `code` (e.g. `SESSION_EXPIRED`, `CORE_UNAVAILABLE`, " +
      "`INVALID_ROLE`, `AUTH_TX_MISSING`).\n" +
      "- `GET /auth/session` is the one exception — a bare `{ authenticated }` boolean, not enveloped.\n\n" +
      "### Auth model\n" +
      "Protected endpoints require the encrypted, httpOnly `ctl_sess` session cookie. Because it is " +
      "httpOnly it cannot be pasted into Swagger UI's Authorize box. **To try a protected endpoint:** " +
      "open `GET /auth/login` in this same browser and complete Google sign-in — the cookie is then " +
      "sent automatically with your `/docs` requests. A 401 with `Auth-Required: reauthenticate` means " +
      "the session expired; sign in again.\n\n" +
      "### Everything else under `/v1/*`\n" +
      "All OTHER `/v1/*` paths are transparently proxied to the Core API and are NOT re-documented " +
      "here — see the Core's own OpenAPI spec via `externalDocs` below.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Auth", description: "Google sign-in session lifecycle (`/auth/*`)." },
    {
      name: "Session",
      description:
        "Bootstrap identity/roles/current-role read the frontend calls on every page load.",
    },
    { name: "Dashboard", description: "Role-shaped signed-in home aggregate." },
    { name: "Tours", description: "Anonymous marketplace tour discovery." },
    { name: "Booking", description: "Participant booking and cart operations." },
    {
      name: "Availability",
      description:
        "Guide recurring-rule/exception/settings CRUD, the resolved-availability read, and " +
        "participant offering slots.",
    },
  ],
  externalDocs: {
    url: `${coreApiBaseUrl}/v3/api-docs`,
    description:
      "Core API (backend) OpenAPI. All other /v1/* paths proxy the Core API — see its spec here.",
  },
});
