**Status:** SHIPPED to prod (v2.16.2–v3.0.1, 2026-06-05). — [anchor](../current/project-roadmap.md#cr028)

# CR028 — Securities-Trade Neutralization & Transfer-Orphan Management

**Created:** 2026-06-05 · **Follows:** [CR023](cr-023-pocketsmith-removal.md) (bank-feed reconciliation), [CR009](cr-009-transfer-analysis.md) (transfer matching).

## 1. Why

Fidelity's feed delivers **both legs** of every brokerage cash move — the trade/assignment leg *and* the matching SPAXX core sweep — which already net to zero. The legacy "Neutralize" action **inserts a mirror** offsetting entry, which is correct only for a *single* leg (the PocketSmith era). On feed data it **double-counts**: e.g. neutralizing a `PURCHASE INTO SPAXX −41,749.13` whose real pair (`YOU SOLD ASSIGNED CALLS +41,749.13`) was already in the feed created a spurious `+41,749.13` `auto-offset` orphan that inflated **Fidelity Options by +$42,164** (surfaced as a false "MTM GAP"). This CR makes neutralization feed-aware, surfaces/cleans orphans, and exposes reconcile settings in the UI.

## 2. What shipped

### 2.1 Smart neutralize (`repo.neutralize`, [transactions.js](../../server/src/v2/repositories/transactions.js))
- Looks for an existing **offsetting leg** in the same account (opposite amount, ±3 days). If found → **pairs** them: both set to `Transfer - Securities Trades` + `accepted`, **no new row** (`action:'pair'`). If none → **inserts** the mirror as before (`action:'mirror'`). Works from either leg.
- **`dryRun`** preview returns the planned `action` (`pair`|`mirror`) without writing — so callers can warn before an insert (the only path that can create an orphan).
- Endpoint `POST /api/v2/transactions/:id/neutralize` accepts `{dryRun?, category_name?}`.

### 2.2 Ledger button (guarded) ([Ledger.jsx](../../frontend/src/pages/Ledger.jsx))
- A **Neutralize** button on the selection bar (next to Edit). It **dry-runs first**, then a `ConfirmModal`: a plain confirm for `pair`, a **warning** for `mirror` ("no matching offsetting leg found nearby — this will CREATE a new offsetting entry"). Handles 1..N selected; accepts string ids (matches delete/edit).

### 2.3 Transfer-Analysis actions ([TransferAnalysis.jsx](../../frontend/src/pages/TransferAnalysis.jsx))
The matching view (CR009) is the home for resolving these — **matching *is* the neutralization**, and orphans surface as **unmatched**. Per unmatched row:
- **`auto-offset`** (the reliable orphan signal) → **Remove** (confirm-gated delete of the spurious mirror).
- real feed leg → **Neutralize** (create its offsetting Transfer entry; safe because the row is, by definition, unmatched).
- Required exposing `t.source` in `findTransfers` (it was absent, so neither button rendered).

### 2.4 Reconcile-mode toggle ([BalanceReconciliation.jsx](../../frontend/src/components/BalanceReconciliation/BalanceReconciliation.jsx))
- Per-account dropdown **bank (calibrate) ⇄ brokerage (mtm)** in the Balance Reconciliation table → `PATCH /api/v2/bank-feed/reconcile-mode/:accountId`. Sets whether drift shows as **DRIFT** (calibrate) or **MTM GAP** (mtm). For accounts holding mark-to-market instruments (e.g. CDs in Fidelity Cash Mgt). Previously script-only (CR023 §7); the mode change is harmless on its own (the reconcile action it governs stays confirm-gated).

### 2.5 Supporting
- Shared **`components/ConfirmModal/`** — styled in-app replacement for `window.confirm` (used by reconcile, neutralize, remove-orphan).
- Bank reconciliation moved into **`components/BalanceReconciliation/`** rendered on the **Balance Calibration** page (above the legacy PS calibration), off the Bank Feed Setup page.

## 3. Orphan cleanup (data)
The single spurious orphan (`id 2666768`, +$41,749.13 on Fidelity Options) was removed via the new **Remove** action → Options drift +$42,164 → **+$414.87** (the real month-to-date move). Verified **0 unmatched `auto-offset` orphans across 2026** afterward. The remaining ~176 unmatched `Transfer - Securities Trades` legs are *real* feed legs already categorized as transfers (no P&L/balance impact) — optional to pair/neutralize over time.

## 4. Tests
- `repositories/__tests__/neutralize.test.js` — pair (no new row), mirror (offset created), `dryRun` preview (no write).

## 5. Non-goals
- Auto-matching these into transfer-match-groups (CR009 already does the analysis; this CR adds resolution actions).
- Splitting a hybrid cash+CD account (e.g. Cash Mgt 30) into separate ledger accounts — deferred; the mode toggle is the lightweight lever.
