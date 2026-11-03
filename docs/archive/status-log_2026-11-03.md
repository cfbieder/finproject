# Status log — archived 2026-11-03

> Lifted **verbatim** from [status.md](../current/status.md) on 2026-11-03, when the file stood at 107 lines
> against a ~60-line budget. Nothing here was deleted as untrue; it moved because it is closed work, a
> record, or a history of the budget itself. Canonical homes: the [CR index](../cr/README.md), the
> [roadmap](../current/project-roadmap.md) (§3 Known issues), [secrets-inventory.md](../current/secrets-inventory.md).
> Previous log: [2026-09-14](status-log_2026-09-14.md).

## The budget note (header)

> **The budget is load-bearing** (216 → 60 on 2026-08-05; 122 → **94** on 2026-08-09, by lifting
> the failure table and the infrastructure block into their own files; **405 → 238 on 2026-09-05**,
> by archiving twelve *Next* bullets that were already finished; **250 on 2026-09-14**, cut by
> archiving the v3.61 headline write-ups, the closed Known-issues narrative and three shipped *Next*
> bullets; **167 → 113 on 2026-09-23**, by moving *Current phase* to
> [current-phase.md](../current/current-phase.md) — the cut this note had been naming): overrun = restatement
> the CR index and roadmap already own, and it is where stale facts collect. Each cut has come from
> MOVING something that changes on a different clock, never from deleting what is true.
> ⚠️ **Still over budget at 107 lines** (123 → 107 on 2026-10-07, by dropping two finished *Next* bullets). The *Live version* paragraph now carries only the current
> release (cut 2026-10-03; roadmap §1.2 owns the log). That paragraph is one line, so the line
> overrun sits in *Known issues* and *Next*.

## Known issues — closed or record-only

- ✅ **Both 2026-09-20 feed alarms are CLOSED, measured 2026-09-23** — every Wise (4) and PKO (7)
  account reads `state: ok` with `days_since_upstream_sync: 0`, and PKO's 180.00 PLN cleared on the
  repaired sync rather than by calibration. ✅ **CR091 §U3's post-reconnect mapping re-check is DONE and
  clean** (2026-09-23), run through the shipped v3.61.5 diff rather than by hand: **disappeared 0**
  (no mapping points at an id the feed no longer has), **appeared 0**, and the single *duplicated*
  row is `acc_01M1R5KN…` — §U3's **own specimen**, still `ignored`, i.e. the regression fixture
  behaving. Wise's three mapped accounts still map one-to-one by currency, so the re-authorisation
  re-pointed nothing. The one account upstream still flags `needs_reconnect` is **Bank Pekao**,
  which fin deliberately ignores (`account_id = NULL`, one of 5) and has no account for, so
  `attention-summary` correctly answers 0. **The rule that buys:** *"attention-summary says 0"
  proves nothing about connections fin does not map* — it is scoped to mapped, non-ignored accounts
  by CR060's own correction. Pekao's last good sync, `2026-09-18`, is also the date this file had
  recorded as PKO's, so the PKO bullet probably named the wrong Polish bank.
- The timezone rule (#3), the ESLint JSX blind spot (#10), dirty-tree deploys (#17). Both items filed back to
  ocr-llm (a client-abort rule; a stale deadline in their API doc) are **fixed upstream** —
  verified 2026-09-28 at their `f249397`; their handoff board has no open threads.
- ✅ **ocr-llm's 413 broadcast ACKED 2026-09-23** — we were unaffected and **measured** it
  (`/clients?days=30`: 142 served / **0 errors**, window covering all 16 days), but only because our
  one 413 branch **discarded the body**. Fixed: it now names `estimated_tokens` / `max_supported`,
  treating the latter as optional. **Unaffected because unimplemented is not unaffected.**

## Next — archive note

> Finished headlines are archived, not repeated: twelve on 2026-09-05
> ([log](../archive/status-log_2026-09-05.md)) and CR091 P1, CR086/CR087 P0–P1 and CR083 P0 on
> 2026-09-14 ([log](../archive/status-log_2026-09-14.md)); the 2026-09-28 CR close-out and CR096 on 2026-10-07 (recorded in roadmap §1.2, v3.67.0 / v3.68.0). Statuses are canonical in the
> [CR index](../cr/README.md), versions in [the roadmap](../current/project-roadmap.md).

## Conventions — the 2026-09-08 secrets narrative

Secrets: [secrets-inventory.md](../current/secrets-inventory.md) — ⚠️ **two values exposed 2026-09-08**
(`POSTGRES_PASSWORD`, `TRADIER_ACCESS_TOKEN`; owner declined rotation, logged there). It is the
**second redaction failure in three days**, and the first one's own rule would have stopped it:
there is no safe redaction of a multi-secret file — verify an `.env` edit with `grep -c` /
`cut -d= -f1` / `git diff --stat`, never by printing the region you changed.
