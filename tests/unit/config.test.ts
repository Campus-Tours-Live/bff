import { jest } from "@jest/globals";

/**
 * config.ts reads + validates env at module load, so each case re-imports it
 * fresh (jest.resetModules) with a tailored process.env. The required-var throw
 * mocks node:fs's existsSync → false so config.ts skips loadEnvFile and the throw
 * is deterministic regardless of any real bff/.env on the machine.
 *
 * NOTE: setup.ts sets all required vars before any module loads; tests that need
 * a var ABSENT delete it from a cloned env after resetModules.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

describe("config defaults (optional vars unset)", () => {
  it("applies the documented fallbacks", async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.PORT;
    delete process.env.WEB_ORIGIN;
    delete process.env.WEB_BASE_URL;
    delete process.env.CORE_API_BASE_URL;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.NODE_ENV;
    jest.resetModules();

    const { config } = await import("@/config.js");

    expect(config.port).toBe(4000);
    expect(config.webOrigin).toBe("http://localhost:3001");
    expect(config.webBaseUrl).toBe("http://localhost:3001");
    expect(config.coreApiBaseUrl).toBe("http://localhost:8080");
    expect(config.google.redirectUri).toBe("http://localhost:3001/auth/callback");
    expect(config.isProd).toBe(false);
  });
});

describe("config overrides (env present)", () => {
  it("reads values from the environment", async () => {
    process.env = { ...ORIGINAL_ENV };
    process.env.PORT = "5555";
    process.env.WEB_ORIGIN = "https://app.example";
    process.env.CORE_API_BASE_URL = "https://core.example";
    process.env.NODE_ENV = "production";
    jest.resetModules();

    const { config } = await import("@/config.js");

    expect(config.port).toBe(5555);
    expect(config.webOrigin).toBe("https://app.example");
    expect(config.coreApiBaseUrl).toBe("https://core.example");
    expect(config.isProd).toBe(true);
  });

  it("exposes the Google client credentials", async () => {
    process.env = { ...ORIGINAL_ENV };
    process.env.GOOGLE_CLIENT_ID = "id-xyz";
    process.env.GOOGLE_CLIENT_SECRET = "secret-xyz";
    jest.resetModules();

    const { config } = await import("@/config.js");

    expect(config.google.clientId).toBe("id-xyz");
    expect(config.google.clientSecret).toBe("secret-xyz");
    expect(config.sessionSecret).toBeTruthy();
  });
});

describe("config required-var validation", () => {
  it.each(["SESSION_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])(
    "throws when %s is missing",
    async (name) => {
      jest.resetModules();
      // Skip loadEnvFile so a real bff/.env can't re-populate the deleted var.
      jest.unstable_mockModule("node:fs", () => ({ existsSync: () => false }));

      process.env = { ...ORIGINAL_ENV };
      delete process.env[name];

      await expect(import("@/config.js")).rejects.toThrow(
        new RegExp(`Missing required env var: ${name}`),
      );
    },
  );
});
