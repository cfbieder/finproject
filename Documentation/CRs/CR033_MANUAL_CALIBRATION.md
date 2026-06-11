# CR033 — Manual Calibration (non-fed account balance reconciliation)

**Status:** RELEASED v3.0.29 (2026-06-11) — migration 032 applied to dev + prod; deployed
**Track:** v3
**Anchor in FC_NEXT_STEPS.md:** [cr033](../FC_NEXT_STEPS.md#cr033)

## Summary

The non-fed twin of **Balance Calibration** (CR023). Balance Calibration reconciles a fed account's computed balance (`opening_balance + Σ tx`) against the bank's reported balance pulled from a feed (`bankfeed_balances`). Many balance-sheet accounts have **no direct feed** (manual/legacy/parked) and so never appear there. CR033 adds a parallel **`/manual-calibration`** page that runs the exact same reconcile workflow for those accounts, except the comparison target is a **current balance the user types in** instead of a feed value.

## Owner decisions (settled 2026-06-11)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Version track | **v3** — standalone, no dependency on the v4/CR027 flags. |
| 2 | Storage of the entered balance | **New `manual_balances` table** (mirror of `bankfeed_balances`): persists the last-entered balance per account so the page shows standing Drift/Status across sessions + an "entered date" / audit trail. |
| 3 | Account scope | **All `section='balance_sheet'` accounts with no active bank-feed mapping** (no `account_source_mappings` row with `source='bank-feed' AND ignored IS NOT TRUE AND account_id IS NOT NULL`) — the exact complement of the feed page's account set. |
| 4 | Reconcile modes | **Both** — `calibrate` (re-anchor `opening_balance`) and `mtm` (post a cat-88 Unrealized-G/L entry), like the feed page, so a non-fed brokerage/holdings account can be MTM'd by typing its current market value. |
| 5 | Sign convention | **Fin convention (signed)** — the user types the balance exactly as fin stores/shows it (asset `+`, liability `−`, matching the Computed column). `expected = entered`, no `feed_sign`/flip-tx toggles (the feed page needs those only because the bank's external format is fixed). |
| 6 | Code structure | **Parallel module** (`reconcileManual.js`) mirroring `reconcileToFeed.js` — keeps the live CR023 feed path untouched; small, isolated duplication. |

## As-built (2026-06-11)

### Database — `032_manual_calibration.sql` (applied to dev)
- `manual_balances (id, account_id FK→accounts ON DELETE CASCADE, balance NUMERIC(20,4), balance_date DATE, currency, note, entered_at, UNIQUE(account_id, balance_date))` + index `(account_id, balance_date DESC)`.
- `accounts.manual_reconcile_mode VARCHAR(20) NOT NULL DEFAULT 'calibrate'` — per-account mode (the non-fed analog of `account_source_mappings.reconcile_mode`; non-fed accounts have no mapping row to hang it on).

### Backend
- **`repositories/manualReconciliation.js`** — `manualBalanceReconcile({asOf, tolerance})`: BS accounts not owned by a live feed; computed = `opening_balance + Σ tx`; LATERAL latest `manual_balances ≤ asOf`; `expected = entered` (no sign normalization); `drift = computed − entered`; `reconciled` is `null` when no balance entered yet (**pending**). Pending rows sort to the bottom, otherwise by `|drift|` desc.
- **`services/reconcileManual.js`** — parallel to `reconcileToFeed.js`:
  - `setManualBalance(accountId, {balance, balanceDate?, note?})` — upsert into `manual_balances` (rejects fed / non-BS accounts).
  - `reconcileManual(accountId, {asOf?, dryRun?, force?})` — `calibrate` sets `opening_balance = entered − Σ tx`; `mtm` posts/refreshes the month-end cat-88 (`source='mtm'`, `description='Unrealized G/L (manual MTM)'`, auto-accepted) adjustment with the same 15%-phantom-gain guard and idempotent delete-then-insert. USD-only for mtm (mirrors the feed engine).
- **`routes/manualCalibration.js`** (mounted at `/api/v2/manual-calibration` in `routes/index.js`):
  - `GET /recon?asOf=` · `PUT /balance/:accountId` · `PATCH /reconcile-mode/:accountId` · `POST /reconcile/:accountId`.

### Frontend
- **`pages/ManualCalibration.jsx`** + **`components/ManualReconciliation/ManualReconciliation.jsx`** (forked from `BalanceReconciliation.jsx`), route **`/manual-calibration`** in `config/routes.jsx` under **Accounts & Transactions** (`Wallet` icon).
- Columns: **Account · Type** (calibrate/mtm select, *no flip-tx*) **· Computed · Current balance** (editable numeric input, saves on blur/Enter via `PUT /balance/:id`) **· Drift · Entered date · Status · Reconcile**.
- Status pills: `reconciled` / `drift` / `MTM gap` / **`pending`** (no balance entered yet). Reconcile button disabled until a balance exists. Filters: account **Type** (asset/liability) + **Status**.

### Tests
- `services/__tests__/reconcileManual.test.js` — 10 DB-backed tests (upsert, calibrate asset/liability, mtm post + idempotency, implausible-MTM guard, dryRun, no-entry throw, recon pending→drift, fed-account exclusion). Full backend suite **220/220** green; `vite build` green.

## Non-goals
- No feed sync / no `feed_sign` / no transaction-sign flip (those are feed-import concerns; manual figures are user-entered in fin's convention).
- No multi-tenancy awareness (v3; CR027 will fold this page in like the rest).
- No historical balance series UI — `manual_balances` keeps the rows (one per date) but the page reads only the latest ≤ asOf.

## Released (v3.0.29, 2026-06-11)
- Migration `032` applied to **prod** (prod-before-code), then `deploy-to-production.sh` rebuilt `fin-server`/`fin-frontend`. The new router (`/api/v2/manual-calibration/*`) and `/manual-calibration` page ship live.
