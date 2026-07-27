import { jest } from "@jest/globals";
import {
  CreateAvailabilityExceptionRequestSchema,
  GuideDashboardDataSchema,
  GuideProfile,
  GuideUniversitySchema,
  ParticipantDashboardDataSchema,
  UpdateAvailabilityExceptionRequestSchema,
} from "@/openapi/schemas.js";

/**
 * `src/openapi/schemas.ts` re-derives `coreApiBaseUrl` from env (a deliberate duplicate of
 * config.ts's value) so the module stays importable without the required secrets — used by
 * the OpenAPI export for the Core /v3/api-docs server URL. This covers both branches of that
 * env default via an isolated re-import (the test env always sets CORE_API_BASE_URL).
 */
describe("openapi/schemas coreApiBaseUrl env default", () => {
  const saved = process.env.CORE_API_BASE_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.CORE_API_BASE_URL;
    else process.env.CORE_API_BASE_URL = saved;
    jest.resetModules();
  });

  it("falls back to http://localhost:8080 when CORE_API_BASE_URL is unset", async () => {
    delete process.env.CORE_API_BASE_URL;
    jest.resetModules();
    const { coreApiBaseUrl } = await import("@/openapi/schemas.js");
    expect(coreApiBaseUrl).toBe("http://localhost:8080");
  });

  it("uses CORE_API_BASE_URL when it is set", async () => {
    process.env.CORE_API_BASE_URL = "http://core.example:9999";
    jest.resetModules();
    const { coreApiBaseUrl } = await import("@/openapi/schemas.js");
    expect(coreApiBaseUrl).toBe("http://core.example:9999");
  });
});

/**
 * `CreateAvailabilityExceptionRequestSchema` (B4 remediation): the real Contract B shape
 * (backend `AvailabilityExceptionRequest.java` + `AvailabilityWriteService.validateExceptionInput`)
 * requires `kind`/`startLocal`/`windowMin` on every create, and requires EITHER `exceptionDate`
 * OR the `dateFrom`/`dateTo` multi-day range (CTL-54 v2.1 Task 3) — never `exceptionDate` as a
 * hard requirement with `startLocal`/`windowMin` merely optional, as the stale schema had it.
 */
describe("CreateAvailabilityExceptionRequestSchema (B4)", () => {
  it("accepts the classic single-date shape", () => {
    const result = CreateAvailabilityExceptionRequestSchema.safeParse({
      exceptionDate: "2026-08-01",
      kind: "UNAVAILABLE",
      startLocal: "09:00",
      windowMin: 60,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a multi-day dateFrom/dateTo range without exceptionDate", () => {
    const result = CreateAvailabilityExceptionRequestSchema.safeParse({
      dateFrom: "2026-08-01",
      dateTo: "2026-08-03",
      kind: "ADDITIONAL",
      startLocal: "09:00",
      windowMin: 60,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a request missing the required startLocal/windowMin", () => {
    const result = CreateAvailabilityExceptionRequestSchema.safeParse({
      exceptionDate: "2026-08-01",
      kind: "UNAVAILABLE",
    });
    expect(result.success).toBe(false);
  });
});

/**
 * `UpdateAvailabilityExceptionRequestSchema` (CTL-56 item 2 remediation): PATCH
 * `/availability/exceptions/{id}` is NOT a partial patch on Contract B — Core's
 * `AvailabilityWriteService.updateException` deletes the existing row and rebuilds it via the
 * SAME `validateExceptionInput` as create, reading `req.kind()`/`req.startLocal()`/
 * `req.windowMin()` unconditionally. So the update body requires the same fields as create; a
 * `.partial()` schema (the old shape) would wrongly accept a body missing `startLocal`/
 * `windowMin` that Core rejects.
 */
describe("UpdateAvailabilityExceptionRequestSchema (CTL-56 item 2)", () => {
  it("rejects a body missing the required startLocal/windowMin", () => {
    const result = UpdateAvailabilityExceptionRequestSchema.safeParse({
      exceptionDate: "2026-08-01",
      kind: "UNAVAILABLE",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a full valid body (same shape as create)", () => {
    const result = UpdateAvailabilityExceptionRequestSchema.safeParse({
      exceptionDate: "2026-08-01",
      kind: "UNAVAILABLE",
      startLocal: "09:00",
      windowMin: 60,
    });
    expect(result.success).toBe(true);
  });
});

describe("Dashboard data schemas tolerate a null createdAt (Core sends null, not undefined)", () => {
  it("GuideDashboardDataSchema accepts createdAt: null", () => {
    const result = GuideDashboardDataSchema.safeParse({
      kind: "guide",
      guide: {},
      guideStatus: null,
      canPublish: false,
      offerings: [],
      createdAt: null,
    });
    expect(result.success).toBe(true);
  });

  it("ParticipantDashboardDataSchema accepts createdAt: null", () => {
    const result = ParticipantDashboardDataSchema.safeParse({
      kind: "participant",
      participant: {},
      nextTour: null,
      upcomingBookings: [],
      pendingActions: null,
      createdAt: null,
    });
    expect(result.success).toBe(true);
  });
});

/**
 * `GuideProfile` (CTL-97 v2 Phase 2 Task 2.7): backend Task 2.3 replaced the flat single-school
 * fields (`universityId`/`universityName`/`universityShortName`/`major`/`classYear`) with a
 * per-school `universities[]` array (each entry also carrying `degree` and its own
 * `verificationStatus`). The dashboard `guide` embed itself stays a runtime `LooseObject`
 * (Core-opaque passthrough — see `GuideDashboardDataSchema`), so this is a doc-accuracy schema,
 * not a runtime gate; these tests pin down its documented shape.
 */
describe("GuideProfile (CTL-97 universities[])", () => {
  it("accepts the universities[] shape with per-school degree + verificationStatus", () => {
    const result = GuideProfile.safeParse({
      userId: "u_guide_123",
      applicationStatus: "APPROVED",
      universities: [
        {
          universityId: "uni_mit",
          universityName: "Massachusetts Institute of Technology",
          universityShortName: "MIT",
          major: "Computer Science",
          degree: "Bachelor's",
          classYear: "2026",
          verificationStatus: "VERIFIED",
        },
      ],
      bio: "Sophomore who loves showing off the maker space.",
      languages: ["en", "es"],
      specialties: ["engineering", "campus-life"],
      basePriceCents: 2500,
      currency: "USD",
    });
    expect(result.success).toBe(true);
  });

  it("no longer has the flat single-school fields at the top level", () => {
    const shape = GuideProfile.shape;
    expect(shape).not.toHaveProperty("universityId");
    expect(shape).not.toHaveProperty("universityName");
    expect(shape).not.toHaveProperty("universityShortName");
    expect(shape).not.toHaveProperty("major");
    expect(shape).not.toHaveProperty("classYear");
    expect(shape).not.toHaveProperty("verificationStatus");
    expect(shape).toHaveProperty("universities");
  });

  it("rejects a leaked schoolEmail on the top-level profile (strict parse)", () => {
    const result = GuideProfile.strict().safeParse({
      applicationStatus: "APPROVED",
      universities: [],
      schoolEmail: "guide@mit.edu",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a leaked schoolEmail on a per-school university entry (strict parse)", () => {
    const result = GuideUniversitySchema.strict().safeParse({
      universityId: "uni_mit",
      universityName: "MIT",
      schoolEmail: "guide@mit.edu",
    });
    expect(result.success).toBe(false);
  });
});
