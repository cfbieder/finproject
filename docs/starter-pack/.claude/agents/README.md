# Review Agents — user guide

> The `.claude/agents/` layer: on-demand **reviewers** that apply the pack's already-written
> standards to your code, docs, and CRs. They are the third leaf of the Claude Code native
> layer — **rules** enforce conventions on every turn, **skills** run procedures on trigger,
> and **agents** review work when you ask.

## What they are (and aren't)

- **Read-only and report-only.** Each is scoped to `Read, Grep, Glob, Bash` — it finds and
  ranks issues, it does not edit. A couple will *apply* fixes, but only when you ask.
- **Project-aware, not hardcoded.** Every agent reads `docs/current/status.md` first and
  defers to *this project's* `CLAUDE.md` + `docs/current/architecture.md` for specifics
  (isolation model, stack idioms, whether it's multilingual). They cite the pack baselines
  (`security-baseline.md`, `testing-and-ci.md`, `documentation-standard.md`, the CR template,
  `.claude/rules/*`) rather than restating them — so they never drift out of sync.
- **Composable.** Run several on one diff in parallel; chain the two CR passes in sequence.

## The roster

| Agent | Lens | Reach for it when… |
|---|---|---|
| `security-reviewer` | Data isolation, auth, injection, secrets | a diff touches SQL, migrations, a new endpoint, auth, uploads, or public routes |
| `migration-reviewer` | DB migration correctness (isolation-in-same-migration, append-only, fresh-DB safety) | any migration file is added/changed |
| `code-quality-reviewer` | Collaboration rules, resource hygiene, test tiers | after a non-trivial change, before committing |
| `ui-design-reviewer` | **two passes** — design-system + accessibility, *and* product/conversion UX | a change to any UI app or shared UI package |
| `cr-technical-reviewer` | **CR pass 1** — senior engineer: technical soundness, architecture fit | a CR design doc is drafted or revised |
| `cr-signoff-pm` | **CR pass 2** — senior PM: scope, priority, value → GO/REVISE/DEFER | after pass 1 clears the design technically |
| `docs-currency-reviewer` | docs-vs-code drift, one-source-of-truth | before `/close`, or after shipping a CR increment |
| `reference-lift-scout` | finds proven logic in a declared reference/parts-bin repo to lift | starting a CR that overlaps that repo's domains (no-op if none declared) |

## How to invoke

- **By intent:** *"use the security-reviewer on this diff"* — or just describe the task
  (*"security-review this migration"*) and the matching agent is selected by its description.
- **In parallel:** *"run security, migration, and code-quality review on this branch"* — they
  fan out and report independently.
- **The CR two-pass:** *"review CR-0NN"* → run `cr-technical-reviewer` first (pass 1), then
  `cr-signoff-pm` (pass 2). Pass 2 assumes the technical review is done and won't repeat it.

## What every agent gives back

A severity-ranked list — **Severity · `file:line` · Issue · Why it matters · Fix** — with an
explicit "nothing found" when the work is clean. On a substantial pass they offer to write a
dated review to `docs/reviews/<topic>_YYYY-MM-DD.md` (per the documentation standard). CR
agents return grouped comments and a one-line verdict/sign-off instead.

## What is deliberately *not* an agent

Mechanical, always-true checks belong in `ci-guards.sh` / pre-commit (see `testing-and-ci.md`),
not an agent — e.g. **i18n string-parity** and **secret-in-code** scans. An agent is for
judgement; a guard is for what a `git grep` can decide.

## Adapting an agent to a project

The agents are generic on purpose — they read the project's own docs for specifics. If a
project wants a sharper instance, rename it for the domain (`security-reviewer` →
`tenant-security-reviewer`) and let its body keep pointing at the project's architecture. Keep
the frontmatter shape (`name`, `description` with a *"Use PROACTIVELY when…"* trigger,
`tools`), keep bodies pointing at canonical docs instead of restating rules, and keep them
read-only unless a fix-applying role is genuinely wanted. When you change a standard, change
the doc first — the agent just applies it.
