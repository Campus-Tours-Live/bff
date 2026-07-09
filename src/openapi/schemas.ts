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
    createdAt: z.string().openapi({
      description: 'Account creation timestamp (ISO-8601 UTC), rendered as "member since".',
      example: "2025-09-01T12:00:00.000Z",
    }),
  })
  .openapi("GuideDashboard", { description: "Signed-in home for a guide." });

/** GET /v1/dashboard, participant variant (src/api/dashboard/participant.ts). */
const ParticipantDashboard = z
  .object({
    kind: z.literal("participant").openapi({
      description: "Discriminator — always `participant` here.",
      example: "participant",
    }),
    participant: ParticipantProfile,
    nextTour: JsonObject.nullable().openapi({
      description:
        "The participant's next confirmed tour, forwarded from Core (opaque shape — see the " +
        "Core spec). Best-effort: null when there is none or the Core read fails.",
      example: {
        bookingId: "bk_789",
        offeringTitle: "Hidden gems of North Campus",
        startsAt: "2026-07-10T15:00:00.000Z",
      },
    }),
    upcomingBookings: z.array(JsonObject).openapi({
      description:
        "Upcoming bookings, forwarded from Core (opaque items). Best-effort: empty list on failure.",
      example: [
        {
          bookingId: "bk_790",
          offeringTitle: "Engineering quad tour",
          startsAt: "2026-07-14T18:00:00.000Z",
        },
      ],
    }),
    pendingActions: JsonObject.nullable().openapi({
      description:
        "Counts of actions needing attention, forwarded from Core (opaque). Best-effort: null on failure.",
      example: { unreadMessages: 2, awaitingReview: 1 },
    }),
    createdAt: z.string().openapi({
      description: 'Account creation timestamp (ISO-8601 UTC), rendered as "member since".',
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
  nextTour: {
    bookingId: "bk_789",
    offeringTitle: "Hidden gems of North Campus",
    startsAt: "2026-07-10T15:00:00.000Z",
  },
  upcomingBookings: [
    {
      bookingId: "bk_790",
      offeringTitle: "Engineering quad tour",
      startsAt: "2026-07-14T18:00:00.000Z",
    },
  ],
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

// --- Booking schemas (Contract A for booking operations) ---
//
// Defined here, ahead of the runtime response-shape contracts below, so
// `ParticipantDashboardDataSchema` can reference `BookingResponseSchema` directly (module-scope
// `const`s must be initialized before use — no forward references).

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
  displayTimeZone: z.string(),
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

/** Request body to create a new booking. */
export const CreateBookingRequestSchema = z.object({
  tourOfferingId: z.string(),
  scheduledStartAt: z.string(),
  displayTimezone: z.string(),
  participantNotes: z.string().max(1000).optional(),
});

/** Request body to cancel an existing booking. */
export const CancelBookingRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
});

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
  createdAt: z.string().optional(), // forwarded from Core
});

/** GET /v1/dashboard participant `data` — strict on `kind` + the array shape (BFF-owned). */
export const ParticipantDashboardDataSchema = z.object({
  kind: z.literal("participant"),
  participant: LooseObject, // forwarded from Core — opaque
  nextTour: BookingResponseSchema.nullable(), // reshaped to Contract-A (one booking shape)
  upcomingBookings: z.array(BookingResponseSchema), // reshaped to Contract-A
  pendingActions: z.unknown(), // Core-opaque (object | null)
  createdAt: z.string().optional(), // forwarded from Core
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
