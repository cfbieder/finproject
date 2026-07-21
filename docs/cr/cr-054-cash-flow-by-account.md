# CR-054 — Cash Flow "By Account" report (category/account filters + currency toggle)

**Status:** SHIPPED v3.4.0 (2026-07-21) · **Track:** v3 ·
**Depends on:** CR008 (HierarchyFilter), CR042 U5 (CashFlowTabs consolidation).

## Problem

The Cash Flow report (Summary / By Period) sums **every** account's transactions in
**USD** (`base_amount`) only. There was no way to ask "what did *this* account (or set of
accounts) spend by category over these periods?", nor to see a non-USD account's flows in
its **own** currency — the owner's PLN/EUR accounts only ever showed a converted USD figure.

## What shipped

A third tab, **By Account**, at `/cash-flow/by-account`
([`CashFlowByAccount.jsx`](../../frontend/src/pages/CashFlowByAccount.jsx)). Same
period-column layout as **By Period** (category tree as rows, one column per
month/quarter/year span), plus:

- **Category + Account filter chips** — the same Budget-Worksheet
  [`HierarchyFilter`](../../frontend/src/components/HierarchyFilter/HierarchyFilter.jsx)
  two-stage control. The group derivation (Income / Expense / Transfers chips; one chip per
  account type) was extracted from `BudgetWorksheetV2` into a shared util
  [`hierarchyFilterGroups.js`](../../frontend/src/utils/hierarchyFilterGroups.js) so both
  screens build the chips identically. Selected leaf names post as repeated
  `category` / `accounts` params.
- **USD ⇄ Original currency toggle.** USD sums `base_amount` (unchanged); Original sums
  `amount` (the transaction's native currency).

### The currency caveat (by design)

With **categories as rows**, an *Original* total that spans accounts of different
currencies (e.g. USD + PLN under one category) is not a real number. So the report:

- defaults to **USD**;
- in Original mode, formats each figure with the selected currency's symbol **only when the
  fetched transactions are single-currency**, otherwise a plain decimal;
- renders a **warning banner** when an Original total mixes currencies
  ("… mix N currencies — filter Accounts to a single currency to total meaningfully").

Filter Accounts to one account (or a single-currency set) and the Original total is exact.
This is why Original pairs naturally with the account filter.

## Implementation

**Backend** — additive, backward-compatible (absent params ⇒ byte-identical output, so the
Summary / By Period tabs are untouched):

- [`server/src/services/reports.js`](../../server/src/services/reports.js) —
  `buildCashFlowReport` / `fetchCategoryTotals` gained optional `categories`, `accounts`,
  `currency`. The SQL adds `LEFT JOIN accounts a ON t.account_id = a.id` with
  `a.name IN (...)` / `c.name IN (...)` filters (mirroring `budget.getSummary`) and picks
  `t.amount` vs `t.base_amount`. It also `ARRAY_AGG(DISTINCT t.currency)` so the response
  carries `meta: { currency, currencies[] }` for the mixed-currency warning.
- [`server/src/v2/routes/reports.js`](../../server/src/v2/routes/reports.js) — `GET
  /cash-flow` parses `category` (repeatable), `accounts` (repeatable), `currency`.

**Frontend** —

- New tab wired in [`CashFlowTabs.jsx`](../../frontend/src/pages/CashFlowTabs.jsx)
  (deep-links via the existing `/cash-flow/:view` route).
- [`CashFlowReport.jsx`](../../frontend/src/features/CashFlow/CashFlowReport.jsx) takes an
  optional `currencyCode` prop; the value formatter is threaded through the recursive row
  renderer (default `"USD"` ⇒ Summary / By Period unchanged).
- REST: `Rest.fetchCashFlowByAccountV2` returns `{ report, meta }`.

**No migration. No new secret.**

## Tests / verification

- Route contract tests extended
  ([`reports.routes.test.js`](../../server/src/v2/routes/__tests__/reports.routes.test.js)):
  the filter+currency call returns 200 with `meta.currency='original'`; the default returns
  `meta.currency='usd'`. All 12 reports-route tests green against the dev DB.
- Verified against dev-DB data that USD vs Original sums diverge correctly (e.g. *Kasia
  Spending* $41,686 USD vs zł151,777 PLN) and that mixed-currency categories (EUR+PLN)
  surface in `meta.currencies`.
- Frontend: build ✓, lint ✓, 195 tests ✓, all four CI guards ✓ (dead-tokens, inline-hex,
  button-css, modal-adoption).

## Open / follow-ups

- The page compiles/lints/tests green but was **not clicked in a live browser** before the
  v3.4.0 deploy — exercise it in prod (`/cash-flow/by-account`).
- Filters + currency are **Generate-driven** (not reactive), matching the other Cash Flow
  tabs; only `frequency` auto-regenerates.
- Possible later polish: a per-currency subtotal split in Original mode instead of a warning.
