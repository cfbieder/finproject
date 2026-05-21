# Development Plan (FC_NEXT_STEPS.md)

Living plan for the Fin project — open Change Requests, known issues, ongoing improvement themes, and a chronological history. Companion to [FC_PROJECT_STRUCTURE.md](FC_PROJECT_STRUCTURE.md), which describes the *current* state of the project.

For the full CR list with one-line descriptions, see [CRs/CR_INDEX.md](CRs/CR_INDEX.md).

---

## 1. Change Requests

Each CR is a self-contained markdown file under [CRs/](CRs/). The first line of each CR carries its status. The anchors below are the deep-link targets used from each CR file's "Plan" link.

### 1.1 Open / In-Progress

<a id="cr014"></a>
- **CR014 — [PocketSmith Replacement](CRs/CR014_POCKETSMITH_REPLACEMENT.md)** — *OPEN*. Evaluate alternatives to PocketSmith for bank transaction aggregation.

<a id="cr015"></a>
- **CR015 — [Re-export Changes Back to PocketSmith](CRs/CR015_PS_REEXPORT.md)** — *OPEN*. One-way push of local edits (category, description, date) back to PocketSmith. May be obsoleted by CR014.


<a id="cr017"></a>
- **CR017 — [Cash Sweep Phase C — Multi-Module Priority Sweep](CRs/CR017_CASH_SWEEP_PHASE_C.md)** — *OPEN*. Withdraw from multiple modules in priority order on shortfall; extends CR005.

### 1.2 Completed (chronological, latest first)

<a id="cr016"></a>
- **CR016 — [Frontend Test Framework (Vitest)](CRs/CR016_FRONTEND_TEST_FRAMEWORK.md)** — *COMPLETED 2026-05-20*. Vitest + `jsdom` scaffolded; 96 tests across 5 helper modules (`dateHelpers`, `formatters`, `treeTraversal`, `forecastHelpers`, `cashFlowHelpers`); `npm test` exits non-zero on failure. Component/hook tests + Playwright E2E deferred to future CRs.

<a id="cr013"></a>
- **CR013 — [Collapse `categories` Table into `accounts`](CRs/CR013_COLLAPSE_CATEGORIES.md)** — *COMPLETED 2026-04-28*. Migration 021. Single COA source of truth; FK columns repointed; legacy table dropped.

<a id="cr006"></a>
- **CR006 — [AI Review of FC Plan](CRs/CR006_AI_REVIEW.md)** — *COMPLETED 2026-04-28*. Conversational review via local `ocr-llm` gateway, async with polling, browser notifications. Migrations 014, 020.

<a id="cr012"></a>
- **CR012 — [Opening Balance Calibration](CRs/CR012_OPENING_BALANCE_CALIBRATION.md)** — *COMPLETED 2026-04*. Migration 016. Accurate balance sheet via `opening_balance + SUM(transactions)`.

<a id="cr007"></a>
- **CR007 — [PWA & Mobile Simplified Shell](CRs/CR007_PWA_MOBILE_SHELL.md)** — *COMPLETED*. Installable PWA + dedicated `/m/*` mobile experience.

<a id="cr005"></a>
- **CR005 — [Cash Sweep & Auto-Balance](CRs/CR005_CASH_SWEEP.md)** — *COMPLETED*. Iterative sweep with income↔sweep convergence loop. Migrations 012–013.

<a id="cr011"></a>
- **CR011 — [Source Mappings (Category + Account)](CRs/CR011_SOURCE_MAPPINGS.md)** — *COMPLETED*. Decouples external system names from internal app names. Migrations 018–019.

<a id="cr009"></a>
- **CR009 — [Transfer Analysis + Manual Match Groups](CRs/CR009_TRANSFER_ANALYSIS.md)** — *COMPLETED*. Auto + manual matching of transfer pairs; `transfer_matched` flag. Migrations 005–006.

<a id="cr008"></a>
- **CR008 — [HierarchyFilter & Transaction Pages Redesign](CRs/CR008_HIERARCHY_FILTER.md)** — *COMPLETED*. Two-stage cascading filter; full redesign of transaction-explorer pages.

<a id="cr010"></a>
- **CR010 — [COA Management Redesign + Move](CRs/CR010_COA_MANAGEMENT.md)** — *COMPLETED*. Tree view editor with toolbar, inline actions, quick-add, Move modal.

<a id="cr004"></a>
- **CR004 — [FC Inc/Exp Mapping Layer](CRs/CR004_FC_LINES_MAPPING.md)** — *COMPLETED*. User-defined FC Lines decouple budget categories from forecast outputs. Migration 007.

<a id="cr003"></a>
- **CR003 — [Forecast Module](CRs/CR003_FORECAST_MODULE.md)** — *COMPLETED*. Engine + UI for BS modules and inc/exp items across all phases (1, 2A, 2B, 3, 4, 5).

<a id="cr002"></a>
- **CR002 — [Frontend Architecture Refactor](CRs/CR002_FRONTEND_REFACTOR.md)** — *COMPLETED*. God components decomposed; `features/` module pattern; ~22 duplicate files deleted.

<a id="cr001"></a>
- **CR001 — [MongoDB → PostgreSQL Migration](CRs/CR001_MIGRATION_MONGO_TO_POSTGRES.md)** — *COMPLETED*. All storage moved to PostgreSQL 16; V1 routes and `coa.json` removed.

---

## 2. Open Backlog (non-CR items)

Small fixes, refactors, and one-off cleanups that don't warrant their own CR file. New work that grows beyond a line item gets promoted to a CR.

- [ ] **Forecast: `baseYears` workaround cleanup** — `baseYears` is now properly populated but a `value == null` detection pattern still lives in `FCReviewTable`. Low-priority cosmetic.
- [ ] **Frontend DRY items** still pending (full list in §3 below):
  - `collectCollapsiblePaths()` duplicated in `Balance.jsx` and `BalanceChart.jsx` — move to shared `treeHelpers.js`.
  - Month options array recreated in multiple components — move to shared constants.
  - FX rate lookup duplicated in BudgetInput and various transaction modals — move to shared `currency.js`.
- [ ] **Shared components missing** (per §3.3): `<Modal>`, `<DataTable>`, `<FormField>`, `<LoadingSpinner>`, `<ErrorMessage>`, `<ConfirmDialog>`, `<CurrencyInput>`. Tracked here as a theme; promote to a CR if a focused refactor is scheduled.
- [ ] **Backend service layer simplification** (per §4): break up `fcbuilder-module.js` (835 lines), `cashFlowFetcher.js` (619 lines). Centralize error handling with an `AppError` class. Promote to a CR when scheduled.
- [ ] **TypeScript migration** (per §3.7) — gradual: utilities → hooks/components → pages.
- [ ] **API design pass**: consistent `{ success, data, meta }` response envelope, pagination on list endpoints, structured logging via Pino.

---

## 3. Known Issues

1. **Test coverage:** 73 backend Jest tests + 17 HTTP smoke checks + 96 frontend Vitest tests across 5 helper modules ([CR016](#cr016) complete; component / hook tests + Playwright E2E deferred to future CRs). Run backend: `cd server && npm test`. Frontend: `cd frontend && npm test`. Smoke: `node server/src/scripts/smoke-after-021.js`. Full test layout: [Testing/TEST_OVERVIEW.md](Testing/TEST_OVERVIEW.md).
2. **Cloud-init ISO** still attached to the VM as a CD-ROM. Harmless but can be ejected:
   ```bash
   virsh --connect qemu:///system change-media fin sda --eject
   ```
3. **Timezone-sensitive date handling:** The `pg` library serializes JavaScript `Date` objects using the server's local timezone. Fixed globally in `postgres.js` with `types.setTypeParser(1082, val => val)` so DATE columns return plain `YYYY-MM-DD` strings. Frontend code must format local-time `Date` objects using `getFullYear()`/`getMonth()`/`getDate()` — never `.toISOString().split("T")[0]` which shifts by one day in UTC+ timezones.

---

## 4. Frontend Improvement Themes (ongoing)

### 4.1 DRY Violations (remaining)

1. ~~Transaction filter logic duplicated across TransActual, TransBudget, useTransactions~~ — *Resolved* (CR002).
2. `collectCollapsiblePaths()` duplicated in `Balance.jsx` and `BalanceChart.jsx` — move to shared `treeHelpers.js`.
3. ~~Date initialization logic in BudgetInput~~ — *Resolved* via `PeriodSelector`.
4. Month options array recreated in multiple components — move to shared constants.
5. FX rate lookup duplicated in BudgetInput and transaction modals — move to shared `currency.js`.

### 4.2 Missing Shared Components

| Component | Used in | Current state |
|-----------|---------|---------------|
| `<Modal>` | 5+ places | Each modal custom-built |
| `<DataTable>` | 6+ places | Tables custom each time |
| ~~`<FilterPanel>`~~ | 4+ places | Partially via `HierarchyFilter` (CR008) and `PeriodSelector` |
| `<FormField>` | 10+ places | Inputs custom per form |
| `<LoadingSpinner>` | All pages | "Loading..." text varies |
| `<ErrorMessage>` | All pages | Error display inconsistent |
| `<ConfirmDialog>` | 5+ places | Delete confirms duplicated |
| ~~`<DateRangePicker>`~~ | 4+ places | Partially via `PeriodSelector` |
| `<CurrencyInput>` | 3+ places | Amount inputs inconsistent |

### 4.3 UI/UX Improvements

| Issue | State | Proposed |
|-------|-------|----------|
| Loading states | Mix of "Loading...", spinners | Unified `<LoadingSkeleton>` |
| Error display | Different per page | Unified `<ErrorBanner>` with retry |
| ~~Empty states~~ | Inconsistent | *Resolved:* `EmptyState` with 8 unDraw variants, wired into 14 pages |
| Button styles | `.generate-report-button` everywhere | Variants: primary, secondary, danger |
| Form validation | Scattered | Centralized validation with error messages |
| Date selection | Different controls per page | Partially via `PeriodSelector`; other pages pending |

### 4.4 Performance & TypeScript

- Component memoization (`React.memo`, `useMemo`, `useCallback`) for expensive components.
- Virtual scrolling (`@tanstack/react-virtual`) for tables with 1000+ rows.
- Debounced filters; SWR/stale-while-revalidate for API caching.
- TypeScript migration: utilities → hooks/components → pages.

### 4.5 Decisions Made

| Decision | Choice |
|----------|--------|
| Component library | Radix UI + custom styling |
| Charting | Recharts |
| Mobile support | Responsive (1080px / 768px / 640px breakpoints) + dedicated `/m/*` shell |
| State | Enhanced React Context (upgrade to Zustand if complexity grows) |

---

## 5. Backend Improvement Themes (ongoing)

### 5.1 Service Layer Complexity

| Service | Lines | Notes |
|---------|-------|-------|
| `fcbuilder-module.js` | 835 | Monolithic; mixes data access with business logic |
| `fcbuilder-incexp.js` | 436 | Duplicated patterns from module builder |
| `cashFlowFetcher.js` | 619 | Complex aggregation, hard to maintain |
| `balanceSheetFetcher.js` | 324 | Could be simplified with SQL views |

### 5.2 Missing Abstractions

- **Repository pattern** — partially adopted under `server/src/v2/repositories/`. Continue extracting where services still embed SQL.
- **Base repository** — common operations in a shared base class.
- **Error handling** — centralize with an `AppError` class and error-handling middleware.

### 5.3 API Design

- Consistent response envelope `{ success, data, meta }` or `{ success, error }`.
- Pagination on list endpoints (`page`, `pageSize`, `total`, `totalPages`).
- Standardize `sortBy`, `sortOrder`, `fromDate`, `toDate` across endpoints.
- Structured logging via Pino.

---

## 6. Testing Strategy

See [Testing/TEST_OVERVIEW.md](Testing/TEST_OVERVIEW.md) for the test inventory, naming conventions, and run commands.

Phased plan:

- **Phase 1 — Backend unit tests (Jest, in place):** Forecast engine, route handlers with mocked repos. 73 tests today.
- **Phase 2 — HTTP smoke tests (in place):** `smoke-after-021.js` covers all SQL JOINs rewritten by migration 021. Add new smoke scripts for major schema changes.
- **Phase 3 — Frontend unit tests (Vitest, [CR016](#cr016)):** Helpers covered. *Complete 2026-05-20: 96 tests across 5 helper modules (`dateHelpers`, `formatters`, `treeTraversal`, `forecastHelpers`, `cashFlowHelpers`). Hook tests deferred to a future CR (need React Testing Library + Context mocking).*
- **Phase 4 — E2E (Playwright, future):** Critical flows — PocketSmith sync + accept, budget entry, forecast module creation.

---

## 7. Migration History

Chronological log of substantive infrastructure / behavioural changes. Smaller user-facing features are documented in the relevant CR file or FC_PROJECT_STRUCTURE.md.

| Date | Event |
|------|-------|
| 2026-05-20 | **CR016 closed — Frontend test framework (Vitest) complete.** Final state: 96 tests across 5 helper modules in `frontend/src/utils/__tests__/` — `dateHelpers` (21), `formatters` (25), `treeTraversal` (17), `forecastHelpers` (20), `cashFlowHelpers` (13). Infrastructure: `vitest@^2.1.9` + `jsdom@^25` in devDeps; `npm test` / `npm run test:watch` scripts; standalone `vitest.config.js` (jsdom env, mirrors Vite path aliases); exits non-zero on failure. Deterministic via `vi.useFakeTimers()` where time-sensitive; no network, no real DB. Component/hook tests and Playwright E2E deferred to future CRs. |
| 2026-05-19 | **Balance Trends — auto-regenerate on interval change** ([CR018](#cr018)). Switching the Month/Quarter/Year pill now re-runs `handleGenerate` automatically so the column count + headers stay in sync with the selected interval (previously the table kept the prior interval's columns until the user clicked Generate). Year/month dropdowns still require an explicit Generate. |
| 2026-05-19 | **Balance Trends — year range + Interval (Month/Quarter/Year) + future-period filter** ([CR018](#cr018)). `PeriodSelector` extended with an opt-in `enableYearRange` prop that adds a Year (to) dropdown alongside Year (from) in Custom mode (no behavior change for other pages). Interval pill bar (Month default / Quarter / Year) controls column granularity. Columns whose period start is in the future are dropped; the current period is included with snapshot as-of today and its header gains an `(MTD)`/`(QTD)`/`(YTD)` suffix in primary color. Page state renamed (`monthEnds` → `columns: [{label, asOf, isPartial}]`) to model the partial-period case cleanly; `interval` state renamed to `intervalKey` to avoid shadowing the global `setInterval`. |
| 2026-05-19 | **Released v2.7.15** — Balance Trends report at `/balance-trends` (Reports & Graphs > Reports, [CR018](#cr018)). Month-end USD balances across the selected period for one or more BS accounts. Reuses `HierarchyFilter` (BS COA groups, right-click solo-select) + single-period `PeriodSelector` (no Transfers/Unrealized, budget year hidden). Table renders accounts × month-ends with a Total (selected, USD) footer row; Excel export. Reuses `Rest.fetchBalanceReport(asOfDate)` once per month-end (parallel) and flattens each tree to a leaf map. |
| 2026-05-18 | **Released v2.7.14** — HierarchyFilter checklist gains a type-to-narrow search input above the leaf list (only visible when a specific group is active; resets on group change; case-insensitive substring; empty-state message). Affects Budget Worksheet and Transaction pages that consume `HierarchyFilter`. |
| 2026-05-04 | **Forecast scenario copy — faithful field carry-over** — `copyScenario()` was inserting only a subset of source columns: `forecast_modules` missed `setup_status` / `cash_sweep_target` / `tax_rate_override`; `forecast_income_expense` missed `setup_status` / `fc_line_id` / `budget_source_year`; the new-scenario INSERT into `forecast_scenarios` missed `cash_sweep_low` / `cash_sweep_high`. Default `setup_status='new'` was silently filtered out by the generator (`COALESCE(setup_status,'new') NOT IN ('new','exclude')`), producing "Modules: 0, Entries: 0" on every copy. Sweep band loss caused ~109 fewer entries on copied scenarios (no cash sweep / no downstream rebalances). Existing-target branch now also mirrors sweep band from source. |
| 2026-05-04 | **Forecast scenario copy — "Update PY Actual values" path corrected** — when the Copy modal's PY-refresh checkbox was used, the year-end balance SQL summed `t.base_amount` (always USD) into `balance_lc`, then wrote that USD figure into `forecast_modules.base_value` (local currency) and 0 into `base_value_usd` for non-USD accounts. Engine then double-converted, halving the asset base for PLN/EUR modules. Fixed by summing `t.amount WHERE t.currency = a.currency` into `balance_lc`. Also stopped overwriting `market_value` / `market_value_usd` from ledger — those are broker-reported and can't be derived from the transaction stream. |
| 2026-04-28 | **Documentation reorganization** — split into PROJECT_STRUCTURE.md (current state) + NEXT_STEPS.md (plan) + CRs/ folder + Testing/ + Archive/. CR_INDEX.md added. CLAUDE.md cross-references updated. |
| 2026-04-28 | **Categories table collapsed into `accounts`** ([CR013](#cr013), migration 021). FK columns repointed; `categories` and `category_source_mappings` dropped. HTTP smoke test (`smoke-after-021.js`) added — 17 endpoint checks against live server. |
| 2026-04-28 | **Transfer Analysis: FX category fuzzy matching now triggers in production:** The `isFxCategory` predicate in `GET /api/v2/transactions/transfer-analysis` checked `name === 'FX'`, but the production category is named `Transfer - FX` (id 208), so the FX branch (1% amount tolerance, 1-day window) never fired and every FX pair fell into the standard exact-match path. Result: a full screen of unmatched WISE EUR↔USD transfers. Fixed by accepting both names. |
| 2026-04-28 | **AI Review context restructured to prevent flow-vs-balance misreads** — `buildForecastContext()` split into three explicit sections: (1) Annual P&L Flows by Year (with sign convention; `Bank Accounts` clarified as flow not balance), (2) Balance Sheet — Year-End Market Value, (3) Cash Account & Cash Sweep Activity. Sweep entries excluded from P&L Flows. |
| 2026-04-28 | **nginx 301 trailing-slash bug broke + New Review:** `location /api/v2/ai-review/` triggered nginx's directory-canonicalization redirect; browsers convert 301-redirected POSTs to GETs. Fixed via regex location `~ ^/api/v2/ai-review(/|$)`. |
| 2026-04-28 | **AI Review made async with polling + browser notifications** ([CR006](#cr006), migration 020). 202 returned immediately; background worker; 8s polling; browser notification when tab hidden; pulsing red dot for unread. nginx `proxy_read_timeout` raised to 360s. |
| 2026-04-27 | **AI Review migrated from Anthropic API to local `ocr-llm` gateway** ([CR006](#cr006)). Local-only fallback chain `ollama_heavy → ollama_mid`. `LLM_GATEWAY_URL` env var. Anthropic SDK removed. Cross-repo coordinated via `ocr-llm/HANDOFFS.md`. |
| 2026-04-13 | **Ledger date filter fix + duplicate detection** — backend now accepts `fromDate`/`toDate` (was silently ignoring); duplicate-finder client-side analysis (same amount+currency within 3 days, or identical descriptions). |
| 2026-04-04 | **Graph Quick Adjustments (FC Exp + FC Module)** — double-clicking a forecast graph point opens an inline adjustment modal. FC Exp modal edits periodic changes (Fixed/Percent/One-Off); FC Module modal edits Invest/Dispose transfers. Save & Regenerate refreshes graph. |
| 2026-04-04 | **Income-Sweep Convergence** ([CR005](#cr005)) — Step 7b iterative loop in `index.js` converges yield income with sweep-adjusted MV. Mirrors Excel Goal Seek for the income↔sweep circular dependency. |
| 2026-04-03 | **Global DATE timezone fix** — root-cause fix in `postgres.js` (`types.setTypeParser(1082, val => val)`) plus frontend uses local-time `getFullYear()`/`getMonth()`/`getDate()` instead of `.toISOString().split("T")[0]`. Affected pages: Budget Realization drilldown, Budget Worksheet popups, Balance pages, date helpers. |
| 2026-04-02 | **AI Review API key security fix** — moved Anthropic key from `appdata.json` to `ANTHROPIC_API_KEY` env var (later replaced entirely by `LLM_GATEWAY_URL`). |
| 2026-04-02 | **AI Review UX fixes** — context moved into first user message, per-review delete buttons, drawer z-index above nav. |
| 2026-04-02 | **FC Review enhancements** — account double-click graph; graph base year fix via shared `resolveCashValue()` / `resolveBalanceValue()` helpers. |
| 2026-03-29 | **Ledger category filter + amount total** — category dropdown populated client-side; total Amount in table footer for filtered rows. |
| 2026-03-28 | **Budget Worksheet filters → HierarchyFilter** ([CR008](#cr008)) — pill-style filters with leaf counts; CategorySelector retained only for right-click quick-pick. |
| 2026-03-28 | **FC Module Phase 2B-5 Engine Update** ([CR003](#cr003)) — engine resolves FC Lines; `expense_growth_method` (`inflation` vs `pct_of_value`); 6 new tests. |
| 2026-03-28 | **FC Module Phase 2B-4b Add from Actuals** — replaces "Seed from Actuals"; tree view with leaf pre-selection and parent aggregation. |
| 2026-03-28 | **FC Module Phase 2B-4 Forecast Expenses Integration** — "Add from FC Lines" replaces "Seed Budget" + "Coverage". |
| 2026-03-28 | **Unmatched modules endpoint fix** — exclude children of matched parent accounts. |
| 2026-03-27 | **Manual Match Groups** ([CR009](#cr009), migration 005) — persistent many-to-one transfer matching. |
| 2026-03-27 | **`transfer_matched` flag + Actuals Transfer Status filter** ([CR009](#cr009), migration 006). |
| 2026-03-27 | **HierarchyFilter component** ([CR008](#cr008)) — two-stage cascading filter for transaction pages. |
| 2026-03-27 | **Day-level date editing in transaction edit modals** — `TransactionDateSelector` now includes Day with leap-year-aware clamping. |
| 2026-03-26 | **Balance Sheet page redesign** — KPI cards, inline period controls, expand/collapse icon buttons, Net Worth footer. |
| 2026-03-26 | **Budget Worksheet page redesign** — two-panel side-by-side layout, KPI cards, right-click category quick-pick. |
| 2026-03-26 | **COA Management page redesign + Move feature** ([CR010](#cr010)). |
| 2026-03-26 | **Transaction pages redesign** ([CR008](#cr008)) — `/trans-actual` and `/trans-budget` with KPI cards, slide-in drawers, contextual selection bar. |
| 2026-03-16 | **Trans-Actual filter & account selector fixes** + leaf-only account filtering (`leafOnly` param on `GET /api/v2/accounts`). |
| 2026-03-15 | **Per-row action buttons in TransactionTable** — Split/Neutralize/Change Category moved from top-bar to per-row. |
| 2026-03-15 | **Category Trend graph** at `/category-trend` (Reports & Graphs > Graphs) — actual vs budget grouped bar chart. |
| 2026-03-14 | **Neutralize Transaction for brokerage accounts** — one-click offset entry tagged "Transfer - Securities Trades". |
| 2026-03-13 | **Forecast FX moved to Forecasting category & income/expense FX fix** in `fcbuilder-incexp.js`. |
| 2026-03-13 | **Monthly Budget FX Rates** at `/budget-fx` (migration 004). |
| 2026-03-13 | **Docker cleanup in backup cron** — prunes build cache + dangling images > 48h. |
| 2026-03-11 | **KPI Summary Cards** — `KpiCards.jsx` with Recharts mini-charts on Budget Realization and Forecast Review. |
| 2026-03-11 | **Export to Excel** — SheetJS-based exports on Balance Sheet, Cash Flow, Budget Realization, Actual + Budget Transactions. |
| 2026-03-11 | **Liability expense percent fix** in `fcbuilder-module.js`. |
| 2026-03-03 | **Quick Add for missing categories** in COA Management. |
| 2026-02-28 | **Split Transaction feature** on `/refresh-ps` and `/trans-actual`. |
| 2026-02-21 | **Full responsive/mobile-friendly UI** — `@media` breakpoints across 14 CSS files; `backdrop-filter` fix for slide-out drawer. |
| 2026-02-17 | **Clear Filters button** on `/trans-actual` and `/trans-budget`. |
| 2026-02-17 | **Transaction edit modal improvements** — restricted to Description + Category on `/trans-actual`; hierarchical CategorySelector. |
| 2026-02-17 | **Transaction acceptance** (migration 003) — `accepted` flag protects manual edits from PS refresh overwrite. |
| 2026-02-16 | **Balance Sheet UI improvements** — Net Worth footer, P1/P2/P3 pill badges, single-row filter bar. |
| 2026-02-16 | **Transaction table column optimization** — `noWrap` on date/amount columns; description ellipsis. |
| 2026-02-16 | **Route reorganization** — `/refresh-ps` moved from Database to Transactions category. |
| 2026-02-16 | **Transaction pages filter bar redesign** — shared `PeriodSelector`/`CategorySelector`/`AccountSelector`. |
| 2026-02-16 | **RefreshPS page enhancements** — Review & Edit New tab; integrated CategorySelector in TransactionEditModal. |
| 2026-02-16 | **Budget Worksheet UI overhaul** — three reusable shared selectors created. |
| 2026-02-15 | **Budget Variances page** at `/budget-variances`. |
| 2026-02-15 | **Frontend refactoring** ([CR002](#cr002)) — unified Transaction module, hook extraction, ~2,200 net LOC reduction. |
| 2026-02-14 | **V1 compat removal** + endpoint fixes + V1 retirement + COA migration to SQL + timezone fix + data fixes ([CR001](#cr001)). |
| 2026-02-13 | Version bumped to v2.0.6. Documentation updates. |
| 2026-02-08 | Decommissioned dev machine; VM is sole environment. Database restored to VM via `pg_dump`/`pg_restore`. Server Dockerfile fixed (`postgresql-client-16`). VM recreated after loss; provisioning scripts added. |
| 2026-02-07 | Migrated from dev machine to KVM VM at `192.168.1.82`. |
| Earlier | Migrated from MongoDB to PostgreSQL 16 ([CR001](#cr001)). |
| Earlier | UI overhaul: Lucide icons, shared layout, category landing pages. |

---

*Last updated: 2026-05-20*
