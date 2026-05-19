# CR018 — Balance Trends Report

**Status:** COMPLETED 2026-05-19
**Anchor in FC_NEXT_STEPS.md:** [cr018](../FC_NEXT_STEPS.md#cr018)

## Summary

New report at `/balance-trends` (Reports & Graphs > Reports) showing month-end USD balances for one or more selected balance sheet accounts across a chosen period.

## Scope

- New page `frontend/src/pages/BalanceTrends.jsx` + `BalanceTrends.css`.
- New lazy route in `frontend/src/config/routes.jsx` (subcategory: Reports, icon: `TrendingUp`).
- No backend changes — reuses `GET /api/v2/reports/balance?asOfDate=…` once per month-end (parallel).

## UX

- **Account selector:** Existing `HierarchyFilter` keyed off `useCoa().bsTree`, with one group pill per child under Assets/Liabilities (Bank Accounts, Fidelity Stock, Fidelity Fixed Income, CVC Investments, US/SP/PL Properties, USD/PLN Credit Cards, Tax Liabilities, …). Left-click toggles checkboxes; **right-click solo-selects** (existing convention used on TransActual/TransBudget).
- **Period selector:** Existing `PeriodSelector` in single-period mode. Presets (This Month, This Month PY, Last Month, Last Month PY, YTD, YTD PY, This Year, Last Year, Custom) plus manual dropdowns in Custom mode. Budget-year row hidden (`hideBudgetYear`); no Transfers/Unrealized controls (irrelevant for balance-sheet snapshots).
- **Period default:** This Year (Jan–Dec current year, 12 columns).
- **Column series:** Month-ends from start-month-end through end-month-end inclusive (Jan–May 2026 → 5 columns: 2026-01-31 … 2026-05-31).
- **Auto-generate on mount** (matches Balance / CashFlow pages).
- **Empty state:** Until at least one account is selected, the table area shows "Select one or more accounts above to see their month-end balance trend."

## Table

- Accounts as rows, month-ends as columns.
- Row contents: account name, native currency badge, one USD value per column.
- **Total (selected, USD)** footer row sums the selected rows; USD-only so the total is always meaningful.
- Sticky first column + sticky header.
- Negative values rendered in red.
- Excel export via `xlsx` (header row + per-account rows + Total row).

## Data flow

1. User chooses period and selected accounts.
2. `handleGenerate` builds the month-end series (`buildMonthEndSeries`).
3. `Promise.all` over `Rest.fetchBalanceReport(asOfDate)` — one call per month-end.
4. Each returned tree is flattened to a `Map<accountName, {currency, balanceInUSD}>` via `flattenBalanceLeaves` (recurses through Assets/Liabilities children).
5. Rows are derived by looking up each selected account name in each month's map; missing entries become 0.

## Files changed

| File | Change |
|------|--------|
| `frontend/src/pages/BalanceTrends.jsx` | New page (single component). |
| `frontend/src/pages/BalanceTrends.css` | New stylesheet (toolbar grid, table, sticky cells, empty state). |
| `frontend/src/config/routes.jsx` | Lazy import + route entry under Reports. |
| `Documentation/FC_PROJECT_STRUCTURE.md` | Routes table updated. |
| `Documentation/FC_NEXT_STEPS.md` | Migration History entry. |
| `Documentation/CRs/CR_INDEX.md` | CR018 row added. |

## Manual QA checklist

- [ ] Page loads via `/balance-trends` and via the Reports & Graphs landing page card.
- [ ] On mount, "This Year" preset is active and the month-end columns Jan–Dec render with zero rows (until accounts selected).
- [ ] Picking a BS COA group (e.g. Bank Accounts) populates the checklist; checking accounts populates rows immediately.
- [ ] Right-click on a checklist item solo-selects that account (tooltip "Right-click to select only this item").
- [ ] Switching presets (YTD, Last Year, Custom) updates the month-end columns after clicking Generate.
- [ ] Total (selected, USD) row equals the sum of visible USD values per column.
- [ ] Excel export downloads `balance-trends-YYYY-MM-MM.xlsx` with the same shape as the on-screen table.
- [ ] Negative balances (e.g. credit cards) render in red and contribute negatively to the Total.
- [ ] Mobile (≤ 900px): toolbar collapses to a single column; table scrolls horizontally inside `report-scroll-container`.

## Follow-ups (out of scope for v1)

- Optional line chart above the table (per-account or total) — deferred.
- "Include opening snapshot" toggle (prior month-end column) — deferred.
- Native-currency display mode — deferred (USD-only for v1).
- Hide accounts that are 0 across all months — deferred.
