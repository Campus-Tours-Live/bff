import type { Request, Response } from "express";
import {
  sendData,
  writeOpts,
  toZ,
  reshapeAffectedBooking,
  type CoreClient,
  type CoreAffectedBooking,
  type AffectedBookingResponse,
  type Json,
} from "../_shared/index.js";

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
  sendData(res, raw);
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
  sendData(res, raw);
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
  sendData(res, reshapeSettings(raw));
}

export async function updateSettings(req: Request, res: Response, core: CoreClient): Promise<void> {
  const { data, affectedBookings } = await core.patchFull<CoreGuideSettings, CoreAffectedBooking>(
    "/availability/settings",
    req.body,
    writeOpts(req, res),
  );
  sendWrite(res, reshapeSettings(data), affectedBookings);
}
