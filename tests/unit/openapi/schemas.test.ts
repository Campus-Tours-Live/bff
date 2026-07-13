import { jest } from "@jest/globals";
import { CreateAvailabilityExceptionRequestSchema } from "@/openapi/schemas.js";

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
