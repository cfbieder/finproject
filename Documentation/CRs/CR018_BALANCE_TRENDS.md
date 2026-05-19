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
- **Period selector:** Existing `PeriodSelector` with the new opt-in `enableYearRange` prop, which renders a **Year (to)** dropdown alongside **Year (from)** in Custom mode so users can span multiple years. Other pages that consume `PeriodSelector` are unaffected (default `enableYearRange={false}`). Presets (This Month, This Month PY, Last Month, Last Month PY, YTD, YTD PY, This Year, Last Year, Custom) keep working — non-Custom presets always set `toYear = actualYear`. Budget-year row hidden (`hideBudgetYear`); no Transfers/Unrealized controls (irrelevant for balance-sheet snapshots).
- **Interval selector:** Pill bar with **Month** (default) / **Quarter** / **Year** controls column granularity. Quarter keeps only Mar/Jun/Sep/Dec ends inside the range; Year keeps only Dec ends.
- **Future-period filter:** Columns whose period start is in the future are dropped entirely. The *current* period (start ≤ today < end) is kept but the snapshot is fetched as-of today rather than the period end. Its column header gets a `(MTD)`/`(QTD)`/`(YTD)` suffix and renders in primary color.
- **Period default:** This Year (Jan–Dec current year). With future-filtering, this typically yields *N* full months + the current month tagged `(MTD)`.
- **Auto-generate on mount** (matches Balance / CashFlow pages).
- **Empty state:** Until at least one account is selected, the table area shows "Select one or more accounts above to see their balance trend."

## Table

- Accounts as rows, month-ends as columns.
- Row contents: account name, native currency badge, one USD value per column.
- **Total (selected, USD)** footer row sums the selected rows; USD-only so the total is always meaningful.
- Sticky first column + sticky header.
- Negative values rendered in red.
- Excel export via `xlsx` (header row + per-account rows + Total row).

## Data flow

1. User chooses period, interval, and selected accounts.
2. `handleGenerate` builds the raw end-date series for the selected interval (`buildEndDateSeries`).
3. `planColumns(rawSeries, interval, today)` filters out future periods and clips the current period's snapshot date to today. It returns `[{ label, asOf, isPartial }]` — `label` is the period end (used in the column header), `asOf` is the date passed to the balance endpoint.
4. `Promise.all` over `Rest.fetchBalanceReport(asOf)` — one call per kept column.
5. Each returned tree is flattened to a `Map<accountName, {currency, balanceInUSD}>` via `flattenBalanceLeaves` (recurses through Assets/Liabilities children); the map is stored keyed by `label`.
6. Rows are derived by looking up each selected account name in each column's map; missing entries become 0.

## Files changed

| File | Change |
|------|--------|
| `frontend/src/pages/BalanceTrends.jsx` | New page (single component). |
| `frontend/src/pages/BalanceTrends.css` | New stylesheet (toolbar grid, table, sticky cells, empty state). |
| `frontend/src/config/routes.jsx` | Lazy import + route entry under Reports. |
| `frontend/src/components/PeriodSelector/PeriodSelector.jsx` | Added optional `toYear` controlled prop + `enableYearRange` flag. |
| `Documentation/FC_PROJECT_STRUCTURE.md` | Routes table updated. |
| `Documentation/FC_NEXT_STEPS.md` | Migration History entries. |
| `Documentation/CRs/CR_INDEX.md` | CR018 row added. |

## Manual QA checklist

- [ ] Page loads via `/balance-trends` and via the Reports & Graphs landing page card.
- [ ] On mount, "This Year" preset is active and Interval = **Month**; columns through last full month are normal, the current month renders with `(MTD)` in primary color, and future months are absent.
- [ ] Switching Interval to **Quarter** keeps only Q1…Q*current* (current quarter tagged `(QTD)`); switching to **Year** shows just the current year tagged `(YTD)`.
- [ ] Custom preset reveals **Year (from)** + **Year (to)** dropdowns; a cross-year range (e.g. Jan 2024 → May 2026) generates the right column count and stops at the current period.
- [ ] Picking a BS COA group (e.g. Bank Accounts) populates the checklist; checking accounts populates rows immediately.
- [ ] Right-click on a checklist item solo-selects that account (tooltip "Right-click to select only this item").
- [ ] Total (selected, USD) row equals the sum of visible USD values per column.
- [ ] Excel export downloads `balance-trends-YYYYMM-YYYYMM-{interval}.xlsx`; partial columns carry the `(MTD)`/`(QTD)`/`(YTD)` suffix in the header row.
- [ ] Negative balances (e.g. credit cards) render in red and contribute negatively to the Total.
- [ ] Mobile (≤ 900px): toolbar collapses to a single column; table scrolls horizontally inside `report-scroll-container`.

## Follow-ups (out of scope for v1)

- Optional line chart above the table (per-account or total) — deferred.
- "Include opening snapshot" toggle (prior month-end column) — deferred.
- Native-currency display mode — deferred (USD-only for v1).
- Hide accounts that are 0 across all months — deferred.

## Update history

- **2026-05-19 v2.7.15** — Initial release: month-end table, single-period selector.
- **2026-05-19 v2.7.16** — Added Year (to) dropdown via `PeriodSelector.enableYearRange`, Interval selector (Month default / Quarter / Year), and future-period filtering (current period clipped to today with `(MTD)`/`(QTD)`/`(YTD)` suffix).
- **2026-05-19 v2.7.17** — Switching the Interval pill auto-runs Generate so the column shape stays in sync; year/month dropdowns still require an explicit Generate click.
