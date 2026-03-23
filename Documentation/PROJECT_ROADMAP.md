# Project Roadmap

Future work, known issues, and improvement proposals for the Fin application.

---

## 1. Known Issues

1. **No test suite** exists currently.
2. **Cloud-init ISO** still attached to the VM as a CD-ROM. Harmless but can be ejected:
   ```bash
   virsh --connect qemu:///system change-media fin sda --eject
   ```
3. **Timezone-sensitive date handling:** The `pg` (node-postgres) library serializes JavaScript `Date` objects using the server's local timezone. Production containers run in UTC; the dev host runs in America/New_York (EST, UTC-5). Fixed in `reports.js` and `budget.js` by passing YYYY-MM-DD strings directly to PostgreSQL. Any future date-based queries should follow the same pattern — never use `new Date()` for date-only values passed to SQL.

---

## 2. Feature Backlog

Items from active development notes:

- [x] Add Program Settings page with configurable default budget year
- [x] Add monthly budget FX rates page (`/budget-fx`) with per-month, per-year rates and recalculate from actual
- [x] Test to check if fx rates in fc periods work, if changed
- [x] Add COA management (SQL-based; frontend CRUD at `/coa-management`)
- [ ] Review how income, growth and expense calculated in fcbuilder / put tooltips
- [ ] When copying modules to other scenarios, automatically update base date and values
- [x] Export to excel
- [ ] Ability to adjust the tax rate on some income (e.g. UB)
- [x] On liabilities the expense needs to be a negative percent — can this be fixed
- [x] Add some KPIs to Budget Page and Forecast Page with graphics
- [ ] Add way to re-export changes back to PocketSmith
- [ ] Start on Option Analysis
- [x] Move Forecast FX Assumptions from Settings `/fx-options` to Forecasting category

---

## 3. Frontend Improvements

Proposals from the original migration plan for future frontend refactoring.

### 3.1 God Components — Completed (v2.0.9)

All four god components have been refactored:

| Component | Before | After | What Changed |
|-----------|--------|-------|--------------|
| `BudgetInput.jsx` | 762 | 549 | Extracted `useBudgetEntrySubmit` hook; replaced inline selectors with shared `CategorySelector`, `AccountSelector`, `PeriodSelector`; added tabbed Balances/Entry panel and collapsible filters |
| `FCExpSetup.jsx` | 869 | 159 | Extracted 4 hooks: `useFCExpAssumptions`, `useFCExpAccountHierarchy`, `useFCExpEntries`, `useFCExpCrud` |
| `TransActual.jsx` | 393 | 282 | Unified with TransBudget via shared `features/Transaction/` module. Filter bar redesigned with `TransactionFilterActual` using shared `PeriodSelector`, `CategorySelector`, `AccountSelector`. |
| `TransBudget.jsx` | 295 | 204 | Unified with TransActual via shared `features/Transaction/` module. Filter bar redesigned with `TransactionFilterBudget` using shared `PeriodSelector`, `CategorySelector`, `AccountSelector`. |

### 3.2 DRY Violations

1. ~~**Transaction filter logic** (~80 lines) duplicated across TransActual, TransBudget, useTransactions~~ — **Resolved:** Unified into `features/Transaction/` with config-driven shared hooks and components (`ACTUAL_CONFIG`, `BUDGET_CONFIG`, `REVIEW_CONFIG`). Now also reused on RefreshPS page for review/edit of new transactions.
2. **`collectCollapsiblePaths()`** duplicated in Balance.jsx and BalanceChart.jsx — move to shared `treeHelpers.js`
3. ~~**Date initialization logic** independently calculated in BudgetInput~~ — **Resolved:** `PeriodSelector` shared component handles period presets (This Month, Last Month, This/Last Year, Custom) with auto-computed date ranges
4. **Month options array** defined in budgetInputUtils.js but recreated in multiple components — move to shared constants
5. **FX rate lookup** duplicated in BudgetInput and various transaction modals — move to shared `currency.js`

### 3.3 Missing Shared Components

| Component | Used In | Current State |
|-----------|---------|---------------|
| `<Modal>` | 5+ places | Each modal is custom-built |
| `<DataTable>` | 6+ places | Tables are custom each time |
| ~~`<FilterPanel>`~~ | 4+ places | Partially addressed: Budget Worksheet, Actual Transactions, and Budget Transactions now use shared `PeriodSelector` + `CategorySelector` + `AccountSelector` in collapsible three-column layout. |
| `<FormField>` | 10+ places | Inputs are custom per form |
| `<LoadingSpinner>` | All pages | "Loading..." text varies |
| `<ErrorMessage>` | All pages | Error display inconsistent |
| `<ConfirmDialog>` | 5+ places | Delete confirms duplicated |
| ~~`<DateRangePicker>`~~ | 4+ places | Partially addressed: `PeriodSelector` covers budget/report period selection with presets. Other pages still use custom date controls. |
| `<CurrencyInput>` | 3+ places | Amount inputs inconsistent |

### 3.4 Component Architecture (Partially Implemented)

The feature module pattern is now in use. Current structure:

```
frontend/src/
├── components/          # Shared UI (Layout, NavigationMenu, Breadcrumbs, Footer, Toast, LoadingSpinner, CategorySelector, PeriodSelector, AccountSelector)
├── features/            # Domain-specific feature modules
│   ├── Transaction/     # ✅ Unified actual + budget + review (config-driven: ACTUAL_CONFIG, BUDGET_CONFIG, REVIEW_CONFIG; shared hooks, components, utils; TransactionFilterActual + TransactionFilterBudget with PeriodSelector/CategorySelector/AccountSelector)
│   ├── BudgetEntry/     # ✅ Budget worksheet (hooks: useFilterOptions, useBalanceData, useCurrencyData, useBudgetEntrySubmit)
│   ├── Forecast/        # ✅ Scenarios, modules, assumptions (hooks: useFCExpAssumptions, useFCExpAccountHierarchy, useFCExpEntries, useFCExpCrud)
│   ├── Balances/        # Balance sheet components
│   ├── Budgets/         # Budget realization
│   ├── CashFlow/        # Cash flow reports
│   ├── Charts/          # Chart components
│   ├── COAManagement/   # COA CRUD, quick-add accounts/categories
│   └── Database/        # Upload, refresh, backup
├── hooks/               # Shared hooks (useCoa)
├── contexts/            # ToastContext, ForecastContext
├── js/                  # API helpers (rest.js)
├── config/              # Route configuration
└── pages/               # Page components (thin wrappers composing feature components)
```

Future: Extract shared `components/ui/`, `components/forms/`, `components/feedback/` primitives from feature modules.

### 3.5 UI/UX Improvements

| Issue | Current State | Proposed Fix |
|-------|--------------|--------------|
| Loading states | Mix of "Loading...", spinners | Unified `<LoadingSkeleton>` |
| Error display | Different per page | Unified `<ErrorBanner>` with retry |
| Empty states | Inconsistent messages | Unified `<EmptyState>` |
| Button styles | `.generate-report-button` everywhere | Button variants: primary, secondary, danger |
| Form validation | Scattered, inconsistent | Centralized validation with error messages |
| Date selection | Different controls per page | Partially addressed: `PeriodSelector` with presets on Budget Worksheet, Actual Transactions, and Budget Transactions. Other pages pending. |

### 3.6 Performance Optimizations

- **Component memoization** with `React.memo`, `useMemo`, `useCallback` for expensive components
- **Virtual scrolling** (`@tanstack/react-virtual`) for tables with 1000+ rows
- **Debounced filters** to prevent excessive API calls
- **API response caching** using SWR/stale-while-revalidate pattern

### 3.7 TypeScript Migration

Gradual migration recommended:
1. Start with shared utilities and type definitions
2. Move to hooks and components
3. Finish with pages

Benefits: compile-time type checking for financial calculations, better IDE support, safer refactoring.

### 3.8 Design Decisions Made

| Decision | Choice |
|----------|--------|
| Component library | Radix UI + custom styling |
| Charting library | Recharts (already in use) |
| Mobile support | Responsive (desktop-first with 1080px/768px/640px breakpoints) |
| State management | Enhanced React Context (upgrade to Zustand if complexity grows) |

---

## 4. Backend Improvements

Proposals from the original migration plan for future backend refactoring.

### 4.1 Service Layer Complexity

| Service | Lines | Issues |
|---------|-------|--------|
| `fcbuilder-module.js` | 835 | Monolithic, mixes data access with business logic |
| `fcbuilder-incexp.js` | 436 | Duplicated patterns from module builder |
| `cashFlowFetcher.js` | 619 | Complex aggregation, hard to maintain |
| `balanceSheetFetcher.js` | 324 | Could be simplified with SQL views |

### 4.2 Missing Abstractions

- **Repository pattern**: Data access is mixed into services. Extract dedicated repository classes per entity (transaction, budget, forecast, account, category).
- **Base repository**: Common operations (findById, findAll, create, update, delete) in a shared base class.
- **Error handling**: Inconsistent error responses across routes. Centralize with an `AppError` class and error-handling middleware.

### 4.3 Proposed Backend Architecture

```
server/src/
├── config/           # Database pool, PocketSmith config, constants
├── repositories/     # Data access layer (one per entity)
├── services/         # Business logic layer
│   ├── pocketsmith/  # Sync, API client, data mapper
│   ├── forecast/     # Generator, scenario, calculator
│   ├── budget/       # Budget service, comparison
│   ├── reports/      # Balance sheet, cash flow
│   └── fx/           # Rates service, converter
├── controllers/      # Thin request handlers
├── routes/           # Route definitions
├── middleware/       # Error handler, validator, logger, rate limiter
└── utils/            # Date, currency, tree utilities
```

### 4.4 API Design Improvements

- **Consistent response format**: All endpoints return `{ success, data, meta }` or `{ success, error }`
- **Pagination**: Add `page`, `pageSize`, `total`, `totalPages` to list endpoints
- **Consistent query parameters**: Standardize `sortBy`, `sortOrder`, `fromDate`, `toDate` across endpoints
- **Structured logging**: Replace minimal logging with Pino (JSON-formatted, leveled)

---

## 5. Testing Strategy

Decision: Unit tests first, expand to E2E later.

### Phase 1 — Unit Tests (Vitest)
High-value targets:
- Forecast calculations
- Currency conversions
- Date utilities
- Data transformations

### Phase 2 — E2E Tests (Playwright)
Critical user flows:
- PocketSmith sync and accept transactions
- Budget entry and editing
- Forecast module creation and review

Skip component tests — they often test implementation details and break on refactors.

### Success Metrics

| Metric | Before | Current | Target |
|--------|--------|---------|--------|
| Largest page component (lines) | 869 | 445 | <200 |
| Transaction duplication (files) | 22 | 0 | 0 |
| Shared transaction components | 0 | 9 | — |
| Test coverage | 0% | 0% | >60% |

---

## 6. Migration History

Timeline of the MongoDB-to-PostgreSQL migration and infrastructure changes.

| Date | Event |
|------|-------|
| 2026-03-15 | **Category Trend graph:** Added new `/category-trend` page under Reports & Graphs > Graphs subcategory. Users select one or more income/expense categories and a standard period (YTD, This Year, Last Year, Last 6/12/24 Months), then view a grouped bar chart comparing actual vs budget monthly values. Expense values are displayed as positive for easier visual comparison. New backend endpoint `GET /api/v2/reports/category-trend` accepts `startDate`, `endDate`, and repeatable `category` query params. New REST helper `Rest.fetchCategoryTrend()` in `rest.js`. New files: `CategoryTrend.jsx`, `CategoryTrend.css`. Modified: `routes.jsx`, `rest.js`, `reports.js` (route). |
| 2026-03-16 | **Trans-Actual filter & account selector fixes:** (1) Fixed `\u2026` literal text in AccountSelector search placeholder (changed to proper `…` character). (2) Fixed "All" button in AccountSelector to clear individual account selections when clicked (was appending "All" to existing selections). (3) Added "All" option to CategorySelector to clear category filters (styled matching AccountSelector's "All" item). (4) Moved action buttons (Edit, Split, Neutralize, All, Delete, Clear Filters, Export) out of the first filter column into a separate row below the filter grid with a divider border, fixing layout overlap with filter controls. (5) **Leaf-only account filtering:** Added `leafOnly` query parameter to `GET /api/v2/accounts` endpoint and `findAll()` repository function — uses `NOT EXISTS` subquery to exclude parent/grouping nodes that have children (e.g. "Fidelity Fixed Income", "Fidelity Stock", "Bank Accounts"). These nodes have `account_type='asset'` but act as hierarchy parents, not transactable accounts. `fetchAccountsV2()` in `rest.js` now accepts `leafOnly` option. Both `useFilterOptions` and `useTransactionAccountOptions` pass `leafOnly: true` so only leaf accounts appear in account selectors. Modified: `AccountSelector.jsx`, `CategorySelector.jsx`, `CategorySelector.css`, `TransactionFilterActual.jsx`, `TransactionFilterActual.css`, `accounts.js` (repo + route), `rest.js`, `useFilterOptions.js`, `TransactionTable.jsx`. |
| 2026-03-15 | **Per-row action buttons in TransactionTable:** Moved Split, Neutralize, and Change Category from top-bar selection-based buttons to per-row action buttons in the Actions column. RefreshPS Review table no longer uses selection checkboxes — each row has Category, Split, Neutralize, and Accept buttons. TransActual table keeps selection checkboxes (for bulk Edit/Delete) and adds per-row Split and Neutralize buttons. Fixed default category name from "Transfer - Security Trade" to "Transfer - Securities Trades". CSS: new `.trans-budget-table__action-btn` variants for each action type. Modified: `TransactionTable.jsx`, `TransActual.jsx`, `RefreshPS.jsx`, `PageLayout.css`, `transactions.js` (route). |
| 2026-03-14 | **Neutralize Transaction for brokerage accounts:** Added one-click "Neutralize" action to both `/refresh-ps` (Review & Edit New tab) and `/trans-actual` pages. Creates an offsetting transaction with negated amount/base_amount, same account/date/currency, categorizes both as "Transfer - Securities Trades", and marks both as accepted. Designed for brokerage security trades where a purchase/sale is an exchange of cash for shares and should not change the account balance. New backend endpoint `POST /api/v2/transactions/:id/neutralize` accepts optional `category_name` (defaults to "Transfer - Securities Trades"). Offset transaction gets `source='auto-offset'`, `ps_id=null`. Uses DB transaction for atomicity. Orange-themed button styling on both pages. Modified: `transactions.js` (repo + route), `TransActual.jsx`, `TransactionFilterActual.jsx`, `TransactionFilterActual.css`, `RefreshPS.jsx`, `RefreshPS.css`. |
| 2026-03-13 | **Forecast FX moved to Forecasting category & income/expense FX fix:** Moved `/fx-options` (Forecast FX Assumptions) from Settings to Forecasting category in `routes.jsx`. Renamed label from "FX Options" to "Forecast FX Assumptions". Updated page title and description in `FXOptions.jsx`. Updated Settings category description (no longer references exchange rates). **FX conversion bug fix in `fcbuilder-incexp.js`:** Income/expense forecast items with non-USD currencies (PLN, EUR) were not being converted to USD — values were written directly as if they were USD amounts. Added FX rate extraction from `df_assumptions` (same pattern as `fcbuilder-module.js`) and LC-to-USD conversion (`valueUSD = valueLC / fxrate`) for `incexpValues`, `taxValues`, and `cashChange` before writing to `df_categories`. USD-denominated items are unaffected (FX rate defaults to 1). Modified: `routes.jsx`, `FXOptions.jsx`, `fcbuilder-incexp.js`. |
| 2026-03-13 | **Monthly Budget FX Rates:** Added new `/budget-fx` page under Budgeting category for managing monthly exchange rates per currency per year. New `budget_fx_rates` table (migration `004_budget_fx_rates.sql`) stores rates with budget convention (X foreign currency per 1 USD). Features: year selector, 12-month x N-currency table with double-click inline editing, per-month "Recalculate" button that fetches average actual FX from `exchange_rates` table, shows preview modal (current rate, new avg actual, data points, entries affected), and on confirm updates both the rate and all affected budget entries' `base_amount`. Backend: new repository `budgetFxRates.js` with 7 functions, 5 new endpoints on `/api/v2/budget/fx-rates/*`. Integration: `useCurrencyData` hook now loads all rates for the budget year and builds `budgetRatesByMonth` map; `BudgetInput.jsx` uses month-specific rates; `useBudgetEntrySubmit` strips `BaseAmount` for multi-month entries so backend calculates per-month; `budget.js` repository `create()` now checks `budget_fx_rates` before falling back to `exchange_rates` table. Moved budget rates section out of `/fx-options` (Settings) — FX Options now only shows Forecast FX Assumptions. New files: `BudgetFX.jsx`, `BudgetFX.css`, `budgetFxRates.js`, `004_budget_fx_rates.sql`. Modified: `budget.js` routes + repo, `routes.jsx`, `useCurrencyData.js`, `BudgetInput.jsx`, `useBudgetEntrySubmit.js`, `FXOptions.jsx`. |
| 2026-03-13 | **Docker cleanup in backup cron:** Added Docker pruning to `backup-to-remote.sh` (step 8). Prunes build cache, dangling images, stopped containers, and unused networks older than 48 hours. Runs as part of the existing every-2-days crontab schedule. Preserves recent builds by using `--filter "until=48h"`. |
| 2026-03-11 | **KPI Summary Cards:** Added KPI summary cards with Recharts mini-charts to Budget Realization and Forecast Review pages. Installed `recharts` library. New shared component `KpiCards.jsx` + `KpiCards.css` — reusable `KpiCard` (title, value, trend icon, change indicator, mini area/bar chart) and `KpiCardRow` (responsive grid container). **Budget Realization** shows 4 cards: Income (actual vs budget bar), Expenses (actual vs budget bar), Net Cash Flow (variance bar), Savings Rate (percentage). **Forecast Review** shows 4 cards: Total Assets (area trend), Net Cash Flow (area trend), Income (area trend), Expenses (area trend) — all across forecast years with year-over-year change indicators. |
| 2026-03-11 | **Export to Excel:** Added client-side Excel (.xlsx) export to 6 pages using SheetJS (`xlsx` package). New shared utility `frontend/src/utils/excelExporter.js` with functions: `exportBalanceSheet` (hierarchical with Net Worth), `exportCashFlow` (hierarchical with periods), `exportBudgetRealization` (budget/actual/variance), `exportTransactions` (flat table). Export buttons added to: Balance Sheet (`BalanceDateSelector`), Cash Flow (`CashFlowDateSelectorMonthYear`), Budget Realization (`BudgetRealizationContent`), Actual Transactions (`TransactionFilterActual`), Budget Transactions (`TransactionFilterBudget`). Cash Flow Monthly upgraded from CSV to Excel export. All exports flatten hierarchical trees with indentation and proper column widths. |
| 2026-03-11 | **Liability expense percent fix:** Fixed sign logic in `fcbuilder-module.js` line 190 where `expPct` was always negated (`-expPct`), which was correct for assets but wrong for liabilities. Now checks `module.AccountType` — for liabilities, the expense percentage is kept as-is so users can enter positive values. Added `a.account_type` to module queries in `forecast/index.js`, `repositories/forecast.js` (`findModulesByScenario`, `findModuleById`). Updated `FCModulesEdit.jsx` tooltip for ExpensePct field to show account-type-aware guidance. |
| 2026-03-03 | **Quick Add for missing categories:** Extended the COA Management page's "Analyze PS Data" feature to support quick-adding missing categories, matching the existing quick-add for missing accounts. After analysis, missing categories appear as blue `+` buttons (accounts use green). Clicking opens a simplified "Add Missing Category" modal showing just the category name (read-only) and a parent category picker — Type, Currency, and Account # fields are hidden since they don't apply to categories. On save, the category is added to the COA tree under the selected parent, transactions are synced, and analysis re-runs. Reuses the existing `POST /api/v2/util/coa/add` endpoint with `isCategory: true`. Modified: `COAManagement.jsx` (new handler, updated save logic), `COAManagementTableSection.jsx` (category quick-add buttons), `COAEditModal.jsx` (new `quickadd-category` mode). |
| 2026-02-28 | **Split Transaction feature:** Added ability to split a single transaction into 2-5 entries on both `/refresh-ps` and `/trans-actual` pages. New backend endpoint `POST /api/v2/transactions/:id/split` updates the original transaction with the first split's amount and creates new rows for remaining splits. Account is always preserved from the original; each split can have a different category via `CategorySelector`. `base_amount` is calculated proportionally to preserve exchange rates. New transactions get `ps_id=null`, `source='split'`, `closing_balance=null`. Wrapped in a PostgreSQL transaction for atomicity. Frontend modal shows original transaction summary, split count selector (2-5), amount inputs (`type="text" inputMode="decimal"` to support negative amounts), category selector per split, and real-time unallocated amount display (green when balanced, red when non-zero). Save disabled until amounts sum to original. Added purple-themed "Split Transaction" button on RefreshPS (visible when 1 row selected) and "Split" button in TransactionFilterActual action bar. New files: split modal CSS in `PageLayout.css` (`.split-modal*` classes). Modified: `transactions.js` (repo + route), `RefreshPS.jsx`, `RefreshPS.css`, `TransActual.jsx`, `TransactionFilterActual.jsx`, `TransactionFilterActual.css`. |
| 2026-02-21 | **Full responsive/mobile-friendly UI:** Added `@media` breakpoints (1080px, 768px, 640px) across 14 CSS files. Responsive typography scaling in `index.css`. Toast overflow fix at 640px. PageLayout: collapsed grids, stacked form actions, reduced table padding, horizontal-scroll tabs. Sidebar panels (Balance, Cash Flow date selectors) stack above content at 768px. Modals (FCReviewAdjustTransferModal, TransactionModal) go full-width at 768px, full-screen at 640px. Budget tables reduce min-height and cell sizing. Report tree indentation scales via CSS custom properties. Breadcrumbs get horizontal scroll. RefreshPS toolbar stacks vertically. **Navigation fix:** Disabled `backdrop-filter` on `.navbar__inner` at mobile — CSS spec causes `backdrop-filter` to create a containing block for `position: fixed` descendants, breaking the slide-out drawer. Nav links now properly hidden behind hamburger with `display: none`/`display: flex` toggle. Brand scales down (44px → 30px), version badge hidden at 640px, navbar goes edge-to-edge at 640px. |
| 2026-02-17 | **Clear Filters button:** Added Clear Filters button to both `/trans-actual` and `/trans-budget` filter bars. Resets all filter state to defaults — period (current month for Actual, full year for Budget), description, value range, categories, and accounts. Styled with muted/neutral appearance (gray border, subtle background) that turns dark on hover. |
| 2026-02-17 | **Transaction edit modal improvements:** Restricted `/trans-actual` edit modal to Description and Category fields only (removed Amount, Currency, BaseAmount, Account — these are PS-sourced and should not be manually editable). Enabled hierarchical `CategorySelector` in edit modals on both `/trans-actual` and `/trans-budget` by passing `plTree` from `useCoa()` hook. |
| 2026-02-17 | **Transaction acceptance:** Added `accepted BOOLEAN DEFAULT FALSE` column to `transactions` table (migration `003_accepted_field.sql`). Accepted transactions are protected from overwrite during PS data refresh/ingest sync (`WHERE transactions.accepted IS NOT TRUE` on upsert). Added Accept button and Accept All button to Review & Edit New tab on `/refresh-ps`. Accepted transactions disappear from review table. Any manual edit via `PATCH /api/v2/transactions/:id` (including from `/trans-actual`) auto-sets `accepted=true`, protecting user edits from future refreshes. Uses existing PATCH endpoint — no new API routes needed. |
| 2026-02-16 | **Balance Sheet UI improvements:** Removed decorative dot from page title (`::before` pseudo-element on `.report-toolbar-header__title`). Redesigned filter bar from two-row stacked layout to single horizontal row (inline layout matching budget realization pattern) — period count selector and date inputs now sit alongside Generate/Expand/Collapse buttons in one row. Removed redundant "Balance Date" labels and border separator. Added `P1`/`P2`/`P3` pill-style badges next to date inputs. Fixed inconsistent vertical spacing between collapsed and expanded states by adding `align-content: start` to the grid container. Added **Net Worth summary row** (`<tfoot>`) to the balance sheet table showing Assets + Liabilities, styled with a primary-color top border and subtle blue background. |
| 2026-02-16 | **Transaction table column optimization:** Added `noWrap` to Date, LC Amount, and USD Amount columns to prevent numeric values from wrapping to two lines. Constrained Description column with `maxWidth: 220px` and text-overflow ellipsis to give amount columns more space. Applied to shared `TransactionTable.jsx` — affects both `/trans-actual` and `/trans-budget`. |
| 2026-02-16 | **Route reorganization:** Moved `/refresh-ps` from Database category to Transactions category in `routes.jsx`, grouping it with related transaction management pages. |
| 2026-02-16 | **Transaction pages filter bar redesign:** Replaced raw HTML multi-select elements and checkbox-toggled filters on both `/trans-actual` and `/trans-budget` with the standard shared components (`PeriodSelector`, `CategorySelector`, `AccountSelector`). Added collapsible Show/Hide filter toggle matching Budget Worksheet pattern. Removed separate currency filter (now implicit via AccountSelector's currency grouping). Added `hideBudgetYear` prop to `PeriodSelector` for non-budget contexts. Changed transaction table date format from "Month Year" to mm/dd/yy. New files: `TransactionFilterActual.jsx`, `TransactionFilterBudget.jsx`, `TransactionFilterActual.css`. Old `TransactionFilter.jsx` retained as legacy (unused). |
| 2026-02-16 | **RefreshPS page enhancements:** Added "Review & Edit New Transactions" feature — editable transaction table on `/refresh-ps` using shared `TransactionTable`, `TransactionEditModal`, and `REVIEW_CONFIG` (Description + Category fields only). New backend endpoint `POST /api/v2/ingest-ps/review-new-transactions` queries `psdata_staging` LEFT JOINed with `transactions` to include unsynced records. Replaced toggle buttons with radio-style tab selector (Review & Edit New / New Transactions / Modified — one active at a time, default: Review). Integrated `CategorySelector` component into `TransactionEditModal` for hierarchical, searchable single-select category picking (via new `plTree` prop). Fixed `GET /api/v2/util/appdata` to merge JSON file data with PostgreSQL `app_data` table (resolving "No ingest/refresh recorded" display bug). Improved toolbar styling with dedicated action button and tab layout. |
| 2026-02-16 | **Budget Worksheet UI overhaul:** Created three reusable shared components — `CategorySelector` (COA-hierarchy-ordered, searchable multi-select), `AccountSelector` (currency-grouped, searchable multi-select), `PeriodSelector` (preset-based: This Month, Last Month, This/Last Year, Custom). Replaced inline filter controls with shared components. Added collapsible filter controls (Show/Hide toggle). Replaced side-by-side Balances + Budget Entry layout with a tabbed panel showing selected category in the tab header. Removed redundant `budget-region` wrappers from `BudgetRegionBalances` and `BudgetRegionBudgetEntry`. |
| 2026-02-15 | **New feature:** Added Budget Variances page (`/budget-variances`) — flat line-item table showing budget vs actual with variance, sorted by largest absolute variance. Uses same data-fetching pattern as Budget Realization (cash-flow + budget cash-flow APIs) with leaf-level extraction. Simple month/year selector defaulting to current month. |
| 2026-02-15 | **Frontend refactoring:** Unified `TransactionActual/` and `TransactionBudget/` into shared `features/Transaction/` module — config-driven architecture (`ACTUAL_CONFIG`, `BUDGET_CONFIG`) with 5 shared hooks and 4 shared components. Deleted 22 duplicate files (~3,100 lines removed, ~900 added = ~2,200 net reduction). Extracted 4 hooks from `FCExpSetup.jsx` (869→159 LOC): `useFCExpAssumptions`, `useFCExpAccountHierarchy`, `useFCExpEntries`, `useFCExpCrud`. Extracted `useBudgetEntrySubmit` from `BudgetInput.jsx` (762→445 LOC). |
| 2026-02-14 | **V1 compat removal:** Consolidated forecast routes — removed ~300 lines of unused v2-only REST endpoints (individual scenario/module/incexp CRUD), merged `/modules/v1` into `/modules`, removed `_id` fields from responses, cleaned up v1 compat comments in frontend. Renamed `mongoImportReport`/`mongoUpdateReport` to `importReport`/`updateReport` in dataPaths.js. |
| 2026-02-14 | **Data fix:** Re-parented "Tax Reserve - US" (id 53) and "Tax Reserve - PL" (id 54) from "Tax Reserve" (id 52, profit_loss) to "Liabilities" (id 51, balance_sheet). They are independent balance sheet nodes, not children of the P&L Tax Reserve account. Applied to both prod and dev databases. |
| 2026-02-14 | **Endpoint fixes:** Implemented `GET /api/v2/accounts/categories` (categories mapped to accounts) and `GET /api/v2/util/exchange-rates` (bulk/historical exchange rates). Both were listed as known issues (500/404) but had never been implemented. Audited and corrected API documentation to match actual routes. |
| 2026-02-14 | **V1 retirement:** Removed all V1 legacy routes (`routes/coa.js`, `routes/util.js`, `routes/health.js`) and the `server/src/routes/` directory. Removed `coa.json`, `coa_traits.json`, and backup copies from `components/data/`. Migrated `forecast.js` `/modules/unmatched` from coa.json to SQL. Removed `coa` entry from `dataPaths.js`. All endpoints now exclusively use PostgreSQL via V2 routes. |
| 2026-02-14 | **Timezone fix:** Fixed ±1 day date shift in `reports.js` and `budget.js` caused by `pg` library serializing JS `Date` objects in local timezone (UTC on prod vs EST on dev). Now passes YYYY-MM-DD strings directly to PostgreSQL. |
| 2026-02-14 | **COA migration to SQL:** Migrated `reports.js` (balance sheet, cash flow), `budget.js` (cash flow, category-groups) from reading `coa.json` to using `accountsRepo.getNestedTree()` with recursive CTE. |
| 2026-02-14 | **Data fix:** Fixed "Children - Anna" account (id 175) self-referencing `parent_id`. Updated to correct parent (id 167) on both prod and dev databases. |
| 2026-02-13 | Version bumped to v2.0.6. Documentation updates. |
| 2026-02-08 | Decommissioned dev machine (linux1). VM is now sole environment. |
| 2026-02-08 | Restored database from dev machine to VM via `pg_dump`/`pg_restore`. All 25k+ transactions, budgets, forecasts confirmed. |
| 2026-02-08 | Fixed server Dockerfile: added `postgresql-client-16` for backup endpoint. |
| 2026-02-08 | Recreated VM after loss (cloud image was in /tmp). All images now in /mnt/vm-ssd via libvirt pool. Added `Scripts/provision-vm.sh` and `Scripts/deploy-on-vm.sh` scripts. |
| 2026-02-07 | Migrated from dev machine to KVM VM at 192.168.1.82 |
| Earlier | Migrated from MongoDB to PostgreSQL 16 |
| Earlier | UI overhaul: Lucide icons, shared layout, category landing pages |

---

*Last updated: 2026-03-16*
