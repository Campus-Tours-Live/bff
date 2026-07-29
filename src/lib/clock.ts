/**
 * Injectable clock — the single source of "now" for logic that needs deterministic,
 * test-controlled time (the pending-session 24h absolute lifetime and the guard that
 * enforces it). Production code must read `clock.now()` here rather than calling
 * `Date.now()` directly, so a test can pin `clock.now` to an exact value and assert the
 * `now < expiresAt` / `now === expiresAt` / `now > expiresAt` boundaries precisely.
 *
 * Deliberately a plain mutable object (not a class or a getter-only export): a test sets
 * `clock.now = () => FIXED_TIME` in `beforeEach` and restores `clock.now = () => Date.now()`
 * (or `jest.restoreAllMocks`-adjacent cleanup) in `afterEach` — no module mocking required.
 *
 * This does NOT replace every `Date.now()` call in the codebase (e.g. the near-token-expiry
 * refresh window in `src/api/_shared/session.ts` still reads `Date.now()` directly) — only
 * the pending-session timestamps (`writePendingSession`) and the central pending-expiry
 * guard (`bearerForSession`) are required to go through this clock.
 */
export interface Clock {
  now: () => number;
}

export const clock: Clock = {
  now: () => Date.now(),
};
