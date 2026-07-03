# Agent & contributor guide

Conventions in this repo are **enforced by CI** — skipping them blocks the merge.
If you (human or AI agent) open a PR, follow these.

## Pull requests

Fill out the PR description using `.github/pull_request_template.md`. The required
`pr-template` check needs:

- a non-empty **## Summary**
- a non-empty **## Testing** section
- at least one **## Type of change** box checked (`- [x]`)

The template is **not** auto-applied when a PR is created via `gh pr create` or by an
agent, so pass a `--body` that includes those sections yourself.

## Commits

Conventional Commits **plus a Jira ticket**:

    <type>: <BOARD>-<NUMBER> <description>
    e.g. feat: CTL-1234 add Google OIDC callback

Types: `feat fix docs style refactor perf test build ci chore revert`.
Enforced by a local `commit-msg` hook (installed on first `./mvnw` / `npm install`).

## What blocks a merge

- `ci` — unit + integration tests, project coverage gate, and ≥80% patch coverage on changed lines
- `pr-template` — the PR-description checks above
- a pull request is required (no direct push to `main`) with **1 approving review**

---

# Agent skills — when to use what (bff)

This guide covers **both Codex and Claude Code**. This repo is the **bff / backend-for-frontend**
(`:4000`, Express 4 / Node / TypeScript ESM). It sits in the middle:
`frontend (:3001) → bff (:4000) → backend (:8080)`. It owns **auth, session, and API
aggregation/proxy** — the trickiest cross-service glue in the project.

Skills are **not** auto-applied every turn — the agent picks them per-message from their
`description`. The table below steers that choice. To force a skill, invoke **its own slash
command** (e.g. `/code-review`).

> **Setup is automatic — for both agents.** This repo's plugins are declared in
> `.claude/settings.json`; `.claude/hooks/ensure-plugins.mjs` installs and keeps them updated for
> whichever agent CLI you have (`claude` and/or `codex`). The same plugin ids work for both — the
> `wshobson/agents` marketplace ships dual `.claude-plugin` + `.codex-plugin` manifests.
>
> - **Claude Code** — a `SessionStart` hook (every session) and the `predev` step (`npm run dev`)
>   run the script. The hook emits `reloadSkills`, so a first-time install is usable in the
>   **same** session (from the first prompt). Accept the workspace-trust dialog once so they load.
> - **Codex** — Codex has no per-repo SessionStart auto-install, so its trigger is running the
>   repo (`npm run dev` / the launcher) or `codex plugin add <name>@claude-code-workflows`.
> - **Cursor (2.5+)** — no plugin CLI or auto-install; install once **in the editor** (add
>   `wshobson/agents`, then `/plugin install <name>`). A committed `.cursor/rules/agent-skills.mdc`
>   gives Cursor the per-repo guidance automatically; Cursor doesn't honor a skill's `tools:` allowlist.
>
> `predev`/the launcher run outside a session, so they only prepare the **next** one — but they
> print a hint to run `/reload-plugins`, which pulls a fresh install into an already-open session
> without a restart. Both agents also keep enabled plugins **updated to latest** (throttled to
> ~once/day so session start stays fast; update everything now with the launcher's
> `npm run update:skills`).
>
> **`†` = process skill (Claude-only).** Rows marked `†` (`superpowers:*`, `doc-coauthoring`)
> come from the **user-level** `superpowers` / `example-skills` plugins — Claude-only, installed
> once at the user level (see `campus-tours-live/AGENTS.md` → "One-time setup"). **Codex does not
> have these**; in Codex, follow the same discipline (plan before coding, TDD, systematic
> debugging) with its built-in flow. Everything unmarked is a domain skill auto-installed for both
> agents.

## Situation → skill

| When you are…                                                                    | Use this skill                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Planning any new route / behavior change                                         | `superpowers:brainstorming` †                                                                                       |
| Refactoring (no behavior change)                                                 | `superpowers:brainstorming` †, then `comprehensive-review`                                                          |
| Express route / middleware / TS ESM patterns                                     | `javascript-typescript`, `backend-development`                                                                      |
| Designing / aggregating APIs, deciding proxy vs aggregate                        | `api-scaffolding`, `backend-development`                                                                            |
| **Auth / session / cookie / OAuth** (this repo's core)                           | `backend-api-security`                                                                                              |
| API contract docs / mocking / OpenAPI                                            | `api-testing-observability`                                                                                         |
| Error handling / the response envelope + error contract                          | `backend-development`, `api-testing-observability`                                                                  |
| Logging / observability / request tracing                                        | `api-testing-observability`                                                                                         |
| Env / config changes (`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `WEB_ORIGIN`, ports) | ⚠️ cross-repo & startup-critical — bff **throws on missing secrets**; see Cross-repo rules below                    |
| Writing / adding tests (Jest + supertest, unit + integration)                    | `unit-testing`, `superpowers:test-driven-development` †                                                             |
| Dependency upgrades / CVE remediation / `npm audit`                              | `security-scanning`                                                                                                 |
| Checking security (SESSION_SECRET, token forwarding, injection)                  | `security-scanning`, `backend-api-security`                                                                         |
| Fixing a red CI / failing build                                                  | `superpowers:systematic-debugging` † (reproduce locally: `npm run lint && npm run typecheck && npm test`)           |
| Debugging (any bug / test failure / unexpected behavior)                         | `superpowers:systematic-debugging` †                                                                                |
| Writing docs / README / comments                                                 | `doc-coauthoring` †                                                                                                 |
| Reviewing your own or someone else's PR, before merging                          | `comprehensive-review`, `/code-review`; security via `/security-review`                                             |
| **"Live" real-time tours (WebSocket signaling likely lands here)**               | ⚠️ product core, **no skill and no infra yet** — always plan/`superpowers:brainstorming` † and design before coding |

## ⚠️ Cross-repo observation rules (read before changing bff)

bff is the hub between all three — **almost every change is a cross-repo change** (full matrix
in `campus-tours-live/AGENTS.md`):

- **Changing the shape returned to frontend (aggregation / DTO)** → always check **frontend**
  for the matching types / TanStack Query usage, or the frontend will break.
- **Changing calls to backend / forwarded tokens** → check the **backend** API contract and
  what its OAuth2 resource server expects from the token (audience, scope, headers).
- **Changing session / cookie / SESSION_SECRET / OAuth flow** → this is a **bidirectional**
  cross-repo change: both the frontend login UX and backend token validation depend on it.
  Read both sides before changing, verify both after. Always run `security-scanning` +
  `backend-api-security` for these.
- **Env / OAuth / ports** → `GOOGLE_CLIENT_ID` must match backend, `WEB_ORIGIN` / redirect URI
  must match frontend's `:3001`, and the OAuth client is registered in the Google Console.
  Changing any of these is a cross-repo + external change — see the hub's "Cross-repo
  environment contract". Never commit real secrets (`.env` is git-ignored).
- **Contract-first**: if a feature needs a new backend endpoint, the order is
  **backend defines the contract → bff adapts → frontend consumes**. Don't merge bff while it
  still long-term mocks backend.
- **If you only cloned bff** → you can't read frontend/backend locally. Work against the agreed
  contracts (Contract A you return, Contract B you consume) via OpenAPI or an issue; clone the
  siblings (`npm run clone-all` in campus-tours-live) when a change spans layers.

> Rule of thumb: bff holds two contracts — one facing frontend, one facing backend. Touch
> either one and you must **read** the corresponding code on the other side, and verify
> end-to-end with the launcher (`npm run start:all`). The full cross-repo coordination rules are
> in `campus-tours-live/AGENTS.md`.
