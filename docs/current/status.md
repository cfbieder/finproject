# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [2026-11-03](../archive/status-log_2026-11-03.md) · [2026-09-14](../archive/status-log_2026-09-14.md) ·
> [2026-09-05](../archive/status-log_2026-09-05.md) · [2026-08-01](../archive/status-log_2026-08-01.md).
> Every budget cut has come from MOVING what changes on a different clock, never deleting what is true
> (history in the 2026-11-03 log).

**Last updated:** 2026-11-10 · **Live version:** **v3.90.0** (see `VERSION` / git tags) — release log: [roadmap §1.2](project-roadmap.md#12-completed-chronological-latest-first).

## Current phase
**Moved to [current-phase.md](current-phase.md)** — it changes on a regenerate, not on a release.
It holds the CR069 module model, the CR076 review, the 2062 net-asset figures and the SRQ question.
Two things from it are worth carrying into every session:
- ⚠️ **The recurring DEFECT CLASS: state that exists, renders, and produces no visible effect, so it
  reads as absent.** Eleven instances; ten found by a person looking at the page, one by a gate. The
  engine half now has a gate; **the DISPLAY half still has none.** Rendering a change in both themes
  is not polish — it is the only instrument that has ever detected this class.
- **[failure-patterns.md](failure-patterns.md) is the canonical list** of the eight recurring shapes.
  Read it before writing a rule, a warning sentence, or any figure that asserts what the engine does.

## Known issues
[roadmap §3](project-roadmap.md#3-known-issues) is canonical; closed items are in the
[2026-11-03 log](../archive/status-log_2026-11-03.md). Still worth knowing at session start:
- 🟡 **The feed can revise a date (or an amount) AFTER promote and the ledger keeps the old one** —
  `staging.upsert` updates staging and never resets `promoted_transaction_id`. One live date instance
  (PKO), **zero amount instances — but that path is permanent drift no re-run clears**.
  [CR094](../cr/cr-094-promote-divergence-gate.md) was closed 2026-09-28 as not warranted (0 cases since
  the 08-10 cutover); its three checks are now a step in the [month-end runbook](../guides/month-end-reconcile.md).
- **#29 FIXED v3.61.7** — the feed FLIPS two FDIC sweeps between a ticker and a numeric id; migration
  081 merged them. ⚠️ A **third** label for the same deposit would still mint a new twin.
- ⚠️ **Owner:** revoke the retired Sheet share and delete its service-account key in Google Cloud
  ([CR059 §26](../cr/cr-059-fintable-api-ingestion.md); the code path is gone since 2026-09-15).
- **#18** — a fresh DB enforces `fc_lines.line_type`'s CHECK while dev and prod do not, so a test can
  pass on dev and fail only in CI.
- The timezone rule (#3), the ESLint JSX blind spot (#10), dirty-tree deploys (#17).

## Live infrastructure
[guides/infrastructure.md](../guides/infrastructure.md) — hosts, ports, deploy, the dev-first migration rule.
⚠️ **An engine change moves nothing until the scenarios are REGENERATED.**

## Next
Statuses are canonical in the [CR index](../cr/README.md), the running version in `VERSION`; the release log is [the roadmap](project-roadmap.md).

- ⚠️ **Publish the 2027 budget by 2026-12-10** (owner; builder code freeze 2026-12-03) — [roadmap §2](project-roadmap.md#2-open-backlog-non-cr-items): run Compare Forecast against `2026 Base`, manual prod backup, publish. Draft *V3* (2027 v6, from LE-11-26) is the one open 2027 build.
- **January 2027: run *Annual close…*** on `2026 Base` → `2027 Base` ([CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md), the annual roll to a new base year); the [CR099](../cr/cr-099-forecast-module-return-path.md) annual-close check (per-year return paths on a module) is due before it — roadmap §2. `2026 Base` and `2026 Market Crash` were regenerated 2026-11-03 with the 2027 rates.
- **[CR097](../cr/cr-097-manual-holdings-register.md)** (holdings register for manually valued accounts): the 2026-10-31 valuation is ⚠️ blocked by its cost gap until the owner says what two October transfers bought — [roadmap entry](project-roadmap.md#cr097).
- Builder follow-ups (P3c hand-edit warning, CR101 report/picker/planning follow-ups) and [CR095](../cr/cr-095-forecast-spend-currency-share.md) (forecast spend that moves with the złoty): [roadmap §2](project-roadmap.md#2-open-backlog-non-cr-items) / [CR index](../cr/README.md).
- **Two forecast judgements for the owner** — re-examine SRQ, and `Retirement Home` double-counting
  `Living Expenses`: both in [current-phase.md](current-phase.md#owner-judgements-carried-from-statusmd).
- **Backlog from the close-out** (roadmap §2): idle-cash interest, loss carry-forward, CR083's P1
  warnings and P2 seed. CR059 is done; its only tail is the owner's Google Cloud cleanup (Known issues).
- **With the owner, do not start unasked:** "2026 Downside" (being redone) · [CR058 §12.8–12.9](../cr/cr-058-quicken-valuation-anchors.md) ·
  [CR059](../cr/cr-059-fintable-api-ingestion.md)'s Chase date basis. **`House Morgage` is
  deliberately `setup_status='new'`** (owner, 2026-08-05) — parked, not broken.
- Full plan: [project-roadmap.md](project-roadmap.md).

## Conventions & drills
[Documentation standard](../documentation-standard.md) · rules auto-load from `.claude/rules/` ·
`/close`, `/question`, `/brief`, `/next-steps`, `/cr-open`, `/update-docs` · **No new transactions? [feed-stall-runbook](../guides/feed-stall-runbook.md)** · Operator brief: https://claude.ai/code/artifact/a058677e-3138-43e7-a076-a5f67d6d02ef · [month-end reconcile](../guides/month-end-reconcile.md) ·
[dev-workflow](../guides/dev-workflow.md) · [permissions](../guides/claude-code-permissions.md).
Last restore drill **2026-11-02 — PASSED** ([runbook](../guides/restore.md)): a fresh prod dump
restored in 6 s / 0 errors, all 68 tables checksum-identical; the encrypted PBS leg was not exercised.
Secrets: [secrets-inventory.md](secrets-inventory.md) (⚠️ two exposed 2026-09-08, rotation declined) — verify an
`.env` edit with `grep -c` / `cut -d= -f1` / `git diff --stat`, never by printing the region you changed.
ocr-llm handoffs are PULLED by a `SessionStart` hook ([guide](../guides/ocr-llm-integration.md)); silence means
the inbox was empty *and* their checkout current.
