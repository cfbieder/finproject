# CR038 — Home Dashboard & Weekly-Loop Attention Surface

**Status:** PLANNED (scoped 2026-07-03 from the design review; not started)
**Track:** v3
**Anchor in FC_NEXT_STEPS.md:** [cr038](../FC_NEXT_STEPS.md#cr038)

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
1. Attention strip placement: Home-only (recommended — cheapest, visited daily) vs. also a `TopStrip` badge visible on every page.
2. P4 mobile reconcile: in-scope or deferred.

## Verification
- Live check on dev: seed a stale feed + unaccepted rows + a drifting account; all three counts render and link correctly; empty state ("all clear") when clean.
- `useOverview` consumed by both shells; MobileHome behavior byte-identical.
