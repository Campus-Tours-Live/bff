import type { Request, Response } from "express";
import { z } from "zod";
import {
  sendData,
  assertShapeInDev,
  writeOpts,
  toZ,
  reshapeAffectedBooking,
  reshapeOccurrence,
  type CoreClient,
  type CoreAffectedBooking,
  type AffectedBookingResponse,
  type CoreOccurrence,
  type OccurrenceResponse,
  type Json,
} from "../_shared/index.js";
import {
  AvailabilityRuleResponseSchema,
  AvailabilityExceptionResponseSchema,
  AvailabilitySettingsResponseSchema,
  ResolvedAvailabilityResponseSchema,
  OverridePreviewResponseSchema,
  AffectedBookingSchema,
} from "../../openapi/schemas.js";

/**
 * The Core `AvailabilityRuleResponse` shape (Contract B). A weekly recurring window: no
 * absolute-instant fields — `startLocal` is a wall-clock time-of-day, `effectiveFrom` /
 * `effectiveTo` are dates — so Contract A passes this through unchanged (CTL-49 only
 * normalizes absolute instants, not wall-clock/local fields).
 */
export interface CoreAvailabilityRule {
  id: string;
  dayOfWeek: number;
  startLocal: string;
  windowMin: number;
  timezone: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean;
}

/**
 * The Core `AvailabilityExceptionResponse` shape (Contract B). Same rationale as
 * {@link CoreAvailabilityRule}: `exceptionDate` is a date, `startLocal` a wall-clock
 * time-of-day — no absolute instants, so this passes through unchanged.
 */
export interface CoreAvailabilityException {
  id: string;
  exceptionDate: string;
  kind: "UNAVAILABLE" | "ADDITIONAL";
  startLocal: string | null;
  windowMin: number | null;
  reason: string | null;
}

/**
 * The Core `GuideBookingSettingsResponse` shape (Contract B). Unlike the rule/exception
 * shapes above, `updatedAt` IS an absolute instant — the one field this module normalizes
 * to canonical UTC `Z` (CTL-49) via {@link reshapeSettings}.
 */
export interface CoreGuideSettings {
  guideId: string;
  acceptanceMode: string;
  responseDeadlineMin: number;
  minNoticeMin: number;
  maxAdvanceDays: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  durationsOffered: number[];
  timezone: string;
  updatedAt: string;
}

/** Reshape Core's settings into Contract A: normalize `updatedAt` to UTC `Z`, pass the rest
 *  through unchanged (wall-clock/count fields carry no timezone ambiguity). */
function reshapeSettings(c: CoreGuideSettings): CoreGuideSettings {
  return { ...c, updatedAt: toZ(c.updatedAt) };
}

/**
 * Send an availability write's response: Core's `AvailabilityWriteResponse{ data,
 * affectedBookings, meta }` (CTL-54), reshaped to Contract A — `data` passed through (or
 * settings-reshaped by the caller), `affectedBookings` normalized to UTC `Z`
 * ({@link reshapeAffectedBooking}), and a bff-owned `meta.requestId` (mirrors
 * `sendData`'s envelope, extended with the `affectedBookings` sibling field CTL-56 needs).
 *
 * **Shape guard (S3):** like {@link sendData}, this validates its outgoing payload in dev/test
 * via {@link assertShapeInDev} — `affectedBookings` (a BFF-owned, reshaped field) always against
 * {@link AffectedBookingSchema}, and `data` against the caller-supplied `dataSchema` when given —
 * so a drifted write response is caught (warned in dev, thrown in test) rather than silently
 * returned. Never runs in production.
 */
function sendWrite(
  res: Response,
  data: unknown,
  affectedBookings: CoreAffectedBooking[],
  dataSchema?: z.ZodType,
): void {
  const reshaped = affectedBookings.map(reshapeAffectedBooking);
  assertShapeInDev(data, dataSchema);
  assertShapeInDev(reshaped, z.array(AffectedBookingSchema));
  const body: { data: unknown; affectedBookings: AffectedBookingResponse[]; meta: Json } = {
    data,
    affectedBookings: reshaped,
    meta: { requestId: res.getHeader("X-Request-Id")?.toString() },
  };
  res.type("application/json").send(JSON.stringify(body));
}

// ---- Rules --------------------------------------------------------------------------------

export async function getRules(_req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.get<CoreAvailabilityRule[]>("/availability/rules");
  sendData(res, raw, z.array(AvailabilityRuleResponseSchema));
}

export async function createRule(req: Request, res: Response, core: CoreClient): Promise<void> {
  const { data, affectedBookings } = await core.postFull<CoreAvailabilityRule, CoreAffectedBooking>(
    "/availability/rules",
    req.body,
    writeOpts(req, res),
  );
  sendWrite(res, data, affectedBookings, AvailabilityRuleResponseSchema);
}

export async function updateRule(req: Request, res: Response, core: CoreClient): Promise<void> {
  const { data, affectedBookings } = await core.patchFull<
    CoreAvailabilityRule,
    CoreAffectedBooking
  >(
    `/availability/rules/${encodeURIComponent(req.params.id ?? "")}`,
    req.body,
    writeOpts(req, res),
  );
  sendWrite(res, data, affectedBookings, AvailabilityRuleResponseSchema);
}

export async function deleteRule(req: Request, res: Response, core: CoreClient): Promise<void> {
  const { data, affectedBookings } = await core.delFull<
    CoreAvailabilityRule[],
    CoreAffectedBooking
  >(`/availability/rules/${encodeURIComponent(req.params.id ?? "")}`, writeOpts(req, res));
  sendWrite(res, data, affectedBookings, z.array(AvailabilityRuleResponseSchema));
}

/**
 * Atomic weekly-rule replace (`POST /v1/availability/rules/replace`) — CTL-54 v2.1 remediation
 * B2 (Task 4), the weekly counterpart to {@link replaceOverrides}. Forwards the body
 * `{dayOfWeek, windows[]}` to Core's atomic replace of ONE weekday's ACTIVE recurring rules (an
 * empty `windows` list clears that weekday's rules; every other weekday is untouched), then
 * reshapes the write envelope to Contract A: `data` (the weekday's resulting rules) passes
 * through unchanged (wall-clock/date fields carry no timezone ambiguity), and
 * `affectedBookings` is normalized to canonical UTC `Z` by {@link sendWrite} (CTL-49). Core
 * COALESCES self-overlapping or touching windows into disjoint rules rather than rejecting them
 * (accept-and-resolve) — a Core 4xx (e.g. a window crossing midnight, or a bad `dayOfWeek`) is
 * relayed VERBATIM (status + message) via `withMutation`; this is a state-mutating POST, so its
 * route is CSRF-guarded like every other availability write.
 */
export async function replaceRules(req: Request, res: Response, core: CoreClient): Promise<void> {
  const { data, affectedBookings } = await core.postFull<
    CoreAvailabilityRule[],
    CoreAffectedBooking
  >("/availability/rules/replace", req.body, writeOpts(req, res));
  sendWrite(res, data, affectedBookings, z.array(AvailabilityRuleResponseSchema));
}

// ---- Exceptions -----------------------------------------------------------------------------

export async function getExceptions(_req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.get<CoreAvailabilityException[]>("/availability/exceptions");
  sendData(res, raw, z.array(AvailabilityExceptionResponseSchema));
}

export async function createException(
  req: Request,
  res: Response,
  core: CoreClient,
): Promise<void> {
  const { data, affectedBookings } = await core.postFull<
    CoreAvailabilityException,
    CoreAffectedBooking
  >("/availability/exceptions", req.body, writeOpts(req, res));
  sendWrite(res, data, affectedBookings, AvailabilityExceptionResponseSchema);
}

export async function updateException(
  req: Request,
  res: Response,
  core: CoreClient,
): Promise<void> {
  const { data, affectedBookings } = await core.patchFull<
    CoreAvailabilityException,
    CoreAffectedBooking
  >(
    `/availability/exceptions/${encodeURIComponent(req.params.id ?? "")}`,
    req.body,
    writeOpts(req, res),
  );
  sendWrite(res, data, affectedBookings, AvailabilityExceptionResponseSchema);
}

export async function deleteException(
  req: Request,
  res: Response,
  core: CoreClient,
): Promise<void> {
  const { data, affectedBookings } = await core.delFull<
    CoreAvailabilityException[],
    CoreAffectedBooking
  >(`/availability/exceptions/${encodeURIComponent(req.params.id ?? "")}`, writeOpts(req, res));
  sendWrite(res, data, affectedBookings, z.array(AvailabilityExceptionResponseSchema));
}

// ---- Atomic override replace (CTL-56 v2.1 B2) -----------------------------------------------

/**
 * Atomic single-day override replace (`POST /v1/availability/overrides/replace`) — CTL-54 v2.1
 * remediation B2. Forwards the body `{date, kind, windows[]}` to Core's atomic replace of ONE
 * kind's date-specific overrides for `date` (an empty `windows` list clears that kind for the
 * day), then reshapes the write envelope to Contract A: `data` (the resulting exception list)
 * passes through unchanged (wall-clock/date fields carry no timezone ambiguity), and
 * `affectedBookings` is normalized to canonical UTC `Z` by {@link sendWrite} (CTL-49). A Core
 * 4xx (e.g. a window crossing midnight) is relayed VERBATIM (status + message) via
 * `withMutation`; this is a state-mutating POST, so its route is CSRF-guarded like every other
 * availability write.
 */
export async function replaceOverrides(
  req: Request,
  res: Response,
  core: CoreClient,
): Promise<void> {
  const { data, affectedBookings } = await core.postFull<
    CoreAvailabilityException[],
    CoreAffectedBooking
  >("/availability/overrides/replace", req.body, writeOpts(req, res));
  sendWrite(res, data, affectedBookings, z.array(AvailabilityExceptionResponseSchema));
}

// ---- Settings -------------------------------------------------------------------------------

export async function getSettings(_req: Request, res: Response, core: CoreClient): Promise<void> {
  const raw = await core.get<CoreGuideSettings>("/availability/settings");
  sendData(res, reshapeSettings(raw), AvailabilitySettingsResponseSchema);
}

export async function updateSettings(req: Request, res: Response, core: CoreClient): Promise<void> {
  const { data, affectedBookings } = await core.patchFull<CoreGuideSettings, CoreAffectedBooking>(
    "/availability/settings",
    req.body,
    writeOpts(req, res),
  );
  sendWrite(res, reshapeSettings(data), affectedBookings, AvailabilitySettingsResponseSchema);
}

// ---- Resolved read (Task 3 — the CTL-55 frontend contract) ----------------------------------

/**
 * Core's resolved-availability read (`GET /availability`, CTL-54 Task 5b): the guide's active
 * rules, the coalesced/disjoint/ascending occurrences they resolve to over the requested
 * window, and any DST "gap days" (a local calendar day that a spring-forward transition
 * eliminates, so it has zero wall-clock occurrences even though a rule would otherwise apply).
 */
export interface CoreResolvedAvailability {
  rules: CoreAvailabilityRule[];
  occurrences: CoreOccurrence[];
  dstGapDays: string[];
  /** Derived readiness signal (backend CTL-54 B1): true iff the guide has at least one
   *  materialized occurrence that has not yet ended. Passed through verbatim — bff never
   *  recomputes availability. */
  bookable: boolean;
  /** Derived readiness signal (backend CTL-54 B1): true iff the guide has at least one active
   *  weekly rule. Passed through verbatim — bff never recomputes availability. */
  hasWeeklyHours: boolean;
}

/** Contract-A resolved-availability shape: `occurrences` normalized to canonical UTC `Z`
 *  (CTL-49); `rules` (wall-clock), `dstGapDays` (ISO dates, not instants), and the two
 *  backend-derived readiness flags `bookable`/`hasWeeklyHours` pass through unchanged — mirrors
 *  the rationale on {@link CoreAvailabilityRule}. */
export interface ResolvedAvailabilityResponse {
  rules: CoreAvailabilityRule[];
  occurrences: OccurrenceResponse[];
  dstGapDays: string[];
  bookable: boolean;
  hasWeeklyHours: boolean;
}

function reshapeResolvedAvailability(c: CoreResolvedAvailability): ResolvedAvailabilityResponse {
  return {
    rules: c.rules,
    occurrences: c.occurrences.map(reshapeOccurrence),
    dstGapDays: c.dstGapDays,
    bookable: c.bookable,
    hasWeeklyHours: c.hasWeeklyHours,
  };
}

/**
 * Resolved-availability read (`GET /v1/availability`) — the CTL-55 frontend contract. Reshapes
 * Core's rules + coalesced occurrences + DST gap-days: occurrences → canonical UTC `Z`
 * (CTL-49); rules and gap-days pass through unchanged (see {@link reshapeResolvedAvailability}).
 *
 * **`from`/`to` forwarded verbatim (no widening):** Core parses these optional ISO-date query
 * params in the GUIDE's own timezone (backend CTL-54 7c) — `from`/`to` anchor a guide-local
 * `[from 00:00, to 00:00)` calendar-day window — so Core already returns exactly the occurrences
 * that belong to the requested guide-local window, including late-local-evening ones whose UTC
 * instant lands on an adjacent UTC calendar day. An earlier ±1-day widening here was a
 * workaround for Core's PRIOR UTC-midnight anchoring; it is now redundant AND harmful (it would
 * pull in occurrences a full day outside the requested window that this handler cannot correctly
 * re-filter — the resolved response carries no top-level guide timezone). So both bounds are
 * forwarded verbatim (string-guarded), and the correct guide-local filtering stays
 * backend-authoritative. A malformed `from`/`to` reaches Core unchanged and Core's 4xx is
 * relayed rather than crashing this handler.
 */
export async function getAvailability(
  req: Request,
  res: Response,
  core: CoreClient,
): Promise<void> {
  const params = new URLSearchParams();
  const { from, to } = req.query;
  if (typeof from === "string") params.set("from", from);
  if (typeof to === "string") params.set("to", to);
  const qs = params.toString();
  const raw = await core.get<CoreResolvedAvailability>(`/availability${qs ? `?${qs}` : ""}`);
  sendData(res, reshapeResolvedAvailability(raw), ResolvedAvailabilityResponseSchema);
}

// ---- Override dry-run preview (CTL-56 v2.1 Task 1) -------------------------------------------

/** A single day's dry-run result within the Core `GET /availability/preview` response
 *  (CTL-54 v2.1): the resolved occurrences after applying the proposed override, and which
 *  of the caller's requested override params got trimmed against an existing conflict. */
export interface CorePreviewDay {
  date: string;
  resultingWindows: CoreOccurrence[];
  trimmed: { kind: string; startLocal: string; windowMin: number }[];
  /** True when the save won't materialize this date (out-of-horizon / past); passed through
   *  from Core Contract B (`OverridePreviewResponse.DatePreview.inert`, CTL-54 v2.1). */
  inert: boolean;
}

/** The Core `OverridePreviewResponse` shape (Contract B, CTL-54 v2.1): a read-only, non-
 *  persisting dry-run of a proposed date-specific override across `[dateFrom, dateTo]`. */
export interface CoreOverridePreview {
  days: CorePreviewDay[];
  valid: boolean;
  message: string | null;
}

/** Contract-A per-day preview shape: `resultingWindows` normalized to canonical UTC `Z`
 *  (CTL-49); `date`/`trimmed` are wall-clock/local fields and pass through unchanged. */
export interface OverridePreviewDayResponse {
  date: string;
  resultingWindows: OccurrenceResponse[];
  trimmed: { kind: string; startLocal: string; windowMin: number }[];
  /** True for dates the save won't materialize (out-of-horizon / past); passed through from
   *  Core verbatim (name-for-name with Contract B), no recompute. */
  inert: boolean;
}

/** Contract-A override-preview response: same shape as Core's, with every day's
 *  `resultingWindows` reshaped to UTC `Z`; `valid`/`message` pass through unchanged. */
export interface OverridePreviewResponse {
  days: OverridePreviewDayResponse[];
  valid: boolean;
  message: string | null;
}

/** Reshape Core's dry-run preview into Contract A: map each day's `resultingWindows` through
 *  {@link reshapeOccurrence}; `date`/`trimmed`/`valid`/`message` pass through unchanged. */
function reshapeOverridePreview(c: CoreOverridePreview): OverridePreviewResponse {
  return {
    days: c.days.map((d) => ({
      date: d.date,
      resultingWindows: d.resultingWindows.map(reshapeOccurrence),
      trimmed: d.trimmed,
      inert: d.inert,
    })),
    valid: c.valid,
    message: c.message,
  };
}

/** The five query params the override dry-run preview accepts, forwarded to Core verbatim
 *  (string-guarded) in the same order they're documented — see {@link getOverridePreview}. */
const PREVIEW_QUERY_PARAMS = ["dateFrom", "dateTo", "kind", "startLocal", "windowMin"] as const;

/**
 * Override dry-run preview (`GET /v1/availability/preview`) — CTL-54 v2.1's read-only,
 * non-persisting preview of a proposed date-specific override (`dateFrom`/`dateTo`/`kind`/
 * `startLocal`/`windowMin`). Reshapes each day's `resultingWindows` to canonical UTC `Z`
 * (CTL-49); `trimmed`/`valid`/`message` pass through unchanged (see
 * {@link reshapeOverridePreview}).
 *
 * **No window widening (unlike {@link getAvailability}):** `dateFrom`/`dateTo` here are the
 * EXACT override the caller is proposing to create, not a display window being resolved —
 * widening them would silently change what's being previewed. So this handler forwards all
 * five params verbatim; a malformed/out-of-range value (e.g. a >366-day span) reaches Core
 * unchanged and Core's 4xx is relayed VERBATIM (status + message) via `withMutation` (B3),
 * so the specific reason reaches the guide instead of a generic `UPSTREAM_ERROR`.
 */
export async function getOverridePreview(
  req: Request,
  res: Response,
  core: CoreClient,
): Promise<void> {
  const params = new URLSearchParams();
  for (const key of PREVIEW_QUERY_PARAMS) {
    const value = req.query[key];
    if (typeof value === "string") params.set(key, value);
  }
  const qs = params.toString();
  const raw = await core.get<CoreOverridePreview>(`/availability/preview${qs ? `?${qs}` : ""}`);
  sendData(res, reshapeOverridePreview(raw), OverridePreviewResponseSchema);
}

// ---- Multi-window override dry-run preview (CTL-56 Phase 2) ----------------------------------

/**
 * Request body for the multi-window override dry-run preview (`POST /availability/preview`,
 * Core Phase 1): the net result of applying MANY proposed windows together across
 * `[dateFrom, dateTo]`, in one shot — unlike {@link getOverridePreview}'s single
 * `startLocal`/`windowMin` pair. `guideId` is server-resolved from the bearer token, so it is
 * never part of this body. Forwarded to Core verbatim (no validation, no widening) — Core is
 * the source of truth for a bad/empty `windows` array or an out-of-range date span (422).
 */
export interface CoreMultiPreviewBody {
  dateFrom: string;
  dateTo: string;
  kind: "UNAVAILABLE" | "ADDITIONAL";
  windows: { startLocal: string; windowMin: number }[];
}

/**
 * Multi-window override dry-run preview (`POST /v1/availability/preview`) — CTL-56 Phase 2's
 * read-only, non-persisting preview of a proposed date-specific override built from MANY time
 * windows applied together (`windows[]`), as opposed to {@link getOverridePreview}'s single
 * window. The response shape is IDENTICAL to the single-window preview's, so this reuses
 * {@link CoreOverridePreview} / {@link reshapeOverridePreview} / {@link
 * OverridePreviewResponseSchema} unchanged — reshapes each day's `resultingWindows` to
 * canonical UTC `Z` (CTL-49); `date`/`trimmed`/`valid`/`message` pass through unchanged.
 *
 * **Why POST, and why no CSRF guard:** this is a read (a dry-run — nothing is persisted), but
 * `windows[]` doesn't fit in a query string, so it travels as a POST body. Unlike this
 * router's other POST routes (which mutate state and go through `csrfGuard` + `withMutation`),
 * this one is registered with `withMutation` (verbatim error relay) but WITHOUT `csrfGuard`,
 * matching the GET preview above: a cross-site
 * caller riding the session cookie can only trigger a computation whose result it cannot read
 * (the browser blocks reading a cross-origin response body without CORS) and that changes no
 * state, so there is nothing for CSRF defenses to protect against.
 */
export async function getOverrideMultiPreview(
  req: Request,
  res: Response,
  core: CoreClient,
): Promise<void> {
  const raw = await core.post<CoreOverridePreview>(
    "/availability/preview",
    req.body,
    writeOpts(req, res),
  );
  sendData(res, reshapeOverridePreview(raw), OverridePreviewResponseSchema);
}
