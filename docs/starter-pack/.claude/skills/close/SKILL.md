---
name: close
description: Close out the working session — update all relevant documentation, commit and push the session's work, and deploy to production if production is set up. Use when the user types /close, or says wrap up, close out, end the session, ship it, or "update docs, commit and deploy".
---

# /close — doc-sync, commit, push, deploy

Composes three pack disciplines into one command: the doc-sync rules
(`documentation-standard.md`), the concurrency protocol (infra-bootstrap §9), and the
deploy gates (`deploy-single-host` skill). Run the phases **in order**; each phase's
failure stops the sequence with a clear report of what did and didn't happen.

## Phase 1 — take stock

1. `git status` + `git diff --stat`: enumerate what this session actually changed. Whose
   changes are these? If files you did not touch are dirty, **do not include them** — flag
   them to the user instead (another session may own them).
2. Decide whether this close includes a deploy: prod is "set up" if
   `docker-compose.prod.yml` (or the project's deploy script/VM target) exists and has
   deployed before. If not, phases 4–5 are skipped and you say so up front.

## Phase 2 — documentation sync (per the documentation standard)

Update **only what the session's changes touch** — this is surgical, not a rewrite:

- `docs/current/status.md` — refresh the snapshot (current phase, shipped headlines as
  links, what's next). Keep it ≤ ~60 lines; it links onward, never restates.
- `docs/current/project-description.md` — add/adjust bullet-per-fact entries (date as
  leading tag) for anything structural: routes, schema, scripts, services.
- `docs/current/project-roadmap.md` — mark completed items, add newly discovered issues or
  backlog.
- `docs/cr/README.md` — if a CR shipped or changed status, update the index row. **Ship
  dates/versions live ONLY here**; other docs link.
- The living catalogs, if touched: migration matrix (any new migration), job registry (any
  new scheduled job), secrets inventory (any new secret — names/locations only).
- **Version bump — standard step, not optional.** If the close ships any code change
  (backend, frontend, migrations, config affecting runtime), bump the version **before**
  committing: `--bump-minor` for a new user-facing capability or feature, `--bump-patch`
  for fixes, tweaks, and internal changes. Decide yourself, state the choice + one-line
  reason in the close report; the user can override. The date part of the version string
  refreshes automatically with any bump. **Docs-only closes don't bump** (nothing rebuilds;
  a bump would be noise). Remember the tag lands at current HEAD — bump-then-commit order
  matters, or move the tag (`git tag -f`).

## Phase 3 — commit + push (concurrency protocol applies in full)

1. `git fetch origin main` + `git log --oneline -1 origin/main`: has HEAD moved? If yes,
   review/rebase before proceeding.
2. Stage **explicit paths only** — the session's files + the docs just updated. Never
   `git add -A` / `.`. Never touch files another session is editing.
3. Commit with a message that summarizes the session's work (reference the CR number if
   one applies).
4. **Verify what landed:** `git show --stat HEAD` — confirm only your files are in the
   commit; a concurrent session can sweep staged files into it despite careful staging.
5. `git fetch` again, then push. One release at a time.

## Phase 4 — deploy gate (only if prod is set up)

Before deploying, confirm the `deploy-single-host` gates: tree clean at `origin/main` (or
pushed, for remote deploys), **tests + `ci-guards.sh` green**, any migration already
applied to dev and recorded in the matrix.

Then **present a one-paragraph ship summary** (version, headline changes, whether a
migration rides along) and **ask for explicit confirmation** — deploying is the one
destructive step in /close and is always confirm-gated, even mid-flow.

## Phase 5 — deploy + verify

On confirmation, run the project's deploy script and follow the `deploy-single-host`
sequence: backup-first, build, migrate-inside-container + ledger assert, public `/health`,
smoke checks. Red smoke ⇒ rollback procedure, and the close report says so plainly.

## Phase 6 — close report

End with a compact report: docs updated (list), commit hash + pushed, deployed version (or
"deploy skipped — no prod / not confirmed / gate failed: <which>"), and anything deferred
or left dirty for another session. If the session surfaced a reusable gotcha or a
correction to a pack practice, note it for upstreaming to the starter pack (README →
maintenance loop).

## Hard rules

- Doc updates happen **before** the commit, so they ship in it — never as a follow-up
  commit that can be forgotten.
- Never deploy without the explicit confirmation in Phase 4, even if the user's /close
  request said "and deploy" — restate what will ship first.
- Never bundle another session's in-flight work into the commit or the deploy.
- A partial close (e.g. push done, deploy gate failed) is reported as exactly that — no
  success banner unless every executed phase succeeded.
