# Project Roadmap

Future work, known issues, and improvement proposals for the Fin application.

---

## 1. Known Issues

1. **`/api/v2/accounts/categories`** returns 500 — pre-existing issue, not migration-related.
2. **`/api/v2/exchange-rates`** returns 404 — route may not be implemented.
3. **No test suite** exists currently.
4. **Cloud-init ISO** still attached to the VM as a CD-ROM. Harmless but can be ejected:
   ```bash
   virsh --connect qemu:///system change-media fin sda --eject
   ```
5. **Tax Reserve orphan accounts:** "Tax Reserve - US" (id 53) and "Tax Reserve - PL" (id 54) have `section=balance_sheet` but their parent "Tax Reserve" (id 52) has `section=profit_loss`. This causes them to appear as orphan root nodes in the balance sheet SQL tree. Pre-existing data issue — needs decision on whether Tax Reserve belongs in balance_sheet or profit_loss.
6. **Timezone-sensitive date handling:** The `pg` (node-postgres) library serializes JavaScript `Date` objects using the server's local timezone. Production containers run in UTC; the dev host runs in America/New_York (EST, UTC-5). Fixed in `reports.js` and `budget.js` by passing YYYY-MM-DD strings directly to PostgreSQL. Any future date-based queries should follow the same pattern — never use `new Date()` for date-only values passed to SQL.

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

### 3.1 God Components to Split

| Component | Lines | Recommendation |
|-----------|-------|----------------|
| `BudgetInput.jsx` | 757 | 50+ state variables, mixed concerns. Split into 5-6 focused components. |
| `FCExpSetup.jsx` | 600+ | Handles assumptions, entries, modals, account loading. Split into 3-4 components. |
| `TransActual.jsx` | 393 | Near-identical to TransBudget (DRY violation). Extract shared base component. |
| `TransBudget.jsx` | 293 | Near-identical to TransActual (DRY violation). Extract shared base component. |

### 3.2 DRY Violations

1. **Transaction filter logic** (~80 lines) duplicated across TransActual, TransBudget, useTransactions
2. **`collectCollapsiblePaths()`** duplicated in Balance.jsx and BalanceChart.jsx — move to shared `treeHelpers.js`
3. **Date initialization logic** independently calculated in TransActual, TransBudget, BudgetInput — extract to `useDateRange` hook
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
| `<DateRangePicker>` | 4+ places | Date selection varies |
| `<CurrencyInput>` | 3+ places | Amount inputs inconsistent |

### 3.4 Proposed Component Architecture

Organize frontend into feature modules:

```
frontend/src/
├── components/          # Shared, reusable components
│   ├── ui/              # Base primitives (Button, Input, Select, Modal, Spinner)
│   ├── data-display/    # DataTable, StatCard, TreeView, Chart
│   ├── forms/           # FormField, DatePicker, CurrencyInput, AccountSelect
│   ├── feedback/        # Toast, ConfirmDialog, EmptyState, LoadingSkeleton
│   └── layout/          # PageHeader, PageLayout, Sidebar
├── features/            # Domain-specific feature modules
│   ├── transactions/    # Unified actual + budget transactions
│   ├── budget/          # Budget worksheet, realization, charts
│   ├── forecast/        # Scenarios, modules, assumptions, review
│   ├── reports/         # Balance sheet, cash flow, charts
│   └── settings/        # COA manager, FX settings
├── hooks/               # Shared hooks (useAPI, useDateRange, useDebounce, useLocalStorage)
├── utils/               # Shared utilities (formatting, validation, tree helpers)
├── constants/           # Shared constants (dates, currencies, routes)
└── pages/               # Thin page wrappers that compose feature components
```

### 3.5 UI/UX Improvements

| Issue | Current State | Proposed Fix |
|-------|--------------|--------------|
| Loading states | Mix of "Loading...", spinners | Unified `<LoadingSkeleton>` |
| Error display | Different per page | Unified `<ErrorBanner>` with retry |
| Empty states | Inconsistent messages | Unified `<EmptyState>` |
| Button styles | `.generate-report-button` everywhere | Button variants: primary, secondary, danger |
| Form validation | Scattered, inconsistent | Centralized validation with error messages |
| Date selection | Different controls per page | Unified `<DateRangePicker>` |

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

| Metric | Current | Target |
|--------|---------|--------|
| Largest component (lines) | 757 | <200 |
| Duplicated code blocks | 5+ | 0 |
| Shared components | ~3 | 15+ |
| Test coverage | 0% | >60% |

---

## 6. Migration History

Timeline of the MongoDB-to-PostgreSQL migration and infrastructure changes.

| Date | Event |
|------|-------|
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

*Last updated: 2026-02-14*
