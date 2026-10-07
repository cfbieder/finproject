---
name: cr-open
description: Audit every open Change Request (CR) against the code, correct documentation that has drifted from what the code actually does, then report the open CRs grouped by what can happen next (ready to build · needs your decision · waiting on a condition · done, awaiting close) — each row giving what the CR does, where the user sees it, what is done vs. specifically still open, and its blockers / questions — plus the threads that connect related CRs — and then reconciles the roadmap so every open CR is on it and nothing closed reads as pending. Use when the user types /cr-open, or asks "what CRs are open", "where does each CR stand", "audit the open CRs", "are the CR docs accurate".
---

# /cr-open — open CRs, verified against the code

A complete ledger of **every** open Change Request, each row checked against the code rather
than taken on the docs' word, grouped by what can happen next. Documentation that disagrees
with the code is corrected in the same run, and the roadmap is brought in line with the result.

It is the per-CR inventory: what each open CR is, where a user meets it, how far it got, and
what stands in its way. It does not pick the next move (a `/next`-style skill does that) and it
does not publish a status page (`/brief` does that).

`/cr-open <NNN> [<NNN>…]` scopes the run to the named CRs.

**Assumed layout** (the starter pack's `documentation-standard.md`):
a CR index at `docs/cr/README.md`, one doc per CR at `docs/cr/cr-NNN-<topic>.md` carrying a
`**Status:**` line, and living docs under `docs/current/` (`status.md`, `project-roadmap.md`,
`project-description.md`). A project laid out differently: map each role to its own file
before starting and say which files you used.

## Phase 0 — find the open set

Sources: the CR index and each CR doc's own `Status:` line. Locate the index's status column
**by its header**, not by position. Split rows on **unescaped** `|` only — titles may contain
`\|`, and a naive split silently loses the status cell.

A CR is **open** when any of these holds:
- its index status is anything but plainly shipped / superseded / dropped (proposed ·
  in progress · deferred · blocked · on hold …);
- it is marked shipped but names parts **not built, deferred, or waiting on data**
  ("phase 2 not built", "part B deferred");
- the index and the doc disagree about whether it is shipped (that is drift — see Phase 2).

Watch for false positives from keyword matching (a status that merely *mentions* "held" or
"blocked" in prose). Skip reserved or placeholder numbers that have no doc, and say so in one
line.

## Phase 1 — gather, per CR (derive, never recall)

For each open CR read, **this run**:

| what | where |
|---|---|
| intent | the doc's Motivation / Scope (one sentence is the goal) |
| plan | the increment / phase list in the doc |
| claimed state | the index status cell · the doc's `Status:` line · its Outcome section |
| dependencies | the doc's `Depends on:` · any CR named as blocking it · program/META CRs that list it |
| user surface | where a user meets it: the frontend router and the components the CR names (web), the command (CLI), the endpoint (API) |
| recent activity | `git log --oneline --all -i --grep='CR-NNN'` (and `CR NNN`, `crNNN`) |
| other mentions | the `docs/current/` living docs |

More than ~6 open CRs: fan the reading out to parallel subagents (batches of 3–5 CRs),
**read-only**, each returning the Phase 1 facts **and** the Phase 2 evidence for its CRs. Keep
the reconciliation and all edits (Phase 3) in the main session so one writer touches the docs.

## Phase 2 — verify against the code

The docs are claims; the code is evidence. For each increment:

- **Claimed shipped** → confirm 1–3 concrete artifacts the doc names actually exist: the
  migration, the route, the module or function, the UI component, the scheduled job, the test.
  `grep`/`ls` for them. A commit mentioning the CR supports the claim; it does not replace
  finding the artifact.
- **Claimed not built** → grep for the symbols/paths the design names. Finding them means the
  work is (partly) done and the docs are behind.
- **Commits after the doc's last revision** that mention the CR → read their subjects; they
  often mean an increment landed without the doc catching up.
- **Thresholds** ("re-open at 150 losses", "needs 20 samples") → take the current reading
  when it is cheap and **read-only** (a `SELECT`, a GET, a log line); otherwise say it was not
  measured. ⚠️ Read what a headline figure *is* before calling it drift: a metric script's
  headline may be the worst week or the minimum of a series, not the latest value printed under it.
- **Uncommitted work** (`git status --short`) touching the CR's files → note it as
  "in the tree, not committed". Never attribute it — the checkout may be shared.

Classify every mismatch:

| drift | example |
|---|---|
| **index ↔ doc** | index says phase 2 shipped, doc Status still says "phase 1 shipped" |
| **doc ↔ code** | doc says "not built", the migration and route exist |
| **living docs ↔ index** | roadmap lists a CR as Next that the index shows shipped |
| **stale reading** | "currently 70" where a live count now says 80 |

## Phase 3 — correct the drift

**Fix it when the evidence is unambiguous** — the code or a live reading plainly shows the
state, and the edit only brings text in line with it:
- the CR doc's `Status:` line and the index status cell, to agree with the code;
- a heading or line still saying "not yet deployed" / "not run" for something that is;
- a living-doc line that contradicts the index (link to the index — never restate a ship date
  or version outside it);
- a dated reading, refreshed with its new date.

**Do not fix — ask** when the code is partial, the evidence conflicts, or the correction would
be a judgement (is this increment "done"? is this CR abandoned or superseded? should it
close?). It becomes a ❓ in the table or an entry in section 4.

Rules for the edits:
- ⛔ **Docs only.** Never change code, tests, or migrations to match a doc.
- ⛔ **Never commit, push, or deploy.** Leave the edits in the tree for the owner (or the
  project's close-out skill).
- ⛔ **Never invent a ship date or version.** Shipped with no known date → "date unknown" plus
  a question.
- ⚠️ **Shared checkout:** re-run `git status --short` right before editing; do not edit a file
  another session has uncommitted changes in — list the fix as pending instead.
- ⚠️ **Surgical:** change only the text that is wrong; use exact-match replacements that fail
  if the target is not found exactly once. Do not rewrite designs.

## Phase 3b — reconcile the roadmap with the result

The CR index says what is true; the roadmap says what happens next. Once Phase 3 has settled
the status of every CR, walk the roadmap (`docs/current/project-roadmap.md`, plus any
next-steps section of `status.md`) **in full** — not only lines that name a CR — and make it
agree with the groups Phase 4 will report:

- **Every open CR has a roadmap entry** naming its next step or what it waits for, linked to its
  CR doc. This is the drift most often missed: an open CR the roadmap never mentions has no date
  anyone will look at. Add one line per missing CR; the status stays in the index, the line names
  the gate or the next step (a deadline such as an evaluation window may be stated — it is a
  date to act on, not a ship date).
- **Nothing closed reads as pending** — an unchecked box, a *Next* / *In progress* entry, or
  "phase N pending" for a CR the index shows closed. Check it off or move it to done, linking the
  index.
- **Triggers and gates that point at a closed CR** ("pick up when CR-X ships", "gated on
  CR-Y's benchmark") can no longer fire. Annotate them; if the item is left with no live trigger,
  say so — whether to drop it is a question for the owner.
- **Misattributed numbers** — "CR-006 candidate" where CR-006 is a different, closed CR — get
  relabelled.
- **Readings and limitations the Phase 2 evidence contradicts** ("traffic is zero", "X is not
  logged") → refresh with a dated reading, or strike a limitation the code has since fixed.
- If the roadmap keeps a dated history or change log, add **one** row recording the
  reconciliation; never edit existing rows.

Phase 3's rules apply unchanged: docs only, exact-match edits, never commit; a judgement (drop
the item? re-gate it?) becomes a question in section 4.

## Phase 4 — the report

### 1. Open CRs

Grouped by **what can happen next**, not by lifecycle status — four groups, each its own
table under a heading, CR number ascending within each:

1. **Ready to build** — the next step can start today (no unmet dependency, no missing data,
   no open question gating it).
2. **Needs your decision** — an owner question blocks the next step.
3. **Waiting on a condition** — a data threshold (with its current reading), another CR, or an
   external party.
4. **Done, awaiting close** — nothing left to build; only a close decision (or a passive
   watch) remains.

A CR goes in the group of its **next** step: one with buildable work *and* open questions is
Ready, with the questions in its last cell. Omit an empty group. Every row carries all six
cells.

| CR | Name | What it does | Where you see it | Done · still open | Blockers / questions |
|---|---|---|---|---|---|

- **CR** — the number, linked to its doc.
- **Name** — the short title (not the index's long summary).
- **What it does** — one sentence, the outcome for the user, ≤ 20 words.
- **Where you see it** — where a user meets it: the page / tab / element (e.g. *Settings →
  Billing tab*, `/reports`), the CLI command, or the API endpoint — plus in a few words what
  changes there. Verify it in the router/components/entry points; never guess. A CR with no
  user surface says *"No UI"* plus what it indirectly affects, if anything.
- **Done · still open** — describe by **what each piece delivers**, never by increment number
  alone: "inc 1b" means nothing to the reader. ✅ what is built, as short phrases of the
  capability · ⏳ what **specifically** remains, as the capability it would add. "More work"
  is not an answer.
- **Blockers / questions** — ⛔ a hard blocker (a CR, a threshold with its current reading, an
  external dependency) · ❓ a question that must be answered to proceed, phrased so it can be
  answered. "—" only when truly none.

Keep cells terse: fragments, not sentences; bold the one claim that matters.

### 2. Threads — how the open CRs connect

One small table showing which open CRs belong together and in what order. **Derived, never
stored:** build it from `Depends on:` lines, program/META CRs and cross-references found in
Phases 1–2 — do not add a "group" field to CR docs (another place for state to drift).

| Thread | Chain (→ = unblocks) | Where it stands |
|---|---|---|

- **Thread** — a short name for the family (e.g. *Billing*, *Search relevance*).
- **Chain** — the CRs in dependency order; **bold** the CR the rest of the thread hangs on;
  `↔` for a two-way link or an unowned seam between CRs.
- **Where it stands** — one line: what gates the thread as a whole.

Every open CR appears in exactly one thread; one with no relations is its own row marked
*(standalone)*. A shipped CR may appear only as context for an open one.

### 3. Documentation corrected

A table: file · what was wrong · what it now says · the evidence (path, commit or reading),
roadmap edits from Phase 3b included. "None — docs matched the code" if so; say explicitly
when the roadmap needed no change.

### 4. Drift not corrected

Anything found but left for the owner (a judgement, ambiguous evidence, a file dirty in
another session), each with the reason. Omit when empty.

### Close

End with one line: the number of open CRs per group, and the one question (if any) whose
answer unblocks the most — usually the bold head of the longest waiting thread. Then stop.

## Phase 5 — check before posting

1. Every CR the index shows as open is in exactly one group and exactly one thread — count them.
2. Every row in *Ready to build* is genuinely startable today; anything gated by a question,
   data or another CR belongs in a later group.
3. No row claims something built that Phase 2 could not find, and no row calls something open
   that Phase 2 found in the code.
4. Every ⛔ threshold carries its current reading, derived this run — or says it was not
   measured.
5. Every edit made is listed in section 3; nothing was committed.
6. Links resolve.
7. Every open CR in section 1 has a roadmap entry, and no roadmap entry presents a CR the index
   shows closed as pending, or depends on one as a live trigger without saying so.

## Hard rules

- ⛔ **Code is the evidence; docs are claims.** When they disagree, the report follows the code
  and the docs get fixed (or the mismatch gets asked).
- ⛔ **Docs-only edits, never committed.** Live readings are read-only.
- ⛔ **Ship dates and versions live only in the CR index** — never restate one elsewhere.
- ⚠️ Say when a check could not be made (a file missing, a grep inconclusive, a reading not
  taken) rather than presenting the row as verified.
