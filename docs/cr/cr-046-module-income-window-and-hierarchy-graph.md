**Status:** 🟢 OPEN — [Roadmap](../current/project-roadmap.md)

# CR046 — Module Income/Expense Window + Hierarchy Breakdown Graph

**Opened:** 2026-07-12 · **Track:** v3 · **Migration:** 037

Two owner-requested Forecast tweaks, unrelated to each other except that both were blocked
by the same thing: the Review page could only show you what the model could already say.

## 1. Future-start income (and expense) on a balance-sheet module

**The gap.** `income_amount` is a base-year figure compounded at inflation from the base
year onward (`fcbuilder-module.js`), and the only thing that could delay it was CR041's
ownership gate — which fires *only* when the asset is **acquired** mid-plan (base MV 0).
So "I own this flat today and start renting it in 2030" was inexpressible: the rent ran
from day one. `expense_amount` had the same limitation.

**Decision (owner, 2026-07-12):** start/end dates on both streams, with the amount still
growing at inflation exactly as now — the window bounds *when* a stream runs, never *how
much*. A dated changes-schedule (stepping the amount up and down over time, as the
income/expense **items** already have) was considered and rejected as more than is needed.

**Migration 037** adds four nullable DATE columns to `forecast_modules`:
`income_start_date`, `income_end_date`, `expense_start_date`, `expense_end_date`.
**NULL = unbounded = today's behavior**, so every existing scenario is byte-identical
(pinned by test W5).

**Year-only, half-year convention (v3.0.83).** The owner picks a **year**, not a date — the
first cut shipped a raw `mm/dd/yyyy` picker, which is more precision than the model has. The
year is stored as **July 1**, so the first and last year each run for half a year and carry
**50% of the amount** — the same half-year convention the engine already applies to an
acquisition year (CR041) and to a Full disposal's year. A single-year window is halved once,
not twice, and a year the window already halved is **not halved again** by CR041's ownership
gate (that would leave 25% of a year's rent). Tests W8–W10.

**Semantics**
- The amount stays a **base-year** figure compounded at inflation. Rent starting in 2030 is
  what you typed, grown to 2030 — the same number the stream would have shown that year
  anyway (test W2). The window does not re-base the amount.
- Applies to **yield-based income too**, not just amount-based: "start earning a yield on
  this in 2035" is the same request.
- **Ownership still wins.** An asset bought in 2035 with an income start of 2030 pays
  nothing before 2035 — you cannot rent what you do not own (test W7).
- Rent that has not started is **not taxed** in the base year: the base-year income tax
  (deferred into Period 1) is skipped when the window has not opened by the base year (W6).

**The copy path carries the new columns.** This is the CR045 §1 bug class — a column a copy
silently drops is a scenario that silently computes something else — so the copy regression
test asserts the window survives a scenario copy, alongside `cash_sweep_priority`.

**UI:** four **year** selects in `FCModulesEdit`'s Expenses and Income sections (new `year`
field type; blank = unbounded), hinting "50% in this year". No day/month to pick.

## 2. Clicking a Review row graphs the accounts beneath it

**The gap.** Double-clicking a row on `/forecast-review` charted that row as a **single
line**. Only the "Net Assets" row expanded into its constituent accounts as a stacked bar
(`netAssetsAccountBreakdown`) — the view the owner actually wants for every row.

**Now:** double-clicking any row expands it into what sits beneath it, stacked, on both the
balance sheet and the P&L:

| clicked | shows |
|---|---|
| level 1 (Assets, Liabilities, Income, Expense) | its level-2 accounts |
| level 2 (Fidelity Stock, US - Properties, …) | its level-3 leaves, if it has any |
| a row with nothing beneath it | the single line, as before |

New pure util `features/Forecast/utils/fcBreakdown.js` (`level2ChildrenOf`,
`leafChildrenOf`, `buildBreakdownSeries`), 9 unit tests. The row click now carries `level`
and `side`; the page aggregates the raw entries by the account they were **actually written
against** (`leafValuesByAccount`) — the existing `entryMaps` is rolled up to level 2, which
is exactly what made it useless for expanding a level-2 row.

Balance-sheet level-2 values come from `balanceDisplayValues` (so Bank Accounts keeps its
running-balance treatment); P&L values come from `getCellValue`, so the base year keeps its
budget-derived figure rather than reading 0 from the engine entries.

**Expense excludes Transfers (v3.0.82).** `Transfer - Bank` maps to level1 `Expense` /
level2 `Transfers`, but the **Expense row is displayed net of transfers** (`getCellValue`
subtracts them, and Transfers gets its own row). The first cut of the breakdown stacked
Transfers under Expense, so the stack totalled to a number the row above it never showed —
a +$53,801 band on prod's 2027. `buildBreakdownSeries` now takes `excludeChildren`, and the
Expense breakdown drops `Transfers`, so the stack reconciles with the row. Pinned by test.
The bar chart's title and tooltip total also named "Net Assets" regardless of what was
clicked; they now name the row (`breakdownLabel`).

**Bug fixed in passing:** `graphSeries` overwrote each series' `color` with the 6-entry line
palette, so the Net Assets stacked bar never actually used `BAR_CHART_COLORS` — every
7th account repeated a color. A series' own color is now preserved.

## 3. Status

| Item | State |
|---|---|
| Migration 037 (4 nullable DATE columns) | ✅ applied dev + prod |
| Engine window (income + expense, yield + amount) | ✅ +10 tests (W1–W10, incl. half-year) |
| Route DTO / create / update / allowlist / **copy** | ✅ copy test extended |
| `FCModulesEdit` fields | ✅ |
| Hierarchy breakdown graph | ✅ +9 tests |
| Deploy | ✅ v3.0.81; Expense-excludes-Transfers v3.0.82; year-only picker + half-year v3.0.83 |

Suites: **338 backend / 174 frontend green**.

Verified on dev against live data: UB Income ran from 2027 at $45,784. With an income start
year of 2035 it starts in 2035 at **$27,892** — exactly half of that year's $55,784 full-year
run-rate (the July-1 half year), reaching the full $57,178 in 2036, and nothing before 2035.

## 4. Open

- The window is a **hard on/off**. If the owner later wants the amount to *step* (rent
  starts at $30K in 2030, rises to $40K in 2040), that is the changes-schedule design
  rejected above — reopen then, mirroring `forecast_incexp_changes`.
