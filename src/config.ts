/**
 * Centralised, validated configuration loaded from environment variables.
 * See .env.example for the full list.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Load the project's .env into process.env before any value below is read.
// (The dev/start scripts don't pass --env-file, so without this the .env is
// inert and everything silently falls back to the defaults here.) Variables
// already present in the real environment still take precedence.
const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Authentication is Google Sign-In (OAuth 2.0 / OIDC, Authorization Code + PKCE).
export const config = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3001",
  webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:3001",
  coreApiBaseUrl: process.env.CORE_API_BASE_URL ?? "http://localhost:8080",

  sessionSecret: required("SESSION_SECRET", process.env.SESSION_SECRET),

  isProd: process.env.NODE_ENV === "production",

  google: {
    clientId: required("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID),
    clientSecret: required("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET),
    // Must be registered as an Authorized redirect URI in the Google OAuth client.
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3001/auth/callback",
  },
} as const;
