# CR038 — Home Dashboard & Weekly-Loop Attention Surface

**Status:** ✅ COMPLETED — P1–P3 released v3.0.55, MTM-aware drift refinement v3.0.56, **P4 (mobile reconcile) released v3.0.57** (all 2026-07-03). No DB migration.
**Track:** v3
**Anchor in FC_NEXT_STEPS.md:** [cr038](../current/project-roadmap.md#cr038)

## Problem

Two related findings from the 2026-07-03 design review:

1. **Desktop Home is a link farm.** `pages/Home.jsx` renders zero live data — a hardcoded quick-actions grid plus a category directory. Meanwhile **`mobile/MobileHome.jsx` is already a real dashboard** (net-worth hero KPI, month-over-month delta, this-month income/expense/net tiles) consuming existing v2 endpoints. The flagship desktop page is strictly worse than the mobile one, and the data plumbing already exists.
2. **The recurring weekly loop has no connective tissue.** Refresh feeds (`/refresh-ps`) → review queue → reconcile fed (`/balance-calibration`) → reconcile manual (`/manual-calibration`) spans 3–4 disconnected pages. Nothing app-wide surfaces *N transactions awaiting review · M feeds stale · K accounts drifting* — a user can have all three and see no indication anywhere unless they visit each page. (Forecasting got `FCStepNav`; the actually-weekly workflow got nothing.)

All the underlying signals exist server-side today: `GET /bank-feed/balance-recon` carries drift + `feed_synced_at` (CR035); the review queue is queryable; manual-calibration recon returns pending/drift rows.

## Scope

### P1 — Desktop Home becomes a dashboard
Port the `MobileHome` overview to desktop `Home.jsx`: net-worth hero + MoM delta, this-month income/expense/net tiles (reuse `KpiCards`), keep the quick-actions row beneath. Extract the fetch/transform logic into a shared hook (e.g. `hooks/useOverview.js`) consumed by **both** `Home.jsx` and `MobileHome.jsx` — first concrete step of the mobile-dedup backlog theme, not a third copy.

### P2 — Attention strip ("Needs attention")
A compact strip on Home showing live counts, each linking to its page:
- **Transactions awaiting review** → `/refresh-ps` (staged/unaccepted count).
- **Stale feeds** → `/balance-calibration` (reuse the CR035 thresholds: amber ≥3d, red ≥7d).
- **Accounts with drift / MTM gap** → `/balance-calibration` + `/manual-calibration` (non-reconciled row counts).
- **Feed-row verify guard (Known Issue #7):** count of accepted-pending `ADJUST WIRE TRANSFER (Cash)` rows in USD investment accounts flagged "verify USD value" — the autopilot-proofing already sketched in KI#7.

Backend: one cheap aggregate endpoint (e.g. `GET /api/v2/util/attention-summary`) rather than the dashboard firing 4 report calls; individual signals already exist, this is composition.

### P3 — Next-step prompts in the loop
After a successful refresh on `/refresh-ps`: inline prompt "N imported — review below · then reconcile →" linking to Balance Calibration. After reconciling the last drifting fed account: pointer to Manual Calibration if it has pending/drift rows. Copy-level, not a wizard.

### P4 (optional, own release) — Mobile reconcile page
Mobile currently can't finish the weekly loop (Refresh Feeds exists; no calibration page). A minimal `/m/reconcile`: list drifting/stale accounts (same recon endpoints), tap-to-reconcile with confirm. Read-mostly + one action; no flip-tx/mode editing on mobile.

## Non-goals
- No nav-IA rework (report-page consolidation is a separate backlog decision).
- No notification system (push/email) — the attention strip is pull-based, on Home.
- No new persistent state; everything derives from existing tables/endpoints at read time.

## Open decisions (owner)
1. Attention strip placement: Home-only (recommended — cheapest, visited daily) vs. also a `TopStrip` badge visible on every page. **Settled 2026-07-03: Home-only** (owner accepted recommendation).
2. P4 mobile reconcile: in-scope or deferred. **Settled 2026-07-03: deferred** — P4 remains open as a follow-up.

## As-built (2026-07-03)

- **P1 — shared overview + desktop dashboard.** New `frontend/src/hooks/useOverview.js` — the MobileHome fetch/transform (net worth today via `fetchBalanceReportV2`, delta vs prior month-end, this-month income/expense/net via `fetchCashFlowReportV2` with transfers excluded and unrealized G/L off) extracted verbatim, plus the shared accountant-style `formatOverviewKpi`. **`MobileHome.jsx` now consumes the hook** (rendering unchanged — first concrete slice of the mobile-dedup backlog theme); `pages/Home.jsx` gains a 4-card KPI row (hero Net Worth + delta, Net Cash Flow / Income / Expenses this month; `.home-kpi*` in `PageLayout.css`, responsive 4→2→1 columns, theme tokens only). Quick Actions and the All Features grid remain below.
- **P2 — attention endpoint + strip.** New `GET /api/v2/util/attention-summary` (`routes/util.js`): `review.count` = `transactions WHERE accepted IS NOT TRUE`; `verifyUsd.count` = pending `ADJUST WIRE TRANSFER%` rows in USD (the KI#7 guard — 0 today, fires on next occurrence); `staleFeeds` = fed accounts whose `feed_synced_at` is ≥3 days old (CR035 thresholds; `worstDays` = oldest) via `bankFeedReconciliation.balanceReconcile`; `drift.fed`/`drift.manual` = `reconciled === false` counts from both recon repos (manual **pending** rows excluded — no balance entered means nothing actionable). New `components/AttentionStrip/` renders pills (info/warn/alert tones; red at ≥7d stale) each linking to its clearing page (`/refresh-ps`, `/balance-calibration`, `/manual-calibration`); quiet "All clear" line when every count is zero; renders nothing on fetch failure (informational, never blocking). Mounted on Home only (decision #1).
- **P3 — next-step prompts.** `RefreshPS.jsx`: after a successful feed refresh, a line under the status feedback — *"Next: review the imported rows below, then reconcile balances →"* (links `/balance-calibration`). `BalanceReconciliation.jsx`: footer pointer *"Accounts without a feed are reconciled on Manual Calibration →"*. Copy-level only, per the CR.
- **Verified:** frontend lint clean on all new files (the pre-existing `MobileHome` destructure lint error is old debt), Vitest 103 green, `vite build` green; endpoint live on dev (`fin-server-dev` image rebuilt — see the CR037 note: the dev container does not hot-reload): real data returned `review 338 / drift.fed 10`, and the stale-feed path proven by seeding one `source_synced_at` 10 days back → `{count:1, worstDays:10}`, then reverted. Dev's `source_synced_at` is otherwise all-NULL (dev doesn't poll the feed service), so `staleFeeds 0` on dev is a data artifact; prod has real values (CR035).
- **v3.0.56 refinement (2026-07-03, same day):** first real prod run exposed a cry-wolf flaw — MTM-mode accounts re-accumulate market drift the day after a booking, so counting their raw drift would flag them all month. `drift.fed` now counts **calibrate-mode accounts only**, and a new **`mtmDue` {count, monthEnd}** signal counts mtm-mode fed accounts with no `source='mtm'` entry dated the last completed month-end (new "MTM booking due for N accounts (date)" pill → Balance Calibration). Verified on dev: 4 unbooked mtm accounts moved from `drift` to `mtmDue`.
- **P4 as-built (v3.0.57, 2026-07-03):** new `mobile/pages/MobileReconcile.jsx` at **`/m/reconcile`** (launcher card on MobileHome; desktop `/balance-calibration` now maps to it in the phone redirect table, so attention-strip links land correctly on mobile). Lists fed accounts needing action (drift, or feed stale ≥3d) and manual accounts with drift, each row showing book vs feed/entered balance + drift; **tap-to-reconcile with a two-tap confirm** (calibrate → plain reconcile; MTM → books at the last completed month-end). Deliberately minimal: no flip-tx, no mode editing, no phantom-gain override (an implausible MTM shows an error pointing to desktop), no statement upload. Uses the same reconcile endpoints as desktop; field names verified against both recon repos.
- **Caveats/notes:** stale count is per *account*, not per institution — several accounts on one dead connection each count (label says "accounts", so truthful). No backend route test added for the endpoint (it composes two already-tested repos + two COUNT queries) — route-level coverage remains a backlog item.

**Deploy note:** no DB migration, no flags; backend (new endpoint) + frontend rebuild. Deploy backend first or together (the strip fail-opens if the endpoint 404s).

## Verification
- Live check on dev: seed a stale feed + unaccepted rows + a drifting account; all three counts render and link correctly; empty state ("all clear") when clean.
- `useOverview` consumed by both shells; MobileHome behavior byte-identical.
