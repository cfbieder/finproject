# CR-054 — Cash Flow "By Account" report (category/account filters + currency toggle)

**Status:** SHIPPED v3.4.0 (2026-07-21); drill-down fixes v3.4.1–v3.4.2 (2026-07-21) · **Track:** v3 ·
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

## v3.4.1 — drill-down fix (owner-found, 2026-07-21)

Owner clicked the shipped tab (PKO-only + Original) and double-clicked a cell: the
transaction modal showed **other accounts'** rows (Fidelity, etc.) with **USD amounts
mislabeled "PLN"**. Two coupled defects in the drill-down:

1. **No account filter.** `handleValueDoubleClick` → `fetchCashFlowTransactions` passed only
   the category, so the modal pulled that category across *all* accounts. Fixed: the
   drill-down now carries the report's account filter — `GET /cash-flow/transactions` +
   `getCashFlowTransactions` accept a repeatable `accounts` param (`AND a.name = ANY(...)`),
   and the report snapshots the accounts used at Generate.
2. **Wrong amount field/currency.** The modal (and its Summarize panel) preferred `BaseAmount`
   (USD) and formatted it with the report's symbol. Fixed: in Original mode both show the
   **native `Amount`** — the transaction list formats each row in its **own** `Currency`
   (correct even for a mixed selection), and the summary totals native amounts using the
   report's currency-aware formatter. USD mode unchanged.

New route-contract test asserts every drill-down row is on the filtered account. 13
reports-route tests + 195 frontend tests + all CI guards green.

### v3.4.2 — drill-down category filter (owner-found, 2026-07-21)

Same drill-down, next click: with a **category** filter set, double-clicking a row still
listed categories *outside* the filter. Cause: the filtered report keeps the **full** P&L
tree (unselected categories total 0 and are hidden by the frontend), so
`collectLeafCategories(node)` returned every leaf under the clicked node regardless of the
chip selection. Fix (frontend-only): the report snapshots the category filter at Generate and
the drill-down **intersects** the node's leaves with it before querying — empty filter ⇒ no
restriction, so Summary/By-Period are unaffected. The `/cash-flow/transactions` endpoint
already restricts to the category list it is given; the bug was passing it the unfiltered
list.

## Open / follow-ups

- Filters + currency are **Generate-driven** (not reactive), matching the other Cash Flow
  tabs; only `frequency` auto-regenerates.
- Possible later polish: a per-currency subtotal split in Original mode instead of a warning.
