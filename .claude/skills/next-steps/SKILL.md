---
name: next-steps
description: Review all documentation and code, then print ONE table of every open next step — numbered, with description, the CR it relates to (with a one-clause gloss), what it does, and when it can be done — plus a one-line recommendation. Read-only. Use when the user types /next-steps, or asks for "the next-steps table", "a table of next steps", "what's left to do, as a table".
---

# /next-steps — the next-steps table

One output: a numbered markdown table of every open next step, printed in the terminal,
followed by a single recommendation line. Not `/cr-open` (audits and *edits* CR docs) and not
`/brief` (publishes a status page). **Read-only** — never edit docs, code, commit, migrate, or
deploy.

`/next-steps <topic>` scopes the table to one thread (a CR, a page, a program).

## Phase 1 — gather (derive, never recall)

Every row must trace to something read **this run**. No facts from memory or earlier sessions.

1. `docs/current/status.md` — Next / watch items, In flight, Last deploy.
2. `docs/cr/README.md` — status cells are often paragraphs; judge each by its **leading token
   after stripping `**`/emoji**. Keep proposed · in progress · parked · on hold; skip shipped /
   superseded / dropped — **except** shipped rows whose cell names a leftover
   (`grep -iE 'follow-up|trigger|→ roadmap|due|stay'`).
3. `docs/current/project-roadmap.md` — Now (unchecked `[ ]` boxes), every In flight section,
   Next, Open questions. A long roadmap hides live items in sub-bullets of ✅ entries, so grep
   first: `grep -nE '⏰|⚠️|❓|Trigger|trigger|due |\[ \]|renew|expires|lapses'` and read around
   each hit. Skip items marked ✅ / RESOLVED / REJECTED / NOT PLANNED.
4. Cross-repo obligations — if `CLAUDE.md` names a handoff inbox or ledger
   ([`cross-repo-integration.md`](../../../docs/starter-pack/cross-repo-integration.md); Fin's inbox
   is the `SessionStart` hook `.claude/hooks/handoff-inbox.sh` — read what it printed), check it: anything owed
   is a row; a check that could not run is noted under the table as *unknown*, never as clear.
5. `git status --short` and `git log --oneline -10` — uncommitted or just-landed work the docs
   don't reflect yet is a row.

## Phase 2 — verify the load-bearing claims

Docs drift. For each row that claims a **defect still live**, a **thing never used**, or a
**gap in code**, run one cheap read-only check and keep what it shows:

- a code claim → `grep` the named symbol/file;
- a data claim → a read-only `SELECT` against prod, using the access `CLAUDE.md` documents.
  Pass SQL on stdin through a quoted heredoc so string literals need no escaping:
  ```bash
  docker exec -i fin-postgres psql -U fin -d fin -At <<'SQL'
  SELECT count(*) FROM some_table WHERE status = 'open';
  SQL
  ```
- a log claim → `docker logs fin-server --since <window> | grep <pattern>`. An
  empty log on a weekend/holiday or right after a deploy **neither confirms nor refutes** — say
  so. Never deploy or restart to check anything.

If a check contradicts the doc, the row says what the check found ("still 497 bad rows",
"already fixed in <commit>" → drop the row). Mention verified facts inline ("confirmed on prod").

## Phase 3 — print the table

Exactly these columns, one row per step, ordered by **when** (dated/imminent first, then
"now", then owner decisions, then triggers/parked, then backlog):

| # | Next step | Description | CR (what it's about) | What it does | When it can be done |
|---|---|---|---|---|---|

Rules per column:

- **Next step** — bold imperative, ≤ ~10 words.
- **Description** — the current fact behind it, with the numbers that make it concrete.
- **CR** — a relative markdown link (`[CR-012](docs/cr/cr-012-….md)`) **and** a one-clause
  gloss of what that CR is about (every CR named gets one). No CR → `—` plus where it lives
  (e.g. "roadmap Now checklist", "roadmap open questions").
- **What it does** — the outcome for the owner, not the mechanism.
- **When** — one of: a **date** (absolute, with weekday if near), **Now — nothing blocks it**,
  **Owner decision, any time**, **Trigger: <condition>**, **Accrues from <date>; trigger:
  <condition>**, **After #N** (a dependency on another row), or **When it bites (backlog)**.
  Deadlines months out (renewals, expiries) still get a row with their date. Add any ⚠️ timing
  hazard (e.g. "read the log before any prod deploy").
- Merge to stay at **≤ 15 rows**: all polish follow-ups → **one** backlog row; all parked
  items waiting on their own trigger → **one** "when their trigger fires" row (each named with
  its CR and condition); several small owner decisions with no dependency → **one** row.

Then, below the table, **one line**: `**Recommended order:** …` — which row first and why
(a dated window, or a live defect feeding wrong numbers, beats everything else), and which
rows are pure owner decisions that can run in parallel.

Precede the table with one short sentence on what was read and whether cross-repo obligations
are clear/owed/unknown. Nothing else — no recap of shipped work, no closing question.
