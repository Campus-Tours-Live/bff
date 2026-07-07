/**
 * Export the in-code OpenAPI document to a JSON file so external tooling (Spectral, code
 * generators, diffing) can read the CURRENT spec without booting the server. Run via
 * `npm run openapi:export`; `npm run openapi:lint` runs this first so it always lints the
 * spec as it stands right now. The output (openapi.json) is git-ignored — it's a build
 * artifact, regenerated on demand.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { openapiSpec } from "../src/openapi/index.js";

const outFile = resolve(dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
writeFileSync(outFile, JSON.stringify(openapiSpec, null, 2) + "\n");
console.log(`Wrote ${outFile}`);
