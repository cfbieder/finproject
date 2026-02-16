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

- [ ] Add option to update budget FX rates on transactions page
- [ ] Test to check if fx rates in fc periods work, if changed
- [x] Add COA management (SQL-based; frontend CRUD at `/coa-management`)
- [ ] Review how income, growth and expense calculated in fcbuilder / put tooltips
- [ ] When copying modules to other scenarios, automatically update base date and values
- [ ] Export to excel
- [ ] Ability to adjust the tax rate on some income (e.g. UB)
- [ ] On liabilities the expense needs to be a negative percent — can this be fixed
- [ ] Add some KPIs to Budget Page and Forecast Page with graphics
- [ ] Add way to re-export changes back to PocketSmith
- [ ] Start on Option Analysis

---

## 3. Frontend Improvements

Proposals from the original migration plan for future frontend refactoring.

### 3.1 God Components — Completed (v2.0.9)

All four god components have been refactored:

| Component | Before | After | What Changed |
|-----------|--------|-------|--------------|
| `BudgetInput.jsx` | 762 | 549 | Extracted `useBudgetEntrySubmit` hook; replaced inline selectors with shared `CategorySelector`, `AccountSelector`, `PeriodSelector`; added tabbed Balances/Entry panel and collapsible filters |
| `FCExpSetup.jsx` | 869 | 159 | Extracted 4 hooks: `useFCExpAssumptions`, `useFCExpAccountHierarchy`, `useFCExpEntries`, `useFCExpCrud` |
| `TransActual.jsx` | 393 | 282 | Unified with TransBudget via shared `features/Transaction/` module |
| `TransBudget.jsx` | 295 | 204 | Unified with TransActual via shared `features/Transaction/` module |

### 3.2 DRY Violations

1. ~~**Transaction filter logic** (~80 lines) duplicated across TransActual, TransBudget, useTransactions~~ — **Resolved:** Unified into `features/Transaction/` with config-driven shared hooks and components
2. **`collectCollapsiblePaths()`** duplicated in Balance.jsx and BalanceChart.jsx — move to shared `treeHelpers.js`
3. ~~**Date initialization logic** independently calculated in BudgetInput~~ — **Resolved:** `PeriodSelector` shared component handles period presets (This Month, Last Month, This/Last Year, Custom) with auto-computed date ranges
4. **Month options array** defined in budgetInputUtils.js but recreated in multiple components — move to shared constants
5. **FX rate lookup** duplicated in BudgetInput and various transaction modals — move to shared `currency.js`

### 3.3 Missing Shared Components

| Component | Used In | Current State |
|-----------|---------|---------------|
| `<Modal>` | 5+ places | Each modal is custom-built |
| `<DataTable>` | 6+ places | Tables are custom each time |
| `<FilterPanel>` | 4+ places | Filter UI duplicated |
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
│   ├── Transaction/     # ✅ Unified actual + budget (config-driven shared hooks, components, utils)
│   ├── BudgetEntry/     # ✅ Budget worksheet (hooks: useFilterOptions, useBalanceData, useCurrencyData, useBudgetEntrySubmit)
│   ├── Forecast/        # ✅ Scenarios, modules, assumptions (hooks: useFCExpAssumptions, useFCExpAccountHierarchy, useFCExpEntries, useFCExpCrud)
│   ├── Balances/        # Balance sheet components
│   ├── Budgets/         # Budget realization
│   ├── CashFlow/        # Cash flow reports
│   ├── Charts/          # Chart components
│   ├── COAManagement/   # COA CRUD
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
| Date selection | Different controls per page | Partially addressed: `PeriodSelector` with presets on Budget Worksheet. Other pages pending. |

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
| Mobile support | Desktop only |
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

*Last updated: 2026-02-16*
