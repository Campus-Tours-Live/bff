import type { Request, Response } from "express";
import { z } from "zod";
import {
  sendData,
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
 */
function sendWrite(res: Response, data: unknown, affectedBookings: CoreAffectedBooking[]): void {
  const body: { data: unknown; affectedBookings: AffectedBookingResponse[]; meta: Json } = {
    data,
    affectedBookings: affectedBookings.map(reshapeAffectedBooking),
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
  sendWrite(res, data, affectedBookings);
}

export async function updateRule(req: Request, res: Response, core: CoreClient): Promise<void> {
  const { data, affectedBookings } = await core.patchFull<
    CoreAvailabilityRule,
    CoreAffectedBooking
  >(`/availability/rules/${req.params.id}`, req.body, writeOpts(req, res));
  sendWrite(res, data, affectedBookings);
}

export async function deleteRule(req: Request, res: Response, core: CoreClient): Promise<void> {
  const { data, affectedBookings } = await core.delFull<
    CoreAvailabilityRule[],
    CoreAffectedBooking
  >(`/availability/rules/${req.params.id}`, writeOpts(req, res));
  sendWrite(res, data, affectedBookings);
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
  sendWrite(res, data, affectedBookings);
}

export async function updateException(
  req: Request,
  res: Response,
  core: CoreClient,
): Promise<void> {
  const { data, affectedBookings } = await core.patchFull<
    CoreAvailabilityException,
    CoreAffectedBooking
  >(`/availability/exceptions/${req.params.id}`, req.body, writeOpts(req, res));
  sendWrite(res, data, affectedBookings);
}

export async function deleteException(
  req: Request,
  res: Response,
  core: CoreClient,
): Promise<void> {
  const { data, affectedBookings } = await core.delFull<
    CoreAvailabilityException[],
    CoreAffectedBooking
  >(`/availability/exceptions/${req.params.id}`, writeOpts(req, res));
  sendWrite(res, data, affectedBookings);
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
  sendWrite(res, reshapeSettings(data), affectedBookings);
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
}

/** Contract-A resolved-availability shape: `occurrences` normalized to canonical UTC `Z`
 *  (CTL-49); `rules` (wall-clock) and `dstGapDays` (ISO dates, not instants) pass through
 *  unchanged — mirrors the rationale on {@link CoreAvailabilityRule}. */
export interface ResolvedAvailabilityResponse {
  rules: CoreAvailabilityRule[];
  occurrences: OccurrenceResponse[];
  dstGapDays: string[];
}

function reshapeResolvedAvailability(c: CoreResolvedAvailability): ResolvedAvailabilityResponse {
  return {
    rules: c.rules,
    occurrences: c.occurrences.map(reshapeOccurrence),
    dstGapDays: c.dstGapDays,
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Widen an ISO `yyyy-MM-dd` date string by `deltaDays` UTC calendar days (e.g. `-1` for `from`,
 * `+1` for `to`). Returns `undefined` if `input` isn't a well-formed ISO date — the caller then
 * falls back to forwarding the original string verbatim, so a malformed value still reaches
 * Core and gets rejected the same way it did before this fix (no crash, no silent swallow).
 */
function widenIsoDate(input: string, deltaDays: number): string | undefined {
  if (!ISO_DATE_RE.test(input)) return undefined;
  const ms = Date.parse(`${input}T00:00:00Z`);
  // The regex only guarantees the `\d{4}-\d{2}-\d{2}` SHAPE, not that the numbers are a real
  // date: a shape-valid but value-invalid string (e.g. month > 12 like `2026-13-01`, or
  // `2026-08-32`) makes `Date.parse` return NaN. Any client can send such a value, so this
  // branch IS reachable — return `undefined` so the caller forwards the original string to Core
  // verbatim (Core validates and 4xxs it), matching how a shape-invalid string is handled.
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms + deltaDays * ONE_DAY_MS).toISOString().slice(0, 10);
}

/**
 * Resolved-availability read (`GET /v1/availability`) — the CTL-55 frontend contract. Reshapes
 * Core's rules + coalesced occurrences + DST gap-days: occurrences → canonical UTC `Z`
 * (CTL-49); rules and gap-days pass through unchanged (see {@link reshapeResolvedAvailability}).
 *
 * **`from`/`to` window widening (edge-occurrence fix):** Core's `from`/`to` (optional ISO-date
 * query params) filter occurrences against a **UTC-midnight-anchored** window
 * (`from T00:00:00Z .. to T00:00:00Z`), NOT a guide-local one. For a guide far from UTC, an
 * occurrence that belongs to the requested guide-local day can have a UTC instant that falls
 * just outside that UTC-anchored window and gets silently dropped. To avoid that data loss,
 * this handler widens whichever of `from`/`to` is present by **1 calendar day** on that side
 * (`coreFrom = from - 1 day`, `coreTo = to + 1 day`) before forwarding to Core — 1 day
 * comfortably exceeds the largest real IANA UTC offset (±14h), so Core returns every occurrence
 * that could belong to the guide-local `[from, to)` window, plus a small margin. The returned
 * set may therefore include a few occurrences just outside the exact requested window; that is
 * acceptable and strictly better than silently losing edge occurrences. **Precise guide-local
 * re-anchoring/re-filtering of the returned set to the exact requested window is a tracked
 * follow-up**, not done here. A malformed `from`/`to` is forwarded unwidened (Core will reject
 * it, matching this handler's pre-existing behavior) rather than crashing this handler.
 */
export async function getAvailability(
  req: Request,
  res: Response,
  core: CoreClient,
): Promise<void> {
  const params = new URLSearchParams();
  const { from, to } = req.query;
  if (typeof from === "string") params.set("from", widenIsoDate(from, -1) ?? from);
  if (typeof to === "string") params.set("to", widenIsoDate(to, 1) ?? to);
  const qs = params.toString();
  const raw = await core.get<CoreResolvedAvailability>(`/availability${qs ? `?${qs}` : ""}`);
  sendData(res, reshapeResolvedAvailability(raw), ResolvedAvailabilityResponseSchema);
}
