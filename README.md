# CampusToursLive.ai — BFF

The **Backend-for-Frontend** for the CampusToursLive.ai web app: the front-end's dedicated edge
layer. It faces the browser on one side and the Spring Boot **Core API** on the other. It is **not**
a general-purpose or public API — it exists only to serve this one front-end.

> The web app (Next.js), this **BFF**, and the **Core API** are **independent services, each in its
> own repository**. Where the BFF sits:
>
> ```
> browser ──(encrypted httpOnly cookie)──▶ BFF ──(Bearer id_token)──▶ Core API ──▶ PostgreSQL
> ```
>
> Two different auth mechanisms, by design: to the **browser** it uses an encrypted session cookie;
> to the **Core** it forwards the Google `id_token` (a JWT) decrypted out of that cookie. Keeping the
> token server-side is the whole point of the BFF.

**What it does**

- Runs the **Google OAuth login flow** (redirect to Google, handle the callback, exchange the code).
- Owns the browser **session / cookie** — sensitive tokens stay server-side, never in browser JS.
- **Aggregates** several Core calls into front-end-shaped composites (e.g. `/v1/dashboard`).
- Enforces **one contract**: success uses a `{ data, meta }` envelope, errors use `problem+json`.

**What it does not do**

- It is not a public API for third parties — only this web app calls it.
- It holds **no business database** — all data lives in the Core (and its Postgres).
- It holds **no core business logic** — that lives in the Core. The BFF orchestrates and shapes.

---

## Contents

- [CampusToursLive.ai — BFF](#campustoursliveai--bff)
  - [Contents](#contents)
  - [Tech stack](#tech-stack)
  - [Prerequisites](#prerequisites)
  - [Google sign-in setup](#google-sign-in-setup)
  - [Getting started](#getting-started)
  - [Configuration (environment variables)](#configuration-environment-variables)
  - [Project structure](#project-structure)
  - [Authentication flow](#authentication-flow)
  - [Session \& cookies](#session--cookies)
  - [Endpoints](#endpoints)
  - [Aggregation, proxy \& the Core client](#aggregation-proxy--the-core-client)
  - [Contracts (envelope \& errors)](#contracts-envelope--errors)
  - [API documentation (OpenAPI / Swagger)](#api-documentation-openapi--swagger)
  - [Security](#security)
  - [Testing](#testing)
  - [Code quality](#code-quality)
  - [Git hooks \& commit conventions](#git-hooks--commit-conventions)
  - [Build \& run in production](#build--run-in-production)
  - [Troubleshooting](#troubleshooting)

---

## Tech stack

| Area        | Choice                                                                    |
| ----------- | ------------------------------------------------------------------------- |
| Runtime     | **Node.js 20+** (ESM), **npm**                                            |
| Language    | **TypeScript** (strict, native ESM — `"type": "module"`)                  |
| Framework   | **Express 4**                                                             |
| Auth        | Google OAuth 2.0 / OIDC — **Authorization Code + PKCE** (no SDK; `fetch`) |
| Session     | Encrypted cookie — **AES-256-GCM** via Node `crypto` (no external store)  |
| HTTP client | native `fetch` (to the Core and to Google)                                |
| Testing     | **Jest** + **supertest** (Core & Google mocked)                           |
| Tooling     | **ESLint** + **Prettier** + `tsc --noEmit` typecheck; **husky** git hooks |

There is intentionally **no database, no Redis, and no external session store** — the session is a
self-contained encrypted cookie.

---

## Prerequisites

- **Node.js 20+** (an `.nvmrc` pins the version — `nvm use`). npm ships with Node.
- A **Google OAuth client** (Client ID + Secret) with the redirect URI registered — see
  [Google sign-in setup](#google-sign-in-setup).
- The **Core API** reachable at `CORE_API_BASE_URL` (default `http://localhost:8080`). The BFF
  **starts** without the Core, but any authenticated call will fail until the Core is up.

> The BFF needs **no database** of its own. For a full login experience you also run the Core (with
> its Postgres) and the web app — see [Getting started](#getting-started).

---

## Google sign-in setup

Google Sign-In is the only auth mode (there is no local stub). **This BFF runs the OAuth login flow**
and needs both the **Client ID** and **Client secret**; the Core service only **validates** the
resulting `id_token` and needs the **Client ID** alone. Both share **one** OAuth client.

> ℹ️ The [Google Cloud console](https://console.cloud.google.com/) is mid-redesign, so menu labels
> differ by account. The steps below use the classic **APIs & Services** navigation (left nav:
> _Credentials_, _OAuth consent screen_). Newer consoles put the same screens under
> [**Google Auth platform**](https://console.cloud.google.com/auth) (_Clients_ / _Branding_ /
> _Audience_) — the actions are identical.

**1. Create / select a Google Cloud project**

- In the top-bar project picker, select your project — or click **New project** → name it →
  **Create**.

**2. Configure the OAuth consent screen** _(once per project)_

- **APIs & Services → OAuth consent screen** → **User type: External** → enter the app name,
  user-support email, and contact email → **Save**.
- Add yourself as a **test user**: under **Test users** (on the consent screen, or the **Audience**
  tab) → **Add users** → your Google account. _(In **Testing** mode only listed test users can sign
  in — otherwise sign-in returns `access_denied`.)_
- The flow requests the scopes `openid`, `email`, `profile`.

**3. Create the OAuth client (Web application)**

1. **APIs & Services → Credentials → + Create credentials → OAuth client ID**.
2. **Application type → Web application**; give it a **Name** (e.g. `CampusToursLive BFF`).
3. Under **Authorized redirect URIs → Add URI** → `http://localhost:3001/auth/callback` (must equal
   the BFF's `GOOGLE_REDIRECT_URI`). Optionally add `http://localhost:3001` under **Authorized
   JavaScript origins**.
4. Click **Create**. Google shows the **Client ID** and **Client secret**.

> ⚠️ The redirect URI is the **web origin** (`:3001`), **not** the BFF port (`:4000`). Google
> redirects the browser back to the web app, whose Next.js rewrites proxy `/auth/*` to the BFF
> same-origin (so the session cookie is first-party). It must match `GOOGLE_REDIRECT_URI` **exactly**
> — a mismatch is the #1 cause of login failures.

> ⚠️ **Save both immediately.** The **Client secret is shown only once** — copy the Client ID _and_
> the secret into a password manager (or _Download JSON_) right away. If you lose it or it leaks,
> **regenerate** the secret in the console (and update wherever it's configured).

**Who uses what — both services must point at the _same_ client:**

| Value             | BFF (this repo)                                                        | Core                                                     |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| **Client ID**     | `GOOGLE_CLIENT_ID` — identifies the app to Google                      | `GOOGLE_CLIENT_ID` — the `id_token` audience it enforces |
| **Client secret** | `GOOGLE_CLIENT_SECRET` — required to exchange the auth code for tokens | _not used_                                               |

> The Core checks `id_token.aud == GOOGLE_CLIENT_ID`. If the BFF and Core are configured with
> **different** clients, every authenticated request fails with **401** — keep the Client ID
> identical across both services.

**Never commit these values.** `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` belong
in a git-ignored `.env`, your shell environment, or a secrets manager — never in the repository.

---

## Getting started

```bash
nvm use                   # Node 20 (per .nvmrc)
npm install
cp .env.example .env       # then fill SESSION_SECRET + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
npm run dev                # tsx watch — hot reload on http://localhost:4000
```

`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` are **required** — the BFF throws on
startup if any is missing.

To create `SESSION_SECRET`, **run this in your terminal** and paste the printed value into `.env`:

```bash
openssl rand -hex 32       # prints a 64-char hex string → SESSION_SECRET=<that value>
```

(`openssl` ships with macOS and Linux. On Windows use Git Bash / WSL, or run
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` instead.)

Verify it's up:

```bash
curl http://localhost:4000/health      # {"status":"ok","auth":"google"}
```

The interactive **API reference** is served by the BFF itself at **http://localhost:4000/docs**
(Swagger UI); the raw OpenAPI 3.1 spec is at `/openapi.json`. No separate process — see
[API documentation](#api-documentation-openapi--swagger).

**Full local stack** (needed to actually log in), in order:

1. **Core** — in `backend/`: `docker compose up -d` (Postgres), then
   `GOOGLE_CLIENT_ID=<client-id> ./mvnw spring-boot:run` (listens on `:8080`).
2. **BFF** — `npm run dev` (`:4000`).
3. **Web app** — in `frontend/`: `npm run dev` (`:3001`). Its `beforeFiles` rewrites proxy
   `/auth/*` and `/v1/*` to the BFF same-origin, so the session cookie is first-party.

## Agent skills (Codex & Claude)

This repo commits a `.claude/settings.json` (plugin marketplace + the skills this stack needs) and
a self-contained `.claude/hooks/ensure-plugins.mjs` that installs and keeps them updated for
**whichever agent CLI you have** — `claude` and/or `codex`. The `wshobson/agents` marketplace ships
dual Codex + Claude plugin manifests, so the same plugin ids work for both.

Auto-install (no extra command):

- **Claude Code** — opening the repo (a `SessionStart` hook that emits `reloadSkills`, so a
  first-time install is usable in the same session) and `npm run dev` (a `predev` step);
  `npm run build` only checks (`prebuild`, CI-safe).
- **Codex** — running the repo (`npm run dev` / the launcher) or `codex plugin add`.

Manual, **this repo only**: `npm run skills` (install missing) or `npm run skills:update` (update
to latest). It's a no-op when neither CLI is present and never blocks dev/build.

**Cursor (2.5+):** no plugin CLI or auto-install — install once **in the editor** (add the
`wshobson/agents` marketplace, then `/plugin install <name>` for the skills below). A committed
`.cursor/rules/agent-skills.mdc` gives Cursor the per-repo guidance automatically; Cursor doesn't
honor a skill's `tools:` allowlist.

Skills this repo enables (both agents):

| Skill / plugin              | Used for                                      |
| --------------------------- | --------------------------------------------- |
| `javascript-typescript`     | Express / Node / TS ESM patterns              |
| `backend-development`       | API architecture, aggregation, error envelope |
| `api-scaffolding`           | REST/GraphQL scaffolding, proxy vs aggregate  |
| `api-testing-observability` | OpenAPI, mocking, logging / tracing           |
| `backend-api-security`      | auth, session, OAuth, token forwarding        |
| `unit-testing`              | Jest + supertest                              |
| `security-scanning`         | SESSION_SECRET, injection, dependency CVEs    |
| `comprehensive-review`      | multi-perspective code review                 |

> Process skills — `superpowers:*` (plan / TDD / debug) and `doc-coauthoring` — are **Claude-only**
> user-level installs (see `../campus-tours-live/README.md`). In Codex, follow the same discipline
> with its built-in flow.

Which skill for which situation, and the cross-repo rules (this repo owns the auth/session and
API-aggregation contracts), are in `AGENTS.md` (Codex) and `CLAUDE.md` (Claude).

---

## Configuration (environment variables)

Configuration comes entirely from environment variables. On startup the BFF **auto-loads
`bff/.env`** via Node's native `process.loadEnvFile` (no `dotenv` dependency); variables already set
in the real environment take precedence over the file. Keep `.env` git-ignored; in production inject
these from the platform's secrets manager.

| Variable               | Purpose                                                                  | Default                               | Secret?     |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------- | ----------- |
| `PORT`                 | Port the BFF listens on                                                  | `4000`                                | no          |
| `WEB_ORIGIN`           | Web app origin — used for **CORS** and the **CSRF** origin check         | `http://localhost:3001`               | no          |
| `WEB_BASE_URL`         | Web app base URL — used to build post-login redirect URLs                | `http://localhost:3001`               | no          |
| `CORE_API_BASE_URL`    | Downstream Core API base URL                                             | `http://localhost:8080`               | no          |
| `SESSION_SECRET`       | Key material for the AES-256-GCM session cookie (`openssl rand -hex 32`) | _(required)_                          | **yes**     |
| `GOOGLE_CLIENT_ID`     | OAuth client ID (identifies the app to Google; Core's `aud`)             | _(required)_                          | no (public) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret (used to exchange the auth code for tokens)          | _(required)_                          | **yes**     |
| `GOOGLE_REDIRECT_URI`  | OAuth redirect; must match the Google client exactly                     | `http://localhost:3001/auth/callback` | no          |
| `NODE_ENV`             | `production` ⇒ session cookie gets the `Secure` flag                     | _(unset)_                             | no          |

> `WEB_ORIGIN`/`WEB_BASE_URL` default to the local web origin (`:3001`, matching `.env.example`). Set
> them explicitly if your web app runs on a different host or port.

---

## Project structure

Rooted at `src/` (ESM TypeScript). `index.ts` boots the server; everything else builds the `app`,
which `app.ts` exports so tests can drive it via supertest without binding a port.

```
src/
├── index.ts                  # entry point — binds the port and starts listening
├── app.ts                    # the Express app: middleware, CORS, /health, route mounting
├── config.ts                 # validated env config (loads .env via process.loadEnvFile)
├── session.ts                # encrypted cookies (ctl_sess + ctl_auth_tx, AES-256-GCM)
├── auth/                     # Google OAuth login flow
│   ├── routes.ts             #   /auth/login | /auth/callback | /auth/logout | /auth/session
│   └── google.ts             #   PKCE, authorize URL, code + refresh token exchange
├── api/                      # BFF-owned endpoints (front-end-shaped composites + reshapes)
│   ├── index.ts              #   mounts the feature routers under /v1
│   ├── dashboard/            #   GET /v1/dashboard (fan-out aggregation; role-aware)
│   ├── onboarding/           #   GET /v1/onboarding (fan-out aggregation)
│   ├── bookings/             #   POST /v1/bookings (+ /:id/cancel) — reshape of Core /bookings
│   ├── cart/                 #   GET/POST/DELETE /v1/cart* — reshape of Core /cart (DRAFT bookings)
│   ├── availability/         #   guide availability CRUD + resolved read + participant slots
│   ├── public-tours/         #   anonymous marketplace discovery (tour catalog + single tour)
│   └── _shared/              #   withSession + withMutation, CoreClient, reshapeBooking, writeOpts,
│                             #   envelope, reauth, errors, types
├── openapi/                  # OpenAPI 3.1 spec built in-code — the zod DSL + schemas
│   ├── helpers.ts            #   the apiRoute / enveloped / problemXXX DSL
│   ├── index.ts              #   registers every BFF-owned path; generates openapiSpec
│   └── schemas.ts            #   zod schemas — single source of truth (docs + runtime guards)
├── proxy/
│   └── coreProxy.ts          # catch-all /v1/* passthrough to the Core (bearer, idempotency)
└── util/
    ├── csrf.ts               # shared cross-site-mutation guard (Origin/Referer vs WEB_ORIGIN)
    └── problem.ts            # RFC 7807 problem+json helper
```

Key principle: `app.ts` mounts the feature router (`api/`) under `/v1` **before** the `coreProxy`,
so the specific composites and reshapes win over the generic passthrough. Each feature owns a folder
(`routes.ts` + per-role handlers); `api/index.ts` flattens them into one router. Auth concerns live
in `auth/` (login flow) and `session.ts` (cookie crypto); everything the handlers share — the
`CoreClient`, the `withSession` (read) and `withMutation` (write) wrappers, the `reshapeBooking`
mapper, the `writeOpts` header helper, the `{ data, meta }` envelope, and the re-auth signal — sits
in `api/_shared/`. The CSRF guard is extracted to `util/csrf.ts` and applied by **both** the proxy
and the composite mutation routes.

---

## Authentication flow

OAuth 2.0 **Authorization Code + PKCE**, implemented directly over `fetch` (no SDK).

1. **`GET /auth/login`** — generates a PKCE `code_verifier`/`code_challenge` (S256) and a random
   `state`, stores them (plus `returnTo` and `intent`) in a short-lived encrypted **transaction
   cookie** (`ctl_auth_tx`, 15 min), then `302`s to Google's authorize endpoint
   (`scope=openid email profile`, `access_type=offline`, `prompt=consent`).
   Query params: `returnTo`, `intent` (`signup` | `signin`), `login_hint` (optional).
2. **User authenticates with Google**, which redirects back to **`GET /auth/callback`** with `code`
   and `state`.
3. The callback **validates**: provider `error` (e.g. the user cancelled → `access_denied`), a
   missing/expired transaction cookie (`400 AUTH_TX_MISSING`), and `state` match
   (`400 AUTH_STATE_INVALID`).
4. It **exchanges** the code (+ PKCE verifier + client secret) for tokens at Google's token endpoint
   (`502 AUTH_EXCHANGE_FAILED` on failure).
5. It calls the Core **`POST /session?intent=…`** to enforce signup vs signin **before** creating a
   session: `signup` provisions a new account; `signin` on an unknown account → the web app's
   `/signin?error=not_registered`.
6. On success it establishes the session (writes the `ctl_sess` cookie) and redirects to a
   **role-aware landing** page (`landingFor`) based on the roles the Core returned and where the user
   started.

Other endpoints: **`POST /auth/logout`** clears the session and returns to the web app (POST-only
and CSRF-guarded — a `GET` would be forgeable cross-site to force a logout);
**`GET /auth/session`** is a lightweight `{ authenticated: boolean }` check (no Core call).

**Token refresh:** when forwarding to the Core, if the `id_token` is within **5 minutes** of expiry
and a refresh token is present, the BFF **silently refreshes** with Google and rotates the session
cookie. Concurrent requests share one in-flight refresh rather than each redeeming the same token.

How a failed refresh is classified matters, because the two outcomes are opposite:

- Google answers **`invalid_grant`** / **`invalid_client`** — the grant really is dead (revoked, or
  the refresh token expired). The session is cleared and the request triggers re-authentication.
- **anything else** — a 5xx, a timeout, a network error, an unrecognised error code. The session is
  **kept** and the request returns **`503 AUTH_UPSTREAM_UNAVAILABLE`** with `Retry-After`. Clearing
  it here would discard a refresh token that is still perfectly good, and there would be nothing
  left to retry with, so an unreachable Google would log people out permanently.

---

## Session & cookies

- **`ctl_sess`** — the session. An **AES-256-GCM**-encrypted JSON blob (key = SHA-256 of
  `SESSION_SECRET`), holding the Google `id_token` / `access_token` / `refresh_token` / `expiresAt`.
  Flags: `httpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, **7-day** max age.
- **`ctl_auth_tx`** — the in-flight login transaction (PKCE verifier, `state`, `returnTo`, `intent`).
  Same encryption; **15-minute** max age; cleared as soon as the callback finishes.
- **Design principle:** the OAuth tokens live **only** inside the encrypted, `httpOnly` cookie —
  never exposed to browser JavaScript. This is the BFF's core defence against token theft via XSS.
- **Re-authentication:** when the session is missing/expired/revoked, or a silent refresh is
  rejected as a dead grant, the BFF clears the cookie and responds **`401`** with an explicit
  **`Auth-Required: reauthenticate`**
  header (and `code: SESSION_EXPIRED`). The web app keys on that header to open the sign-in modal — a
  plain `401` (e.g. an authorization failure / `403`) does **not** trigger re-auth.
- **Logout** clears `ctl_sess`, and — because the session is a self-contained encrypted cookie with
  no server-side record to delete — also asks Google to **revoke the refresh token** so the
  credential ends there too, not just here. The revocation is fire-and-forget and its failures are
  swallowed: the user asked to leave, and an unreachable Google is not a reason to keep them signed
  in. Note this revokes the **grant**, so other sessions of the same user for this OAuth client end
  too.

---

## Endpoints

**Front-facing (called by the web app):**

| Route                                                                                                                               | Purpose                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /health`                                                                                                                       | Liveness — `{ "status": "ok", "auth": "google" }`                       |
| `GET /docs`                                                                                                                         | Swagger UI — interactive Contract A reference                           |
| `GET /openapi.json`                                                                                                                 | OpenAPI 3.1 spec (Contract A), generated in-code from the zod schemas   |
| `GET /auth/login`                                                                                                                   | Start Google sign-in. Query: `returnTo`, `intent`, `login_hint`         |
| `GET /auth/callback`                                                                                                                | Google redirect target (code → session, then redirect to the web app)   |
| `POST /auth/logout`                                                                                                                 | Clear the session cookie, return to the web app (CSRF-guarded)          |
| `GET /auth/session`                                                                                                                 | `{ authenticated: boolean }` (no Core call)                             |
| `GET /v1/tours`                                                                                                                     | **Public** — anonymous marketplace tour catalog (reshape-relay to Core) |
| `GET /v1/tours/:tourId`                                                                                                             | **Public** — anonymous single tour detail (reshape-relay to Core)       |
| `GET /v1/dashboard`                                                                                                                 | **Aggregation** — role-aware home (discriminated by `kind`)             |
| `GET /v1/onboarding`                                                                                                                | **Aggregation** — onboarding bootstrap data                             |
| `POST /v1/bookings`                                                                                                                 | **Reshape** — create a booking; Core reply mapped to Contract A         |
| `POST /v1/bookings/:id/cancel`                                                                                                      | **Reshape** — cancel own booking; reshaped reply                        |
| `GET /v1/cart`                                                                                                                      | **Reshape** — the booking cart (list of reshaped DRAFT bookings)        |
| `POST /v1/cart/items`                                                                                                               | **Reshape** — validate + add a cart item; reshaped reply                |
| `DELETE /v1/cart/items/:id`                                                                                                         | **Reshape** — remove a cart item; reshaped cart list                    |
| `POST /v1/cart/checkout`                                                                                                            | **Reshape** — check out the whole cart atomically; reshaped list        |
| `GET /v1/availability`                                                                                                              | **Reshape** — the guide's resolved availability                         |
| `GET\|POST /v1/availability/preview`                                                                                                | **Reshape** — dry-run a rule/override change before saving              |
| `GET\|POST /v1/availability/rules`, `PATCH\|DELETE /v1/availability/rules/:id`, `POST /v1/availability/rules/replace`               | **Reshape** — weekly recurring hours                                    |
| `GET\|POST /v1/availability/exceptions`, `PATCH\|DELETE /v1/availability/exceptions/:id`, `POST /v1/availability/overrides/replace` | **Reshape** — date-specific overrides (incl. atomic single-day replace) |
| `GET\|PATCH /v1/availability/settings`                                                                                              | **Reshape** — booking settings (timezone, notice, buffers)              |
| `GET /v1/offerings/:id/slots`                                                                                                       | **Reshape** — bookable slots for one offering                           |
| `ALL /v1/*` (other)                                                                                                                 | **Proxy** to the Core API — bearer attached, except public reads        |

The composite/reshape routes are mounted under `/v1` **before** the catch-all proxy, so they win
over the passthrough. Their paths are **generic** (`/v1/bookings*`, `/v1/cart*`, `/v1/availability*`) — they mirror the
Core's canonical resource paths one-to-one and only add the `/v1` prefix. Role (PARTICIPANT) is
enforced by the Core's authorization, never by the URL, so the front end builds one URL regardless
of role (matching how `/v1/dashboard` and `/v1/onboarding` already work).

---

## Aggregation, proxy & the Core client

The BFF talks to exactly one downstream — the Core — and exposes three patterns over it:

- **Proxy** (`/v1/*`, catch-all): strips the `/v1` prefix (the Core owns the bare resource paths),
  attaches an `X-Request-Id` and — for mutations — the client's `Idempotency-Key` **if it sent one**.
  The BFF never mints one: a fresh key per request is unique every time, so the Core would record a
  row per mutation and never dedupe. Transport failures become `502`.

  Not every proxied request carries a `Bearer`. The tours catalog (`/v1/tours`) and a single tour
  (`/v1/tours/:tourId`) are now **BFF-owned** endpoints — a public-tours handler intercepts them
  ahead of the proxy, so they no longer reach `coreProxy`. The proxy's own anonymous **public read**
  (`GET`/`HEAD`, no session) covers the rest — the deeper `/tours/*` and `/meta/*` paths; everything
  else requires a session.

  The path is **canonicalised before** that public/private decision is made, so a traversal cannot
  dress a private path up as a public one — and the same canonical path is what gets forwarded, so
  the path authorised is always the path sent. A `..` **path segment** is rejected outright with
  `400 BAD_PATH` (a slug that merely contains dots, like `/tours/foo..bar`, is left alone). The
  query string is forwarded as the raw byte slice of the request target rather than a re-encoded
  copy, so a transparent proxy stays transparent.

- **Aggregation** (`/v1/dashboard`, `/v1/onboarding`): the BFF fans out to several Core endpoints via
  a `CoreClient`, then composes a single front-end-shaped payload. The `withSession` wrapper resolves
  the Bearer once, hands the handler a `CoreClient`, and funnels all errors through one place — so
  handlers stay branch-free (required reads `await`; best-effort reads `.catch(() => fallback)`).
- **Reshape** (`/v1/bookings*`, `/v1/cart*`): a single-resource read/write whose Core payload is
  **renamed into Contract A** before it reaches the browser. `reshapeBooking` maps each Core
  `BookingDetailResponse` → the Contract-A booking: money becomes a `{ amount, currency }` **cents**
  object, `durationMin` → `durationMinutes`, and `scheduledAt` is normalised to a canonical UTC
  string (`…Z`, no millis) with `scheduledEndAt` **computed** from the duration — so start and end
  never diverge in notation regardless of how the Core serialises the timestamp. List reads
  (`GET /v1/cart`, checkout) tolerate a null Core body via `(raw ?? []).map(reshapeBooking)`.

Reads use `withSession`; **writes use `withMutation`** — the mutation sibling that resolves auth
once and, on a Core error, **relays the Core's `4xx` `problem+json` verbatim** (its status,
content-type, and body) so validation messages (e.g. "time slot just taken", `422`) reach the
browser unchanged. Writes carry headers built by `writeOpts`: the client's `Idempotency-Key` when present (never one
the BFF invents) and the canonical `X-Request-Id` that `app.ts` echoes back.

**Downstream error mapping:**

| Core responds          | BFF returns                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `401` (token rejected) | `401` + `Auth-Required: reauthenticate` (`SESSION_EXPIRED`)                         |
| `4xx` on a **read**    | the real status as generic `problem+json` (`UPSTREAM_ERROR`)                        |
| `4xx` on a **write**   | the Core's own `problem+json` **relayed verbatim** (so field-level detail survives) |
| `5xx` / unreachable    | `502` `CORE_UNAVAILABLE`                                                            |

Two responses the BFF originates itself, before or instead of calling the Core:

| BFF returns                                       | When                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `503` `AUTH_UPSTREAM_UNAVAILABLE` + `Retry-After` | Google could not be reached to refresh the token. The session is deliberately **kept** — see [Token refresh](#authentication-flow). |
| `400` `BAD_PATH`                                  | The request target contains a `..` path segment.                                                                                    |

The `CoreClient` uses plain `fetch` with no built-in retry/timeout — failures throw (`CoreAuthError`
on 401, `CoreError` carrying the response body/content-type otherwise) and are mapped centrally. Its
`unwrap` returns the Core's `{ data }` payload — and returns `null` for a `{ data: null }` envelope
(e.g. a participant with no next tour) rather than leaking the envelope to a reshape.

---

## Contracts (envelope & errors)

Whatever endpoint the web app calls, the response shape is consistent:

- **Success** — `{ "data": …, "meta": { "requestId": "…" } }`.
- **Error** — RFC 7807 **`application/problem+json`**:
  `{ "type", "title", "status", "detail?", "code?", "requestId" }`.
- **`Auth-Required: reauthenticate`** — the agreed signal between BFF and web app that the user must
  sign in again (see [Session & cookies](#session--cookies)).

Every request/response carries an **`X-Request-Id`** (honoured from the inbound header or generated)
for correlation across the web app → BFF → Core chain.

---

## API documentation (OpenAPI / Swagger)

Contract A is documented as an **OpenAPI 3.1** spec, served by the BFF itself:

- **Swagger UI** — [`/docs`](http://localhost:4000/docs) (interactive; expand an endpoint for field
  descriptions, allowed enum values, and per-status response examples).
- **Raw spec** — [`/openapi.json`](http://localhost:4000/openapi.json).

Both come up **with the BFF** (they're routes in `app.ts`, same `:4000` port — no separate process),
and the spec is **generated in-code from the zod schemas** in `src/openapi/`, so it is a single source
of truth that can't drift from the running app. Scope is the **BFF-owned** surface — `/auth/*` plus
every `/v1` route the BFF serves itself (the aggregation composites, the reshaped bookings / cart /
availability resources, and the public tours endpoints); every other `/v1/*` path proxies the Core
and is documented by the Core's own spec (linked via `externalDocs` → `/v3/api-docs`).

> **Trying protected endpoints in Swagger UI:** auth is the httpOnly `ctl_sess` cookie, which _cannot_
> be pasted into the _Authorize_ box. Sign in first via `GET /auth/login` in the same browser — the
> cookie is then sent automatically with your `/docs` requests.

### Adding or changing an endpoint

Register every BFF-owned path through the small DSL in `src/openapi/` — `apiRoute()` (requires a
`summary`, `description`, and ≥1 `tag`; auto-attaches the session-cookie security + 401/502 for `/v1`),
`enveloped()` for success bodies, and `problem401/502/422/400()` for errors. Give every field a
`description` + example and use `z.enum([...])` for fixed options. Full guide:
[`docs/openapi-conventions.md`](./docs/openapi-conventions.md).

### CI enforces it — drift fails the build

```bash
npm run openapi:lint      # Spectral: export the spec, then lint it against the house ruleset
npm run openapi:export    # write openapi.json (the static spec)
```

The **`Lint & Typecheck`** job (Spectral) and the **`Unit & Integration`** job (a contract/drift test)
are both required checks. A PR fails if you add a route without documenting it, leave an operation
without a summary/description/tag/example, or **change an existing endpoint's response shape without
updating its zod schema** — the schemas double as runtime response guards under `NODE_ENV=test`.

---

## Security

- **Token isolation** — OAuth tokens never leave the encrypted `httpOnly` cookie; the browser sees
  only an opaque session id-equivalent.
- **CSRF** — defence in depth on top of `SameSite=Lax`: state-changing proxied requests are rejected
  (`403 CSRF_BLOCKED`) when the `Origin` (or, failing that, `Referer`) is a different site from
  `WEB_ORIGIN`. Requests with no `Origin`/`Referer` (typical same-origin fetches) are allowed and
  still covered by the `SameSite` cookie.
- **CORS** — enabled only for `WEB_ORIGIN`, with credentials; preflight (`OPTIONS`) → `204`. When the
  web app proxies same-origin via Next.js rewrites, CORS is a harmless no-op.
- **Cookie flags** — `Secure` is set automatically when `NODE_ENV=production`. Locally (plain HTTP)
  it's off so cookies work over `http://localhost`.
- **Hardening** — `x-powered-by` disabled, JSON body capped at `1mb`, `trust proxy` enabled for
  correct client info behind a reverse proxy.
- **Secrets** — `SESSION_SECRET` and `GOOGLE_CLIENT_SECRET` are real secrets: keep them in a
  git-ignored `.env` locally and a secrets manager in production. Rotating `SESSION_SECRET`
  invalidates all existing session cookies (users must sign in again).
- **`SESSION_SECRET` must be identical across every BFF instance.** It's the key that encrypts the
  session cookie, so if you run more than one replica (horizontal scaling, blue/green, etc.) they
  must all share the **same** value — otherwise a cookie encrypted by one instance can't be decrypted
  by another and users get logged out at random. It's a BFF-only value: the web app and Core never
  use it.

---

## Testing

```bash
npm test                  # all tests (unit + integration) + coverage report + HTML report
npm run test:unit         # unit tests only
npm run test:integration  # integration tests (supertest against the real Express app)
npm run test:coverage     # explicit coverage alias (same coverage as `npm test`)
```

- **Strategy** — integration tests drive the actual Express app with **supertest**; the **Core API
  and Google are mocked** (no real external calls), so the suite is hermetic and fast.
- **Coverage is collected on every run** (`collectCoverage` is on): each `npm test` prints a terminal
  summary and writes an **HTML report to `coverage/lcov-report/index.html`** (regenerated each run;
  `coverage/` is git-ignored), scoped to `src/` (the bootstrap `index.ts` is excluded).
- **Coverage is 100%** (a few genuinely-unreachable defensive branches are marked
  `/* istanbul ignore */`); Jest enforces a **90%** gate (statements / branches / functions / lines)
  to leave headroom.
- Tests run Jest with `--experimental-vm-modules` (ESM + ts-jest); the npm scripts pass the flag
  **directly to `node`** (`node --experimental-vm-modules ./node_modules/jest/bin/jest.js`), not via
  a `NODE_OPTIONS` environment variable.

---

## Code quality

```bash
npm run lint              # ESLint
npm run lint:fix          # ESLint with autofix
npm run format            # Prettier (write)
npm run format:check      # Prettier (check only)
npm run typecheck         # tsc --noEmit for src AND tests (tests/tsconfig.json)
npm run openapi:lint      # Spectral — lint the OpenAPI spec (see API documentation)
```

ESLint v9 (flat config) + typescript-eslint, with `eslint-config-prettier` so formatting is owned by
Prettier alone.

---

## Git hooks & commit conventions

Git hooks are managed by **husky** and installed automatically on `npm install` (via the `prepare`
script). They mirror the Core repo's Maven-managed hooks.

| Hook         | Runs          | Purpose                                   |
| ------------ | ------------- | ----------------------------------------- |
| `pre-commit` | `lint-staged` | ESLint `--fix` + Prettier on staged files |
| `commit-msg` | `commitlint`  | Enforces the commit convention below      |
| `pre-push`   | `npm test`    | Full test suite must pass before pushing  |

**Commit message format** (identical to the Core repo):

```
<type>: <BOARD>-<NUMBER> <description>
```

- `<type>` — `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
  `revert` (an optional scope is allowed: `fix(auth): …`).
- `<BOARD>` — Jira board key, uppercase (e.g. `CTL`); `<NUMBER>` — the ticket number.

Examples: `feat: CTL-1234 add Google OIDC callback`, `fix(proxy): CTL-987 handle upstream 502`.
Commits missing the type or the `<BOARD>-<NUMBER>` ticket are rejected. Bypass in an emergency with
`git commit --no-verify` / `git push --no-verify`.

> **Monorepo note:** while the BFF lives inside the umbrella monorepo (single `.git` at the root),
> husky's auto-install targets the repo root. Once the BFF is its own repository (its root = this
> directory), the hooks apply exactly as described.

---

## Pull requests

Open a PR against `main` (direct pushes are blocked by a branch ruleset). The gate requires:

- **A filled-in `.github/pull_request_template.md`** — a real **Summary** (>= 100 characters / 15 words) and **Testing** (>= 40 characters / 7 words), and at least one **Type of change** box checked. Placeholder / junk / gibberish text and an identical Summary and Testing are rejected; an AI step in the same check also verifies the description matches the diff.
- **Screenshots are optional** for this repo — attach API responses, logs, or before/after captures if they help review.
- All required checks green + **1 approving review**.

## Build & run in production

```bash
npm run build             # tsc → dist/
npm start                 # node dist/index.js
```

- Set `NODE_ENV=production` (enables the `Secure` cookie flag) and provide all required env vars from
  your secrets manager.
- The `GET /health` endpoint is suitable as a liveness/readiness probe for a load balancer or k8s.
- Container image / Dockerfile is not included yet — a planned addition.

---

## Troubleshooting

| Symptom                                         | Cause & fix                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Missing required env var: …` on startup        | `SESSION_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` not set. Copy `.env.example` → `.env` and fill them in.         |
| Google login fails / `redirect_uri_mismatch`    | The Google client's **Authorized redirect URI** must equal `GOOGLE_REDIRECT_URI` **exactly** (scheme, host, port, path).       |
| Sign-in returns `access_denied`                 | App is in Testing and you're not a listed **test user** (Google consent screen), or the user cancelled. Add a test user.       |
| `/v1/*` returns `502 CORE_UNAVAILABLE`          | The Core isn't reachable. Check it's running and `CORE_API_BASE_URL` is correct.                                               |
| Stuck in a re-auth loop / `401 SESSION_EXPIRED` | Session cookie can't be validated — often `SESSION_SECRET` changed (old cookies are now undecryptable). Sign in again.         |
| Cookie not sent (logged out after redirect)     | Cross-port/site cookie issue. Run the web app and BFF same-origin (Next.js rewrites); locally don't set `NODE_ENV=production`. |
| `403 CSRF_BLOCKED` on a POST/PATCH              | The request's `Origin`/`Referer` doesn't match `WEB_ORIGIN`. Ensure the web app calls the BFF same-origin.                     |
