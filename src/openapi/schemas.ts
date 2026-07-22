/**
 * Zod schemas for Contract A — the single source of truth behind BOTH the OpenAPI
 * document (see ./index.ts) and runtime validation (the onboarding `role` guard and the
 * dev-only response-shape assertions in src/api/_shared/envelope.ts + the contract test).
 *
 * Two families live here:
 *   1. **Documentation schemas** (rich `.openapi()` metadata, precise enums/examples) —
 *      consumed by ./index.ts + ./helpers.ts to generate the spec.
 *   2. **Runtime response-shape contracts** (the `*DataSchema` / `Enveloped*Schema` block
 *      at the bottom) — deliberately LOOSE on the opaque objects the BFF forwards verbatim
 *      from Core (Core may add fields) and STRICT on the parts the BFF actually owns: the
 *      `{ data, meta }` envelope, the `kind`/`role` discriminators, and derived fields
 *      (`canPublish`, the `offerings`/`upcomingBookings` array shapes, the `Progress`
 *      structure, `authenticated`). This split lets CI catch "a handler changed shape but
 *      the schema/spec didn't" without false-failing on legitimate Core passthrough drift.
 */
import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

// Adds the `.openapi()` metadata method onto Zod schemas. Must run before any schema
// below uses it / is registered.
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// The Core API base for the proxied /v1/* passthrough. Read straight from env (with the
// same default as config.ts) so this module stays importable without the required
// secrets — handy for generating/exporting the spec in isolation.
export const coreApiBaseUrl = process.env.CORE_API_BASE_URL ?? "http://localhost:8080";

// A stable example correlation id, reused across every `meta.requestId` /
// `Problem.requestId` example so the docs read consistently.
export const REQUEST_ID_EXAMPLE = "3f6c1a9e-2b7d-4c5a-9f10-8e2b7d4c5a9f";

// --- Security: the encrypted httpOnly session cookie (see src/session.ts) ---
// Cookie name is `ctl_sess` (SESSION_COOKIE in src/session.ts).
registry.registerComponent("securitySchemes", "sessionCookie", {
  type: "apiKey",
  in: "cookie",
  name: "ctl_sess",
  description:
    "Encrypted, httpOnly AES-256-GCM session cookie set by `GET /auth/callback` and read " +
    "by the aggregation endpoints. Because it is httpOnly it is NOT readable by browser JS " +
    "and cannot be pasted into Swagger UI's Authorize box — to exercise a protected endpoint " +
    "from here, sign in first at `GET /auth/login` in the same browser so the cookie rides " +
    "along automatically with `/docs` requests.",
});

// --- Enumerations (exact values sourced from backend + frontend Contract A) ---

/**
 * `role` request/response discriminator (dashboard `kind`, onboarding `role`). Exported so
 * the onboarding handler validates its `role` query param against the SAME enum the spec
 * documents — one source of truth for the accepted values.
 */
export const RoleEnum = z.enum(["guide", "participant"]);

/**
 * Guide application status (a.k.a. `guideStatus`, Core `application_status`). `DRAFT`
 * = profile started but not yet submitted; only `APPROVED` unlocks publishing.
 */
export const ApplicationStatusEnum = z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED"]);

/** Guide identity/verification status (deferred in onboarding — often null for now). */
export const VerificationStatusEnum = z.enum(["PENDING", "VERIFIED", "REJECTED"]);

/** Participant kind — a `PARENT` reads as a guardian booking on a student's behalf. */
export const ParticipantTypeEnum = z.enum(["STUDENT", "PARENT"]);

/** Lifecycle status of a guide's tour offering (Core `TourOfferingStatus`). */
export const OfferingStatusEnum = z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);

// --- Shared components ---

/** RFC 7807 `application/problem+json` — the single error shape (src/util/problem.ts). */
export const Problem = registry.register(
  "Problem",
  z
    .object({
      type: z.string().optional().openapi({
        description: "URI reference identifying the problem type; `about:blank` when unspecified.",
        example: "about:blank",
      }),
      title: z.string().openapi({
        description: "Short, human-readable summary of the problem, stable per type.",
        example: "Authentication required",
      }),
      status: z.number().int().openapi({
        description: "HTTP status code, duplicated in the body for convenience.",
        example: 401,
      }),
      detail: z.string().optional().openapi({
        description: "Human-readable explanation specific to this occurrence.",
        example: "Your session has expired — please sign in again.",
      }),
      code: z
        .string()
        .optional()
        .openapi({
          description:
            "Stable machine-readable error code the web app switches on " +
            "(e.g. SESSION_EXPIRED, CORE_UNAVAILABLE, AUTH_TX_MISSING, INVALID_ROLE).",
          example: "SESSION_EXPIRED",
        }),
      requestId: z.string().optional().openapi({
        description: "Per-request correlation id (echo of the `X-Request-Id` header) for tracing.",
        example: REQUEST_ID_EXAMPLE,
      }),
    })
    .openapi("Problem", {
      description: "RFC 7807 application/problem+json error body.",
    }),
);

/** `meta` block of the success envelope — echoes the per-request correlation id. */
export const Meta = registry.register(
  "Meta",
  z
    .object({
      requestId: z.string().openapi({
        description: "Per-request correlation id (echo of the `X-Request-Id` response header).",
        example: REQUEST_ID_EXAMPLE,
      }),
    })
    .openapi("Meta", { description: "Envelope metadata — the per-request correlation id." }),
);

/**
 * The standard success envelope `{ data, meta: { requestId } }` (src/api/_shared/envelope.ts).
 * A helper because `data` differs per endpoint; the wrapper is uniform.
 */
export function Envelope<T extends z.ZodTypeAny>(
  data: T,
): z.ZodObject<{ data: T; meta: typeof Meta }> {
  return z.object({
    data: data.openapi({ description: "The endpoint-specific payload." }),
    meta: Meta,
  });
}

/** An arbitrary JSON object the BFF passes through from the Core untouched. */
export const JsonObject = z.record(z.string(), z.unknown());

// --- Value builders (pure — used by the example bodies below and by ./helpers.ts) ---

/** Assemble a realistic `Problem` example body (mirrors util/problem.ts field order). */
export function problem(
  status: number,
  title: string,
  code: string,
  detail?: string,
): z.infer<typeof Problem> {
  return {
    type: "about:blank",
    title,
    status,
    ...(detail ? { detail } : {}),
    code,
    requestId: REQUEST_ID_EXAMPLE,
  };
}

/** Wrap a payload example in the `{ data, meta }` success envelope. */
export function envelope<T>(data: T): { data: T; meta: { requestId: string } } {
  return { data, meta: { requestId: REQUEST_ID_EXAMPLE } };
}

// --- Domain sub-schemas (forwarded from Core; field names per Contract A) ---

/** A guide's public/profile record (Core, forwarded verbatim by the BFF). */
export const GuideProfile = registry.register(
  "GuideProfile",
  z
    .object({
      userId: z
        .string()
        .optional()
        .openapi({ description: "Guide's user id.", example: "u_guide_123" }),
      firstName: z.string().optional().openapi({ description: "Given name.", example: "Ada" }),
      lastName: z.string().optional().openapi({ description: "Family name.", example: "Lovelace" }),
      displayName: z
        .string()
        .optional()
        .openapi({ description: "Name shown to participants.", example: "Ada L." }),
      email: z
        .string()
        .optional()
        .openapi({ description: "Contact email.", example: "ada@example.edu" }),
      accountStatus: z
        .string()
        .optional()
        .openapi({ description: "Overall account status from Core.", example: "ACTIVE" }),
      universityId: z.string().nullable().optional().openapi({
        description: "Id of the guide's university (null until set).",
        example: "uni_mit",
      }),
      universityName: z.string().nullable().optional().openapi({
        description: "Full university name.",
        example: "Massachusetts Institute of Technology",
      }),
      universityShortName: z
        .string()
        .nullable()
        .optional()
        .openapi({ description: "Abbreviated university name.", example: "MIT" }),
      major: z
        .string()
        .optional()
        .openapi({ description: "Field of study.", example: "Computer Science" }),
      classYear: z
        .string()
        .optional()
        .openapi({ description: "Graduation year.", example: "2026" }),
      bio: z.string().nullable().optional().openapi({
        description: "Free-text guide bio.",
        example: "Sophomore who loves showing off the maker space.",
      }),
      languages: z
        .array(z.string())
        .optional()
        .openapi({ description: "Languages the guide can tour in.", example: ["en", "es"] }),
      specialties: z
        .array(z.string())
        .optional()
        .openapi({ description: "Tour focus areas.", example: ["engineering", "campus-life"] }),
      basePriceCents: z.number().int().nullable().optional().openapi({
        description: "Default price per tour, in cents (null until set).",
        example: 2500,
      }),
      currency: z
        .string()
        .optional()
        .openapi({ description: "ISO-4217 currency code.", example: "USD" }),
      applicationStatus: ApplicationStatusEnum.nullable().optional().openapi({
        description: "Guide application/review status (null if no guide profile yet).",
        example: "APPROVED",
      }),
      verificationStatus: VerificationStatusEnum.nullable().optional().openapi({
        description: "Guide identity verification status (often null — deferred).",
        example: "VERIFIED",
      }),
    })
    .openapi("GuideProfile", { description: "Guide profile record forwarded from Core." }),
);

/** A participant's profile record (Core, forwarded verbatim by the BFF). */
export const ParticipantProfile = registry.register(
  "ParticipantProfile",
  z
    .object({
      firstName: z.string().optional().openapi({ description: "Given name.", example: "Grace" }),
      lastName: z.string().optional().openapi({ description: "Family name.", example: "Hopper" }),
      displayName: z
        .string()
        .optional()
        .openapi({ description: "Name shown in the app.", example: "Grace H." }),
      email: z
        .string()
        .optional()
        .openapi({ description: "Contact email.", example: "grace@example.com" }),
      participantType: ParticipantTypeEnum.optional().openapi({
        description: "Whether the participant is the student or a booking guardian.",
        example: "STUDENT",
      }),
      gradeLevel: z
        .string()
        .optional()
        .openapi({ description: "Current grade / year.", example: "12" }),
      intendedMajor: z
        .string()
        .optional()
        .openapi({ description: "Prospective major.", example: "Biology" }),
      topicsOfInterest: z
        .array(z.string())
        .optional()
        .openapi({
          description: "Tour topics the participant cares about.",
          example: ["dorm-life", "research"],
        }),
      universitiesOfInterest: z
        .array(z.string())
        .optional()
        .openapi({
          description: "University ids the participant is exploring.",
          example: ["uni_mit", "uni_stanford"],
        }),
      guardianRequired: z
        .boolean()
        .optional()
        .openapi({ description: "Whether a guardian must be present to book.", example: false }),
    })
    .openapi("ParticipantProfile", {
      description: "Participant profile record forwarded from Core.",
    }),
);

/** A guide's sellable tour offering (Core `TourOfferingResponse`). */
export const Offering = registry.register(
  "Offering",
  z
    .object({
      id: z.string().openapi({ description: "Offering id.", example: "off_abc123" }),
      title: z
        .string()
        .openapi({ description: "Offering title.", example: "Hidden gems of North Campus" }),
      slug: z.string().openapi({ description: "URL slug.", example: "hidden-gems-north-campus" }),
      status: OfferingStatusEnum.openapi({
        description: "Publication lifecycle status.",
        example: "ACTIVE",
      }),
      topic: z
        .string()
        .nullable()
        .openapi({ description: "Primary topic (nullable).", example: "campus-life" }),
      universityId: z
        .string()
        .nullable()
        .openapi({ description: "University the tour covers (nullable).", example: "uni_mit" }),
      durationMin: z
        .number()
        .int()
        .openapi({ description: "Tour length in minutes.", example: 45 }),
      priceCents: z.number().int().openapi({ description: "Price in cents.", example: 2500 }),
      currency: z.string().openapi({ description: "ISO-4217 currency code.", example: "USD" }),
      description: z.string().nullable().optional().openapi({
        description: "Long-form description (nullable/optional).",
        example: "A 45-minute walk through the parts of campus the official tour skips.",
      }),
    })
    .openapi("Offering", { description: "A guide's sellable tour offering." }),
);

// --- Booking response schemas (Contract A for booking operations) ---
//
// Defined here, ahead of the dashboard payloads below, so both the registered/published
// `ParticipantDashboard` schema and the runtime `ParticipantDashboardDataSchema` can reference
// `BookingResponseSchema` directly (module-scope `const`s must be initialized before use — no
// forward references).

/** Money value in ISO-4217 currency, with amount in minor units (cents). */
export const MoneySchema = z.object({
  amount: z.number().int().describe("minor units (cents)"),
  currency: z.string().length(3),
});

/** A confirmed or pending booking response. */
export const BookingResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  scheduledStartAt: z.string(),
  scheduledEndAt: z.string(),
  durationMinutes: z.number().int(),
  tourOfferingId: z.string(),
  tourTitle: z.string(),
  guideName: z.string(),
  guideResponseDeadline: z.string().nullable(),
  universityName: z.string(),
  price: MoneySchema,
});

/** Array of booking responses. */
export const BookingListSchema = z.array(BookingResponseSchema);

// --- Dashboard payloads (GET /v1/dashboard, discriminated by `kind`) ---

/** GET /v1/dashboard, guide variant (src/api/dashboard/guide.ts). */
const GuideDashboard = z
  .object({
    kind: z
      .literal("guide")
      .openapi({ description: "Discriminator — always `guide` here.", example: "guide" }),
    guide: GuideProfile,
    guideStatus: ApplicationStatusEnum.nullable().openapi({
      description: "The guide's application status (echo of `guide.applicationStatus`).",
      example: "APPROVED",
    }),
    canPublish: z.boolean().openapi({
      description: 'Computed convenience gate — true only when `guideStatus === "APPROVED"`.',
      example: true,
    }),
    offerings: z.array(Offering).openapi({
      description: "The guide's offerings (best-effort — empty list if the Core read fails).",
    }),
    createdAt: z
      .string()
      .nullish()
      .openapi({
        description:
          'Account creation timestamp (ISO-8601 UTC), rendered as "member since". Nullable: ' +
          "Core sends `null` for accounts created before it recorded this, and the runtime " +
          "schema accepts that — the published shape must say so too (M5).",
        example: "2025-09-01T12:00:00.000Z",
      }),
  })
  .openapi("GuideDashboard", { description: "Signed-in home for a guide." });

/** Shared example for `ParticipantDashboard.nextTour` and `participantDashboardExample`. */
const PARTICIPANT_NEXT_TOUR_EXAMPLE = {
  id: "bk_789",
  status: "CONFIRMED",
  scheduledStartAt: "2026-07-10T15:00:00Z",
  scheduledEndAt: "2026-07-10T16:00:00Z",
  durationMinutes: 60,
  tourOfferingId: "off_123",
  tourTitle: "Hidden gems of North Campus",
  guideName: "Maya Chen",
  guideResponseDeadline: null,
  universityName: "North Campus University",
  price: { amount: 4200, currency: "USD" },
};

/** Shared example for `ParticipantDashboard.upcomingBookings` and `participantDashboardExample`. */
const PARTICIPANT_UPCOMING_EXAMPLE = {
  id: "bk_790",
  status: "WAITING_FOR_GUIDE",
  scheduledStartAt: "2026-07-14T18:00:00Z",
  scheduledEndAt: "2026-07-14T19:30:00Z",
  durationMinutes: 90,
  tourOfferingId: "off_456",
  tourTitle: "Engineering quad tour",
  guideName: "Sam Rivera",
  guideResponseDeadline: "2026-07-12T18:00:00Z",
  universityName: "North Campus University",
  price: { amount: 6000, currency: "USD" },
};

/** GET /v1/dashboard, participant variant (src/api/dashboard/participant.ts). */
const ParticipantDashboard = z
  .object({
    kind: z.literal("participant").openapi({
      description: "Discriminator — always `participant` here.",
      example: "participant",
    }),
    participant: ParticipantProfile,
    nextTour: BookingResponseSchema.nullable().openapi({
      description:
        "The participant's next confirmed tour, reshaped to the Contract-A booking shape " +
        "(same shape as GET/POST /v1/bookings). Best-effort: null when there is " +
        "none or the Core read fails.",
      example: PARTICIPANT_NEXT_TOUR_EXAMPLE,
    }),
    upcomingBookings: z.array(BookingResponseSchema).openapi({
      description:
        "Upcoming bookings, reshaped to the Contract-A booking shape. Best-effort: empty list on failure.",
      example: [PARTICIPANT_UPCOMING_EXAMPLE],
    }),
    pendingActions: JsonObject.nullable().openapi({
      description:
        "Counts of actions needing attention, forwarded from Core (opaque). Best-effort: null on failure.",
      example: { unreadMessages: 2, awaitingReview: 1 },
    }),
    createdAt: z
      .string()
      .nullish()
      .openapi({
        description:
          'Account creation timestamp (ISO-8601 UTC), rendered as "member since". Nullable: ' +
          "Core sends `null` for accounts created before it recorded this, and the runtime " +
          "schema accepts that — the published shape must say so too (M5).",
        example: "2026-01-15T09:30:00.000Z",
      }),
  })
  .openapi("ParticipantDashboard", { description: "Signed-in home for a participant." });

/** Discriminated by `kind`, matching the front-end's single shared /dashboard route. */
export const Dashboard = registry.register(
  "Dashboard",
  z
    .discriminatedUnion("kind", [GuideDashboard, ParticipantDashboard])
    .openapi({ description: "Role-shaped dashboard payload, discriminated by `kind`." }),
);

/** Uniform onboarding-progress shape returned for either role (src/api/onboarding/types.ts). */
export const Progress = registry.register(
  "Progress",
  z
    .object({
      role: RoleEnum.openapi({
        description: "The target role this progress describes.",
        example: "guide",
      }),
      started: z
        .boolean()
        .openapi({ description: "Whether onboarding for this role has begun.", example: true }),
      complete: z
        .boolean()
        .openapi({ description: "Whether onboarding for this role is finished.", example: false }),
      canSubmit: z.boolean().openapi({
        description:
          "Whether the user may submit/advance now (coarse for guides — field gating deferred).",
        example: true,
      }),
      applicationStatus: ApplicationStatusEnum.nullable().openapi({
        description: "Guide application status; always null for participants.",
        example: "PENDING_REVIEW",
      }),
      verificationStatus: VerificationStatusEnum.nullable().openapi({
        description: "Guide verification status; deferred, so currently always null.",
        example: null,
      }),
      steps: z
        .array(
          z.object({
            key: z.string().openapi({ description: "Stable step key.", example: "submitted" }),
            label: z.string().openapi({
              description: "Human-readable step label.",
              example: "Application submitted",
            }),
            done: z
              .boolean()
              .openapi({ description: "Whether this step is complete.", example: true }),
          }),
        )
        .openapi({ description: "Ordered checklist of onboarding steps for this role." }),
    })
    .openapi("Progress", { description: "Derived onboarding progress for one role." }),
);

/** GET /auth/session — lightweight, un-enveloped auth check (src/auth/routes.ts). */
export const SessionStatus = registry.register(
  "SessionStatus",
  z
    .object({
      authenticated: z.boolean().openapi({
        description: "True when a valid session cookie carrying an id_token is present.",
        example: true,
      }),
    })
    .openapi("SessionStatus", { description: "Un-enveloped session presence check." }),
);

// --- Example bodies ---

export const guideDashboardExample = envelope({
  kind: "guide",
  guide: {
    userId: "u_guide_123",
    firstName: "Ada",
    lastName: "Lovelace",
    displayName: "Ada L.",
    email: "ada@example.edu",
    accountStatus: "ACTIVE",
    universityId: "uni_mit",
    universityName: "Massachusetts Institute of Technology",
    universityShortName: "MIT",
    major: "Computer Science",
    classYear: "2026",
    bio: "Sophomore who loves showing off the maker space.",
    languages: ["en", "es"],
    specialties: ["engineering", "campus-life"],
    basePriceCents: 2500,
    currency: "USD",
    applicationStatus: "APPROVED",
    verificationStatus: "VERIFIED",
  },
  guideStatus: "APPROVED",
  canPublish: true,
  offerings: [
    {
      id: "off_abc123",
      title: "Hidden gems of North Campus",
      slug: "hidden-gems-north-campus",
      status: "ACTIVE",
      topic: "campus-life",
      universityId: "uni_mit",
      durationMin: 45,
      priceCents: 2500,
      currency: "USD",
      description: "A 45-minute walk through the parts of campus the official tour skips.",
    },
  ],
  createdAt: "2025-09-01T12:00:00.000Z",
});

export const participantDashboardExample = envelope({
  kind: "participant",
  participant: {
    firstName: "Grace",
    lastName: "Hopper",
    displayName: "Grace H.",
    email: "grace@example.com",
    participantType: "STUDENT",
    gradeLevel: "12",
    intendedMajor: "Biology",
    topicsOfInterest: ["dorm-life", "research"],
    universitiesOfInterest: ["uni_mit", "uni_stanford"],
    guardianRequired: false,
  },
  nextTour: PARTICIPANT_NEXT_TOUR_EXAMPLE,
  upcomingBookings: [PARTICIPANT_UPCOMING_EXAMPLE],
  pendingActions: { unreadMessages: 2, awaitingReview: 1 },
  createdAt: "2026-01-15T09:30:00.000Z",
});

export const guideProgressExample = envelope({
  role: "guide",
  started: true,
  complete: false,
  canSubmit: true,
  applicationStatus: "PENDING_REVIEW",
  verificationStatus: null,
  steps: [{ key: "submitted", label: "Application submitted", done: false }],
});

export const participantProgressExample = envelope({
  role: "participant",
  started: true,
  complete: true,
  canSubmit: false,
  applicationStatus: null,
  verificationStatus: null,
  steps: [{ key: "profile", label: "Your details", done: true }],
});

// Reused Problem examples.
export const sessionExpiredProblem = problem(
  401,
  "Authentication required",
  "SESSION_EXPIRED",
  "No valid session — sign in again. The response also carries `Auth-Required: reauthenticate`.",
);
export const coreUnavailableProblem = problem(
  502,
  "Upstream service unavailable",
  "CORE_UNAVAILABLE",
  "The Core API was unreachable or returned a 5xx.",
);

export const authUpstreamUnavailableProblem = problem(
  503,
  "Sign-in service temporarily unavailable",
  "AUTH_UPSTREAM_UNAVAILABLE",
  "Could not refresh your session with Google. Your session is intact — retry shortly.",
);

// --- Booking request schemas (Contract A for booking operations) ---
//
// `MoneySchema`/`BookingResponseSchema`/`BookingListSchema` live earlier in this file (just
// above the dashboard payloads) so both the registered/published `ParticipantDashboard` schema
// and the runtime `ParticipantDashboardDataSchema` can reference `BookingResponseSchema`
// directly (module-scope `const`s must be initialized before use — no forward references).

/** Request body to create a new booking. */
export const CreateBookingRequestSchema = z.object({
  tourOfferingId: z.string(),
  scheduledStartAt: z.string(),
  participantNotes: z.string().max(1000).optional(),
});

/** Request body to cancel an existing booking. */
export const CancelBookingRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
});

// --- Availability schemas (Contract A for CTL-56: rules/exceptions/settings + slots) ---
//
// Wall-clock rule/exception/settings fields (`startLocal`, `windowMin`, `effectiveFrom`/
// `effectiveTo`, `exceptionDate`) carry no absolute instant and pass through from Core
// unchanged (CTL-49 only normalizes absolute instants). Only `settings.updatedAt` and the
// occurrence/slot `startAt`/`endAt` are absolute instants — reshaped to canonical UTC `Z`
// by src/api/_shared/reshape.ts before these schemas ever see them.

/** `kind` of a one-off availability exception. */
export const ExceptionKindEnum = z.enum(["UNAVAILABLE", "ADDITIONAL"]);

/** Whether a guide's bookings auto-confirm or require manual approval. */
export const AcceptanceModeEnum = z.enum(["AUTO", "MANUAL"]);

/** Request body to create a weekly recurring availability rule. */
export const CreateAvailabilityRuleRequestSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).openapi({
    description: "Day of week the rule applies to (0=Sunday .. 6=Saturday).",
    example: 1,
  }),
  startLocal: z.string().openapi({
    description: "Wall-clock start time of day, 24h `HH:mm`, in the guide's account timezone.",
    example: "09:00",
  }),
  windowMin: z.number().int().positive().openapi({
    description: "Window length in minutes (> 0).",
    example: 120,
  }),
  effectiveFrom: z.string().optional().openapi({
    description: "First date (inclusive, ISO-8601) the rule is active; omitted = always.",
    example: "2026-01-01",
  }),
  effectiveTo: z.string().optional().openapi({
    description: "Last date (inclusive, ISO-8601) the rule is active; omitted = open-ended.",
    example: "2026-12-31",
  }),
  active: z.boolean().optional().openapi({
    description: "Whether the rule is enabled; omitted defaults to true.",
    example: true,
  }),
});

/** Request body to update a rule — every field optional (partial update). */
export const UpdateAvailabilityRuleRequestSchema = CreateAvailabilityRuleRequestSchema.partial();

/** A guide's weekly recurring availability window (Core `AvailabilityRuleResponse`). */
export const AvailabilityRuleResponseSchema = registry.register(
  "AvailabilityRuleResponse",
  z
    .object({
      id: z.string().openapi({ description: "Rule id.", example: "r1" }),
      dayOfWeek: z.number().int().min(0).max(6).openapi({
        description: "Day of week the rule applies to (0=Sunday .. 6=Saturday).",
        example: 1,
      }),
      startLocal: z.string().openapi({
        description: "Wall-clock start time of day, 24h `HH:mm`.",
        example: "09:00",
      }),
      windowMin: z.number().int().positive().openapi({
        description: "Window length in minutes (> 0).",
        example: 120,
      }),
      timezone: z.string().openapi({
        description:
          "The guide's account timezone the wall-clock fields are relative to (IANA name).",
        example: "America/Los_Angeles",
      }),
      effectiveFrom: z.string().nullable().openapi({
        description: "First date (inclusive) the rule is active; null = always.",
        example: "2026-01-01",
      }),
      effectiveTo: z.string().nullable().openapi({
        description: "Last date (inclusive) the rule is active; null = open-ended.",
        example: null,
      }),
      active: z
        .boolean()
        .openapi({ description: "Whether the rule is currently enabled.", example: true }),
    })
    .openapi("AvailabilityRuleResponse", {
      description: "A guide's weekly recurring availability window.",
    }),
);

/**
 * Request body to create a one-off availability exception (Core `AvailabilityExceptionRequest`,
 * `POST /availability/exceptions`; CTL-56 B4 fix). The caller supplies EITHER `exceptionDate` (a
 * single date) OR both `dateFrom`/`dateTo` (an inclusive multi-day range, CTL-54 v2.1 Task 3) —
 * never a mix; `kind`/`startLocal`/`windowMin` are always required (Core
 * `AvailabilityWriteService.validateExceptionInput`). There is no separate ALL_DAY kind — an
 * all-day UNAVAILABLE block is expressed as `startLocal: "00:00"`, `windowMin: 1440`, not by
 * omitting the fields.
 */
export const CreateAvailabilityExceptionRequestSchema = z.object({
  exceptionDate: z
    .string()
    .optional()
    .openapi({
      description:
        "ISO-8601 date this exception applies to (single-date form). Mutually exclusive with " +
        "`dateFrom`/`dateTo`; required if those are omitted.",
      example: "2026-08-01",
    }),
  kind: ExceptionKindEnum.openapi({
    description:
      "UNAVAILABLE blocks the window (or whole day); ADDITIONAL adds an extra one-off window.",
    example: "UNAVAILABLE",
  }),
  startLocal: z.string().openapi({
    description:
      "Wall-clock start time `HH:mm`. Always required — an all-day UNAVAILABLE block is " +
      '`"00:00"` with `windowMin: 1440`, not an omitted value.',
    example: "09:00",
  }),
  windowMin: z.number().int().positive().openapi({
    description: "Window length in minutes (> 0). Always required.",
    example: 60,
  }),
  reason: z.string().optional().openapi({
    description: "Free-text reason, shown to the guide only.",
    example: "Holiday",
  }),
  dateFrom: z
    .string()
    .optional()
    .openapi({
      description:
        "ISO-8601 inclusive start date of a multi-day override. Requires `dateTo`; mutually " +
        "exclusive with `exceptionDate`. Capped at 366 days from `dateTo`.",
      example: "2026-08-01",
    }),
  dateTo: z
    .string()
    .optional()
    .openapi({
      description:
        "ISO-8601 inclusive end date of a multi-day override. Requires `dateFrom`; mutually " +
        "exclusive with `exceptionDate`.",
      example: "2026-08-03",
    }),
});

/**
 * Request body to update an exception (Core `AvailabilityExceptionRequest`,
 * `PATCH /availability/exceptions/{id}`; CTL-56 item 2 fix). This is NOT a partial patch: Core's
 * `AvailabilityWriteService.updateException` deletes the existing row and rebuilds it via the
 * SAME `validateExceptionInput` as create, so `kind`/`startLocal`/`windowMin` (and the
 * exceptionDate-XOR-dateFrom/dateTo choice) are required exactly as they are on create — the
 * shape is identical.
 */
export const UpdateAvailabilityExceptionRequestSchema = CreateAvailabilityExceptionRequestSchema;

/** One time window (a wall-clock start + a length in minutes) within an atomic override
 *  replace (Core `OverrideReplaceRequest.Window`, CTL-54 v2.1 B2). Wall-clock — no absolute
 *  instant, so name-for-name with the backend record. */
const OverrideReplaceWindowSchema = z.object({
  startLocal: z.string().openapi({
    description: "Wall-clock start time of day, 24h `HH:mm`, in the guide's settings timezone.",
    example: "09:00",
  }),
  windowMin: z.number().int().positive().openapi({
    description: "Window length in minutes (> 0).",
    example: 60,
  }),
});

/**
 * Request body for `POST /v1/availability/overrides/replace` — an ATOMIC single-day replace of
 * ONE kind's date-specific overrides (Core `OverrideReplaceRequest`, CTL-54 v2.1 B2). The
 * guide's existing same-kind exceptions for `date` are dropped and replaced by exactly `windows`
 * in one transaction (other-kind exceptions on that date are preserved, trimmed only where a new
 * window overlaps). An EMPTY `windows` list is allowed and means "clear this kind for the day".
 * Name-for-name with the backend record: a single `date` (NOT `dateFrom`/`dateTo`) — there is
 * deliberately no date-range field. `guideId` is server-resolved from the session; never in the body.
 */
export const OverrideReplaceRequestSchema = z.object({
  date: z.string().openapi({
    description: "ISO-8601 date whose same-kind overrides are being replaced.",
    example: "2026-07-12",
  }),
  kind: ExceptionKindEnum.openapi({
    description:
      "Which kind of override to replace on this date. UNAVAILABLE removes availability; " +
      "ADDITIONAL adds it. Only this kind's existing exceptions for the date are replaced.",
    example: "UNAVAILABLE",
  }),
  windows: z.array(OverrideReplaceWindowSchema).openapi({
    description:
      "The time windows this kind should have on the date after the replace. MAY be empty — an " +
      "empty list clears this kind for the day. Later windows trim earlier overlapping ones " +
      "(newest-wins).",
  }),
});

/** One time window (a wall-clock start + a length in minutes) within an atomic weekly-rule
 *  replace (Core `RulesReplaceRequest.Window`, CTL-54 v2.1 B2). Wall-clock — no absolute
 *  instant, so name-for-name with the backend record. */
const RulesReplaceWindowSchema = z.object({
  startLocal: z.string().openapi({
    description: "Wall-clock start time of day, 24h `HH:mm`, in the guide's settings timezone.",
    example: "09:00",
  }),
  windowMin: z.number().int().positive().openapi({
    description: "Window length in minutes (> 0).",
    example: 60,
  }),
});

/**
 * Request body for `POST /v1/availability/rules/replace` — an ATOMIC replace of ONE weekday's
 * recurring availability rules (Core `RulesReplaceRequest`, CTL-54 v2.1 B2, the weekly
 * counterpart to {@link OverrideReplaceRequestSchema}). The guide's existing ACTIVE rules for
 * `dayOfWeek` are dropped and replaced by exactly `windows` in one transaction (other weekdays
 * are untouched). An EMPTY `windows` list is allowed and means "clear this weekday's rules".
 * Name-for-name with the backend record: deliberately no `timezone`/`effectiveFrom`/
 * `effectiveTo`/`kind` field — every inserted rule takes the guide's settings timezone, an
 * open-ended effective range starting today, and is active (the read-only-tz invariant).
 * `guideId` is server-resolved from the session; never in the body.
 */
export const RulesReplaceRequestSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).openapi({
    description: "Day of week whose rules are being replaced (0=Sunday .. 6=Saturday).",
    example: 1,
  }),
  windows: z.array(RulesReplaceWindowSchema).openapi({
    description:
      "The time windows this weekday should have after the replace. MAY be empty — an empty " +
      "list clears this weekday's rules. Overlapping or touching windows are accepted and " +
      "merged (coalesced) into disjoint rules, not rejected.",
  }),
});

/** A one-off date override to a guide's recurring rules (Core `AvailabilityExceptionResponse`). */
export const AvailabilityExceptionResponseSchema = registry.register(
  "AvailabilityExceptionResponse",
  z
    .object({
      id: z.string().openapi({ description: "Exception id.", example: "e1" }),
      exceptionDate: z.string().openapi({
        description: "ISO-8601 date this exception applies to.",
        example: "2026-08-01",
      }),
      kind: ExceptionKindEnum.openapi({
        description:
          "UNAVAILABLE blocks the window (or whole day); ADDITIONAL adds an extra window.",
        example: "UNAVAILABLE",
      }),
      startLocal: z.string().openapi({
        description:
          "Wall-clock start time `HH:mm`. Always present — Core encodes an all-day block as `00:00`, never null.",
        example: "09:00",
      }),
      windowMin: z.number().int().positive().openapi({
        description:
          "Window length in minutes. Always present — Core encodes an all-day block as `1440`, never null.",
        example: 60,
      }),
      reason: z
        .string()
        .nullable()
        .openapi({ description: "Free-text reason (nullable).", example: "Holiday" }),
    })
    .openapi("AvailabilityExceptionResponse", {
      description: "A one-off date override to the guide's recurring rules.",
    }),
);

/** A guide's booking-acceptance and scheduling-window settings (Core `GuideBookingSettingsResponse`). */
export const AvailabilitySettingsResponseSchema = registry.register(
  "AvailabilitySettingsResponse",
  z
    .object({
      guideId: z.string().openapi({ description: "Guide's user id.", example: "g1" }),
      acceptanceMode: AcceptanceModeEnum.openapi({
        description: "Whether bookings auto-confirm (AUTO) or require guide approval (MANUAL).",
        example: "AUTO",
      }),
      responseDeadlineMin: z.number().int().openapi({
        description: "Minutes a guide has to respond to a pending booking (MANUAL mode).",
        example: 60,
      }),
      minNoticeMin: z.number().int().openapi({
        description: "Minimum lead time (minutes) a booking must be made ahead of its start.",
        example: 120,
      }),
      maxAdvanceDays: z.number().int().openapi({
        description: "How far in advance (days) a booking can be made.",
        example: 30,
      }),
      bufferBeforeMin: z.number().int().openapi({
        description: "Buffer (minutes) blocked immediately before each booking.",
        example: 10,
      }),
      bufferAfterMin: z.number().int().openapi({
        description: "Buffer (minutes) blocked immediately after each booking.",
        example: 10,
      }),
      durationsOffered: z.array(z.number().int()).openapi({
        description: "Tour durations (minutes) the guide offers.",
        example: [30, 60],
      }),
      timezone: z.string().openapi({
        description: "The guide's account timezone (IANA name).",
        example: "America/Los_Angeles",
      }),
      updatedAt: z.string().openapi({
        description: "Last-updated timestamp, canonical UTC `Z` (CTL-49).",
        example: "2026-07-01T12:00:00Z",
      }),
    })
    .openapi("AvailabilitySettingsResponse", {
      description: "A guide's booking-acceptance and scheduling-window settings.",
    }),
);

/** Request body to update settings — every field optional except the read-only `guideId`/`updatedAt`. */
export const UpdateAvailabilitySettingsRequestSchema = AvailabilitySettingsResponseSchema.omit({
  guideId: true,
  updatedAt: true,
}).partial();

/** A single resolved bookable window: an absolute UTC instant interval (CTL-49). Shared shape
 *  for the resolved-availability read's `occurrences` and the participant slots read. */
export const AvailabilityOccurrenceSchema = registry.register(
  "AvailabilityOccurrence",
  z
    .object({
      startAt: z.string().openapi({
        description: "Occurrence/slot start, canonical UTC `Z` (CTL-49).",
        example: "2026-08-01T15:00:00Z",
      }),
      endAt: z.string().openapi({
        description: "Occurrence/slot end, canonical UTC `Z` (CTL-49).",
        example: "2026-08-01T16:00:00Z",
      }),
    })
    .openapi("AvailabilityOccurrence", {
      description: "A single resolved bookable window (absolute UTC instant interval).",
    }),
);

/** `GET /v1/availability` — a guide's active rules + coalesced occurrences + DST gap-days. */
export const ResolvedAvailabilityResponseSchema = registry.register(
  "ResolvedAvailabilityResponse",
  z
    .object({
      rules: z
        .array(AvailabilityRuleResponseSchema)
        .openapi({ description: "The guide's active recurring rules." }),
      occurrences: z.array(AvailabilityOccurrenceSchema).openapi({
        description:
          "Coalesced, disjoint, ascending bookable occurrences over the requested window.",
      }),
      dstGapDays: z.array(z.string()).openapi({
        description:
          "ISO dates a DST spring-forward eliminates (zero wall-clock occurrences that day " +
          "even though a rule would otherwise apply).",
        example: ["2026-03-08"],
      }),
      bookable: z.boolean().openapi({
        description:
          "Derived readiness signal, passed through verbatim from backend (no recompute): " +
          "true iff the guide has at least one materialized occurrence that has not yet " +
          "ended, i.e. a participant could book right now.",
        example: true,
      }),
      hasWeeklyHours: z.boolean().openapi({
        description:
          "Derived readiness signal, passed through verbatim from backend (no recompute): " +
          "true iff the guide has at least one active weekly rule (an expired-but-active " +
          "rule still counts; a soft-deleted/inactive rule does not).",
        example: true,
      }),
    })
    .openapi("ResolvedAvailabilityResponse", {
      description:
        "The guide's resolved availability: rules + coalesced occurrences + DST gap-days.",
    }),
);

/** One field of the proposed override that a day's dry-run preview trimmed against an
 *  existing conflict (Core `OverridePreviewResponse.days[].trimmed`, CTL-54 v2.1). Wall-clock
 *  fields — no absolute instant, so CTL-49 does not touch this shape (same rationale as
 *  {@link AvailabilityExceptionResponseSchema}). */
const OverridePreviewTrimmedItemSchema = z.object({
  kind: ExceptionKindEnum.openapi({
    description: "Which side of the proposed override this trimmed entry names.",
    example: "ADDITIONAL",
  }),
  startLocal: z.string().openapi({
    description: "Wall-clock start time `HH:mm` of the (possibly trimmed) window.",
    example: "09:00",
  }),
  windowMin: z.number().int().positive().openapi({
    description: "Window length in minutes (> 0) after trimming against the conflict.",
    example: 30,
  }),
});

/** A single date's dry-run result within the override preview (Core
 *  `OverridePreviewResponse.days[]`, CTL-54 v2.1): the occurrences that date resolves to
 *  after applying the proposed override, and which requested fields got trimmed. */
const OverridePreviewDaySchema = z.object({
  date: z.string().openapi({
    description: "ISO-8601 date this day's dry-run result applies to.",
    example: "2026-07-18",
  }),
  resultingWindows: z.array(AvailabilityOccurrenceSchema).openapi({
    description:
      "Bookable windows this date resolves to after applying the proposed override, " +
      "canonical UTC `Z` (CTL-49).",
  }),
  trimmed: z.array(OverridePreviewTrimmedItemSchema).openapi({
    description:
      "Requested override fields (by `kind`) that were trimmed against an existing " +
      "conflict; empty when nothing was trimmed.",
  }),
  inert: z.boolean().openapi({
    description:
      "True when saving the proposed override won't materialize this date — it falls outside " +
      "the bookable horizon or is in the past (Core `OverridePreviewResponse.DatePreview.inert`, " +
      "CTL-54 v2.1). Passed through from Core verbatim; the BFF does not recompute it.",
    example: false,
  }),
});

/** `GET /v1/availability/preview` — a read-only, non-persisting dry-run of a proposed
 *  date-specific override across `[dateFrom, dateTo]` (Core `OverridePreviewResponse`,
 *  CTL-54 v2.1). */
export const OverridePreviewResponseSchema = registry.register(
  "OverridePreviewResponse",
  z
    .object({
      days: z.array(OverridePreviewDaySchema).openapi({
        description: "Per-date dry-run results across the requested `[dateFrom, dateTo]` range.",
      }),
      valid: z.boolean().openapi({
        description:
          "Whether the proposed override is valid. This preview is valid=true-always on " +
          "content (trimming, not rejection, resolves conflicts) — it only reports invalid on " +
          "a bad param/range.",
        example: true,
      }),
      message: z.string().nullable().openapi({
        description: "Human-readable detail; null when `valid` is true.",
        example: null,
      }),
    })
    .openapi("OverridePreviewResponse", {
      description:
        "Read-only, non-persisting dry-run preview of a proposed date-specific availability " +
        "override.",
    }),
);

/** One proposed window within a multi-window override preview request (Core `POST
 *  /availability/preview`, CTL-56 Phase 2 request body). Wall-clock, like {@link
 *  OverridePreviewTrimmedItemSchema} — no absolute instant. */
const OverrideMultiPreviewWindowSchema = z.object({
  startLocal: z.string().openapi({
    description: "Wall-clock start time of day, 24h `HH:mm`, in the guide's account timezone.",
    example: "09:00",
  }),
  windowMin: z.number().int().positive().openapi({
    description: "Window length in minutes (> 0).",
    example: 60,
  }),
});

/** Request body for `POST /v1/availability/preview` — the net result of applying MANY
 *  proposed windows together across `[dateFrom, dateTo]` (Core Phase 1, CTL-56 Phase 2).
 *  `guideId` is server-resolved from the session; never part of this body. */
export const OverrideMultiPreviewRequestSchema = z.object({
  dateFrom: z.string().openapi({
    description: "ISO-8601 first date (inclusive) of the proposed override.",
    example: "2026-07-18",
  }),
  dateTo: z.string().openapi({
    description: "ISO-8601 last date (inclusive) of the proposed override.",
    example: "2026-07-19",
  }),
  kind: ExceptionKindEnum.openapi({
    description:
      "UNAVAILABLE blocks the windows (or whole day); ADDITIONAL proposes extra windows.",
    example: "ADDITIONAL",
  }),
  windows: z.array(OverrideMultiPreviewWindowSchema).openapi({
    description:
      "The proposed windows to apply together — non-empty unless replaceExisting is true " +
      "(empty windows clears that kind for the day).",
  }),
  replaceExisting: z
    .boolean()
    .optional()
    .openapi({
      description:
        "When true, replace this kind's existing overrides for the day with exactly these " +
        "windows (empty windows clears them); when false or omitted, apply on top of existing.",
      example: true,
    }),
});

/** A booking whose schedule shifted or was cancelled as a side effect of an availability
 *  write (Core `AvailabilityWriteResponse.affectedBookings`, CTL-54). */
export const AffectedBookingSchema = registry.register(
  "AffectedBooking",
  z
    .object({
      bookingId: z.string().openapi({ description: "Affected booking id.", example: "b1" }),
      bookingNumber: z
        .string()
        .openapi({ description: "Human-facing booking number.", example: "BK-001" }),
      status: z.string().openapi({
        description: "The booking's status after the side effect.",
        example: "CONFIRMED",
      }),
      scheduledStartAt: z.string().openapi({
        description: "The booking's (possibly shifted) start, canonical UTC `Z` (CTL-49).",
        example: "2026-08-01T15:00:00Z",
      }),
      scheduledEndAt: z.string().openapi({
        description: "The booking's (possibly shifted) end, canonical UTC `Z` (CTL-49).",
        example: "2026-08-01T16:00:00Z",
      }),
    })
    .openapi("AffectedBooking", {
      description:
        "A booking whose schedule shifted or that was cancelled as a side effect of this " +
        "availability write — a warning list, not an error.",
    }),
);

/**
 * The write-response envelope an availability write returns: `data` (the written resource,
 * or its list on delete) alongside `affectedBookings`, both under the standard `meta`.
 * Distinct from the plain `{ data, meta }` read envelope ({@link Envelope}) — availability
 * writes are the only BFF routes that carry this sibling field (Core's
 * `AvailabilityWriteResponse`, CTL-54).
 */
export function WriteEnvelope<T extends z.ZodTypeAny>(
  data: T,
): z.ZodObject<{
  data: T;
  affectedBookings: z.ZodArray<typeof AffectedBookingSchema>;
  meta: typeof Meta;
}> {
  return z.object({
    data: data.openapi({ description: "The written resource (or its list on delete)." }),
    affectedBookings: z.array(AffectedBookingSchema).openapi({
      description:
        "Bookings whose schedule shifted or were cancelled as a side effect of this write.",
    }),
    meta: Meta,
  });
}

/** Wrap a payload example in the `{ data, affectedBookings, meta }` write envelope. */
export function writeEnvelope<T>(
  data: T,
  affectedBookings: z.infer<typeof AffectedBookingSchema>[] = [],
): {
  data: T;
  affectedBookings: z.infer<typeof AffectedBookingSchema>[];
  meta: { requestId: string };
} {
  return { data, affectedBookings, meta: { requestId: REQUEST_ID_EXAMPLE } };
}

// --- Runtime response-shape contracts (loose on Core passthrough, strict on BFF-owned) ---
//
// These are used by the dev-only assertion in src/api/_shared/envelope.ts and by the
// integration/contract tests to prove handler output ↔ schema ↔ spec stay in lockstep.
// See the module header for the strict/loose rationale.

/** A JSON object the BFF forwards verbatim from Core — any string-keyed shape passes. */
const LooseObject = z.record(z.string(), z.unknown());

/** The `{ data, meta: { requestId } }` success envelope, strict on the wrapper. */
export function envelopeOf<T extends z.ZodTypeAny>(
  data: T,
): z.ZodObject<{ data: T; meta: z.ZodObject<{ requestId: z.ZodString }> }> {
  return z.object({ data, meta: z.object({ requestId: z.string() }) });
}

/** GET /v1/dashboard guide `data` — strict on `kind`/`canPublish`/`offerings` (BFF-owned). */
export const GuideDashboardDataSchema = z.object({
  kind: z.literal("guide"),
  guide: LooseObject, // forwarded from Core — opaque
  guideStatus: z.string().nullable(), // forwarded from Core — value not constrained here
  canPublish: z.boolean(), // BFF-derived
  offerings: z.array(LooseObject), // BFF owns "it's an array"; items are Core-opaque
  createdAt: z.string().nullish(), // forwarded from Core (may be null, not just absent)
});

/** GET /v1/dashboard participant `data` — strict on `kind` + the array shape (BFF-owned). */
export const ParticipantDashboardDataSchema = z.object({
  kind: z.literal("participant"),
  participant: LooseObject, // forwarded from Core — opaque
  nextTour: BookingResponseSchema.nullable(), // reshaped to Contract-A (one booking shape)
  upcomingBookings: z.array(BookingResponseSchema), // reshaped to Contract-A
  pendingActions: z.unknown(), // Core-opaque (object | null)
  createdAt: z.string().nullish(), // forwarded from Core (may be null, not just absent)
});

/** GET /v1/dashboard `data`, discriminated by `kind`. */
export const DashboardDataSchema = z.discriminatedUnion("kind", [
  GuideDashboardDataSchema,
  ParticipantDashboardDataSchema,
]);

/** Full enveloped GET /v1/dashboard response contract. */
export const EnvelopedDashboardSchema = envelopeOf(DashboardDataSchema);

/** GET /v1/onboarding `data` — the `Progress` structure is entirely BFF-owned (strict). */
export const ProgressDataSchema = z.object({
  role: RoleEnum,
  started: z.boolean(),
  complete: z.boolean(),
  canSubmit: z.boolean(),
  applicationStatus: z.string().nullable(), // forwarded from Core — value not constrained here
  verificationStatus: z.string().nullable(), // deferred (currently always null)
  steps: z.array(z.object({ key: z.string(), label: z.string(), done: z.boolean() })),
});

/** Full enveloped GET /v1/onboarding response contract. */
export const EnvelopedProgressSchema = envelopeOf(ProgressDataSchema);

/** GET /auth/session — the bare, un-enveloped `{ authenticated }` boolean (BFF-owned). */
export const SessionStatusSchema = z.object({ authenticated: z.boolean() });
