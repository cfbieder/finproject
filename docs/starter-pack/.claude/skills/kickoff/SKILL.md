---
name: kickoff
description: Kick off a brand-new project from the starter pack and a project brief — seed the repo structure, substitute placeholders, resolve open decisions via /question, and produce CR-001. Use when the user types /kickoff, says "seed this project from the starter pack", "kick off this project", "set up a new project", or drops a project brief into an empty/near-empty repo and asks to begin.
---

# /kickoff — brief → running project

Orchestrates day one. Inputs: the starter pack (this `.claude/` tree came from it; the
full pack may also be present in the repo or provided by the user) and a **project brief**
(ideally on `templates/project-brief.md`). Output: a seeded repo with `docs/` populated,
placeholders substituted, decisions resolved and recorded, and CR-001 ready to build from.

## Phase 0 — inputs check

1. **Find the brief.** Look for a brief in the repo or conversation. If none exists, offer
   to draft one together on `templates/project-brief.md` — walk its sections using the
   `/question` protocol (the brief's §8 and §10 are literally question lists). **Do not
   proceed to seeding without at least a v0.1 brief**; a project seeded without a Phase 1
   success criterion has no definition of done.
2. **Confirm the placeholder values** in one compact exchange: `<<APP>>` (slug),
   `<<HOST>>`/`<<TS_IP>>`, `<<PROD_URL>>` (or "TBD"), stack tokens (`<<BACKEND>>`,
   `<<FRONTEND>>`, `<<DB>>`, `<<WEB>>`) from the brief's §8 where answered.

## Phase 1 — seed the structure

1. Copy in (if not already present): `.claude/` and `CLAUDE.md` from `templates/CLAUDE.md`.
2. Scaffold `docs/` from `templates/docs/`: `current/status.md`,
   `current/project-description.md`, `current/project-roadmap.md`,
   `current/secrets-inventory.md`, `cr/README.md`, `cr/cr-000-template.md`, plus empty
   `guides/` and `archive/`. Copy the pack docs the project will need into `docs/guides/`
   (at minimum `documentation-standard.md`; playbooks as relevant per the brief's §8.3).
3. **Substitute placeholders** across the copied files (seed-time `<<TOKENS>>` only —
   leave `<runtime>` fill-ins alone). Record which pack version seeded the project in
   `docs/current/status.md` and the roadmap's Completed section.
4. `git init` if needed; first commit: the seeded skeleton + the brief (explicit paths).

## Phase 2 — resolve decisions (`/question`)

Run the `/question` skill over: the brief's §8 items not yet answered, its §10 open
questions for the user, and anything the brief left ambiguous that blocks CR-001. One at a
time, options + recommendation + rationale, decisions tracked.

## Phase 3 — CR-001 + first real status

1. Write `cr/cr-001-architecture-foundation.md` from the CR template: the decided stack,
   topology (infra-bootstrap §0.5 answers), deploy shape, and every Phase 2 decision with
   its rationale. Add the index row.
2. Freeze the brief: copy to `docs/archive/project-brief_v0.N.md`; the living truth is now
   `docs/current/` + CRs.
3. Fill `status.md` for real (current phase = "implementing CR-001"), seed the roadmap's
   *Now* section from the brief's phase plan.
4. Commit (explicit paths). Report: what was seeded, decisions made, and the proposed
   first implementation step — then **stop and confirm** before starting to build.

## Hard rules

- Never invent placeholder values — confirm them (Phase 0.2 is one message, not a survey).
- Never skip the brief; never skip `/question` on unanswered §8 items — an architecture
  built on unconfirmed assumptions is the expensive kind of fast.
- Building (implementing CR-001) is a separate, confirmed step — /kickoff ends at the
  ready-to-build report.
