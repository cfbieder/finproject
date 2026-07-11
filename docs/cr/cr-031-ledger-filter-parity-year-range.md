# CR031 — Ledger Filter Parity + Period Year-Range

| Field | Value |
|-------|-------|
| **Status** | COMPLETED — Released v3.0.12 (2026-06-06) |
| **Track** | v3 |
| **Depends on** | CR018 (`enableYearRange` on `PeriodSelector`), CR026 (filter-chip pattern) |
| **Migration** | none |

## Goal

Bring the **Ledger** account + period selectors in line with the **Transactions** / **Budget**
pages (chip-style `HierarchyFilter` + always-visible `PeriodSelector`), and let the Custom period
span **multiple years** (Year-from / Year-to) on all three pages — not just a single Actual Year.

## What changed

### 1. `PeriodSelector` year-range across the transaction pages
- `TransActual`, `TransBudget`, and `Ledger` now pass `enableYearRange` (the same prop
  `/balance-trends` already used). Custom mode shows **Month(from) / Month(to) / Year(from) / Year(to)**.
- New `filters.toYear` (string) carries the to-year; absent/equal ⇒ identical single-year behavior.
- `handlePeriodChange` on each page stores `toYear`; single-month fast-path only applies when
  `year === toYear`.
- Shared chip label helper `buildPeriodChipLabel(filters)` (exported from `PeriodSelector.jsx`)
  renders e.g. `Jan 2024–Dec 2026` for a multi-year span; replaces the duplicated inline logic on
  TransActual/TransBudget.

### 2. Date-range plumbing (`features/Transaction/transactionConfig.js`)
- `buildDateRangeParams` is now **year-range aware**: `fromDate = (filters.year, fromMonth)`,
  `toDate = (filters.toYear, toMonth+1)` (exclusive upper bound). Drives Budget + Ledger list loads.
- **Actual** list + totals queries route through `buildDateRangeParams` (send `fromDate`/`toDate`)
  instead of a single `year`/`month`. The `/transactions` endpoint already prioritizes
  `fromDate`/`toDate`. TransActual's client-side filter (`locallyFilteredTransactions`) re-applies
  the same UTC date-range bounds.
- `toYear` added to ACTUAL/BUDGET/LEDGER `defaultFilters`.

### 3. Backend — range-aware Actual totals
- `GET /api/v2/budget/actual-entries` now accepts `fromDate`/`toDate` (exclusive upper bound via
  `transaction_date < toDate`) and uses them when present; falls back to the legacy single
  `actualYear` + `month`/`fromMonth`/`toMonth` path otherwise. Without this the Transactions totals
  panel could only reflect one year of a multi-year selection.

### 4. `HierarchyFilter` single-select mode (new)
- New opt-in props: `singleSelect`, `selectedLeaf`, `getItemSuffix(name)`. Default off ⇒
  Transactions/Budget/Worksheet unaffected.
- In single-select: the **"All"** pill is hidden, the checklist is **radio-style** (exactly one
  leaf emitted), the chosen row is highlighted (`--primary-subtle`), and `getItemSuffix` renders a
  per-item suffix (used for the account's currency code).

### 5. Ledger page rebuild
- Removed the bespoke cascading `Type → Group → Sub-Group → Account` dropdowns; the account picker
  is now a single-select `HierarchyFilter` over the BS COA groups (Bank Accounts, Fidelity Stock, …)
  with the currency code as a row suffix. Running balance still requires exactly one account
  (single-select preserves that).
- Period filter is **always visible** (the old "Period Filter" checkbox is gone), defaulting to
  **This Year** with `enableYearRange`. Category dropdown (derived from loaded transactions) unchanged.

## Decisions

- **Ledger stays single-account** (running balance only makes sense for one account/currency) — the
  chip UI is adopted purely for look + consistency, not multi-select.
- **Ledger default = This Year** (not all-time): faster initial load; running balance starts Jan 1
  of the chosen range — widen the period for a true-opening baseline.
- **Actual totals: backend extended** (vs hiding totals across years) so totals stay accurate.

## Deploy note

Released **v3.0.12 (2026-06-06)** via `deploy-to-production.sh` (rebuilds + restarts the prod
`fin-server`/frontend containers, so the `budget.js` route change goes live). No DB migration.
`vite build` passes. The dev `fin-server-dev` image still needs a rebuild to serve the route locally.
