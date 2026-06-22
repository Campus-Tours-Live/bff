/**
 * Per-test hardening (runs after the test framework is set up). Many suites stub
 * `global.fetch`; restore the real one after every test so a stub can never leak into
 * a later suite (which would make results order/parallelism dependent).
 */
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});
