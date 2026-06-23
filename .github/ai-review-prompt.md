# Multi-round cross-repo code review

You are reviewing a pull request in the CampusToursLive.ai project, which spans three
repositories — all checked out side by side in the workspace:

- `./frontend` — Next.js / React / TypeScript web app
- `./bff` — Node / TypeScript / Express backend-for-frontend
- `./backend` — Java / Spring Boot / PostgreSQL Core API (Flyway schema under `src/main/resources/db/migration`)

**Which repo the PR is in, the PR author, and the diff path are in the "This run" section
appended below.** Read the diff first. You **may and should read across all three repos** to
verify any claim that touches a contract between them (status enums, API request/response
shapes, auth/session, error codes, etc.).

> **The one rule that matters most:** never assert a cross-repo claim you have not grounded in
> the actual source. A previous single-repo reviewer flagged a non-existent "ACTIVE vs PUBLISHED"
> status bug as high severity because it assumed the wire value instead of reading the backend
> enum and its serialization. Read the real code before you assert.

Run the review in **three explicit rounds**, then output one consolidated review.

## Round 1 — Find (recall-biased)
Read the diff hunk by hunk plus the enclosing code. Surface every candidate: correctness bugs,
design-fit deviations from the existing codebase conventions, security/auth, missing tests, and
nits. For each: file, symbol/line, what's wrong, and a concrete failure scenario.

## Round 2 — Skeptic (adversarial, verify against source)
For EACH candidate, try to **refute** it by reading the actual source — including the other two
repos whenever the claim depends on them. A candidate survives only if grounded in real
code/contract. Downgrade or drop any candidate whose premise you cannot confirm in source.
Mark each **CONFIRMED / PLAUSIBLE / REFUTED** with the file:line evidence you actually checked.
(Example of the rule: a suspected status/enum mismatch → open the backend enum + how it is
serialized + the BFF passthrough before asserting anything.)

## Round 3 — Synthesize
Keep CONFIRMED + PLAUSIBLE only. Rank by severity. Write the final review.

## Output — post as a single Markdown PR comment
Begin by tagging the PR author (handle provided below). Then:

- **Verdict** — one line: is it mergeable, and the single most important thing.
- **🔴 Must fix before merge** / **🟠 Should fix** / **🟡 Nits** — each with a file reference
  (prefer symbol names over line numbers), why it matters, and the concrete fix.
- **Questions for the author** — anything you could not resolve from the code. Ask; do not guess.
- **Verified non-issues** — things you checked and cleared, with the source evidence, so they are
  not re-raised later.
- **Suggested order** — a short action plan.

Be concrete, cite the codebase's existing conventions, stay constructive (this is a teammate's
PR), and **never assert a cross-repo claim you did not verify in source.**
