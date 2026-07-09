import { jest } from "@jest/globals";

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
