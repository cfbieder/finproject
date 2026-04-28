**Status:** COMPLETED — [Plan](../NEXT_STEPS.md#cr003)

# CR003 — Forecast Module

This CR is the original design + implementation plan document for the Forecast Module. All phases (1, 2A, 2B, 3, 4, 5) shipped. Engine code lives in `server/src/services/forecast/`. Frontend pages: `/forecast-mapping`, `/forecast-modules`, `/forecast-setup-exp`, `/forecast-review`, `/fc-settings`. 73 backend tests cover engine logic. See `NEXT_STEPS.md` for any remaining open sub-items (Cash Sweep Phase C → CR017, Frontend test framework → CR016).

---

# Forecast Module — Design & Implementation Plan

## 1. Reference Spreadsheet Analysis

The spreadsheet `2026 Retirement Estimator v1.xlsm` is the target behavior model. It has 3 sheets:

### 1.1 Inputs Sheet (the calculation engine)

**Global Assumptions:**
- Year timeline (2023–2046) with age tracking per year
- FX rates: PLN and EUR per USD, per year (step-function)
- Inflation rates per year (step-function, e.g. 4% dropping to 2%)

**Cash Module:**
- Target cash balance per year (e.g. 250K USD)
- "Funding to cash" row — the residual that auto-balances: excess asset cash flows above target are reinvested, shortfalls trigger asset sales
- "Difference" row validates cash target is met

**Deposits / Fixed Income:**
- Deposit balance per year
- Deposit rate per year (e.g. 6% declining to 2.4%)
- Interest Income = deposit balance × deposit rate

**Equity Investments (e.g. Fidelity):**
- Market Value, Cost Basis
- Invest (purchases), Sell (disposals)
- Gain/Loss = sell amount - proportional basis
- Tax on realized gains at 25%, **deferred one year**
- Dividend yield % → Dividend Income = avg(MV current, MV prior) × yield %
- Growth rate = equity growth % (linked to inflation multiplier)

**Private Equity (e.g. CVC1, CVC2 — in EUR):**
- Same structure as equity but with scheduled payout dates
- FX conversion at assumed EUR/USD rate
- Growth rate independent of inflation for PE

**Other Businesses (e.g. UB — in PLN):**
- Market Value, Basis, scheduled sale date
- Annual Dividend in local currency → converted to USD
- Growth rate = base growth × inflation multiplier

**Real Estate (9 properties across USD, EUR, PLN):**
- Per property: Market Value, Basis, Sale date, Gain/Loss, Tax
- Property Costs (absolute amount, growing at inflation)
- Rental Income (absolute amount, growing at inflation)
- Growth rate = property appreciation × inflation

**Liabilities:**
- Loan balances with repayment schedules
- Interest Rate = base rate × inflation multiplier × 1.6
- Interest Expense = balance × interest rate
- Repayment amounts reduce balance

**Movements Summary:**
- Aggregates: Financial Investments, OTF contributions, Real Estate Investments

### 1.2 Outputs Sheet (the summary report)

**Cash Flow (P&L):**
- Income: Interest, Dividends, Salary/SS, UB Dividend, Other, Land, Rental
- Expenses: Living Expenses (inflation-adjusted), Property Costs, Interest Expense, Tax
- Net Cash Flow = Total Income - Total Expenses

**Balance Sheet:**
- Cash, Fixed Income, Stocks, CVC, Other Business, UB Investment
- SP Properties, US Properties, PL Properties, PL Land
- Liabilities (negative)
- **Net Worth** = sum of all

**Change in Equity Bridge:**
- Operating (income - expenses)
- Tax
- Unrealized Gain (market value changes)
- Realized Gain (on sales)
- Debt changes

### 1.3 Sheet1 (simplified/alternate model)

Older or simplified version with fewer asset classes; appears to be a quick-reference summary.

---

## 2. Current App Implementation

### 2.1 What Already Works

| Feature | Status | Notes |
|---------|--------|-------|
| Module-per-asset architecture | Done | Each BS item is a separate forecast module |
| Income/Expense items | Done | Separate `forecast_income_expense` table |
| Multi-currency (PLN, EUR, USD) | Done | FX rate assumptions per scenario |
| Growth via inflation multiplier | Done | `growth_rate × inflation_rate` compound |
| Tax on realized gains | Done | Capital gains tax at scenario tax rate |
| Investments & disposals | Done | With "Full" disposal flag |
| Unrealized/realized gain tracking | Done | In BS module processing |
| Income % and Expense % on modules | Done | `IncomePct` schedule, `ExpensePct` |
| Multi-year projection | Done | Year columns in danfo.js DataFrames |
| Scenario management | Done | Multiple scenarios with CRUD |
| Audit trail CSV export | Done | Per-module LC/USD/entries CSVs |
| Frontend: Scenarios page | Done | Create, edit, delete, copy scenarios |
| Frontend: Modules page | Done | Full CRUD with nested arrays |
| Frontend: Income/Expense page | Done | Setup with changes over time |
| Frontend: Review page | Done | Multi-year table with KPIs and graphs |
| Frontend: FX Assumptions page | Done | Manage FX rate assumptions |

### 2.2 Gaps vs. Spreadsheet (original analysis → current status)

| # | Gap | Spreadsheet Behavior | Status | Implemented In |
|---|-----|---------------------|--------|----------------|
| G1 | **Auto-populate base values from actuals** | 2025 YE balance sheet values are the starting point for 2026 FC | **DONE** | Phase 2B-4b — "Add from Actuals" tree view |
| G2 | **Deposit rate / interest income** | Deposits earn interest at a configurable rate per year | **DONE** | Phase 3 — IncomePct as deposit rate |
| G3 | **Cash auto-balance (target cash)** | Cash is the residual bucket; excess flows to deposits, shortfalls trigger sales | **DONE** | Phase 4 — target_cash + post-processing |
| G4 | **Tax deferral** | Capital gains tax is paid the following year | **DONE** | Phase 1 — +1 year shift |
| G5 | **Income/Expense from budget** | Living expenses and income baselines are planned forward-looking values | **DONE** | Phase 2B-4 — "Add from FC Lines" with budget pre-fill |
| G6 | **Liability interest model** | Interest rate = base × inflation × multiplier; auto-calculated interest expense | **DONE** | Phase 1 — expense_pct as interest rate |
| G7 | **Age tracking** | Row showing age for each forecast year | **DONE** | Phase 5 — birth year in Settings |
| G8 | **Property costs as absolute amounts** | Property costs are absolute values growing at inflation | **DONE** | Phase 1 — expense_amount field |
| G9 | **Equity bridge (change in NW)** | Operating + Tax + Unrealized + Realized + Debt = equity change | **DONE** | Phase 5 — collapsible Review section |
| G10 | **Movements / rebalancing summary** | Shows investment flows and rebalancing totals | **NOT DONE** | Not yet designed or implemented |

---

## 3. Design Decisions

| # | Gap | Decision | Approach |
|---|-----|----------|----------|
| G1 | Auto-populate BS base values | **"Seed from Actuals" button** on Modules page | Backend queries prior-year balance sheet, auto-fills base values for matched modules. User reviews before saving. |
| G2 | Deposit rate / interest income | **Reuse `IncomePct` as deposit rate** | For deposit-type modules, `IncomePct` schedule = deposit rate per year. Interest = market value × rate. Flows to "Interest Income" category. No schema changes. |
| G3 | Cash auto-balance | **Post-processing with target, manual rebalance** | New `target_cash` field on scenario. After generation, compute cash gap per year. Excess → adds to deposits. Shortfall → flagged in output for user to add disposals. |
| G4 | Tax deferral | **One-year shift on all realized gains tax** | Shift `taxValues` array by +1 year in `fcbuilder-module.js`. Small code change, correct US tax behavior. |
| G5 | Income/Expense from budget | **"Seed from Budget" button** on Income/Expense page | Backend queries current-year budget entries summed by category, auto-fills base values for matched items. Budget is forward-looking and already curated — better than prior-year actuals which include one-offs. Fallback to prior-year actuals if no budget entry exists. |
| G6 | Liability interest model | **Reuse existing fields** | `expense_pct` = interest rate, `Dispose` array = repayment schedule. Engine adjusts calculation for `account_type = 'liability'`. No schema changes. |
| G7 | Age tracking | **Birth year in Program Settings** | Single field in app settings. Review page displays `year - birth_year` as header row. Pure display, no engine changes. |
| G8 | Property costs absolute amounts | **Support both modes** | `expense_amount` column already exists in DB. If `expense_amount > 0`, use as absolute base grown at inflation. If 0, fall back to `expense_pct`. Frontend shows both fields. |
| G9 | Equity bridge | **Frontend aggregation from existing entries** | Group `forecast_entries` by account type to derive Operating, Tax, Unrealized, Realized, Debt. Collapsible section in Review page. No engine changes. |

---

## 4. Implementation Plan

### Phase 1: Engine Fixes (calculation accuracy)

**Goal:** Get the math right before adding automation.

**G4 — Tax Deferral**
- File: `server/src/services/forecast/fcbuilder-module.js`
- Change: After computing `taxValues[]`, shift array by +1 index (year 0 tax → year 1, etc.)
- The final year's tax spills into year N+1 — store it but note it's beyond the forecast horizon
- Also apply to `fcbuilder-incexp.js` for income tax on positive income items
- Test: Compare audit trail CSV output against spreadsheet values for a known module

**G8 — Property Costs as Absolute Amounts**
- File: `server/src/services/forecast/fcbuilder-module.js`
- Change: In expense calculation block, check if `module.expense_amount > 0`:
  - Yes → `expenseValues[i] = expense_amount * (1 + inflation)^(year - baseYear)` (absolute, inflation-adjusted)
  - No → existing `expense_pct` logic (percentage of avg market value)
- File: `server/src/v2/routes/forecast.js` — ensure `expense_amount` is passed through on create/update
- File: `frontend/src/features/Forecast/FCModulesEdit.jsx` — show `expense_amount` field, hint that it overrides `expense_pct`
- DB: `expense_amount` column already exists — no migration needed

**G6 — Liability Interest Model**
- File: `server/src/services/forecast/fcbuilder-module.js`
- Change: When `module.AccountType === 'liability'`:
  - Interpret `expense_pct` as annual interest rate
  - Interest expense = balance × (expense_pct / 100), grown by inflation
  - `Dispose` entries reduce the outstanding balance (repayments)
  - After full repayment, zero out all subsequent years
- Existing sign-handling for liabilities already inverts `expense_pct` — verify this works correctly with interest model

**Phase 1 Status: COMPLETE (2026-03-27)**
- G4 Tax Deferral: Implemented and verified (tax shifts +1 year in both fcbuilder-module.js and fcbuilder-incexp.js)
- G8 Absolute Expenses: Implemented and verified (expense_amount > 0 uses absolute value grown at inflation, falls back to expense_pct)
- G6 Liability Interest: Verified working with existing fields (expense_pct = interest rate, Dispose = repayments)
- 19 automated tests passing, 9 manual checks confirmed

### Phase 2: Seed from Actuals (automation)

**Goal:** One-click population of forecast starting values from actual data.

**G1 — Seed BS Module Base Values**
- New API endpoint: `POST /api/v2/forecast/modules/seed-from-actuals`
  - Query params: `scenario` (name), `baseYear` (e.g. 2025)
  - Backend calls the balance sheet report for Dec `baseYear`
  - For each forecast module in the scenario, match by `account_id` to balance sheet line items
  - Return proposed updates: `[{ module_id, current_base_value, proposed_base_value, proposed_market_value, account_name }]`
- New API endpoint: `PATCH /api/v2/forecast/modules/bulk-update`
  - Accepts array of `{ id, base_value, base_value_usd, market_value, market_value_usd, base_date }`
  - User confirms which modules to update after reviewing proposals
- Frontend: "Seed from Actuals" button on FCModuleManage page
  - Opens a review modal showing current vs. proposed values
  - Checkboxes to select which modules to update
  - "Apply" commits the bulk update

**G5 — Seed Income/Expense from Budget**
- New API endpoint: `POST /api/v2/forecast/incomeexpense/seed-from-budget`
  - Query params: `scenario`, `budgetYear` (e.g. 2026 — the first forecast year)
  - Backend queries `budget_entries` for the given year, summed by category (annualized)
  - For each `forecast_income_expense` item in the scenario, match by `account_id` to budget category totals
  - Returns proposed updates: `[{ incexp_id, current_base_value, proposed_base_value, account_name, budget_amount, actual_amount }]`
  - `actual_amount` included as reference (prior-year P&L) so user can compare budget vs actual
  - Fallback: if no budget entry exists for a category, show prior-year actual instead (marked as "from actuals")
- New API endpoint: `PATCH /api/v2/forecast/incomeexpense/bulk-update`
  - Same pattern as modules
- Frontend: "Seed from Budget" button on FCExpSetup page
  - Opens review modal showing: Item Name | Current Value | Budget Amount | Prior Year Actual | Source (Budget/Actual)
  - Checkboxes to select which items to update
  - "Apply" commits the bulk update
- **Rationale:** Budget is forward-looking and already curated (no one-offs). The forecast year 1 P&L should match the budget, then grow from there via inflation/growth rates.

**Phase 2 Status: SUPERSEDED BY PHASE 2B (2026-03-27)**
- G1 Seed from Actuals: REPLACED by "Add from Actuals" (tree-based module creation)
- G5 Seed from Budget: REPLACED by "Add from FC Lines" (FC Mapping → Forecast Expenses)
- Coverage Check: REPLACED by FC Mapping page coverage bar
- Property Cost Seeding: REPLACED by FC Line assignment on BS modules

**Phase 2B Status: COMPLETE (2026-03-28)**
- Phase 2B-1 DB & API Foundation: DONE — Migration 007_fc_lines.sql, fc_lines + fc_line_categories tables, 9 REST endpoints, 15 automated tests passing
- Phase 2B-2 FC Mapping Page: DONE — FCLineMapping.jsx with line CRUD, drag/drop category assignment, multi-select (Ctrl+Click), type dropdowns, coverage bar, budget totals, category detail modal on double-click
- Phase 2B-3 Module Edit Integration: DONE — Expense/Income Line pickers (FC Line dropdowns filtered by type + "None"), Expense/Income Amount (Yr 1) fields, Expense Growth method toggle, allocation tracking (Budget / Other modules / Remaining), Income % year dropdown fixed, modal no longer closes on overlay click
- Phase 2B-4 Forecast Expenses Integration: DONE — "Add from FC Lines" button replaces "Seed Budget" and "Coverage" buttons. Modal shows Forecast Expense/Income lines with budget totals, creates items with budget pre-fill, base date, fc_line_id, budget_source_year. Old FCSeedFromBudgetModal and FCCoverageCheckModal removed from imports.
- Phase 2B-4b Add from Actuals: DONE — "Add from Actuals" replaces "Seed Actuals" on Modules page. New endpoint `POST /forecast/modules/add-from-actuals` returns BS account tree with year-end balances (excluding Bank Accounts). Tree view modal with expand/collapse, leaf pre-selection, parent aggregation toggle. Creates modules with balances pre-filled. Old `seed-from-actuals` endpoint and `FCSeedFromActualsModal.jsx` deleted.
- Phase 2B-5 Engine Update: DONE — FC Line name map preloaded in index.js, expense_growth_method (inflation/pct_of_value) implemented in processModule, expense_fc_line_id/income_fc_line_id resolved to entry labels, 6 new tests (T5.1-T5.6), 41 total tests passing
- Phase 2B-6 Migration Script: SKIPPED — FC data wiped clean instead of migrating; fresh start on both dev and production
- Phase 2B-7 Cleanup: DONE — Removed seed-from-budget and bulk-update endpoints, deleted FCSeedFromBudgetModal.jsx and FCCoverageCheckModal.jsx, removed expense_category/income_category/expense_pct from routes/repository/engine/frontend, dropped 3 DB columns (migration 008), frontend builds clean, 41 tests passing

**Additional fixes applied during Phase 2B (2026-03-28):**
- Fixed `findUnassignedCategories` to use recursive CTE — children of assigned parent categories now excluded from unmatched list
- Fixed `modules/unmatched` endpoint — children of matched parent accounts excluded via `ancestorMatched` flag during tree traversal
- Fixed group heading capitalization in FCModulesUnmatchedModal — `asset` → `Asset`, `liability` → `Liability`
- Fixed `IsMatched` field mapping — API returns `IsMatched` but edit form expected `Matched`, causing checkbox to always appear unchecked
- Fixed Account/Name fields in edit modal — now read-only (disabled) when module is matched to COA
- Fixed FX rates modal showing no currency fields — added default `["PLN", "EUR"]` to `fxKeys` so fields appear even on fresh scenarios
- Fixed Generate Suggestions — now opens selectable checklist modal instead of auto-creating all lines; re-running shows only remaining suggestions
- Fixed FC Mapping page scrolling — both FC Lines and Unassigned panels now have independent scroll via `maxHeight: calc(100vh - 320px)`
- Fixed new scenario naming — selecting "+ New Scenario" immediately opens naming modal instead of going to placeholder state
- Added FCStepNav component — prev/next step navigation arrows on all 5 forecast pages (Mapping → Scenarios → Modules → Expenses → Review)
- Fixed `writeValuesToCategoryRow` year offset — BaseDate year before DataFrame's first column caused all entries to be silently dropped
- Fixed audit trail duplicate column keys — when IncomeCategory/ExpCategory both empty, DataFrame column names collided
- Fixed FX division by zero — missing FX assumptions produced 0 rates, causing Infinity on EUR/PLN modules; now guards with `fx || 1`
- Added `GET /api/v2/forecast/modules/:id` endpoint — returns single module with nested arrays (IncomePct, Invest, Dispose); edit modal now fetches full data before opening (fixes Income % entries not loading/saving)
- Fixed FC Expense edit modal — Account/Name/Type/Matched locked when item created from FC Line (`FcLineId` set); auto-correct effect skipped for FC Line items
- Fixed account resolution for FC Line items — backend resolves `account_id` from FC Line name → P&L account on creation
- Added `FcLineId` to incexp GET response for frontend lock logic
- Fixed incexp Type capitalization — "expense" → "Expense", "income" → "Income" in API response
- Fixed Graph button disabled — removed unnecessary loading state dependencies; now enabled when rows are selected
- Added `PUT /api/v2/forecast/scenarios/:id` endpoint for updating scenario fields (target_cash)
- Added Select All / Clear buttons to Add from Actuals modal
- Added `Matched` field to module list GET response (was only `IsMatched`, table read `Matched`)
- Module Type capitalized in API response and editable even when matched (dropdown with configurable types)
- Module Type dropdown options sourced from appdata `moduleTypes` (configurable via FC Settings page)
- New FC Settings page (`/fc-settings`) — combines Birth Year, Module Types, and FX Assumptions (replaces old `/fx-options`)
- Module setup status tracking: `setup_status` column (migration 011) on both `forecast_modules` and `forecast_income_expense`, color-coded badges (New/In Progress/Complete), table filter, edit form dropdown
- Forecast engine only includes modules and expenses with `setup_status = 'complete'` — allows incremental setup and review (mark complete → generate → see impact → mark next complete)
- **Engine: P&L now driven by FC Lines** — IncExp items resolve `fc_line_id` to FC Line name for entry labels (instead of COA account names). Standardized tax account name from "Taxes US" to "Taxes" across both engines. Review page P&L section rebuilt from FC Lines via `useFCLineStructure` hook and `/api/v2/fc-lines/review-structure` endpoint. Income/Expense sections show FC Line names grouped by type.

**Additional fixes applied during Phase 2/2B (prior sessions):**
- Fixed `PUT /assumptions` to preserve `scenarios` array in FCAssump.json (was being stripped, breaking forecast generation)
- Fixed `copyScenario` to handle existing target scenarios (clears and re-copies instead of failing with duplicate key)
- Fixed duplicate key error on assumptions PUT with try/catch for race condition with copy
- Fixed deploy script: `--no-deps server frontend` to avoid postgres container conflicts, `COMPOSE_PROJECT_NAME=psproject` for consistent Docker networking, auto-connect to postgres network
- Fixed `formatTableNumber` in FCExpSetup to handle string values from DB (was showing "—" for valid numbers)
- Fixed Income % year dropdown showing only "0" when PeriodStart not set (fallback to currentYear)
- Added `Rest.get()`, `Rest.put()`, `Rest.del()` to frontend REST helper
- Vite dev proxy pointed to dev API (port 3105) for testing

**Additional fixes applied during Phase 2:**
- Fixed `PUT /assumptions` to preserve `scenarios` array in FCAssump.json (was being stripped, breaking forecast generation)
- Fixed `copyScenario` to handle existing target scenarios (clears and re-copies instead of failing with duplicate key)
- Fixed duplicate key error on assumptions PUT with try/catch for race condition with copy
- Fixed deploy script: `--no-deps server frontend` to avoid postgres container conflicts, `COMPOSE_PROJECT_NAME=psproject` for consistent Docker networking, auto-connect to postgres network
- Fixed `expense_amount` column already existed in DB but wasn't used in calculation — now implemented in Phase 1

**End-to-end walkthrough status (dev server `http://100.94.46.62:5174`):**
1. FC Mapping page: Generate Suggestions → select lines → assign categories → set types — PASS
2. Create scenario (+ New Scenario → immediate naming modal) — PASS
3. Set inflation, FX rates, tax rate, target cash — PASS
4. Add from Actuals on Modules page (tree view, Select All/Clear) — PASS
5. Edit modules: Growth, Expense/Income Lines, Expense Amount, Income % — PASS (nested arrays now load correctly)
6. Add from FC Lines on Expenses page (budget pre-fill, locked fields) — PASS
7. Generate forecast — PASS (391 entries, all BS + P&L accounts populated)
8. Review results — PASS (values match hand calculations, graph works)
9. Automated e2e test: 8 complex tests covering equity/property/fixed-income/liability/incexp/FX/tax-deferral — PASS

**Remaining "Not Covered" items from coverage check (31 categories, -115K):**
- Taxes (US, SP, PL, Preparation): Handled by engine tax calculation — OK
- Property costs (Condo Fees, Property Tax, Utilities, Insurance, Maintenance per property): Need `expense_amount` on BS modules — TO BE BUILT via property cost seeding
- Base Salary (3.8K): Small, could add as FC IncExp item

### Phase 3: Deposit Rate (interest income)

**Goal:** Deposits earn interest at a configurable rate.

**Phase 3 Status: COMPLETE (2026-03-28)**
- Engine already supports deposit/yield rates via IncomePct schedule: `income = avg(MV_current, MV_prior) × rate%`
- Frontend label dynamically shows "Yield / Deposit Rate %" for deposit/fixed-income/bond module types, "Income / Yield %" for others
- Verified in e2e test: 1M fixed income at 4% yield produces 40K/year income
- Growth field relabeled to "Growth (x Inflation)" with tooltip on both BS module and IncExp edit forms

### Phase 4: Cash Target & Auto-Balance

**Goal:** Maintain target cash balance; excess to deposits, shortfall flagged.

**Phase 4 Status: COMPLETE (2026-03-28)**
- Migration 009: `target_cash` NUMERIC column added to `forecast_scenarios`
- Engine post-processing in `index.js`: after all modules processed, computes cumulative cash balance vs target
  - Excess cash → creates `Cash Rebalance - Deposits` entries (positive) and reduces `Bank Accounts`
  - Shortfall → creates `Cash Shortfall` entries (negative, flagged for user)
- Frontend: `Target Cash` field on Scenarios page (FCScenariosSelect), saved to DB via `PUT /api/v2/forecast/scenarios/:id`
- Review page: Cash Shortfall and Cash Rebalance rows appear automatically as forecast entries
- 49 automated tests passing (8 new e2e engine tests)

### Phase 5: Display Enhancements

**Phase 5 Status: COMPLETE (2026-03-28)**

**G7 — Age Tracking: DONE**
- Birth year stored in appdata JSON via `POST /api/v2/util/appdata` (key: `birthYear`)
- Program Settings page: new "Forecast" section with Birth Year input field
- FC Review page: age row displayed below year headers (`year - birthYear`), styled in muted gray
- No backend engine changes

**G9 — Equity Bridge: DONE**
- Collapsible "Change in Net Worth" section at bottom of Review table
- Rows: Operating (Income - Expenses), Tax, Asset Value Changes (residual), Total Change in Net Worth
- Computed from existing P&L entries and year-over-year total assets change
- Green/red color coding, bold total row with separator

**Additional features implemented (2026-03-28):**
- Per-module tax rate override: `tax_rate_override` column on `forecast_modules` (migration 010), `Tax Rate Override (%)` field in module edit form, engine uses module-specific rate when set (NULL = scenario default)
- Copy scenario auto-refresh: "Update base values from actuals" checkbox + year picker on copy modal; updates module base_value/market_value/base_date from year-end balances when copying

**G9 — Equity Bridge**
- File: `frontend/src/utils/forecastHelpers.js` — new function `computeEquityBridge(entries, years)`
  - Groups entries by account into bridge categories:
    - **Operating:** sum of all income + expense category entries
    - **Tax:** sum of all "Taxes US" entries
    - **Unrealized Gains:** year-over-year change in module market values (derived from BS entries)
    - **Realized Gains:** sum of all "Transfer - Bank" entries (represents investment/divestment cash flows)
    - **Debt:** change in liability entries
  - Returns `{ operating: [], tax: [], unrealized: [], realized: [], debt: [], total: [] }` per year
- File: `frontend/src/features/Forecast/FCReviewTable.jsx` — add collapsible "Change in Net Worth" section below balance sheet
- No backend engine changes

---

## 5. Files Affected Summary (final state, all phases)

### Backend
| File | Phases | Changes |
|------|--------|---------|
| `server/src/services/forecast/fcbuilder-module.js` | 1, 2B-5, 3 | Tax deferral, absolute expense amounts, liability interest, expense_growth_method (inflation/pct_of_value), FC Line name resolution, deposit rate |
| `server/src/services/forecast/fcbuilder-incexp.js` | 1, 2B-5 | Tax deferral on income items, FC Line name resolution, FX conversion fix |
| `server/src/services/forecast/index.js` | 2B-5, 4 | FC Line name map preload, cash auto-balance post-processing |
| `server/src/v2/routes/forecast.js` | 2B-4, 2B-4b | add-from-actuals, add-from-lines, modules/:id GET, scenarios/:id PUT, setup_status support |
| `server/src/v2/routes/fcLines.js` | 2B-1 | FC Lines CRUD, category assignment, suggestions, unassigned, budget-totals, review-structure |
| `server/src/v2/repositories/forecast.js` | 2B, 4, 5 | Module/incexp CRUD with FC Line fields, target_cash, tax_rate_override, setup_status |
| `server/src/v2/repositories/fcLines.js` | 2B-1 | FC Lines and category assignment CRUD, budget totals aggregation |
| `server/db/migrations/007_fc_lines.sql` | 2B-1 | fc_lines + fc_line_categories tables |
| `server/db/migrations/008_drop_old_fc_columns.sql` | 2B-7 | Drop expense_category, income_category, expense_pct |
| `server/db/migrations/009_target_cash.sql` | 4 | Add target_cash to forecast_scenarios |
| `server/db/migrations/010_tax_rate_override.sql` | 5 | Add tax_rate_override to forecast_modules |
| `server/db/migrations/011_setup_status.sql` | 5 | Add setup_status to forecast_modules and forecast_income_expense |

### Frontend — Pages
| File | Phases | Changes |
|------|--------|---------|
| `frontend/src/pages/FCLineMapping.jsx` | 2B-2 | FC Mapping page with drag/drop, multi-select, generate suggestions, coverage bar |
| `frontend/src/pages/FCModuleManage.jsx` | 2B-4b | "Add from Actuals" tree view, setup status filter |
| `frontend/src/pages/FCExpSetup.jsx` | 2B-4 | "Add from FC Lines" button, setup status filter, locked fields for FC Line items |
| `frontend/src/pages/FCReview.jsx` | 4, 5 | Cash shortfall/rebalance rows, age row, KPI cards, FC Line-driven P&L |
| `frontend/src/pages/FCScenarios.jsx` | 4 | Target Cash field |
| `frontend/src/pages/FCSettings.jsx` | 5 | Birth Year, Module Types, FX Assumptions (combined page) |
| `frontend/src/pages/ProgramSettings.jsx` | 5 | Birth year field |

### Frontend — Components
| File | Phases | Changes |
|------|--------|---------|
| `frontend/src/features/Forecast/FCModulesEdit.jsx` | 1, 2B-3 | expense_amount, FC Line pickers, growth method toggle, allocation tracking, tax rate override, setup status |
| `frontend/src/features/Forecast/FCAddFromActualsModal.jsx` | 2B-4b | Tree view with expand/collapse, leaf pre-selection, Select All/Clear |
| `frontend/src/features/Forecast/FCAddFromLinesModal.jsx` | 2B-4 | FC Lines with budget totals, budget year picker |
| `frontend/src/features/Forecast/FCReviewTable.jsx` | 5 | Equity bridge collapsible section, FC Line-driven P&L structure |
| `frontend/src/features/Forecast/FCStepNav.jsx` | 2B | Step navigation arrows across all 5 forecast pages |
| `frontend/src/features/Forecast/FCScenariosSelect.jsx` | 4 | Target Cash display |
| `frontend/src/utils/forecastHelpers.js` | 5 | `computeEquityBridge()` function |
| `frontend/src/contexts/ForecastContext.jsx` | 2B | Shared forecast state |
| `frontend/src/js/rest.js` | 2B | `Rest.get()`, `Rest.put()`, `Rest.del()` methods |

### Files Removed (Phase 2B-7 Cleanup)
| File | Reason |
|------|--------|
| `FCSeedFromBudgetModal.jsx` | Replaced by "Add from FC Lines" |
| `FCCoverageCheckModal.jsx` | Replaced by FC Mapping page coverage |
| `FCSeedFromActualsModal.jsx` | Replaced by `FCAddFromActualsModal.jsx` |
| `seed-from-budget` endpoint | Replaced by FC Line flow |
| `coverage-check` endpoint | Replaced by mapping page |
| `expense_category`, `income_category`, `expense_pct` columns | Replaced by FC Line FKs + expense_growth_method |

---

## 6. Testing Strategy

Testing infrastructure: **Jest 29.7** is configured for the server (`server/jest.config.js`), tests go in `__tests__` directories matching `**/__tests__/**/*.test.js`. No frontend test framework yet — frontend verification is manual.

Each phase has:
- **Automated tests** (Jest unit tests) — run with `cd server && npm test`
- **Manual walkthrough** — step-by-step UI and API verification checklist

**Gate rule:** All automated tests pass AND all manual checks are confirmed before moving to the next phase.

---

### Phase 1 Testing: Engine Fixes

#### Automated Tests

**File:** `server/src/services/forecast/__tests__/fcbuilder-module.test.js`

**Test Group: Tax Deferral (G4)**

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1.1 | Tax is deferred by one year | Module with disposal in year 2 generating $100 realized gain, tax rate 25% | `taxValues[2] = 0`, `taxValues[3] = -25` |
| 1.2 | No tax in the disposal year | Same as 1.1 | Year 2 tax entry is 0 |
| 1.3 | Tax on final forecast year spills correctly | Disposal in final year of forecast period | Tax entry exists for final year + 1 (or is recorded as deferred) |
| 1.4 | No tax on losses | Module with disposal at a loss (sell < basis) | All tax values = 0 |
| 1.5 | Multiple disposals across years | Disposals in years 3 and 5 | Tax appears in years 4 and 6 respectively |

**Test Group: Absolute Expense Amounts (G8)**

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1.6 | Absolute expense grows at inflation | `expense_amount = 30`, inflation = 2%, 3-year forecast | Year 1: 30, Year 2: 30.6, Year 3: 31.212 |
| 1.7 | Expense amount overrides expense_pct | Module with `expense_amount = 30` AND `expense_pct = 5` | Expense uses 30 (absolute), not 5% of market value |
| 1.8 | Zero expense_amount falls back to pct | `expense_amount = 0`, `expense_pct = 5`, market value = 1000 | Expense = ~50 (5% of avg market value) |
| 1.9 | Expense amount with FX conversion | PLN module, `expense_amount = 120`, FX = 4 PLN/USD | USD expense = 120/4 = 30 per year (before inflation) |

**Test Group: Liability Interest Model (G6)**

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1.10 | Interest calculated on liability balance | Liability module, balance = 100, `expense_pct` = 8 (interest rate) | Interest expense = 100 × 8% = 8 per year |
| 1.11 | Repayment reduces balance | Liability = 100, repayment of 50 in year 2 via `Dispose` | Year 1 balance = 100, Year 2 balance = 50, Year 3 interest based on 50 |
| 1.12 | Full repayment zeros out | Liability = 100, full repayment in year 2 | Year 3+ balance = 0, interest = 0 |
| 1.13 | Interest rate varies with inflation | Liability with `expense_pct = 8`, growth_rate linked to inflation | Interest rate adjusts per inflation schedule |

**File:** `server/src/services/forecast/__tests__/fcbuilder-incexp.test.js`

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1.14 | Income tax deferred one year | Income item with positive value, tax rate 25% | Tax entry shifted +1 year |
| 1.15 | No tax deferral on expense items | Expense item (negative value) | No tax generated (negative items don't trigger tax) |

**Test Utilities Needed:**
- `server/src/services/forecast/__tests__/helpers.js` — factory functions to create mock modules, scenarios, and assumption DataFrames without hitting the database. Mock `db.query` to capture inserted entries instead of writing to PostgreSQL.

#### Manual Walkthrough

| # | Step | Action | Verify |
|---|------|--------|--------|
| M1.1 | Set up a test scenario | Create scenario "Test_Phase1" with period 2026–2035, tax rate 25%, inflation 2% | Scenario appears on Scenarios page |
| M1.2 | Add a module with a disposal | Create equity module: base value 1000, market value 1200, disposal of 500 in 2028 | Module saved, disposal visible in edit form |
| M1.3 | Generate forecast | Click Generate for "Test_Phase1" | Generation succeeds, entries created |
| M1.4 | Check tax deferral | Open audit trail CSV for the module | Tax from 2028 disposal appears in 2029 column, not 2028 |
| M1.5 | Add a property module with expense_amount | Create real estate module: market value 500, expense_amount = 30 | Module saved with expense_amount field visible |
| M1.6 | Verify absolute expense in output | Regenerate forecast, check audit trail | Expense row shows ~30 growing at inflation, NOT a % of market value |
| M1.7 | Add a liability module | Create liability: balance 100, expense_pct = 8 (interest rate), disposal of 50 in 2028 (repayment) | Module saved as liability type |
| M1.8 | Verify liability interest | Regenerate, check audit trail | Interest = 8 in 2026-2027, drops to ~4 after 2028 repayment |
| M1.9 | Compare to spreadsheet | For a module that matches a spreadsheet asset, compare year-by-year values | Values match within rounding tolerance (< $1 difference per year) |

---

### Phase 2 Testing: Seed from Actuals

#### Automated Tests

**File:** `server/src/v2/routes/__tests__/forecast-seed.test.js`

**Test Group: Seed BS Modules (G1)**

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 2.1 | Returns proposed values for matched modules | Scenario with 3 modules, 2 have matching account_ids in balance sheet | Response contains 2 proposals with `current_base_value` and `proposed_base_value` |
| 2.2 | Unmatched modules are skipped | Module with account_id that has no balance sheet entry | Module not included in proposals |
| 2.3 | Bulk update applies values | PATCH with 2 module updates | DB rows updated with new base_value, market_value, base_date |
| 2.4 | Bulk update rejects invalid IDs | PATCH with non-existent module ID | 404 or partial success with error for invalid ID |
| 2.5 | Base date set to Dec 31 of base year | Seed with baseYear = 2025 | All proposed base_date values = "2025-12-31" |

**Test Group: Seed Income/Expense from Budget (G5)**

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 2.6 | Returns proposed values from budget | 3 income/expense items, 2 have budget entries for the year | 2 proposals with `proposed_base_value` from budget totals, source = "Budget" |
| 2.7 | Falls back to prior-year actual | Item with no budget entry but has prior-year P&L activity | Proposal returned with source = "Actual" |
| 2.8 | Handles income (positive) and expense (negative) | Mix of income and expense budget entries | Positive values for income, negative for expense categories |
| 2.9 | Includes actual as reference | Items with both budget and actual data | Response includes both `budget_amount` and `actual_amount` for comparison |
| 2.10 | Bulk update applies values | PATCH with updates | DB rows updated with new base_value, base_value_usd |

#### Manual Walkthrough

| # | Step | Action | Verify |
|---|------|--------|--------|
| M2.1 | Verify actuals exist | Navigate to Balance page, generate Dec 2025 report | Balance sheet shows account balances |
| M2.2 | Navigate to Modules page | Select a scenario with existing modules | Modules list displayed |
| M2.3 | Click "Seed from Actuals" | Click button, enter base year = 2025 | Review modal opens with proposed values |
| M2.4 | Verify proposals | Compare proposed values to balance sheet report | Values match balance sheet for each matched account |
| M2.5 | Verify unmatched shown | Check for modules with no match | Unmatched modules show "No match" or are absent from list |
| M2.6 | Select and apply | Check 2 modules, click Apply | Toast confirms update, module list refreshes with new values |
| M2.7 | Verify persisted | Close and reopen the module edit form | Base values reflect the applied actuals |
| M2.8 | Repeat for Income/Expense | Navigate to Income/Expense page, click "Seed from Budget" | Review modal opens with budget year selector |
| M2.9 | Verify budget proposals | Compare proposed values to Budget Worksheet totals for 2026 | Budget amounts match per category; "Source" column shows "Budget" |
| M2.10 | Verify fallback to actual | Check an item that has no budget entry | Shows prior-year actual amount, "Source" column shows "Actual" |
| M2.11 | Verify reference column | Check the "Prior Year Actual" column | Shows 2025 actual values alongside budget for comparison |
| M2.12 | Apply and regenerate | Apply seed, then generate forecast | Forecast year 1 P&L aligns with budget; subsequent years grow from there |

---

### Phase 3 Testing: Deposit Rate

#### Automated Tests

**File:** `server/src/services/forecast/__tests__/fcbuilder-deposit.test.js`

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 3.1 | Interest = balance × rate | Module: market value 1000, IncomePct = [{Date: 2026, Value: 3.0}], IncomeCategory = "Interest Income" | Income year 1 = avg(1000, 1000) × 3% = 30 |
| 3.2 | Rate changes over time | IncomePct = [{Date: 2026, Value: 5.0}, {Date: 2029, Value: 2.5}] | Years 2026–2028 use 5%, 2029+ use 2.5% |
| 3.3 | Interest on growing balance | Module with investments adding to balance | Interest computed on avg of prior and current year market values |
| 3.4 | Interest flows to correct category | IncomeCategory = "Interest Income" | Entries created with account = "Interest Income" |
| 3.5 | Zero rate produces zero interest | IncomePct = [{Date: 2026, Value: 0}] | No income entries generated |
| 3.6 | FX conversion on PLN deposits | PLN module, rate 3%, FX = 4 | Interest in USD = (balance × 3%) / 4 |

#### Manual Walkthrough

| # | Step | Action | Verify |
|---|------|--------|--------|
| M3.1 | Create deposit module | New module: "Fixed Income", base value 1000, IncomeCategory = "Interest Income" | Module created |
| M3.2 | Set deposit rate schedule | Add IncomePct entries: 5% from 2026, 2.5% from 2030 | IncomePct array saved |
| M3.3 | Generate forecast | Generate for the scenario | Success |
| M3.4 | Verify interest in review | FC Review page, find "Interest Income" row | Shows ~50 for 2026–2029, ~25 for 2030+ (scaled to actual balances) |
| M3.5 | Check audit trail | Download audit trail CSV for the deposit module | IncomePct column shows correct rates, income column shows balance × rate |
| M3.6 | Compare to spreadsheet | Match deposit rows in spreadsheet (rows 12–18) | Interest income values align |

---

### Phase 4 Testing: Cash Target & Auto-Balance

#### Automated Tests

**File:** `server/src/services/forecast/__tests__/cash-balance.test.js`

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 4.1 | Excess cash redirected to deposits | Net cash = 500, target = 250 | New entry: "Fixed Income Deposit" = 250 (excess) |
| 4.2 | Shortfall flagged | Net cash = 100, target = 250 | New entry: "Cash Shortfall" = 150 |
| 4.3 | Exact target produces no adjustment | Net cash = 250, target = 250 | No additional entries |
| 4.4 | No target_cash skips processing | target_cash = NULL | No cash balance entries created (existing behavior) |
| 4.5 | Multi-year mix of excess and shortfall | Years: [500, 300, 100, 400], target = 250 | Correct excess/shortfall per year |
| 4.6 | Excess adds to deposit balance for interest calc | Year 1 excess = 200 → deposits grow | Subsequent years' deposit balance reflects accumulated excess |

**File:** `server/src/v2/routes/__tests__/forecast-scenarios.test.js`

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 4.7 | target_cash saved on scenario create | POST scenario with target_cash = 250 | DB row has target_cash = 250 |
| 4.8 | target_cash nullable | POST scenario without target_cash | DB row has target_cash = NULL |
| 4.9 | target_cash updated | PUT scenario with new target_cash | DB row updated |

#### Manual Walkthrough

| # | Step | Action | Verify |
|---|------|--------|--------|
| M4.1 | Add target cash to scenario | Edit scenario, set target_cash = 250 | Field saves, visible on reopen |
| M4.2 | Generate forecast | Generate for the scenario | Success |
| M4.3 | Check cash balance row | FC Review page, "Bank Accounts" / Cash row | Cash balance stabilizes near 250 per year |
| M4.4 | Verify excess years | Years where income > expenses significantly | "Fixed Income Deposit" entries show positive amounts |
| M4.5 | Verify shortfall years | Years where disposals or large expenses occur | Cash Shortfall rows highlighted in warning/red |
| M4.6 | Test without target | Remove target_cash (set blank), regenerate | Cash balance floats freely, no deposit/shortfall entries |
| M4.7 | Adjust to fix shortfall | Add a disposal to cover the shortfall year, regenerate | Shortfall disappears or reduces |

---

### Phase 5 Testing: Display Enhancements

#### Automated Tests

**File:** `server/src/services/forecast/__tests__/equity-bridge.test.js`

(Note: equity bridge is frontend logic, but we can test the helper function if extracted to a shared utility)

**File:** `frontend/src/utils/__tests__/forecastHelpers.test.js` (requires adding Vitest to frontend — optional, can defer)

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 5.1 | computeEquityBridge groups correctly | Mock entries with known accounts | Operating = sum of income + expense entries |
| 5.2 | Bridge sums to NW change | Entries for a 3-year period | `operating + tax + unrealized + realized + debt = NW[year] - NW[year-1]` for each year |
| 5.3 | Empty entries produce zero bridge | No entries | All bridge values = 0 |

#### Manual Walkthrough

| # | Step | Action | Verify |
|---|------|--------|--------|
| M5.1 | Set birth year | Program Settings → enter birth year (e.g. 1968) | Saves successfully |
| M5.2 | Check age row in Review | Navigate to FC Review, select scenario | Age row appears below year headers: 2026 → 58, 2027 → 59, etc. |
| M5.3 | Verify age math | Spot check 3 years | All ages = year - birth_year |
| M5.4 | Check equity bridge section | Scroll below balance sheet in FC Review | "Change in Net Worth" section visible, collapsible |
| M5.5 | Verify bridge rows | Check Operating, Tax, Unrealized, Realized, Debt rows | Values present, non-zero where expected |
| M5.6 | Verify bridge totals | Sum the 5 bridge rows for each year | Total matches year-over-year Net Worth change |
| M5.7 | Compare to spreadsheet | Match equity bridge rows (Outputs sheet rows 57–63) | Values align within rounding tolerance |
| M5.8 | Test collapse/expand | Click to collapse the equity bridge section | Section hides; re-click expands |

---

### Test File Structure

```
server/src/services/forecast/__tests__/
├── helpers.js                      # Mock factories: createMockModule(), createMockScenario(), createMockAssumptions()
├── fcbuilder-module.test.js        # Phase 1: tax deferral, absolute expenses, liability interest
├── fcbuilder-incexp.test.js        # Phase 1: income tax deferral
├── fcbuilder-deposit.test.js       # Phase 3: deposit rate / interest income
└── cash-balance.test.js            # Phase 4: cash target auto-balance

server/src/v2/routes/__tests__/
├── forecast-seed.test.js           # Phase 2: seed from actuals endpoints
└── forecast-scenarios.test.js      # Phase 4: target_cash CRUD
```

### Running Tests

```bash
# All forecast tests
cd server && npm test -- --testPathPattern="forecast"

# Specific phase
cd server && npm test -- --testPathPattern="fcbuilder-module"

# With coverage
cd server && npm run test:coverage -- --testPathPattern="forecast"
```

---

## 7. FC Inc/Exp Mapping Layer — Design (Phase 2B)

### 7.1 Problem Statement

The original Phase 2 approach attempted to match budget categories to forecast modules and expenses using ad-hoc logic (name matching, category hierarchy traversal, property-specific seeding). This led to:
- Fragile matching that breaks when names change
- No single place to see which budget categories are covered
- Separate "seed" flows for different category types (actuals, budget, property costs)
- No clean link between budget granularity (~130 categories) and forecast granularity (~20-30 lines)

### 7.2 Solution: FC Inc/Exp Mapping Layer

Introduce a **global mapping layer** that sits between budget categories and the forecast engine. The user defines a set of **FC Lines** (forecast income and expense lines), assigns every budget category to a line, and designates each line's destination (BS Module or Forecast Inc/Exp).

### 7.3 Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Scope | Global (not per-scenario) | Budget categories don't change per scenario; mapping is foundational |
| D2 | Line creation | User-defined with "Generate suggestions" from P&L account hierarchy | Full control; P&L hierarchy provides good starting names |
| D3 | Category assignment | Drag/drop; each category assigned to exactly one line; unassigned clearly visible | Prevents double-counting; ensures complete coverage |
| D4 | Line type | Set on mapping page; changeable. Values: BS Module - Expense, BS Module - Income, Forecast Expense, Forecast Income, Unassigned | Full visibility on mapping page; prevents accidental dual-use |
| D5 | BS Module linkage | Module edit form picks FC Lines (BS Module types) + "None" for expense/income category; replaces old string-based dropdowns | Clean FK relationship; old strings were placeholders |
| D6 | Multi-module allocation | One line can be assigned to multiple modules; user manually splits amount; allocation tracking shows over/under | Handles US/PL cases where budget isn't per-property |
| D7 | Forecast Inc/Exp linkage | User selects which Forecast-type lines to include per scenario; budget total pre-fills base_value | Per-scenario control; budget auto-seeds values |
| D8 | Year 1 expense seeding | Budget total auto-seeds expense_amount for year 1 | Grounds forecast in actual budget |
| D9 | Growth method | User chooses per module: "Grow at inflation" or "Grow as % of asset value" | Property tax scales with value; condo fees scale with inflation |
| D10 | Workflow order | FC Mapping page comes BEFORE scenario creation in the UI | Mapping is foundational; modules and expenses reference lines |
| D11 | Income handling | Same system for income and expense lines | Unified coverage; rental income, interest, dividends all mapped |
| D12 | Migration | Existing expense_category/income_category strings auto-matched to new FC Lines; unmatched flagged | Clean break; old strings were placeholders anyway |

### 7.4 Data Model

#### New Table: `fc_lines`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | |
| `name` | VARCHAR(200) UNIQUE | User-defined line name (e.g., "Prop Costs - PM4") |
| `line_type` | VARCHAR(30) | `bs_module_expense`, `bs_module_income`, `forecast_expense`, `forecast_income`, `unassigned` |
| `display_order` | INTEGER | Sort order on mapping page |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### New Table: `fc_line_categories`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | |
| `fc_line_id` | INTEGER FK → fc_lines | Parent line |
| `category_id` | INTEGER FK → categories UNIQUE | Each category assigned to exactly one line |
| `created_at` | TIMESTAMPTZ | |

UNIQUE constraint on `category_id` ensures no double-assignment.

#### Modified Table: `forecast_modules`

| Column | Change | Description |
|--------|--------|-------------|
| `expense_category` | **REMOVE** (after migration) | Replaced by `expense_fc_line_id` |
| `income_category` | **REMOVE** (after migration) | Replaced by `income_fc_line_id` |
| `expense_fc_line_id` | **ADD** INTEGER FK → fc_lines, NULLABLE | Links to FC Line typed as `bs_module_expense`, NULL = "None" |
| `income_fc_line_id` | **ADD** INTEGER FK → fc_lines, NULLABLE | Links to FC Line typed as `bs_module_income`, NULL = "None" |
| `expense_growth_method` | **ADD** VARCHAR(20) DEFAULT 'inflation' | `inflation` or `pct_of_value` — controls year 2+ expense growth |

#### Modified Table: `forecast_income_expense`

| Column | Change | Description |
|--------|--------|-------------|
| `fc_line_id` | **ADD** INTEGER FK → fc_lines, NULLABLE | Links to FC Line typed as `forecast_expense` or `forecast_income` |

`account_id` is **derived** from the FC Line — see Data Integrity Rules below. It is set automatically when `fc_line_id` is assigned, not independently editable.

#### Data Integrity Rules

**FK Delete Behavior:**

| FK | ON DELETE | Rationale |
|----|----------|-----------|
| `fc_line_categories.fc_line_id` → `fc_lines` | **CASCADE** | Deleting a line unassigns all its categories |
| `fc_line_categories.category_id` → `categories` | **CASCADE** | If a category is removed from the system, its assignment is cleaned up |
| `forecast_modules.expense_fc_line_id` → `fc_lines` | **SET NULL** | If a line is deleted, module reverts to "None" (no expense line) |
| `forecast_modules.income_fc_line_id` → `fc_lines` | **SET NULL** | Same — reverts to "None" |
| `forecast_income_expense.fc_line_id` → `fc_lines` | **RESTRICT** | Cannot delete a line that has active forecast items referencing it; user must remove items first |

**Line Deletion Service Rules:**
- Before deleting an FC Line, the API checks for `forecast_income_expense` rows referencing it
- If references exist, return 409 Conflict with a list of scenarios using the line
- `forecast_modules` references are safe to orphan (SET NULL) since "None" is a valid state

**`account_id` Derivation (forecast_income_expense):**
- `account_id` on `forecast_income_expense` is **derived from the FC Line**, not independently set
- When a forecast item is created from an FC Line, the system resolves the `account_id` by finding the common P&L ancestor of the line's assigned categories (via `categories.mapped_account_id` → account hierarchy)
- If the line's categories span multiple P&L branches, use the nearest common parent account
- This ensures P&L posting is always consistent with the category mapping
- `account_id` is still stored on the row (for query performance) but is recalculated if the line's category assignments change

**Budget Year for Pre-fill:**
- When adding FC Lines to a scenario's Forecast Expenses, the budget year used for pre-filling `base_value` defaults to the **scenario's first forecast year** (i.e., `PeriodStart` year from the scenario assumptions)
- The user can override this on the "Add from FC Lines" dialog (dropdown with available budget years)
- The chosen budget year is stored on `forecast_income_expense.budget_source_year` (new column, INTEGER, nullable) for reproducibility and audit

**Expense Growth Method — Formula Precedence:**

The `expense_growth_method` field on `forecast_modules` controls how the engine calculates expenses for year 2+. It **replaces** the existing `expense_pct` and `expense_amount` fields with a single coherent model:

| Method | Year 1 | Year 2+ | Engine Formula |
|--------|--------|---------|----------------|
| `inflation` | `expense_amount` (seeded from budget) | `expense_amount × (1 + inflation)^(year - baseYear)` | Absolute amount growing at inflation — same as current `expense_amount` behavior |
| `pct_of_value` | `expense_amount` (seeded from budget) | `expense_amount / market_value_year1 × avg(MV[year], MV[year-1])` | Derives an implicit % from year 1, then applies to asset value each year |

**Field consolidation:**
- `expense_amount` — **KEEP**: holds the year-1 base amount (seeded from budget via FC Line)
- `expense_pct` — **REMOVE** (after migration): its role is replaced by `expense_growth_method = 'pct_of_value'` which derives the % from `expense_amount / market_value` rather than storing a separate manual %
- During migration, if a module has `expense_pct > 0` and `expense_amount = 0`, convert: `expense_amount = market_value × expense_pct / 100`, set `expense_growth_method = 'pct_of_value'`

### 7.5 Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  Step 0: FC Inc/Exp Mapping Page (global, do once)          │
│                                                             │
│  1. Click "Generate Suggestions" → empty lines from P&L     │
│  2. Create / rename / delete lines as needed                │
│  3. Drag budget categories into lines                       │
│  4. Set each line's type:                                   │
│     • BS Module - Expense                                   │
│     • BS Module - Income                                    │
│     • Forecast Expense                                      │
│     • Forecast Income                                       │
│     • Unassigned (gap — clearly flagged)                    │
│                                                             │
│  Coverage indicator: "128/131 categories assigned"          │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          │                                 │
          ▼                                 ▼
┌─────────────────────┐          ┌──────────────────────────┐
│ BS Module - Expense  │          │ Forecast Expense/Income   │
│ BS Module - Income   │          │                          │
│                     │          │ Step 3: FC Expenses page  │
│ Step 2: Module Edit │          │ Select lines to include   │
│ Expense Line: [▼]  │          │ in this scenario          │
│ Income Line:  [▼]  │          │ Budget pre-fills values   │
│ Growth: [inflation▼]│          │                          │
│                     │          │ [✓] Living Expenses  -45K │
│ Budget seeds year 1 │          │ [✓] Travel           -8K  │
│ expense_amount      │          │ [ ] One-Off Items     -2K │
│                     │          │                          │
│ Multi-module split: │          │                          │
│ Line total: $33,725 │          │                          │
│ This module: $32,000│          │                          │
│ Remaining: $1,725   │          │                          │
└─────────────────────┘          └──────────────────────────┘
```

### 7.6 Coverage Check (Simplified)

With the mapping layer, coverage becomes trivial:

- **Fully covered:** Category assigned to a line with type ≠ `unassigned`
- **Mapped but untyped:** Category assigned to a line typed `unassigned` → user needs to set the type
- **Unmapped:** Category not assigned to any line → user needs to assign it

The existing `POST /forecast/coverage-check` endpoint and `FCCoverageCheckModal` are **replaced** by the mapping page itself — the mapping page IS the coverage view.

### 7.7 Code Cleanup — Items to Remove

The mapping layer replaces several ad-hoc features built during Phase 2. These must be removed to avoid dead code:

#### Backend — Remove
| Item | File | Reason |
|------|------|--------|
| `POST /forecast/incomeexpense/seed-from-budget` | `server/src/v2/routes/forecast.js` | Replaced by FC line → scenario inclusion with budget pre-fill |
| `POST /forecast/coverage-check` | `server/src/v2/routes/forecast.js` | Replaced by mapping page; coverage is inherent in assignment status |
| `PATCH /forecast/incomeexpense/bulk-update` | `server/src/v2/routes/forecast.js` | Replaced by line-based scenario inclusion |

**Keep:**
- `POST /forecast/modules/seed-from-actuals` — still needed for seeding BS module base values (market values) from balance sheet
- `PATCH /forecast/modules/bulk-update` — still needed, and now extended with `expense_fc_line_id`, `income_fc_line_id`, `expense_growth_method`

#### Frontend — Remove
| Item | File | Reason |
|------|------|--------|
| `FCSeedFromBudgetModal` | `frontend/src/features/Forecast/FCSeedFromBudgetModal.jsx` | Replaced by line-based scenario inclusion |
| `FCCoverageCheckModal` | `frontend/src/features/Forecast/FCCoverageCheckModal.jsx` | Replaced by mapping page |
| Seed Budget button | `frontend/src/features/Forecast/FCExpFilter.jsx` | Remove `onSeedClick` / `seedDisabled` props and button |
| Coverage button | `frontend/src/features/Forecast/FCExpFilter.jsx` | Remove `onCoverageClick` / `coverageDisabled` props and button |
| Seed/Coverage state | `frontend/src/pages/FCExpSetup.jsx` | Remove `showSeedModal`, `showCoverageModal` state and modal renders |

**Keep:**
- `FCSeedFromActualsModal` — still used for seeding BS module market values
- Seed Actuals button on `FCModulesFilter.jsx` — still needed

#### Frontend — Modify
| Item | File | Change |
|------|------|--------|
| `FCModulesEdit.jsx` | `frontend/src/features/Forecast/` | Replace `expense_category` / `income_category` string dropdowns with FC Line pickers (filtered by type). Add "None" option. Add `expense_growth_method` selector. |
| `FCExpSetup.jsx` | `frontend/src/pages/` | Replace manual item creation with "Add from FC Lines" flow. Show available Forecast-type lines, user selects which to include. Budget pre-fills base_value. |
| `FCModulesFilter.jsx` | `frontend/src/features/Forecast/` | Keep Seed Actuals button. Remove any coverage-related buttons if present. |

#### Database — Migration
| Action | Description |
|--------|-------------|
| Create `fc_lines` table | New table per schema above |
| Create `fc_line_categories` table | New table per schema above |
| Add `expense_fc_line_id` to `forecast_modules` | FK → fc_lines, nullable, ON DELETE SET NULL |
| Add `income_fc_line_id` to `forecast_modules` | FK → fc_lines, nullable, ON DELETE SET NULL |
| Add `expense_growth_method` to `forecast_modules` | VARCHAR(20) DEFAULT 'inflation' |
| Add `fc_line_id` to `forecast_income_expense` | FK → fc_lines, nullable, ON DELETE RESTRICT |
| Add `budget_source_year` to `forecast_income_expense` | INTEGER, nullable — records which budget year was used for pre-fill |
| Migrate `expense_category` / `income_category` strings | Match to FC lines by name where possible |
| Migrate `expense_pct` → `expense_amount` + `expense_growth_method` | Where `expense_pct > 0` and `expense_amount = 0`: set `expense_amount = market_value × expense_pct / 100`, `expense_growth_method = 'pct_of_value'` |
| Drop `expense_category` from `forecast_modules` | After migration verified |
| Drop `income_category` from `forecast_modules` | After migration verified |
| Drop `expense_pct` from `forecast_modules` | After migration verified — replaced by `expense_growth_method` |

### 7.8 Implementation Plan

**Gate rule:** Each phase has a test checkpoint. All automated tests pass AND all manual checks confirmed before moving to the next phase.

---

#### Phase 2B-1: Database & API Foundation

**Build:**
1. Write migration: create `fc_lines`, `fc_line_categories` tables with FK constraints per §7.4
2. Write migration: add new columns to `forecast_modules` and `forecast_income_expense`
3. Create `server/src/v2/repositories/fcLines.js` — CRUD for lines and category assignments
4. Create `server/src/v2/routes/fcLines.js` — REST API endpoints:
   - `GET /api/v2/fc-lines` — list all lines with assigned categories
   - `POST /api/v2/fc-lines` — create a line
   - `PUT /api/v2/fc-lines/:id` — update name, type, display_order
   - `DELETE /api/v2/fc-lines/:id` — delete line (unassigns its categories)
   - `POST /api/v2/fc-lines/:id/categories` — assign categories to a line
   - `DELETE /api/v2/fc-lines/:id/categories/:categoryId` — unassign a category
   - `POST /api/v2/fc-lines/generate-suggestions` — auto-create lines from P&L hierarchy
   - `GET /api/v2/fc-lines/unassigned-categories` — list categories not assigned to any line
   - `GET /api/v2/fc-lines/budget-totals?budgetYear=2026` — budget sum per line for a given year

**Test Checkpoint 2B-1:**

Automated tests — `server/src/v2/routes/__tests__/fc-lines.test.js`:

| # | Test | Action | Expected |
|---|------|--------|----------|
| T1.1 | Create line | POST `/fc-lines` with name + type | 201, line returned with id |
| T1.2 | Duplicate name rejected | POST with existing name | 409 Conflict |
| T1.3 | List lines with categories | GET `/fc-lines` after assigning 3 categories to a line | Line includes `categories` array with 3 items |
| T1.4 | Assign category | POST `/fc-lines/:id/categories` with category_id | 200, category appears in line |
| T1.5 | Double-assign rejected | Assign same category to a second line | 409 Conflict (UNIQUE on category_id) |
| T1.6 | Unassign category | DELETE `/fc-lines/:id/categories/:catId` | 200, category no longer in line |
| T1.7 | Delete line cascades | Delete line with 3 assigned categories | Line deleted, categories now in unassigned list |
| T1.8 | Delete line with FC items blocked | Delete line referenced by `forecast_income_expense` | 409 Conflict with list of referencing scenarios |
| T1.9 | Delete line with modules allowed | Delete line referenced by `forecast_modules` | 200, module's `fc_line_id` set to NULL |
| T1.10 | Generate suggestions | POST `/fc-lines/generate-suggestions` | Lines created from P&L parent accounts; no categories auto-assigned |
| T1.11 | Unassigned categories | GET `/fc-lines/unassigned-categories` after assigning some | Returns only categories not in any line |
| T1.12 | Budget totals | GET `/fc-lines/budget-totals?budgetYear=2026` | Returns sum of budget_entries per line based on assigned categories |
| T1.13 | Update line type | PUT `/fc-lines/:id` changing type to `bs_module_expense` | 200, type updated |

Manual checks:

| # | Check | Action | Verify |
|---|-------|--------|--------|
| M1.1 | Migration runs clean | Run migration on dev DB | Tables created, columns added, no errors |
| M1.2 | Existing forecast still works | Generate a forecast with existing scenario | Forecast generation succeeds (old code path still intact) |
| M1.3 | API responds | `curl GET /api/v2/fc-lines` on dev server | 200 with empty array |
| M1.4 | Generate suggestions | `curl POST /api/v2/fc-lines/generate-suggestions` | Lines created matching P&L parent account names |

---

#### Phase 2B-2: FC Mapping Page (Frontend)

**Build:**
1. Create `frontend/src/pages/FCLineMapping.jsx` — the main mapping page
   - Left panel: list of FC Lines with type badges and category counts
   - Right panel: assigned categories (drag targets) + unassigned pool
   - "Generate Suggestions" button
   - Coverage indicator bar
   - Line CRUD (create, rename, delete, set type)
   - Drag/drop category assignment
2. Add route and navigation link (before Scenarios in the FC nav)

**Test Checkpoint 2B-2:**

| # | Check | Action | Verify |
|---|-------|--------|--------|
| M2.1 | Page loads | Navigate to FC Mapping page | Page renders with empty state (no lines yet) |
| M2.2 | Generate suggestions | Click "Generate Suggestions" | Lines appear named from P&L hierarchy (Property Costs, Living Expenses, Travel, etc.) |
| M2.3 | Create custom line | Click "New Line", enter "Prop Costs - PM4" | Line appears in list |
| M2.4 | Rename line | Double-click line name, change it | Name updates on blur/enter |
| M2.5 | Set line type | Select "BS Module - Expense" from type dropdown | Badge updates, type persists on reload |
| M2.6 | Assign categories | Drag "Property - Condo Fees - SP - PM4" from unassigned pool into "Prop Costs - PM4" | Category moves to the line; disappears from unassigned pool |
| M2.7 | No double-assign | Try to drag an already-assigned category to another line | Blocked or moves (reassigns) — never duplicated |
| M2.8 | Unassigned visibility | Leave 5 categories unassigned | Unassigned pool shows 5 items; coverage bar shows "X/Y assigned" |
| M2.9 | Delete line | Delete a line with 3 assigned categories | Line removed; 3 categories return to unassigned pool |
| M2.10 | Delete blocked | Delete a line referenced by a forecast expense item | Error message listing the scenario(s) using it |
| M2.11 | Budget totals | Assign categories to a line, check displayed budget total | Total matches sum of those categories' budget entries for current year |
| M2.12 | Persist on reload | Refresh the page | All lines, assignments, and types preserved |

---

#### Phase 2B-3: Module Edit Integration

**Build:**
1. Modify `FCModulesEdit.jsx`:
   - Replace `expense_category` dropdown with FC Line picker (BS Module - Expense lines + "None")
   - Replace `income_category` dropdown with FC Line picker (BS Module - Income lines + "None")
   - Add `expense_growth_method` toggle (Inflation / % of Asset Value)
   - Show budget total for selected line + allocation tracking (total / allocated to other modules / remaining)
2. Update module create/update API to handle `expense_fc_line_id`, `income_fc_line_id`, `expense_growth_method`

**Test Checkpoint 2B-3:**

| # | Check | Action | Verify |
|---|-------|--------|--------|
| M3.1 | Expense line picker | Open module edit for a RealEstate module | Expense Category dropdown shows only BS Module - Expense lines + "None" |
| M3.2 | Income line picker | Same module | Income Category dropdown shows only BS Module - Income lines + "None" |
| M3.3 | Select "None" | Set expense line to "None", save | Module saves with `expense_fc_line_id = NULL`; no expense calculated |
| M3.4 | Select a line | Set expense line to "Prop Costs - PM4", save | Module saves with correct `expense_fc_line_id` |
| M3.5 | Budget total shown | After selecting a line | Budget total for that line displayed (e.g., "$2,411 for 2026") |
| M3.6 | Allocation tracking | Assign same line to two modules, enter amounts | Shows "Total: $2,411 / This module: $2,000 / Other modules: $200 / Remaining: $211" |
| M3.7 | Growth method toggle | Toggle "Inflation" → "% of Asset Value" | `expense_growth_method` changes; persists on save and reload |
| M3.8 | Existing modules load | Open a module that had old `expense_category` string | Field shows "None" (old string not migrated yet — that's Phase 2B-6) |

---

#### Phase 2B-4: Forecast Expenses Integration

**Build:**
1. Modify `FCExpSetup.jsx`:
   - Add "Add from FC Lines" button that shows available Forecast Expense/Income lines
   - User selects lines to include; budget total pre-fills `base_value` (default: scenario's `PeriodStart` year)
   - Budget year override dropdown on the "Add from FC Lines" dialog
   - `budget_source_year` stored on created items for audit
   - Remove old Seed Budget and Coverage buttons/modals
2. Update income/expense create API to accept `fc_line_id` and `budget_source_year`

**Test Checkpoint 2B-4:**

| # | Check | Action | Verify |
|---|-------|--------|--------|
| M4.1 | "Add from FC Lines" button | Navigate to Forecast Expenses page with a scenario selected | Button visible, enabled |
| M4.2 | Available lines shown | Click "Add from FC Lines" | Dialog shows Forecast Expense and Forecast Income type lines with budget totals |
| M4.3 | Already-added lines excluded | Add "Living Expenses" to scenario, reopen dialog | "Living Expenses" not shown (already included) |
| M4.4 | Budget pre-fills | Select "Travel" line (budget: $8,000 for 2026) | New FC expense item created with `base_value = -8000` |
| M4.5 | Budget year default | Open dialog without changing year | Default year = scenario's PeriodStart year |
| M4.6 | Budget year override | Change budget year to 2025 in dropdown | Totals refresh to 2025 budget amounts |
| M4.7 | budget_source_year stored | Add item, then query DB | `forecast_income_expense` row has `budget_source_year = 2026` (or overridden year) |
| M4.8 | Old buttons removed | Check Forecast Expenses toolbar | No "Seed Budget" button; no "Coverage" button |
| M4.9 | account_id derived | Add item from FC Line, check DB | `account_id` set to common P&L ancestor of the line's assigned categories |
| M4.10 | Multiple items | Add 5 FC Lines to scenario | All 5 appear as forecast expense/income items with correct pre-filled values |

---

#### Phase 2B-5: Engine Update

**Build:**
1. **Preload FC Line name map** in `fcbuilder-module.js` at forecast generation time:
   - Query `fc_lines` table, build `Map<id, name>`
   - When creating `forecast_entries`, resolve `expense_fc_line_id` → `fc_lines.name` for the P&L entry label (replaces old `expense_category` string lookup)
   - Same for `income_fc_line_id` → income entry label
2. **Implement `expense_growth_method = 'pct_of_value'`** in expense calculation block:
   - `inflation` mode (default): `expenseValues[i] = expense_amount × (1 + inflation)^(year - baseYear)` — existing behavior
   - `pct_of_value` mode: `derived_pct = expense_amount / market_value_base`, then `expenseValues[i] = derived_pct × avg(MV[i], MV[i-1])` — scales with asset value
3. **Remove `expense_pct` logic** from engine — replaced by `expense_growth_method`

**Test Checkpoint 2B-5:**

Automated tests — `server/src/services/forecast/__tests__/fcbuilder-module.test.js` (new tests):

| # | Test | Setup | Expected |
|---|------|-------|----------|
| T5.1 | Inflation growth method | Module: `expense_amount = 1000`, `expense_growth_method = 'inflation'`, inflation = 3%, 3-year forecast | Year 1: 1000, Year 2: 1030, Year 3: 1060.9 |
| T5.2 | Pct of value growth method | Module: `expense_amount = 1000`, `expense_growth_method = 'pct_of_value'`, `market_value = 100000`, MV grows 5%/yr | derived_pct = 1%, Year 1: 1000, Year 2: ~1050 (1% of avg 100K, 105K), Year 3: ~1102 |
| T5.3 | No expense when fc_line_id NULL | Module with `expense_fc_line_id = NULL` | No expense entries generated |
| T5.4 | Entry label from FC Line name | Module with `expense_fc_line_id` pointing to line named "Prop Costs - PM4" | `forecast_entries` have `account = 'Prop Costs - PM4'` |
| T5.5 | Income label from FC Line name | Module with `income_fc_line_id` pointing to line named "Rental Income - PM4" | Income entries labeled "Rental Income - PM4" |
| T5.6 | Pct of value with zero market value | `expense_amount = 1000`, `market_value = 0` | Falls back to inflation method (avoid division by zero) |

Manual checks:

| # | Check | Action | Verify |
|---|-------|--------|--------|
| M5.1 | Generate with FC Lines | Set up modules with FC Line expense/income, generate forecast | Forecast completes without errors |
| M5.2 | Audit trail labels | Download audit trail CSV for a module | Expense/income columns labeled with FC Line names, not old category strings |
| M5.3 | Review page values | Open FC Review page | Expense amounts match expected inflation or pct_of_value growth |
| M5.4 | Compare to Phase 1 baseline | For a module that previously used `expense_pct`, compare before/after | Values should match (since migration converts `expense_pct` to equivalent `expense_amount + pct_of_value`) |

---

#### Phase 2B-6: Migration Script (run BEFORE cleanup)

**Build:**
1. Write migration script `server/src/scripts/migrate-fc-lines.js` that:
   - Creates FC Lines from existing `expense_category` / `income_category` string values on modules
   - Converts `expense_pct` → `expense_amount` + `expense_growth_method` where applicable
   - Maps existing modules to the new `expense_fc_line_id` / `income_fc_line_id` columns
   - Reports unmatched items for manual resolution
2. Script must be idempotent (safe to re-run)

**Test Checkpoint 2B-6:**

| # | Check | Action | Verify |
|---|-------|--------|--------|
| M6.1 | Run migration on dev | Execute `node server/src/scripts/migrate-fc-lines.js` | Completes with summary: X lines created, Y modules mapped, Z unmatched |
| M6.2 | Idempotent | Run the script again | No errors, no duplicates, same summary |
| M6.3 | expense_pct converted | Query modules that had `expense_pct > 0` and `expense_amount = 0` | Now have `expense_amount = market_value × expense_pct / 100`, `expense_growth_method = 'pct_of_value'` |
| M6.4 | FC Line IDs populated | Query `forecast_modules` where old `expense_category` was not "Bank Fees" | `expense_fc_line_id` is not NULL, points to a valid FC Line |
| M6.5 | Forecast still generates | Generate forecast for 2026_Base scenario after migration | Results identical to pre-migration (values haven't changed, only field names) |
| M6.6 | Comparison test | Export audit trail CSV before and after migration for same scenario | Values match within rounding tolerance ($1) |
| M6.7 | Run migration on production | Execute on production DB | Same results as dev |

**Gate:** M6.5 and M6.6 must pass before proceeding to Phase 2B-7.

---

#### Phase 2B-7: Cleanup (run AFTER migration verified)

**Build:**
1. **Remove backend endpoints:**
   - `POST /forecast/incomeexpense/seed-from-budget`
   - `POST /forecast/coverage-check`
   - `PATCH /forecast/incomeexpense/bulk-update`
2. **Remove frontend files:**
   - `FCSeedFromBudgetModal.jsx`
   - `FCCoverageCheckModal.jsx`
3. **Remove frontend props/state** in `FCExpFilter.jsx` and `FCExpSetup.jsx` related to seed/coverage
4. **Database column drops** (separate migration, only after code no longer references them):
   - Drop `expense_category` from `forecast_modules`
   - Drop `income_category` from `forecast_modules`
   - Drop `expense_pct` from `forecast_modules`

**Test Checkpoint 2B-7:**

| # | Check | Action | Verify |
|---|-------|--------|--------|
| M7.1 | Removed endpoints 404 | `curl POST /api/v2/forecast/coverage-check` | 404 Not Found |
| M7.2 | Removed endpoints 404 | `curl POST /api/v2/forecast/incomeexpense/seed-from-budget` | 404 Not Found |
| M7.3 | Removed files gone | Check `frontend/src/features/Forecast/` | No `FCSeedFromBudgetModal.jsx` or `FCCoverageCheckModal.jsx` |
| M7.4 | FCExpSetup clean | Open Forecast Expenses page | No "Seed Budget" or "Coverage" buttons; "Add from FC Lines" is the only way to add items |
| M7.5 | Full end-to-end | Create scenario → Mapping → Modules → Expenses → Generate → Review | Entire workflow works with no references to old code |
| M7.6 | No dead code | `grep -r "seed-from-budget\|coverage-check\|expense_category\|income_category\|expense_pct" server/src/ frontend/src/` | Zero matches (excluding test files, migration script, and this doc) |
| M7.7 | Column drops clean | Run column drop migration on dev | No errors; existing queries still work (no code references dropped columns) |
| M7.8 | Deploy to production | Deploy full stack | All pages load; forecast generates correctly |

### 7.9 API Endpoints Summary

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/fc-lines` | List all FC Lines with categories and budget totals |
| POST | `/api/v2/fc-lines` | Create a new FC Line |
| PUT | `/api/v2/fc-lines/:id` | Update line name, type, display_order |
| DELETE | `/api/v2/fc-lines/:id` | Delete a line (categories become unassigned) |
| POST | `/api/v2/fc-lines/:id/categories` | Assign category IDs to a line |
| DELETE | `/api/v2/fc-lines/:id/categories/:categoryId` | Unassign a category |
| POST | `/api/v2/fc-lines/generate-suggestions` | Auto-create empty lines from P&L account hierarchy |
| GET | `/api/v2/fc-lines/unassigned-categories` | List categories not assigned to any line |
| GET | `/api/v2/fc-lines/budget-totals` | Budget totals per line for a given year |
