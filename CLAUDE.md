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

# Claude skills — when to use what (bff)

This repo is the **bff / backend-for-frontend** (`:4000`, Express 4 / Node / TypeScript ESM).
It sits in the middle: `frontend (:3001) → bff (:4000) → backend (:8080)`. It owns **auth,
session, and API aggregation/proxy** — the trickiest cross-service glue in the project.

Skills are **not** auto-applied every turn — Claude picks them per-message from their
`description`. The table below tells Claude (and reminds humans) which skill fits which
situation. You can always force one via the skill's slash command.

> **One-time setup:** plugins are declared in `.claude/settings.json`
> (marketplace `claude-code-workflows` = `wshobson/agents`). The first time you open this
> repo, accept the workspace-trust dialog so they load.

## Situation → skill

| When you are… | Use this skill |
| --- | --- |
| Planning any new route / behavior change | `superpowers:brainstorming` |
| Express route / middleware / TS ESM patterns | `javascript-typescript`, `backend-development` |
| Designing / aggregating APIs, deciding proxy vs aggregate | `api-scaffolding`, `backend-development` |
| **Auth / session / cookie / OAuth** (this repo's core) | `backend-api-security` |
| API contract docs / mocking / OpenAPI | `api-testing-observability` |
| Writing / adding tests (Jest + supertest, unit + integration) | `unit-testing`, `superpowers:test-driven-development` |
| Checking security (SESSION_SECRET, token forwarding, injection) | `security-scanning`, `backend-api-security` |
| Debugging (any bug / test failure / unexpected behavior) | `superpowers:systematic-debugging` |
| Self-review before finishing | `comprehensive-review`, `/code-review` |

## ⚠️ Cross-repo observation rules (read before changing bff)

bff is the hub between all three — **almost every change is a cross-repo change**:

- **Changing the shape returned to frontend (aggregation / DTO)** → always check **frontend**
  for the matching types / TanStack Query usage, or the frontend will break.
- **Changing calls to backend / forwarded tokens** → check the **backend** API contract and
  what its OAuth2 resource server expects from the token (audience, scope, headers).
- **Changing session / cookie / SESSION_SECRET / OAuth flow** → this is a **bidirectional**
  cross-repo change: both the frontend login UX and backend token validation depend on it.
  Read both sides before changing, verify both after. Always run `security-scanning` +
  `backend-api-security` for these.
- **Contract-first**: if a feature needs a new backend endpoint, the order is
  **backend defines the contract → bff adapts → frontend consumes**. Don't merge bff while it
  still long-term mocks backend.

> Rule of thumb: bff holds two contracts — one facing frontend, one facing backend. Touch
> either one and you must **read** the corresponding code on the other side. See the
> "Cross-repo coordination" section in `campus-tours-live/CLAUDE.md`.
