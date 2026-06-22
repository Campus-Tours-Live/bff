/**
 * Deterministic test environment. Runs before any module (so before config.ts reads
 * env): sets dummy values for the required vars, so tests never depend on the real
 * bff/.env or real secrets. config.ts's loadEnvFile does not override existing
 * process.env, so these win.
 */
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.WEB_ORIGIN = "http://localhost:3001";
process.env.WEB_BASE_URL = "http://localhost:3001";
process.env.CORE_API_BASE_URL = "http://core.test";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3001/auth/callback";
process.env.BFF_URL = "http://localhost:4000";
