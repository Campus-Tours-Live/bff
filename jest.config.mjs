/**
 * Jest config for the BFF (ESM TypeScript). ts-jest runs the .ts sources as ESM
 * (so `import.meta` etc. work); the moduleNameMapper strips the ".js" extension that
 * ESM relative imports use, so ts-jest resolves the real ".ts" file.
 *
 * Run with NODE_OPTIONS=--experimental-vm-modules (see package.json scripts).
 *
 * Unit and integration tests live in SEPARATE folders:
 *   tests/unit/**         — isolated units (deps mocked or pure)
 *   tests/integration/**  — the real Express app via supertest, with Core/Google mocked
 */
/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  moduleNameMapper: {
    // "@/x.js" → src/x  (alias for tests; strips the ESM .js extension)
    "^@/(.*)\\.js$": "<rootDir>/src/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
    // relative "./x.js" → "./x" so ts-jest resolves the .ts source
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  setupFiles: ["<rootDir>/tests/setup.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup-after-env.ts"],
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  // Coverage (`npm run test:coverage`). index.ts is the bootstrap/listen entry — excluded.
  // Measure ONLY production code under src/ (exclude test files/helpers and the bootstrap entry).
  // Without this, Jest also instruments the test _helpers, which drags the global numbers down.
  collectCoverageFrom: ["src/**/*.ts", "!src/index.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "text-summary", "html", "lcov"],
  // Coverage gate (`npm run test:coverage`): a 90% floor across the board. Actual coverage is
  // ~100% (the only truly-unreachable defensive branches are marked `/* istanbul ignore */`);
  // the 90% floor leaves headroom so a small future change doesn't break the build.
  coverageThreshold: {
    global: { statements: 90, functions: 90, lines: 90, branches: 90 },
  },
};
