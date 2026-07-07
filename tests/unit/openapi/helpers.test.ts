import { z } from "zod";
import type { RouteConfig } from "@asteasolutions/zod-to-openapi";
import { registry } from "@/openapi/schemas.js";
import {
  apiRoute,
  enveloped,
  problem400,
  problem401,
  problem422,
  problem502,
  problemResponse,
} from "@/openapi/helpers.js";

/** Pull the RouteConfig a just-registered path landed as, from the shared registry. */
function lastRoute(method: string, path: string): RouteConfig | undefined {
  const defs = registry.definitions;
  for (let i = defs.length - 1; i >= 0; i--) {
    const d = defs[i];
    if (d?.type === "route" && d.route.method === method && d.route.path === path) return d.route;
  }
  return undefined;
}

describe("apiRoute — build-time convention guards", () => {
  it("throws when summary is missing", () => {
    expect(() =>
      apiRoute({
        method: "get",
        path: "/v1/no-summary",
        tags: ["X"],
        description: "d",
        responses: {},
      }),
    ).toThrow(/summary/);
  });

  it("throws when description is missing", () => {
    expect(() =>
      apiRoute({ method: "get", path: "/v1/no-desc", tags: ["X"], summary: "s", responses: {} }),
    ).toThrow(/description/);
  });

  it("throws when tags is empty", () => {
    expect(() =>
      apiRoute({
        method: "get",
        path: "/v1/no-tags",
        tags: [],
        summary: "s",
        description: "d",
        responses: {},
      }),
    ).toThrow(/tags/);
  });
});

describe("apiRoute — protected /v1 defaults", () => {
  it("adds sessionCookie security + default 401/502 to a /v1 route", () => {
    apiRoute({
      method: "get",
      path: "/v1/protected-demo",
      tags: ["Demo"],
      summary: "s",
      description: "d",
      responses: {
        200: enveloped(z.object({ x: z.string().openapi({ description: "x" }) }), {
          description: "ok",
          example: { data: { x: "y" }, meta: { requestId: "r" } },
        }),
      },
    });
    const route = lastRoute("get", "/v1/protected-demo");
    expect(route?.security).toEqual([{ sessionCookie: [] }]);
    expect(route?.responses["401"]).toBeDefined();
    expect(route?.responses["502"]).toBeDefined();
    expect(route?.responses["200"]).toBeDefined();
  });

  it("lets a caller-supplied 401/502 override the defaults", () => {
    const custom = problem401("bespoke 401 description");
    apiRoute({
      method: "get",
      path: "/v1/override-demo",
      tags: ["Demo"],
      summary: "s",
      description: "d",
      responses: { 401: custom },
    });
    const route = lastRoute("get", "/v1/override-demo");
    const r401 = route?.responses["401"] as { description?: string } | undefined;
    expect(r401?.description).toBe("bespoke 401 description");
  });

  it("does NOT add security to a non-/v1 (public) route", () => {
    apiRoute({
      method: "get",
      path: "/auth/demo",
      tags: ["Auth"],
      summary: "s",
      description: "d",
      responses: { 302: { description: "redirect" } },
    });
    const route = lastRoute("get", "/auth/demo");
    expect(route?.security).toBeUndefined();
    expect(route?.responses["401"]).toBeUndefined();
  });

  it("honours an explicit protected:false on a /v1 path", () => {
    apiRoute({
      method: "get",
      path: "/v1/opt-out",
      tags: ["Demo"],
      summary: "s",
      description: "d",
      protected: false,
      responses: { 200: { description: "ok" } },
    });
    const route = lastRoute("get", "/v1/opt-out");
    expect(route?.security).toBeUndefined();
  });
});

describe("problem helpers", () => {
  it("problemResponse omits example when none is given", () => {
    const r = problemResponse("just a description");
    expect(r.content?.["application/problem+json"]?.example).toBeUndefined();
    expect(r.description).toBe("just a description");
  });

  it("problem401 carries a SESSION_EXPIRED example", () => {
    const example = problem401("d").content?.["application/problem+json"]?.example as {
      code?: string;
    };
    expect(example?.code).toBe("SESSION_EXPIRED");
  });

  it("problem502 defaults to a CORE_UNAVAILABLE example", () => {
    const example = problem502("d").content?.["application/problem+json"]?.example as {
      status?: number;
    };
    expect(example?.status).toBe(502);
  });

  it("problem422 / problem400 build examples with the given code", () => {
    const e422 = problem422("INVALID_ROLE", "t", "d").content?.["application/problem+json"]
      ?.example as { code?: string; status?: number };
    expect(e422).toMatchObject({ code: "INVALID_ROLE", status: 422 });
    const e400 = problem400("AUTH_TX_MISSING", "t", "d").content?.["application/problem+json"]
      ?.example as { code?: string; status?: number };
    expect(e400).toMatchObject({ code: "AUTH_TX_MISSING", status: 400 });
  });
});

describe("enveloped", () => {
  it("wraps the data schema in a { data, meta } envelope and passes a single example", () => {
    const r = enveloped(z.object({ x: z.string().openapi({ description: "x" }) }), {
      description: "ok",
      example: { data: { x: "y" }, meta: { requestId: "r" } },
    });
    const media = r.content?.["application/json"];
    expect(media?.example).toEqual({ data: { x: "y" }, meta: { requestId: "r" } });
    // The baked-in envelope schema is an object with `data` + `meta`.
    const shape = (media?.schema as z.ZodObject).shape;
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(["data", "meta"]));
  });
});
