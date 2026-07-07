# OpenAPI conventions (Contract A)

The BFF documents **Contract A** — the frontend-facing surface it owns (`/auth/*` and the
`/v1` aggregation composites `/v1/dashboard`, `/v1/onboarding`) — as a hand-written,
zod-driven OpenAPI 3.1 spec built in code with `@asteasolutions/zod-to-openapi`. Everything
else under `/v1/*` is a transparent proxy to the Core API and is intentionally **not**
re-documented here (see the spec's `externalDocs`).

The spec is served at **`/openapi.json`** and rendered by Swagger UI at **`/docs`**.

## The model

- **Success envelope.** Aggregation responses are wrapped in
  `{ "data": <payload>, "meta": { "requestId": "<uuid>" } }`. `meta.requestId` echoes the
  `X-Request-Id` response header. (`GET /auth/session` is the one deliberate exception — a
  bare `{ authenticated }` boolean.)
- **Errors** are always RFC 7807 `application/problem+json`:
  `{ title, status, code, requestId, detail? }`. The web app switches on the stable `code`
  (e.g. `SESSION_EXPIRED`, `CORE_UNAVAILABLE`, `INVALID_ROLE`, `AUTH_TX_MISSING`).
- **Auth.** Protected endpoints require the encrypted, httpOnly `ctl_sess` session cookie
  (security scheme `sessionCookie`). Because it is httpOnly it can't be pasted into Swagger's
  Authorize box — sign in via `GET /auth/login` in the same browser to exercise them.

## Where things live

| File                                  | Purpose                                                                                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/openapi/schemas.ts`              | The zod schemas — **single source of truth**. Documentation schemas (rich `.openapi()` metadata) **and** the runtime response-shape contracts (`*DataSchema` / `Enveloped*Schema`). Also the reusable `RoleEnum`. |
| `src/openapi/helpers.ts`              | The helper DSL that bakes in the conventions: `apiRoute`, `enveloped`, `problem401/502/422/400`.                                                                                                                  |
| `src/openapi/index.ts`                | Registers every path **through the DSL** and generates `openapiSpec`.                                                                                                                                             |
| `.spectral.yaml`                      | Spectral ruleset (industry OAS linter) run in CI.                                                                                                                                                                 |
| `tests/unit/openapi.contract.test.ts` | Project-specific drift guard + convention checks.                                                                                                                                                                 |

## Adding or changing an endpoint

Always go through the helper DSL — never call `registry.registerPath` directly.

1. **Model the shapes in `schemas.ts`.** Give every field a `.openapi({ description, example })`.
   Reuse/define enums (like `RoleEnum`) once. For a response the BFF forwards verbatim from
   Core, keep the doc schema rich but the **runtime** contract loose (see below).
2. **Register the path in `index.ts` with `apiRoute`:**

   ```ts
   apiRoute({
     method: "get",
     path: "/v1/thing",
     tags: ["Thing"],            // ≥1 required
     summary: "One-line summary", // required
     description: "What it does, auth, best-effort behaviour…", // required
     request: { query: z.object({ /* … */ }) },
     responses: {
       200: enveloped(Thing, {
         description: "…",
         examples: { a: { summary: "…", value: /* enveloped example */ } },
       }),
       // 401 + 502 are auto-added for /v1 routes; override for a bespoke description.
     },
   });
   ```

   `apiRoute` **throws at build time** if `summary`, `description`, or `tags` is missing, and
   for `/v1/*` routes it auto-attaches the `sessionCookie` security scheme plus default
   `401`/`502` problem responses (your explicit ones win).

3. **Errors** use `problem401(desc)`, `problem502(desc, example?)`, `problem422(code, title, desc)`,
   `problem400(code, title, desc)` — never hand-roll a problem response.
4. **Wire the schema into the handler.** Validate request input against the same zod schema
   (e.g. the onboarding handler parses `role` with `RoleEnum`) and pass the response
   **data schema** to `sendData(res, data, SchemaDataSchema)` so the dev/test response-shape
   assertion can catch drift.

### Field-description + enum rules

- Every schema property needs a `description` (Spectral enforces this on object components).
- Enumerated values are zod enums defined once in `schemas.ts` and reused, so docs and
  runtime validation can't disagree.
- Every response body ships **at least one example** (`example` or `examples`) — Spectral
  enforces this too.

### Loose vs strict (runtime contracts)

The `*DataSchema` / `Enveloped*Schema` at the bottom of `schemas.ts` are used by the dev-only
assertion and the tests. They are deliberately **loose on the opaque objects the BFF forwards
verbatim from Core** (Core may add fields) and **strict on what the BFF owns**: the
`{ data, meta }` envelope, the `kind`/`role` discriminators, and derived fields (`canPublish`,
the `offerings`/`upcomingBookings` array shapes, the `Progress` structure, `authenticated`).
Changing a handler's owned shape without updating the schema fails `npm test`.

## Before you push

```bash
npm run openapi:lint   # exports the current spec + Spectral lint (runs in CI)
npm test               # unit + integration, incl. the contract/drift test
```

Both run in CI (`.github/workflows/ci.yml`). A new/renamed BFF-owned route that isn't
documented, an operation missing summary/description/tags, a protected `/v1` route missing
security or 401/502, or a response whose shape drifts from its schema will all turn CI red.
