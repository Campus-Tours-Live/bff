/**
 * The helper DSL that BAKES IN Contract A's conventions so contributions can't drift.
 *
 * Every BFF-owned operation is registered through {@link apiRoute}, and its bodies are
 * built with {@link enveloped} (success) + {@link problem401}/{@link problem502}/
 * {@link problem422}/{@link problem400} (errors). That guarantees, by construction:
 *   - the `{ data, meta }` success envelope wraps every 200 aggregation body,
 *   - RFC 7807 `application/problem+json` is the single error shape,
 *   - `/v1` protected routes always carry the `sessionCookie` security scheme + 401/502,
 *   - and every operation has a `summary`, a `description`, and at least one `tag`
 *     (enforced at build time — {@link apiRoute} throws otherwise).
 *
 * See ./index.ts for how the paths are registered and bff/docs/openapi-conventions.md
 * for the contributor-facing guide.
 */
import type { z } from "zod";
import type { ResponseConfig, RouteConfig } from "@asteasolutions/zod-to-openapi";
import {
  Envelope,
  Problem,
  problem,
  registry,
  sessionExpiredProblem,
  coreUnavailableProblem,
} from "./schemas.js";

/** Either a single worked `example` or a map of named `examples` for a response body. */
type BodyExamples =
  | { example: unknown }
  | { examples: Record<string, { summary: string; value: unknown }> };

/** Build a `problem+json` response entry, optionally with a worked example. */
export function problemResponse(
  description: string,
  example?: z.infer<typeof Problem>,
): ResponseConfig {
  return {
    description,
    content: {
      "application/problem+json": {
        schema: Problem,
        ...(example ? { example } : {}),
      },
    },
  };
}

/**
 * A `200` response whose body is the standard `{ data, meta }` envelope around
 * `dataSchema`, carrying either a single `example` or named `examples`. The envelope is
 * baked in here so contributors never hand-roll (and so never forget) it.
 */
export function enveloped(
  dataSchema: z.ZodTypeAny,
  opts: { description: string } & BodyExamples,
): ResponseConfig {
  const { description, ...bodies } = opts;
  return {
    description,
    content: { "application/json": { schema: Envelope(dataSchema), ...bodies } },
  };
}

/** Standard `401 Unauthorized` (no/expired session or a Core 401). */
export function problem401(description: string): ResponseConfig {
  return problemResponse(description, sessionExpiredProblem);
}

/** Standard `502 Bad Gateway` (Core unreachable / 5xx). Override `example` for other codes. */
export function problem502(
  description: string,
  example: z.infer<typeof Problem> = coreUnavailableProblem,
): ResponseConfig {
  return problemResponse(description, example);
}

/** Standard `422 Unprocessable Entity` with a stable `code` (e.g. INVALID_ROLE). */
export function problem422(code: string, title: string, description: string): ResponseConfig {
  return problemResponse(description, problem(422, title, code));
}

/** Standard `400 Bad Request` with a stable `code` (e.g. AUTH_TX_MISSING). */
export function problem400(code: string, title: string, description: string): ResponseConfig {
  return problemResponse(description, problem(400, title, code));
}

/** Standard `404 Not Found` with a stable `code` (e.g. BOOKING_NOT_FOUND). */
export function problem404(code: string, title: string, description: string): ResponseConfig {
  return problemResponse(description, problem(404, title, code));
}

/** Standard `409 Conflict` (rare uncaught optimistic-lock retry). */
export function problem409(code: string, title: string, description: string): ResponseConfig {
  return problemResponse(description, problem(409, title, code));
}

/** {@link apiRoute} config — a RouteConfig plus an optional explicit `protected` flag. */
export type ApiRouteConfig = RouteConfig & {
  /**
   * Whether this is a session-protected route (adds `sessionCookie` security + default
   * 401/502 responses). Defaults to `true` for `/v1/*` paths, `false` otherwise.
   */
  protected?: boolean;
};

/**
 * The ONLY sanctioned way to register a BFF-owned path. A thin wrapper over
 * `registry.registerPath` that:
 *   - REQUIRES `summary`, `description`, and ≥1 `tags` (throws at build/import time if
 *     missing — a misconfigured operation fails the process, and thus CI, immediately);
 *   - for protected `/v1/*` routes, merges in the `sessionCookie` security scheme and
 *     default `401`/`502` problem responses (caller-supplied ones win, so bespoke
 *     descriptions are preserved).
 */
export function apiRoute(config: ApiRouteConfig): void {
  const where = `apiRoute(${config.method.toUpperCase()} ${config.path})`;
  if (!config.summary) throw new Error(`${where}: a non-empty \`summary\` is required.`);
  if (!config.description) throw new Error(`${where}: a non-empty \`description\` is required.`);
  if (!config.tags || config.tags.length === 0) {
    throw new Error(`${where}: at least one \`tags\` entry is required.`);
  }

  const { protected: isProtectedOpt, ...route } = config;
  const isProtected = isProtectedOpt ?? config.path.startsWith("/v1");
  // Stable operationId (e.g. GET /v1/dashboard -> getV1Dashboard) — satisfies Spectral's
  // operation-operationId rule and gives generated clients readable method names.
  route.operationId = route.operationId ?? operationIdFrom(config.method, config.path);

  if (isProtected) {
    route.security = route.security ?? [{ sessionCookie: [] }];
    // Defaults first, so caller-supplied 401/502 (with bespoke descriptions) override them.
    route.responses = {
      401: problem401("Authentication required — no/expired session or a Core 401."),
      502: problem502("The Core API was unreachable or returned a 5xx."),
      ...route.responses,
    };
  }

  registry.registerPath(route);
}

/** Derive a stable operationId from method + path, e.g. `get` + `/v1/dashboard` -> `getV1Dashboard`. */
function operationIdFrom(method: string, path: string): string {
  const tail = path
    .split("/")
    .filter(Boolean)
    .map((seg) => seg.replace(/[^a-zA-Z0-9]/g, ""))
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
  return method.toLowerCase() + tail;
}
