# CR033 — Manual Calibration (non-fed account balance reconciliation)

**Status:** RELEASED v3.0.29 (2026-06-11) — migration 032 applied to dev + prod; deployed. Follow-ups v3.0.30 (leaf-only list + MTM booking date), v3.0.31 (non-USD MTM via FX + recon header cleanup).
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
  - `reconcileManual(accountId, {asOf?, dryRun?, force?})` — `calibrate` sets `opening_balance = entered − Σ tx`; `mtm` posts/refreshes the month-end cat-88 (`source='mtm'`, `description='Unrealized G/L (manual MTM)'`, auto-accepted) adjustment with the same 15%-phantom-gain guard and idempotent delete-then-insert. Non-USD accounts convert the entry's `base_amount`→USD via the shared `services/fx.js` `usdBaseAmount` (exchange_rates table); a missing rate is a hard error (no more USD-only restriction).
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
- Migration `032` applied to **prod** (prod-before-code), then `deploy-to-production.sh` rebuilt `fin-server`/`fin-frontend`. The new router (`/api/v2/manual-calibration/*`) and `/manual-calibration` page ship live; live `GET /recon` verified 200 on prod.

## Follow-up enhancements (Released v3.0.30, 2026-06-11)

### Leaf-only account list (FIXED)
`manualBalanceReconcile`'s `eligible` CTE now restricts to **final leaves** — `is_active = TRUE AND NOT EXISTS (child WHERE parent_id = a.id)` — so parent/container aggregation nodes ("Assets" #1, "Liabilities" #51, "Bank Accounts", "Other Bank Accounts", "CVC Investments", "Historical Assets/Liabilities", …) no longer show as calibratable rows. Dev: 68 → 48 accounts (20 containers dropped). Test: `manualBalanceReconcile: excludes parent/container accounts (leaf-only)`.

### MTM booking date (feed + manual)
Both reconcile engines (`reconcileToFeed.js` **and** `reconcileManual.js`) gained an optional **`bookDate`** (YYYY-MM-DD). For `mtm` mode it is used **verbatim** as the entry's `transaction_date` AND the balance as-of, so the Unrealized-G/L entry can be aligned to a **quarter/year-end** (marks against the balance as of that date). When absent, the legacy snap (`asOf` → its month-end) holds — existing callers (incl. `mtm-reconcile.js`) are byte-identical. **Scoped to MTM only:** calibrate is untouched (it re-anchors `opening_balance = balance(asOf) − Σ all-tx`, so feeding it a past period-end would misstate today's balance). Routes thread `bookDate`; the feed route also ingests balances up to `bookDate` before reconciling. UI: a shared **`MtmDateControl`** (`components/MtmDateControl.jsx`, default last completed month-end + month-end/quarter-end/year-end quick-fills) in both recon table headers; the reconcile POST sends `bookDate` for `mtm` rows only. Tests: `mtm: bookDate books the entry verbatim …` in both `reconcileManual.test.js` and `reconcileToFeed.test.js`.

## Further fixes (Released v3.0.31, 2026-06-11)

### Non-USD MTM (bug — was silently blocked)
Reconciling MTM on a non-USD account (e.g. CVC Fund IX, EUR) failed with *"MTM for non-USD account N (EUR) not supported"* — both engines hard-coded `base_amount = amount` (1:1 USD) and threw for any other currency. **Fix:** extracted the bank-feed promote's FX helper into shared **`services/fx.js`** (`usdBaseAmount` — `exchange_rates` from_currency→USD, most recent rate ≤ date, nearest fallback); `refreshBankFeedV2` now imports it (single source of truth). Both MTM engines drop the USD guard and set `base_amount = usdBaseAmount(amount, currency, bookDate)`; a **missing rate is a hard error** (`no USD exchange rate for X …`) rather than a wrong balance-sheet figure. Tests: non-USD-converts + no-rate-throws in both reconcile suites (synthetic `XTS` currency). Full suite **225/225**.

### Recon header UI cleanup
The MTM date control was crammed into the flex `space-between` filter row (presets wrapping awkwardly next to a second "as of" date). Moved it to **its own row beneath the filters** (`.bfd-mtm-date`), presets restyled as pill chips (`.bfd-mtm-chip`), with a one-line hint. Applies to both the feed and manual recon tables.
