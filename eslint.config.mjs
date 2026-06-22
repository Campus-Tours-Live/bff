// Flat ESLint config (ESLint v9) for the BFF — TypeScript via typescript-eslint, with
// Prettier turned off as a linter (eslint-config-prettier) so formatting is Prettier's job.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // Allow intentionally-unused names when prefixed with "_" (e.g. unused middleware args).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // The BFF logs to the console on purpose (startup banner, auth-callback diagnostics).
      "no-console": "off",
    },
  },
);
