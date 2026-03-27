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

### 2.2 Gaps vs. Spreadsheet

| # | Gap | Spreadsheet Behavior | Current App Behavior |
|---|-----|---------------------|---------------------|
| G1 | **Auto-populate base values from actuals** | 2025 YE balance sheet values are the starting point for 2026 FC | Module base values are manually entered; no link to actual balances |
| G2 | **Deposit rate / interest income** | Deposits earn interest at a configurable rate per year | Deposits are static BS modules with no interest calculation |
| G3 | **Cash auto-balance (target cash)** | Cash is the residual bucket; excess flows to deposits, shortfalls trigger sales | `Bank Accounts` accumulates cash changes but no target or rebalancing |
| G4 | **Tax deferral** | Capital gains tax is paid the following year | Tax is calculated in the same year as the gain |
| G5 | **Income/Expense from budget** | Living expenses and income baselines are planned forward-looking values | Income/expense base values are manually entered; no link to budget |
| G6 | **Liability interest model** | Interest rate = base × inflation × multiplier; auto-calculated interest expense | Liabilities exist as modules but no dedicated interest calculation |
| G7 | **Age tracking** | Row showing age for each forecast year | Not present |
| G8 | **Property costs as absolute amounts** | Property costs are absolute values growing at inflation | App uses `expense_pct` (percentage of market value) |
| G9 | **Equity bridge (change in NW)** | Operating + Tax + Unrealized + Realized + Debt = equity change | Not computed |
| G10 | **Movements / rebalancing summary** | Shows investment flows and rebalancing totals | Not tracked |

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

### Phase 3: Deposit Rate (interest income)

**Goal:** Deposits earn interest at a configurable rate.

**G2 — Deposit Rate via IncomePct**
- File: `server/src/services/forecast/fcbuilder-module.js`
- Change: The `IncomePct` schedule already generates `incomeValues[]` as:
  `incomeValues[i] = avg(marketValues[i], marketValues[i-1]) × incomePctValues[i] / 100`
- This already works for deposit interest! The `IncomePct` value IS the deposit rate.
- The income flows to `module.IncomeCategory` (e.g. "Interest Income")
- Verification: Set up a deposit module with `IncomePct = [{ Date: 2026, Value: 3.0 }]` and `IncomeCategory = "Interest Income"`. Confirm interest = avg balance × 3%.
- Frontend: On the module edit form, when module type is "deposit" or similar, label the `IncomePct` field as "Deposit Rate %" for clarity
- May already work — primarily a labeling/documentation task

### Phase 4: Cash Target & Auto-Balance

**Goal:** Maintain target cash balance; excess to deposits, shortfall flagged.

**G3 — Cash Auto-Balance**
- Schema: Add `target_cash` column to `forecast_scenarios` table (NUMERIC, nullable, default NULL)
  - Migration: `ALTER TABLE forecast_scenarios ADD COLUMN target_cash NUMERIC DEFAULT NULL`
- File: `server/src/services/forecast/index.js`
- Change: After all modules and income/expense items are processed, add a post-processing step:
  1. Query all `forecast_entries` for the scenario where `account = 'Bank Accounts'`
  2. Sum by year to get projected cash balance per year
  3. If `target_cash` is set:
     - For each year where cash > target: create entry `account = 'Fixed Income Deposit'`, `amount = cash - target` (excess reinvested)
     - For each year where cash < target: create entry `account = 'Cash Shortfall'`, `amount = target - cash` (flagged for user)
  4. Recompute final cash balance after adjustments
- Frontend: Add `target_cash` field to scenario edit modal
- Frontend: In FC Review, highlight years with cash shortfall in red/warning color
- Frontend: Show "Cash Gap" row in the balance sheet section when shortfalls exist

### Phase 5: Display Enhancements

**Goal:** Better context and analysis in the Review page.

**G7 — Age Tracking**
- Schema: Add `birth_year` to `app_data` table (or as a key in the existing JSON app_data store)
- File: `frontend/src/pages/ProgramSettings.jsx` — add "Birth Year" field
- File: `frontend/src/pages/FCReview.jsx` — read birth year from app settings, display `year - birthYear` as a sub-header row beneath the year columns
- No backend engine changes

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

## 5. Files Affected Summary

### Backend
| File | Phases | Changes |
|------|--------|---------|
| `server/src/services/forecast/fcbuilder-module.js` | 1, 3 | Tax deferral, absolute expense amounts, liability interest, deposit rate verification |
| `server/src/services/forecast/fcbuilder-incexp.js` | 1 | Tax deferral on income items |
| `server/src/services/forecast/index.js` | 4 | Cash auto-balance post-processing step |
| `server/src/v2/routes/forecast.js` | 2 | New seed-from-actuals and bulk-update endpoints |
| `server/src/v2/repositories/forecast.js` | 2, 4 | Bulk update queries, target_cash field |
| `server/db/migrations/` | 4 | Add `target_cash` to `forecast_scenarios` |

### Frontend
| File | Phases | Changes |
|------|--------|---------|
| `frontend/src/features/Forecast/FCModulesEdit.jsx` | 1 | Show `expense_amount` field |
| `frontend/src/pages/FCModuleManage.jsx` | 2 | "Seed from Actuals" button + review modal |
| `frontend/src/pages/FCExpSetup.jsx` | 2 | "Seed from Actuals" button + review modal |
| `frontend/src/features/Forecast/FCScenariosModal.jsx` | 4 | `target_cash` field in scenario edit |
| `frontend/src/pages/FCReview.jsx` | 4, 5 | Cash shortfall highlighting, age row, equity bridge |
| `frontend/src/features/Forecast/FCReviewTable.jsx` | 5 | Equity bridge collapsible section |
| `frontend/src/utils/forecastHelpers.js` | 5 | `computeEquityBridge()` function |
| `frontend/src/pages/ProgramSettings.jsx` | 5 | Birth year field |

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
