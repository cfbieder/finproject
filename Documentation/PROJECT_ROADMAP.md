# Project Roadmap

Future work, known issues, and improvement proposals for the Fin application.

---

## 1. Known Issues

1. ~~**No test suite** exists currently.~~ **73 automated tests** — 16 FC Lines API tests, 19 engine tests (fcbuilder-module), 6 incexp tests, 8 E2E engine tests, cash-sweep tests, 16 balance calibration tests. Run: `cd server && npm test`
2. **Cloud-init ISO** still attached to the VM as a CD-ROM. Harmless but can be ejected:
   ```bash
   virsh --connect qemu:///system change-media fin sda --eject
   ```
3. **Timezone-sensitive date handling:** The `pg` (node-postgres) library serializes JavaScript `Date` objects using the server's local timezone. Fixed globally in `postgres.js` with `types.setTypeParser(1082, val => val)` so DATE columns return plain `YYYY-MM-DD` strings. Frontend code must format local-time Date objects using `getFullYear()`/`getMonth()`/`getDate()` — never `.toISOString().split("T")[0]` which shifts by one day in UTC+ timezones.

---

## 2. Feature Backlog

Items from active development notes:

- [x] Add Program Settings page with configurable default budget year
- [x] Add monthly budget FX rates page (`/budget-fx`) with per-month, per-year rates and recalculate from actual
- [x] Test to check if fx rates in fc periods work, if changed
- [x] Add COA management (SQL-based; frontend CRUD at `/coa-management`)
- [x] Add Ledger report page (`/ledger`) — account-level transaction listing with running balance for asset/liability accounts, dynamic cascading COA selectors (variable depth), collapsible filters, row selection with edit/delete, add transaction drawer
- [x] Review how income, growth and expense calculated in fcbuilder / put tooltips — Growth relabeled to "Growth (x Inflation)" with tooltips on BS module + IncExp edit forms
- [x] When copying modules to other scenarios, automatically update base date and values — "Update base values from actuals" checkbox on copy modal with year picker
- [x] Export to excel
- [x] Ability to adjust the tax rate on some income (e.g. UB) — per-module `tax_rate_override` field (migration 010), NULL = scenario default
- [x] On liabilities the expense needs to be a negative percent — can this be fixed
- [x] Add some KPIs to Budget Page and Forecast Page with graphics
- [x] PWA & Mobile-Friendly UI — installable Progressive Web App via `vite-plugin-pwa`. Cache-first for hashed Vite assets (JS/CSS/fonts/images), network-only for `/api/` calls. Auto-update detection every 60s with toast prompt ("A new version is available" + Update/Later buttons). PWA manifest (`standalone`, `any` orientation), icons (192px, 512px, maskable, Apple Touch 180px). Mobile enhancements: safe area insets for notched devices, 44px touch targets on `pointer: coarse`, `font-size: 16px` on inputs (prevents iOS zoom), `overscroll-behavior: none` in standalone mode, DataTable mobile breakpoints (responsive font/padding), `section-filters` auto-height on small screens. `PWAUpdatePrompt.jsx` in `main.jsx`. Custom "Install" button in navbar via `useInstallPrompt` hook (captures `beforeinstallprompt`, hides when already installed/standalone; icon-only on mobile). nginx `sw.js`/`manifest.webmanifest` served with `no-cache`; hashed `/assets/` with `1y immutable`.
- [ ] Add way to re-export changes back to PocketSmith
- [ ] **Mobile/PWA Simplified Shell** — dedicated mobile experience under `/m/*` separate from desktop pages, shown on PWA standalone or viewport ≤ 640px (with localStorage `forceDesktop` escape hatch). Bottom tab bar with 5 reports: Balance, Cash Flow, Refresh, Budget, Graph. See `frontend/src/mobile/`.
  - [x] **PR1** — Foundation + Mobile Balance Summary (`useIsMobile`, `MobileLayout`, `MobileTabBar`, `MobileHome` pure-launcher, `mobile.css` token overlay, `MobileBalance` page with KPIs + collapsible Level-1 groups, `/m/*` routing with auto-redirect both directions, "Switch to desktop view" escape hatch)
  - [x] **PR2** — Mobile Cash Flow (`MobileCashFlow` page with period pill row, KPIs (Net hero / Income / Expenses), Top Expenses list with "See all N" toggle, Top Income list with "See all N" toggle; shared `periodPresets.js` helper for This Month / Last Month / This Year / Last Year)
  - [x] **PR3** — Mobile Budget Realization (`MobileBudgetRealization` page with period pill row, 2×2 KPI grid (Income / Expenses / Net Cash Flow / Savings Rate, each showing actual + "vs budget"), top variances card list ranked by absolute variance with inline progress bars and signed delta, "See all N" toggle)
  - [x] **PR4** — Mobile Budget Graph (`MobileBudgetGraph` page with period pill row + single full-bleed Recharts horizontal grouped bar chart showing top 10 expense categories with Actual + Budget bars, red coloring when actual exceeds budget)
  - [x] **PR5** — Mobile Refresh PS (`MobileRefreshPS` page with "Refresh from PS" trigger button + "Accept all" button + chronological card list of new transactions with per-row Accept pills and optimistic removal; edits/splits/neutralize remain desktop-only)
  - [x] **PR5b** — Tap-to-recategorize on Refresh PS: tappable category text in each row opens `MobileCategoryPicker` (full-screen searchable list of all P&L leaves grouped by Income/Expense/Transfers, with "Recent" group from `localStorage`); selecting a category PATCHes `/api/v2/transactions/:id` with `{Category}` and updates the row optimistically before user taps Accept
- [x] Move Forecast FX Assumptions from Settings `/fx-options` to Forecasting category — now part of FC Settings page (`/fc-settings`)
- [x] Add Transfer Analysis page (`/transfer-analysis`) — match debit/credit transfer pairs by amount within date tolerance, show matched and unmatched transfers by category
- [x] Add Manual Match Groups to Transfer Analysis — persistent many-to-one transfer matching via checkbox selection + "Link as Matched" action, with Unlink capability. DB tables: `transfer_match_groups`, `transfer_match_group_members`. API: `POST/GET/DELETE /api/v2/transfer-match-groups`
- [x] Transfer Matched flag + Actuals filter — `transfer_matched` boolean column on transactions (migration `006`), persisted when Transfer Analysis runs. Transfer Status dropdown (All/Matched/Unmatched) added to Actuals filter panel footer. Link bar shows net base amount of selected transactions (green when zero)
- [x] HierarchyFilter — new two-stage cascading filter component replacing CategorySelector and AccountSelector on Actual and Budget transaction pages. Stage 1 pill buttons for COA hierarchy groups, Stage 2 scrollable checklist with right-click solo-select. Categories split into Income/Expense/Transfers groups; accounts grouped by BS COA hierarchy (Bank Accounts, Investments, Properties, Liabilities, etc.). Transfer Match Status toggle appears contextually only when Transfers group is selected
- [x] Refresh PS: Add inline Date editing (with automatic USD recalculation via implied FX rate), row selection checkboxes, and bulk category assignment for multiple selected transactions
- [x] Forecast: Tax deferral — capital gains tax shifted to following year (Phase 1)
- [x] Forecast: Absolute expense amounts — expense_amount field used for property costs growing at inflation (Phase 1)
- [x] Forecast: Liability interest model — verified working with expense_pct as interest rate (Phase 1)
- [x] Forecast: Seed from Actuals — replaced by "Add from Actuals" tree-based module creation (Phase 2B-4b)
- [x] Forecast: Seed from Budget — replaced by "Add from FC Lines" on Forecast Expenses page (Phase 2B-4)
- [x] Forecast: FC Inc/Exp Mapping Layer (Phase 2B) — global mapping page where user defines FC Lines, assigns budget categories via drag/drop, sets line types (BS Module Expense/Income, Forecast Expense/Income). See `Documentation/FC_Module/FC_MODULE.md` §7 for full design.
  - [x] Phase 2B-1: Database & API foundation (fc_lines, fc_line_categories tables, REST endpoints, 15 tests)
  - [x] Phase 2B-2: FC Mapping Page frontend (drag/drop, multi-select, generate suggestions, coverage bar, budget detail modal)
  - [x] Phase 2B-3: Module Edit integration (FC Line pickers, growth method toggle, allocation tracking, Expense/Income Amount Yr 1)
  - [x] Phase 2B-4: Forecast Expenses integration ("Add from FC Lines" replaces Seed Budget + Coverage)
  - [x] Phase 2B-4b: Add from Actuals ("Add from Actuals" tree view replaces Seed Actuals on Modules page)
  - [x] Phase 2B-5: Engine update (FC Line name map, expense_growth_method inflation/pct_of_value, fc_line_id→label resolution, 40 tests passing)
  - [x] Phase 2B-6: Migration script — SKIPPED (FC data wiped clean for fresh start)
  - [x] Phase 2B-7: Cleanup (removed old endpoints/files/columns, migration 008, 40 tests passing)
- [x] Forecast: Phase 3 — Deposit Rate labeling (IncomePct label contextually shows "Yield / Deposit Rate %" for deposit-type modules)
- [x] Forecast: Phase 4 — Cash Target & Auto-Balance (target_cash on scenarios, post-processing creates Cash Rebalance / Cash Shortfall entries, Target Cash field on Scenarios page)
- [x] Forecast: Phase 5 — Display Enhancements (G7 age tracking with birth year in Settings + age row in Review; G9 equity bridge "Change in Net Worth" collapsible section)
- [x] Forecast: Per-module tax rate override (migration 010, Tax Rate Override field in module edit, engine uses per-module rate when set)
- [x] Forecast: E2E engine test suite — 8 comprehensive tests covering equity/property/fixed-income/liability/incexp/FX/tax-deferral/no-expense scenarios. 49 total automated tests.
- [x] Forecast: FC Settings page (`/fc-settings`) — combines Birth Year, Module Types (configurable list), and FX Assumptions (moved from `/fx-options`)
- [x] Forecast: Module setup status tracking — `setup_status` column (migration 011) on both modules and expenses, color-coded badges (New/In Progress/Complete), table filter, edit dropdown. Engine only generates from "Complete" items for incremental review.
- [x] Forecast: Module Type editable when matched, configurable type list from appdata, capitalized in API response
- [x] Forecast: Review P&L driven by FC Lines — engine writes entries with FC Line names, Review builds P&L from `/fc-lines/review-structure` instead of COA tree. Unified "Taxes" account name.
- [x] Forecast: Base Year / Period terminology standardized — `expense_amount` and `income_amount` are Base Year values (renamed from "Yr 1"). Review base year column shows raw base values from completed modules/expenses via `/api/v2/forecast/base-year-values`.
- [x] Forecast: Engine income logic — Yield Spread (additive over inflation: `effective yield = inflation% + spread%`) takes priority over income_amount for all years where set. Income_amount used only when no yield spread schedule exists (grown at inflation). Base year income generates deferred tax in Period 1. UI renamed from "Income / Yield %" to "Yield Spread" with description "Annual yield above/below inflation (%)".
- [x] Forecast: Engine expense logic — pct_of_value applies derived % from Period 1 (not inflation for P1). Inflation mode compounds from base year for all periods.
- [x] Forecast: Full disposal handling — 50% expense/income in disposal year, 0 after. Full disposal with amount=0 allowed (DB constraint fixed).
- [x] Forecast: FX setup fix — `entry.Rates.PLN`/`EUR` format supported (previously only `USDPLN`/`USDEUR`). Pre-period years use first available FX rate.
- [x] Forecast: Equity bridge inside main table — rows aligned with data columns. Operating = Net Cash Flow - Tax. Capital & Unrealized = residual.
- [x] Forecast: Base year totals — Cash Flow, Net Cash Flow, Income/Expense level-1 totals computed from base year values in Review.
- [x] Forecast: IncomePct year dropdown includes Period 1 (was excluded, preventing user from setting yield for first forecast year).
- [x] Forecast: Module edit Account Value fix — Base Date changed from Dec 13 to Dec 31 year-end; fixed null values displaying as "0.00" instead of "-"; fixed balance lookup for leaf accounts not found at level 2 in COA tree; multi-child accounts now show all child names in scrollable list and sum all children's account values

- [x] Forecast: Exclude status — new `exclude` setup_status option, engine filters out excluded modules/expenses, inline status dropdown on modules table
- [x] Forecast: Module Audit Modal — "View Output" button on module edit shows LC/USD audit trail CSVs via `/api/v2/forecast/audittrail/:scenario/:module/detail` (Cash Sweep tab removed — now standalone modal on Review page)
- [x] Forecast: Cash Sweep — iterative year-by-year engine feature (migrations 012–013). Low/high cash band (`cash_sweep_low`/`cash_sweep_high` on forecast_scenarios, replacing `target_cash`). Excess above high band swept into designated module; shortfalls below low band trigger emergency withdrawal from module's own balance (partial if insufficient). Matching transfer pairs (bank + module sides with equal amounts) for clear entry breakdowns. Prior-years carry-forward (`_sweep_bal`) for cumulative MV adjustment. No yield calculation in sweep — yield computed by normal module engine on adjusted balances. Cash Sweep Summary moved from module View Output tab to standalone modal on Review page (green button in toolbar). Audit CSV columns: Year, Action, Amount, CashBefore, CashAfter, NetModuleEffect. See `cash-sweep.js` for pure computation functions.

### Open Items
- [x] Forecast: Equity bridge formula review — fixed in commit `adbe652`: Operating = Net Cash Flow - Tax, Capital & Unrealized = residual.
- [x] Forecast: Graph Quick Adjustments — double-clicking a data point on the forecast graph opens an inline adjustment modal. FC Exp lines: add/edit periodic changes (Fixed $, Percent %, One-Off $) for the clicked year. FC Modules: edit Invest/Dispose transfers with full context of existing transfers, clicked year highlighted and pre-selected for new rows. Both modals auto-regenerate forecast on save and refresh graph. Pointer cursor on adjustable points; server-side fix for PUT `/incomeexpense/:id` to handle changes-only updates. New components: `FCGraphAdjustModal.jsx`, `FCGraphModuleAdjustModal.jsx`. Server: `FcLineName` field added to GET `/incomeexpense` response; `findIncExpByScenario` query extended with `fc_lines` join.
- [x] Forecast: Income-Sweep Convergence — fixed bug where yield-based income on the cash sweep target module was calculated on pre-sweep market values (growing) while the displayed balance was post-sweep (declining). Added iterative convergence loop (Step 7b in `index.js`) that recalculates income using sweep-adjusted market values, updates tax deltas, recomputes cash flow, and re-runs sweep until converged (maxDelta < $100, typically ~10 iterations). Matches the Excel Goal Seek approach. Generation time ~2s with convergence.
- [x] Forecast: Periodic Adjustments sign-check warning — when editing an Expense-type FC Exp entry, a positive amount on a periodic change now shows an inline warning ("Note: check if correct — expense increases are typically negative numbers") below the amount input in `FCExpModal.jsx`.
- [x] Ledger: Find Duplicates — toggle button flags transactions sharing amount+currency with close dates (≤3 days) or identical descriptions; filter list to duplicates only with count banner (`Ledger.jsx`). Fixed TDZ error ("Cannot access 'S' before initialization") by moving `showDuplicatesOnly` state and `duplicateIds` useMemo above the `searchFiltered` useMemo that depends on them.
- [ ] Forecast: baseYears workaround cleanup — `baseYears` is now properly populated but `value == null` detection pattern still in FCReviewTable. Low-priority cosmetic fix.
- [x] Forecast: Deploy latest code to production — significant changes since last deploy (engine fixes, FX, equity bridge, base year display, cash sweep)
- [ ] Forecast: Frontend test framework — Vitest for testing frontend forecast helpers; currently all 73 tests are backend-only
- [ ] Forecast: Cash Sweep Phase C — multi-module priority-order sweeps (withdraw from multiple modules in priority order on shortfall)
- [x] Forecast: AI Review of FC Plan — full implementation complete. Backend: `aiReview.js` service (context builder with 6 data sources + Claude Sonnet 4.6 API call), `aiReview.js` routes at `/api/v2/ai-review` (create review, follow-up, list, get, delete, auto-apply). Frontend: `FCAIReviewDrawer.jsx` slide-out drawer with conversation sidebar, message bubbles, inline Apply buttons, confirmation modal. FC Settings: AI System Prompt. Auto-apply supports `update_module`, `update_incexp`, `update_scenario` actions. Migration 014 (`fc_ai_reviews`, `fc_ai_messages` tables).
- [x] Forecast: AI Review API key issue resolved — Anthropic API key moved from `appdata.json` to `ANTHROPIC_API_KEY` environment variable (with fallback to `app_data` table). `docker-compose.yml` and `docker-compose.dev.yml` now pass the env var to the server container. `.env` is git-ignored. Model configurable via `ANTHROPIC_MODEL` env var (default `claude-3-haiku-20240307`). "New Review" button issue resolved.
- [x] Forecast: AI Review prompt fix — moved forecast context data from system prompt into the first user message so smaller models (haiku) actually analyze the plan instead of returning generic responses. Added per-review delete buttons (× on hover) in the sidebar. Set drawer z-index above navigation menu (10100/10200). Cleaned up failed review records from database.
- [x] Forecast: Account double-click graph — double-clicking any cell in the Account column (P&L or Balance Sheet) opens the graph modal for that single row. Selects the row and immediately shows the chart.
- [x] Forecast: Graph base year fix — extracted `resolveCashValue()` and `resolveBalanceValue()` helpers in `FCReviewTable.jsx` to resolve display values including base/actual year overlays. Graph series now show correct budget/actual values for base years instead of zero.
- [ ] Forecast: AI Review model upgrade — current API key only has access to `claude-3-haiku-20240307`. When a key with broader access is available, switch `ANTHROPIC_MODEL` to `claude-3-5-sonnet` or newer for higher-quality reviews.
- [x] Forecast: UX improvements — year headers above Balance Sheet in FCReviewTable, sticky top scrollbar for horizontal scrolling, thicker scrollbar (14px), `overscroll-behavior-x: contain` on table wrapper
- [x] Forecast: Editable module Name — Name field is now always editable (free-text input with datalist suggestions from COA children when matched). Previously auto-defaulted to first child name and was read-only.
- [x] Forecast: Periodic dispose transfers — Periodic flag now correctly repeats the disposal amount each year from Start Year to optional End Year (DB column `date_end`, migration 015). Engine caps each year's disposal at available market value so balances never go negative. UI shows Type first, then Start Year, End Year (optional), and Amount/Year. Multiple periodic entries supported for start/stop windows.
- [x] Forecast: Net Assets row + bar chart — "Net Assets" (Assets − Liabilities) summary row above Balance Sheet section in FCReviewTable. Double-clicking opens stacked bar chart with per-account breakdown (leaf accounts only, liabilities shown as negative). HTML tooltip shows account values and total for hovered year. New `totalLiabilitiesByYear`, `netAssetsByYear`, and `netAssetsAccountBreakdown` computed values in FCReview.jsx. Graph modal supports `chartMode="bar"` prop.
- [ ] Add way to re-export changes back to PocketSmith
- [x] Forecast: Yield Spread — renamed "Income / Yield %" to "Yield Spread" with additive inflation formula (`effective yield = inflation% + spread%`). 0% spread = inflation-only yield. UI shows subtitle "Annual yield above/below inflation (%)". Engine detects schedule presence by entry count (not non-zero values). 41 backend tests updated and passing.
- [x] Forecast: Generate button in Edit Module modal — saves changes first, then runs forecast generation, stays on modal so user can immediately View Output. Styled with primary green color.
- [x] Forecast: Generate button on Review page restyled with primary green color for better visibility.
- [x] UI Overhaul: "Mindful Minimalist" design system — complete visual transformation across all 50+ CSS files and chart JSX. Warm cream background (`#FDFCF8`), muted forest green accent (`#6B8E6B`), Outfit font (Google Fonts), elevation-based depth (soft shadows instead of borders), generous 1.5x whitespace, 24px rounded containers, organic muted chart palette, borderless cards/panels/modals/toasts, unDraw SVG illustrations for empty states (8 variants wired into 14 components). Phases: (1) design tokens + typography, (2) layout + navigation, (3) component restyling, (4) icons — skipped (Lucide already rounded), (5) chart visualization, (6) empty states + polish.
- [x] Opening Balance Calibration — accurate balance sheet via `opening_balance + SUM(transactions)` instead of PocketSmith's stale `closing_balance`. Migration 016 adds `opening_balance`, `opening_balance_date`, `last_calibrated_at`, `ps_transaction_account_id` to accounts table. Three new API endpoints: `POST /api/v2/accounts/map-ps-accounts` (maps PS transaction account IDs), `POST /api/v2/accounts/calibrate` (back-calculates opening balances using PS API `current_balance` as authoritative anchor, with closing_balance fallback for unmapped accounts), `GET /api/v2/accounts/calibration-status` (calculated vs PS comparison). Balance Calibration section added to ProgramSettings page. REST helpers in `rest.js`. 16 integration tests covering calibration logic, balance calculation at multiple dates, recalibration after data changes, and edge cases.
- [x] FX Rate Auto-Refresh — exchange rates kept current via two mechanisms: (1) PS sync (`POST /ingest-ps/refresh-ps`) auto-refreshes all non-USD rates from Frankfurter API after syncing, (2) balance sheet report auto-detects stale rates (> 3 days) and refreshes on-demand. Shared utility `refreshExchangeRates.js`. Frankfurter API URL updated from `api.frankfurter.app` to `api.frankfurter.dev/v1` with redirect following.
- [x] Forecast: IncExp form improvements — (1) Account dropdown fixed: `useFCExpAccountHierarchy` hook rewritten to parse `{ name, children }` tree format from `getNestedTree()` (was extracting literal key "name" instead of account names). Now correctly shows COA Level 2 categories. "Select account..." disabled placeholder added. (2) Type field changed from free-text input to dropdown with Income/Expense options. (3) Exclude status option added to IncExp edit modal (matching Modules), with red badge in table.
- [x] Forecast: Periodic invest transfers — Periodic flag now correctly repeats the investment amount each year from Start Year to optional End Year (DB column `date_end`, migration 017). Previously only the first year was applied. Engine invest logic now mirrors the dispose periodic expansion. Full stack fix: migration, repository, routes (GET/POST/PUT), data loader, and engine.

---

## 3. Frontend Improvements

Proposals from the original migration plan for future frontend refactoring.

### 3.1 God Components — Completed (v2.0.9)

All four god components have been refactored:

| Component | Before | After | What Changed |
|-----------|--------|-------|--------------|
| `BudgetInput.jsx` → `BudgetWorksheetV2.jsx` | 762 | ~500 | Fully redesigned: two-panel layout (balance table + entry form sidebar always visible), compact toolbar with collapsible filters and active chips, KPI cards, right-click category quick-pick popover, budget year from Program Settings. Old `BudgetInput.jsx` retained but unused. |
| `FCExpSetup.jsx` | 869 | 159 | Extracted 4 hooks: `useFCExpAssumptions`, `useFCExpAccountHierarchy`, `useFCExpEntries`, `useFCExpCrud` |
| `TransActual.jsx` | 393 | ~590 | Fully redesigned with inline filters, search bar, KPI cards, contextual selection bar, split drawer, and shared `TransactionExplorer.css`. Self-contained page (no separate filter component). |
| `TransBudget.jsx` | 295 | ~530 | Fully redesigned matching TransActual pattern. Budget-specific: category groups, "this-year" default, no split/neutralize. Shares `TransactionExplorer.css`. |

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
| ~~`<FilterPanel>`~~ | 4+ places | Partially addressed: Budget Worksheet now uses `HierarchyFilter` (pill-style with counts + checklist) for categories and accounts, matching Actual Transactions page. Budget Transactions uses `CategorySelector` + `AccountSelector`. All share `PeriodSelector` in collapsible layout. |
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
├── components/          # Shared UI (Layout, NavigationMenu, Breadcrumbs, Footer, Toast, LoadingSpinner, EmptyState, KpiCards, HierarchyFilter, CategorySelector, PeriodSelector, AccountSelector)
├── features/            # Domain-specific feature modules
│   ├── Transaction/     # ✅ Unified actual + budget + review (config-driven: ACTUAL_CONFIG, BUDGET_CONFIG, REVIEW_CONFIG; shared hooks, components, utils; TransactionFilterActual + TransactionFilterBudget with PeriodSelector/CategorySelector/AccountSelector)
│   ├── BudgetEntry/     # ✅ Budget worksheet (hooks: useFilterOptions, useBalanceData, useCurrencyData, useBudgetEntrySubmit)
│   ├── Forecast/        # ✅ Scenarios, modules, assumptions (hooks: useFCExpAssumptions, useFCExpAccountHierarchy, useFCExpEntries, useFCExpCrud)
│   ├── Balances/        # Balance sheet components
│   ├── Budgets/         # Budget realization
│   ├── CashFlow/        # Cash flow reports
│   ├── Charts/          # Chart components
│   ├── COAManagement/   # COA CRUD — tree view with toolbar, inline row actions (edit, delete, add child, move), quick-add, move modal
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
| ~~Empty states~~ | ~~Inconsistent messages~~ | ~~Unified `<EmptyState>`~~ — **Done:** `EmptyState` component with 8 unDraw illustration variants (void, no-data, empty, wallet, finance, searching, upload, ai-review). Wired into 14 pages/components. |
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
| 2026-03-28 | **Budget Worksheet filters switched to HierarchyFilter:** Replaced `CategorySelector` and `AccountSelector` in the Budget Worksheet collapsible filter panel with `HierarchyFilter` pill-style components, matching the pattern used on Actual and Budget transaction pages. Category pills: All / Income / Expense / Transfers with leaf counts and drill-down checklist. Account pills: BS COA hierarchy groups (Bank Accounts / Fidelity Stock / CVC Investments / Properties / Liabilities sub-groups etc.) with leaf counts and drill-down checklist. Filter footer now has Reset + Apply buttons. `CategorySelector` retained only for the right-click category quick-pick popover. Modified: `BudgetWorksheetV2.jsx`. |
| 2026-04-04 | **Graph Quick Adjustments (FC Exp + FC Module):** Double-clicking a data point on the forecast line chart opens an inline adjustment modal. **FC Exp lines:** `FCGraphAdjustModal` — add/edit periodic changes (Fixed $, Percent %, One-Off $) for the clicked year; pre-populates if change exists. **FC Modules (Balance Sheet):** `FCGraphModuleAdjustModal` — loads full module data via GET `/modules/:id`, shows Invest and Dispose transfer sections with existing transfers; clicked year highlighted, new rows default to clicked year. Both modals: Save & Regenerate button triggers PUT → generate → reload → graph refresh (graph stays open). `graphSeries` enriched with `hasModule` flag for pointer cursor on adjustable points. Lookup maps: `fcExpByLabel` (FC Line name → FC Exp entries) and `fcModulesByLabel` (BS level 2 label → FC Modules via `balanceAccountMap`). Server: `FcLineName` added to GET `/incomeexpense` response (`fc_lines` JOIN in `findIncExpByScenario`); PUT `/incomeexpense/:id` fixed to handle changes-only updates (no main fields) via `findIncExpById` fallback. `selectedSeries` values auto-refresh when `entryMaps` changes. New files: `FCGraphAdjustModal.jsx`, `FCGraphAdjustModal.css`, `FCGraphModuleAdjustModal.jsx`, `FCGraphModuleAdjustModal.css`. Modified: `FCReviewTableGraphModal.jsx` (onPointDoubleClick prop, pointer cursor), `FCReview.jsx` (state, handlers, modal rendering), `forecast.js` (routes + repo). |
| 2026-04-04 | **Income-Sweep Convergence Fix:** Fixed bug where yield-based income on the cash sweep target module was calculated on pre-sweep market values (growing steadily) while the displayed balance included sweep adjustments (declining). Root cause: modules process in parallel (Step 6), writing income before sweep runs (Step 7). Added Step 7b iterative convergence loop in `index.js`: (1) load sweep-adjusted MV from `_cash_sweep`/`_sweep_bal` entries, (2) recalculate income using adjusted avg MV × effective yield, (3) compute income/tax deltas and UPDATE entries (preserving realized gain tax), (4) recompute Bank Accounts cash deltas, (5) re-run `computeCashSweepIterative()`, (6) repeat until maxDelta < $100 (~10 iterations). Mirrors the Excel Goal Seek approach for circular income↔sweep dependency. Yield now correctly tracks balance (e.g., consistent 7.00% across all years). Generation time ~2s with convergence. Modified: `index.js`. |
| 2026-03-28 | **FC Module Phase 2B-5 Engine Update:** Updated forecast engine to support FC Line system. `index.js`: preloads FC Line name map (id → name), resolves `expense_fc_line_id`/`income_fc_line_id` to entry labels, passes map through `loadModulesForScenario` and `loadCategoriesForScenario`. `fcbuilder-module.js`: `processModule` now accepts `fcLineNameMap`, implements `expense_growth_method` with two modes — `inflation` (absolute amount compounded at inflation, default) and `pct_of_value` (derives implicit % from expense_amount/market_value, applies to average MV each year). Skips expense generation when `expense_fc_line_id` field exists but is null (user selected "None"). Legacy `expense_pct` fallback preserved for backward compatibility. 6 new tests (T5.1-T5.6), 40 total tests passing. Modified: `fcbuilder-module.js`, `index.js`, `fcbuilder-module.test.js`. |
| 2026-03-29 | **Ledger category filter + amount total:** Added category filter dropdown to the Ledger filter panel — populated from loaded transactions, filters client-side. Added total Amount display in the table footer showing the sum for all currently filtered/displayed transactions. Modified: `Ledger.jsx`, `Ledger.css`. |
| 2026-03-28 | **FC Module Phase 2B-4b Add from Actuals:** Replaced "Seed from Actuals" with "Add from Actuals" on Modules page. New `POST /forecast/modules/add-from-actuals` endpoint returns BS account tree with year-end balances, excluding Bank Accounts subtree and accounts already used as modules in the scenario (including children of matched parent accounts). New `FCAddFromActualsModal.jsx` with tree view featuring expand/collapse, leaf pre-selection, parent aggregation toggle. Creates modules with balances pre-filled. Old `seed-from-actuals` endpoint and `FCSeedFromActualsModal.jsx` deleted. Modified: `forecast.js` (routes), `FCModuleManage.jsx`. New: `FCAddFromActualsModal.jsx`. Deleted: `FCSeedFromActualsModal.jsx`. |
| 2026-03-28 | **FC Module Phase 2B-4 Forecast Expenses Integration:** "Add from FC Lines" button replaces "Seed Budget" and "Coverage" buttons on Forecast Expenses page. New `FCAddFromLinesModal.jsx` shows Forecast Expense/Income lines with budget totals, creates income/expense items with budget pre-fill, base date, `fc_line_id`, `budget_source_year`. Old `FCSeedFromBudgetModal` and `FCCoverageCheckModal` removed from imports. Modified: `FCExpFilter.jsx`, `FCExpSetup.jsx`. New: `FCAddFromLinesModal.jsx`. |
| 2026-04-02 | **AI Review API key security fix:** Moved Anthropic API key from `appdata.json` to `ANTHROPIC_API_KEY` environment variable. Server reads key from env var with fallback to `app_data` database table. `docker-compose.yml` and `docker-compose.dev.yml` now pass `ANTHROPIC_API_KEY` to the server container. `appdata.json` no longer stores the key. `.env` added to `.gitignore`. Model now configurable via `ANTHROPIC_MODEL` env var (defaults to `claude-3-haiku-20240307`). "New Review" button issue resolved. |
| 2026-04-03 | **Global DATE timezone fix:** Fixed one-day date shift affecting Budget Realization drilldown, Budget Worksheet popups, Balance pages, and date helpers. Root cause: `pg` library returned PostgreSQL DATE columns as JS `Date` objects (timezone-shifted on JSON serialization), and several frontend components used `.toISOString().split("T")[0]` on local-time Date objects (shifting dates back one day in UTC+ timezones). Backend fix: added `types.setTypeParser(1082, val => val)` in `postgres.js` so DATE values return as plain `YYYY-MM-DD` strings. Frontend fixes: `BudgetDetailModal.jsx` `formatDateParam` switched from `.toISOString()` to local-time `getFullYear()`/`getMonth()`/`getDate()`; `BudgetEntriesBudgetPopup.jsx` date params fixed same way; `dateHelpers.js` `getToday()` now uses `formatLocalDate()`; `Balance.jsx` and `BalanceV2.jsx` `getToday()` switched to local-time formatting. Modified: `postgres.js`, `BudgetDetailModal.jsx`, `BudgetEntriesBudgetPopup.jsx`, `dateHelpers.js`, `Balance.jsx`, `BalanceV2.jsx`. |
| 2026-04-02 | **AI Review UX fixes:** Moved forecast context data from system prompt into first user message for reliable processing by smaller models. Added per-review delete buttons (× with red hover) in sidebar. Set drawer z-index to 10100/10200 (above navigation menu at 10001). Cleaned up failed review records. Modified: `aiReview.js` (service), `FCAIReviewDrawer.jsx`. |
| 2026-04-02 | **Account double-click graph:** Double-clicking any Account column cell in the FC Review table opens the graph modal for that single row. New `onAccountDoubleClick` prop on `FCReviewTable`, `handleAccountDoubleClick` handler in `FCReview.jsx`. Account cells show pointer cursor. Modified: `FCReviewTable.jsx`, `FCReview.jsx`. |
| 2026-04-02 | **Graph base year fix:** Extracted `resolveCashValue()` and `resolveBalanceValue()` helpers in `FCReviewTable.jsx`. These apply base-year budget overlays and actual-year overlays to raw `getCellValue()` results, fixing a bug where graph series showed zero for base/actual years. The same helpers are used for both table cell display and graph `rowValues` (previously only table cells applied overlays). Eliminated ~40 lines of duplicated overlay logic from the cell render. Modified: `FCReviewTable.jsx`. |
| 2026-03-28 | **Unmatched modules endpoint fix:** Updated `GET /forecast/modules/unmatched` to exclude children of matched parent accounts (e.g., if "Fidelity Stock" is matched as a module, its children like "AAPL", "MSFT" are no longer shown as unmatched). Moved matched-name lookup before leaf collection so `collectLeaves` can track ancestor match state. Modified: `forecast.js` (routes). |
| 2026-03-27 | **Manual Match Groups for Transfer Analysis:** Added persistent many-to-one transfer matching to `/transfer-analysis` page. Users can select 2+ unmatched transactions via checkboxes across categories and link them as a match group (e.g., one lump 200k PLN credit matching five split debits). Linked groups appear in an auto-expanded "Manually Matched Groups" section with debit/credit totals, net amount, and an Unlink button. Sticky action bar appears when 2+ rows are selected, showing selection count, net base amount (green when zero, light red otherwise), Link as Matched, and Clear buttons. Manually matched transactions are excluded from the auto-matching algorithm. New DB tables: `transfer_match_groups`, `transfer_match_group_members` (migration `005_transfer_match_groups.sql`). New API: `POST/GET/DELETE /api/v2/transfer-match-groups`. New files: `transferMatchGroups.js` (repository + route). Modified: `transactions.js` (route — transfer-analysis endpoint), `TransferAnalysis.jsx`, `TransferAnalysis.css`, `repositories/index.js`, `routes/index.js`. |
| 2026-03-27 | **Transfer Matched flag + Actuals Transfer Status filter:** Added `transfer_matched` boolean column to transactions table (migration `006_transfer_matched_flag.sql`, partial index). Transfer Analysis endpoint now persists this flag as a side effect — `true` for auto-matched pairs and manual group members, `false` for unmatched transfers. Added `transferMatched` query parameter to `GET /api/v2/transactions` for server-side filtering. Row transform includes `TransferMatched` field. Modified: `transactions.js` (repository — `findAllExtended`, `updateTransferMatchedFlags`; route — GET `/` and transfer-analysis), `transactionConfig.js` (row transform + buildFilterQuery). |
| 2026-03-27 | **HierarchyFilter component — cascading category/account filters:** New shared component `HierarchyFilter/HierarchyFilter.jsx` replaces `CategorySelector` and `AccountSelector` on Actual and Budget transaction pages. Two-stage design: Stage 1 pill buttons for COA hierarchy groups (Categories: All/Income/Expense/Transfers; Accounts: Bank Accounts/Fidelity Stock/CVC Investments/Properties/Liabilities sub-groups etc.), each showing item count. Stage 2 compact scrollable checklist of leaf items under the active group — all checked by default, uncheck to narrow. Right-click any item to solo-select (deselects all others). Transfer Match Status toggle (All/Matched/Unmatched) appears contextually only when the Transfers category group is active, replacing the previous always-visible dropdown. Props: `groups`, `onSelectionChange`, `onGroupChange`, `extraSlot`, `label`. New files: `HierarchyFilter.jsx`, `HierarchyFilter.css`. Modified: `TransActual.jsx`, `TransBudget.jsx` (replaced CategorySelector/AccountSelector with HierarchyFilter, new group derivation from plTree/bsTree, new handler functions). |
| 2026-03-26 | **Balance Sheet page redesign:** Completely redesigned `/balance` page (`BalanceV2.jsx`, `BalanceV2.css`). Added KPI cards for Net Worth (highlighted with primary gradient), Total Assets, and Total Liabilities. Replaced `BalanceDateSelector` toolbar component with inline period controls in a compact toolbar bar — period count dropdown, P1/P2/P3 badges with date pickers, Generate button with refresh icon, expand/collapse as compact icon buttons (ChevronDown/ChevronUp), and Export button. Removed separate title/description header section. Reuses existing `BalanceReport` component (tree table with sticky columns, resizable account column, row highlighting, path-based collapse, Net Worth footer). Auto-generates report on page load. Old `Balance.jsx` retained but unused. |
| 2026-03-26 | **Budget Worksheet page redesign:** Completely redesigned `/budget-worksheet` (`BudgetWorksheetV2.jsx`, `BudgetWorksheetV2.css`). Replaced tabbed Balances/Entry layout with two-panel side-by-side layout: balance comparison table (left) and budget entry form (right sidebar, sticky). Both always visible — no more tab switching. Compact toolbar with collapsible filter panel (PeriodSelector, CategorySelector, AccountSelector), active filter chips with one-click removal, Reset button. KPI cards for Total Actual, Total Budget, Difference. Balance table preserves double-click drill-down on Actual/Budget cells (reuses existing popup modals). Entry form streamlined with Month/Currency row, Account selector, Amount with math expression support, auto-calculated Base Amount, derived Category display. Right-click context menu on category chip/badge opens floating CategorySelector popover for quick category switching without opening filters. Budget year now defaults from Program Settings (`defaultBudgetYear`) instead of hardcoded `BUDGET_YEAR_OPTIONS[2]`. Reuses all existing hooks (`useFilterOptions`, `useBalanceData`, `useCurrencyData`, `useBudgetEntrySubmit`) and popup components (`BudgetEntriesAtualPopup`, `BudgetEntriesBudgetPopup`, `BudgetExpenseSignModal`). Old `BudgetInput.jsx` retained but unused. |
| 2026-03-26 | **COA Management page redesign + Move feature:** Completely redesigned `/coa-management` from scratch. Replaced sidebar filter panel (`COAManagementFilters.jsx`) with a horizontal toolbar (`COAManagementToolbar.jsx`) containing search, filter controls, and Add button. Replaced flat table (`COAManagementTableSection.jsx`) with a tree view (`COATreeTable.jsx`, `COATreeRow.jsx`) featuring expand/collapse chevrons for hierarchy navigation. Added inline row actions on hover (edit, delete, add child, move) for faster workflows. Added "Add as category" toggle in the Add modal so categories can be created at any point in the hierarchy (not just via quick-add). Category picker now shown in regular add mode. **Move account feature:** New `COAMoveModal.jsx` with full-tree category picker allows re-parenting accounts under any node (including leaf accounts that aren't yet categories). Uses existing `POST /api/v2/util/coa/add` endpoint which re-parents when it finds an existing account under a different parent. Client-side validation prevents same-parent moves. **Category picker enhancement:** `COACategoryPicker.jsx` now accepts `includeAllNodes` prop to show all tree nodes (not just categories with children) and `excludeName` prop to hide the item being moved. Categories shown bold in the picker for visual distinction. Deleted: `COAManagementFilters.jsx`, `COAManagementTableSection.jsx`. Created: `COAManagementToolbar.jsx`, `COATreeTable.jsx`, `COATreeRow.jsx`, `COAMoveModal.jsx`. Modified: `COAManagement.jsx`, `COAEditModal.jsx`, `COACategoryPicker.jsx`, `COAManagement.css`. |
| 2026-03-15 | **Category Trend graph:** Added new `/category-trend` page under Reports & Graphs > Graphs subcategory. Users select one or more income/expense categories and a standard period (YTD, This Year, Last Year, Last 6/12/24 Months), then view a grouped bar chart comparing actual vs budget monthly values. Expense values are displayed as positive for easier visual comparison. New backend endpoint `GET /api/v2/reports/category-trend` accepts `startDate`, `endDate`, and repeatable `category` query params. New REST helper `Rest.fetchCategoryTrend()` in `rest.js`. New files: `CategoryTrend.jsx`, `CategoryTrend.css`. Modified: `routes.jsx`, `rest.js`, `reports.js` (route). |
| 2026-03-26 | **Transaction pages full redesign (Actuals + Budget):** Completely redesigned both `/trans-actual` and `/trans-budget` pages with a modern, cleaner layout. Replaced dense 3-column filter grid with: (1) unified toolbar bar with instant search, filter toggle button with badge count, and export; (2) active filter chips with one-click removal; (3) collapsible filter panel (Period/Categories/Accounts + value range). Replaced separate Previous/Next batch buttons with inline "Load more" in table footer. Added KPI summary cards showing currency totals (income/expenses for multi-currency). Added contextual selection action bar (slide-down animation) that only appears when rows are selected — Edit/Split/Neutralize/Delete. Table redesigned with custom-styled checkboxes, hover row actions (split/neutralize icons), color-coded amounts (green/red), monospace tabular-nums, and cleaner spacing. Split transaction modal replaced with slide-in drawer from right. Both pages share `TransactionExplorer.css` for consistent styling. Budget page retains category group options (Income/Expense/Operational) and "this-year" default period; no split/neutralize. Actual page retains client-side filtering, description search, split, and neutralize. Old `TransactionFilterActual.jsx` and `TransactionFilterBudget.jsx` filter components are no longer used by these pages. New/modified files: `TransActual.jsx` (rewritten), `TransBudget.jsx` (rewritten), `TransactionExplorer.css` (new shared CSS). Removed: `TransActualV2.jsx`, `TransActualV2.css` (merged into main). |
| 2026-03-16 | **Trans-Actual filter & account selector fixes:** (1) Fixed `\u2026` literal text in AccountSelector search placeholder (changed to proper `…` character). (2) Fixed "All" button in AccountSelector to clear individual account selections when clicked (was appending "All" to existing selections). (3) Added "All" option to CategorySelector to clear category filters (styled matching AccountSelector's "All" item). (4) Moved action buttons (Edit, Split, Neutralize, All, Delete, Clear Filters, Export) out of the first filter column into a separate row below the filter grid with a divider border, fixing layout overlap with filter controls. (5) **Leaf-only account filtering:** Added `leafOnly` query parameter to `GET /api/v2/accounts` endpoint and `findAll()` repository function — uses `NOT EXISTS` subquery to exclude parent/grouping nodes that have children (e.g. "Fidelity Fixed Income", "Fidelity Stock", "Bank Accounts"). These nodes have `account_type='asset'` but act as hierarchy parents, not transactable accounts. `fetchAccountsV2()` in `rest.js` now accepts `leafOnly` option. Both `useFilterOptions` and `useTransactionAccountOptions` pass `leafOnly: true` so only leaf accounts appear in account selectors. Modified: `AccountSelector.jsx`, `CategorySelector.jsx`, `CategorySelector.css`, `TransactionFilterActual.jsx`, `TransactionFilterActual.css`, `accounts.js` (repo + route), `rest.js`, `useFilterOptions.js`, `TransactionTable.jsx`. |
| 2026-03-27 | **Day-level date editing in transaction edit modals:** Updated `TransactionDateSelector` to include a Day dropdown alongside Month and Year (previously only Month + Year). Day options dynamically adjust to the number of days in the selected month/year (handles Feb, leap years, 30/31-day months). Day is clamped when switching to a shorter month. Added Date field to Ledger page's `LEDGER_EDIT_CONFIG` so ledger transactions can also have their date edited. Modified: `TransactionTable.jsx` (`TransactionDateSelector`, helper functions), `Ledger.jsx` (`LEDGER_EDIT_CONFIG`). |
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

*Last updated: 2026-04-02*
