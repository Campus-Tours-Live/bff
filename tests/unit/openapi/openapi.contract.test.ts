/**
 * Project-specific OpenAPI convention + drift guard — the rules Spectral can't see.
 *
 * This is the safety net that keeps the Express app, the zod schemas, and the generated
 * spec in lockstep:
 *   - **Drift guard:** every BFF-OWNED route wired into the Express app (walked live from the
 *     router stack) must be documented in the spec. Add a route, forget the docs → red.
 *   - Every operation carries a summary, description, and ≥1 tag.
 *   - Every protected `/v1/*` operation declares the `sessionCookie` security scheme and
 *     documents 401 + 502.
 *   - Every `/v1/*` 200 body is the `{ data, meta }` envelope and ships an example.
 */
import { app } from "@/app.js";
import { openapiSpec } from "@/openapi/index.js";

// --- Live route extraction from the Express app ------------------------------------------

interface RouteLayer {
  name?: string;
  route?: { path: string; methods: Record<string, boolean> };
  regexp?: { source?: string; fast_slash?: boolean };
  handle?: { stack?: RouteLayer[] };
}

/** Infra/utility routes the BFF exposes but does NOT document as Contract A. */
const INFRA_ROUTES = new Set(["/health", "/openapi.json"]);

/** Recover the mount prefix (e.g. "/auth", "/v1") a sub-router was mounted at, from its regexp. */
function mountPrefix(regexp?: { source?: string; fast_slash?: boolean }): string {
  if (!regexp || regexp.fast_slash || !regexp.source) return "";
  const prefix = regexp.source.match(/^\^\\\/(.+?)\\\/\?/)?.[1];
  return prefix ? "/" + prefix.replace(/\\\//g, "/") : "";
}

/**
 * Walk the Express router stack, recursing into mounted sub-routers (e.g. /auth, /v1), and
 * collect every concrete `(method, path)` route. `coreProxy` (the /v1 catch-all) is a plain
 * middleware function, not a Router, so it contributes no routes and is naturally excluded;
 * the /docs Swagger middleware likewise has no `.route`.
 */
function extractRoutes(stack: RouteLayer[], prefix = ""): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];
  for (const layer of stack) {
    if (layer.route) {
      const path = (prefix + layer.route.path).replace(/:([^/]+)/g, "{$1}");
      for (const [method, on] of Object.entries(layer.route.methods)) {
        if (on) out.push({ method: method.toLowerCase(), path });
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      out.push(...extractRoutes(layer.handle.stack, prefix + mountPrefix(layer.regexp)));
    }
  }
  return out;
}

function appRouterStack(): RouteLayer[] {
  const a = app as unknown as {
    _router?: { stack: RouteLayer[] };
    router?: { stack: RouteLayer[] };
  };
  const router = a._router ?? a.router;
  if (!router) throw new Error("Could not find the Express router stack on the app");
  return router.stack;
}

/** BFF-owned routes = every extracted route minus the infra/utility ones. */
function bffOwnedRoutes(): { method: string; path: string }[] {
  return extractRoutes(appRouterStack()).filter((r) => !INFRA_ROUTES.has(r.path));
}

// --- Spec helpers ------------------------------------------------------------------------

type Operation = {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Record<string, unknown>[];
  responses: Record<
    string,
    { content?: Record<string, { schema?: unknown; example?: unknown; examples?: unknown }> }
  >;
};

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options", "trace"];
const paths = openapiSpec.paths ?? {};

/** Enumerate every documented operation as (method, path, operation). */
function operations(): { method: string; path: string; op: Operation }[] {
  const out: { method: string; path: string; op: Operation }[] = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const op = (item as Record<string, unknown>)[method];
      if (op) out.push({ method, path, op: op as Operation });
    }
  }
  return out;
}

describe("OpenAPI contract — drift guard (Express routes ↔ spec)", () => {
  it("extracts the expected BFF-owned routes from the live app (walker sanity check)", () => {
    const routes = bffOwnedRoutes()
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(routes).toEqual(
      [
        "get /auth/callback",
        "get /auth/login",
        "get /auth/session",
        "get /v1/userinfo",
        "post /v1/session/current-role",
        "post /v1/session/onboarding-role",
        "get /v1/dashboard",
        "get /v1/onboarding",
        "get /v1/tours",
        "get /v1/tours/{tourId}",
        "post /auth/logout",
        "post /v1/bookings",
        "post /v1/bookings/{id}/cancel",
        "get /v1/cart",
        "post /v1/cart/items",
        "delete /v1/cart/items/{id}",
        "post /v1/cart/checkout",
        "get /v1/availability/rules",
        "post /v1/availability/rules",
        "patch /v1/availability/rules/{id}",
        "delete /v1/availability/rules/{id}",
        "post /v1/availability/rules/replace",
        "post /v1/availability/overrides/replace",
        "get /v1/availability/exceptions",
        "post /v1/availability/exceptions",
        "patch /v1/availability/exceptions/{id}",
        "delete /v1/availability/exceptions/{id}",
        "get /v1/availability/settings",
        "patch /v1/availability/settings",
        "get /v1/availability",
        "get /v1/availability/preview",
        "post /v1/availability/preview",
        "get /v1/offerings/{id}/slots",
      ].sort(),
    );
  });

  it("documents every BFF-owned route (method + path) in the spec", () => {
    for (const { method, path } of bffOwnedRoutes()) {
      const item = paths[path] as Record<string, unknown> | undefined;
      expect(item).toBeDefined();
      expect(item?.[method]).toBeDefined();
    }
  });
});

describe("OpenAPI contract — public /v1 discovery operations", () => {
  const publicOps = () =>
    operations().filter((o) => o.path === "/v1/tours" || o.path === "/v1/tours/{tourId}");

  it("declare no session security requirement", () => {
    for (const { path, op } of publicOps()) {
      expect({ path, security: op.security }).toEqual({ path, security: undefined });
    }
  });

  it("document Core errors and BFF transport failures without a session 401", () => {
    for (const { path, op } of publicOps()) {
      expect({ path, has401: Boolean(op.responses["401"]) }).toEqual({ path, has401: false });
      expect({ path, has502: Boolean(op.responses["502"]) }).toEqual({ path, has502: true });
    }
  });

  it("documents the relayed Core tour fields and metadata", () => {
    type Schema = {
      properties?: Record<string, Schema>;
      items?: Schema;
    };
    const catalog = paths["/v1/tours"]?.get as Operation;
    const detail = paths["/v1/tours/{tourId}"]?.get as Operation;
    const catalogSchema = catalog.responses["200"]?.content?.["application/json"]?.schema as Schema;
    const detailSchema = detail.responses["200"]?.content?.["application/json"]?.schema as Schema;

    expect(Object.keys(catalogSchema.properties?.data?.items?.properties ?? {})).toEqual(
      expect.arrayContaining([
        "id",
        "slug",
        "topic",
        "universityId",
        "guideId",
        "durationMin",
        "priceCents",
        "avgRating",
        "reviewCount",
      ]),
    );
    expect(Object.keys(detailSchema.properties?.data?.properties ?? {})).toEqual(
      expect.arrayContaining([
        "description",
        "languages",
        "universitySlug",
        "universityCity",
        "universityRegion",
        "guideBio",
      ]),
    );
    expect(Object.keys(catalogSchema.properties?.meta?.properties ?? {})).toEqual(
      expect.arrayContaining(["requestId", "timestamp"]),
    );
  });
});

describe("OpenAPI contract — every operation is self-describing", () => {
  it("has a non-empty summary, description, and ≥1 tag", () => {
    for (const { method, path, op } of operations()) {
      const where = `${method.toUpperCase()} ${path}`;
      expect({ where, summary: Boolean(op.summary) }).toEqual({ where, summary: true });
      expect({ where, description: Boolean(op.description) }).toEqual({ where, description: true });
      expect({ where, tags: Array.isArray(op.tags) && op.tags.length >= 1 }).toEqual({
        where,
        tags: true,
      });
    }
  });
});

describe("OpenAPI contract — protected /v1 operations", () => {
  const publicV1Paths = new Set(["/v1/tours", "/v1/tours/{tourId}"]);
  const protectedOps = () =>
    operations().filter((o) => o.path.startsWith("/v1/") && !publicV1Paths.has(o.path));

  it("declare the sessionCookie security scheme", () => {
    for (const { path, op } of protectedOps()) {
      expect({ path, security: op.security }).toEqual({ path, security: [{ sessionCookie: [] }] });
    }
  });

  it("document 401 and 502 responses", () => {
    for (const { path, op } of protectedOps()) {
      expect({ path, has401: Boolean(op.responses["401"]) }).toEqual({ path, has401: true });
      expect({ path, has502: Boolean(op.responses["502"]) }).toEqual({ path, has502: true });
    }
  });

  it("return a { data, meta } envelope with at least one example on 200", () => {
    for (const { path, op } of protectedOps()) {
      const json = op.responses["200"]?.content?.["application/json"];
      expect({ path, hasJson: Boolean(json) }).toEqual({ path, hasJson: true });
      const schema = json?.schema as { properties?: Record<string, unknown> } | undefined;
      expect(Object.keys(schema?.properties ?? {})).toEqual(
        expect.arrayContaining(["data", "meta"]),
      );
      expect({ path, hasExample: Boolean(json?.example) || Boolean(json?.examples) }).toEqual({
        path,
        hasExample: true,
      });
    }
  });
});

/**
 * M5 follow-up — the PUBLISHED shape must agree with what we actually validate.
 *
 * M5 fixed the runtime schemas (`GuideDashboardDataSchema` / `ParticipantDashboardDataSchema`
 * accept the `null` Core really sends) but left the documented ones saying `createdAt` is a
 * required, non-null string. The spec is Contract A's public face — consumers generate types
 * from it — so a spec that disagrees with the validator hands them a type that is wrong in
 * production while every test stays green.
 *
 * Generalised on purpose: this walks the dashboard schemas rather than asserting one field,
 * so the next nullable field cannot drift the same way.
 */
describe("OpenAPI contract — published nullability matches runtime validation", () => {
  const NULLABLE_DASHBOARD_FIELDS = [
    ["GuideDashboard", "createdAt"],
    ["ParticipantDashboard", "createdAt"],
  ] as const;

  /** True when the documented property admits null (OpenAPI 3.0 `nullable` or 3.1 type union). */
  function admitsNull(prop: unknown): boolean {
    if (!prop || typeof prop !== "object") return false;
    const p = prop as { nullable?: boolean; type?: unknown; anyOf?: unknown[]; oneOf?: unknown[] };
    if (p.nullable === true) return true;
    if (Array.isArray(p.type) && p.type.includes("null")) return true;
    const union = p.anyOf ?? p.oneOf;
    return Array.isArray(union) && union.some((m) => admitsNull(m));
  }

  it.each(NULLABLE_DASHBOARD_FIELDS)(
    "%s.%s is documented as nullable, matching the runtime schema",
    (schemaName, field) => {
      const schemas = (openapiSpec as { components?: { schemas?: Record<string, unknown> } })
        .components?.schemas;
      const schema = schemas?.[schemaName] as { properties?: Record<string, unknown> } | undefined;
      expect(schema).toBeDefined();

      const prop = schema?.properties?.[field];
      expect(prop).toBeDefined();
      expect(admitsNull(prop)).toBe(true);
    },
  );
});
