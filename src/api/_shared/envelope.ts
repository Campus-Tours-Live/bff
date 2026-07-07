import type { Response } from "express";
import type { z } from "zod";
import { sendProblem } from "../../util/problem.js";

/**
 * Dev-only response-shape guard. When a `schema` is supplied and we're NOT in production,
 * `safeParse` the outgoing payload against its documented zod schema and surface drift:
 *   - always `console.warn` on a mismatch (visible during `npm run dev`);
 *   - additionally THROW under `NODE_ENV==='test'`, so the existing integration/unit suites
 *     that already exercise these endpoints fail on drift — no separate assertion needed.
 * Never runs in production (never throws, never changes the response). The schemas are
 * intentionally loose on Core-forwarded fields and strict on BFF-owned ones (see
 * src/openapi/schemas.ts), so this only fires when the BFF's own contract actually drifts.
 */
function assertShapeInDev(data: unknown, schema?: z.ZodType): void {
  if (!schema || process.env.NODE_ENV === "production") return;
  const result = schema.safeParse(data);
  if (result.success) return;
  const message =
    "[response-shape] aggregation payload does not match its documented zod schema — update " +
    "the schema in src/openapi/schemas.ts (and its example/spec). Issues: " +
    JSON.stringify(result.error.issues);
  console.warn(message);
  if (process.env.NODE_ENV === "test") throw new Error(message);
}

/** Wrap an aggregated payload in the standard { data, meta } success envelope.
 *  `meta.requestId` echoes the per-request correlation id for tracing. When a `schema`
 *  is passed, the payload is shape-checked against it in dev/test (see assertShapeInDev). */
export function sendData(res: Response, data: unknown, schema?: z.ZodType): void {
  assertShapeInDev(data, schema);
  res
    .type("application/json")
    .send(JSON.stringify({ data, meta: { requestId: res.getHeader("X-Request-Id")?.toString() } }));
}

export function coreUnavailable(res: Response): void {
  sendProblem(res, 502, "Upstream service unavailable", { code: "CORE_UNAVAILABLE" });
}
