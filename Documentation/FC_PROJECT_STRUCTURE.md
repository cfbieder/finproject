# Fin - Personal Finance Manager

## 1. Architecture Overview

```
                        +----------------------------+
                        |       nginx (port 80)      |
                        |   React SPA + API proxy    |
                        +-----------+----------------+
                                    | /api/*
                        +-----------v----------------+
                        |   Express 5 (port 3005)    |
                        |   Node.js Backend          |
                        +-----------+----------------+
                                    |
                        +-----------v----------------+
                        |  PostgreSQL 16 (port 5432) |
                        |  fin database              |
                        +----------------------------+
```

**Three-service architecture (production):** PostgreSQL database, Node.js/Express API server, and nginx-served React SPA. Production services run in Docker containers orchestrated by Docker Compose.

---

## 2. Infrastructure

### VM

| Field | Value |
|-------|-------|
| IP | `192.168.1.87` (DHCP via `enp1s0`) |
| OS | Ubuntu 24.04 LTS (Noble) |
| vCPUs / RAM / Disk | 4 / 8 GB / 77 GB (LVM) |
| User | `cfbieder` (sudo NOPASSWD, SSH key auth) |
| Docker | 29.2.1, Compose v5.1.0 |
| Project path | `/home/cfbieder/psproject` (symlink: `~/Programs/fin` → `~/psproject`) |
| Autostart | Enabled (`virsh autostart fin`) |

### KVM Host

| Field | Value |
|-------|-------|
| IP | `192.168.1.61` |
| Storage Pools | `vm-ssd` (`/mnt/vm-ssd`), `vm-hdd` (`/mnt/vm-hdd`) |
| Cockpit | `https://192.168.1.61:9090` |

All VM images (base, overlay, cloud-init ISO) stored in `/mnt/vm-ssd/` via the `vm-ssd` libvirt pool.

### SSH Access

```bash
ssh cfbieder@192.168.1.87          # VM (primary)
ssh cfbieder@192.168.1.61          # KVM host (VM management only)
```

### Tailscale

- URL: `https://fin.tail413695.ts.net`
- Proxies to: `https+insecure://localhost:5175` (production frontend)
- Auto-starts on boot via systemd

### Access URLs

| Environment | Frontend HTTPS | Frontend HTTP | API | Database |
|-------------|---------------|---------------|-----|----------|
| **Production** | `https://192.168.1.87:5175` | `http://192.168.1.87:3006` | `http://192.168.1.87:3005` | `192.168.1.87:5433` |
| **Production (Tailscale)** | `https://fin.tail413695.ts.net` | - | - | - |
| **Development** | `http://100.94.46.62:5174` | - | `http://100.94.46.62:3105` | `100.94.46.62:5434` |

---

## 3. Tech Stack

### Frontend

| Library | Version | Purpose |
|---------|---------|---------|
| React | 19.2.0 | UI framework |
| Vite | 7.2.4 | Build tool & dev server |
| vite-plugin-pwa | 1.2.0 | PWA support (service worker, manifest, precache) |
| workbox-window | 7.4.0 | Service worker registration & update detection |
| React Router DOM | 7.9.6 | Client-side routing |
| Lucide React | 0.563.0 | SVG icon library |
| Recharts | 2.x | Chart library (KPI sparklines, mini-charts) |
| xlsx (SheetJS) | 0.18.5 | Excel file generation |
| env-cmd | 11.0.0 | Environment management |

**PWA:** Installable Progressive Web App with offline-capable service worker. Cache-first strategy for hashed Vite assets (JS/CSS/fonts) — new builds generate new filenames so the SW detects changes and prompts users to update. API calls are network-only (never cached). Update prompt toast appears when a new version is available. Custom "Install" button in navbar (auto-hides when installed or in standalone mode). Icons: 192px, 512px, Apple Touch 180px. Safe area insets and touch-friendly 44px tap targets for mobile.

**Design System:** "Mindful Minimalist" — warm cream palette (`#FDFCF8`), muted forest green accents (`#6B8E6B`), Outfit font, soft diffused shadows (elevation over borders), generous whitespace (1.5x spacing), rounded geometry (`24px` containers, `12px` buttons), unDraw illustrations for empty states.

### Backend

| Library | Version | Purpose |
|---------|---------|---------|
| Express | 5.1.0 | HTTP framework |
| pg | 8.13.1 | PostgreSQL client |
| Arquero | 8.0.3 | Data transformation |
| danfojs-node | 1.2.0 | DataFrame operations |
| archiver | 7.0.1 | Backup compression |
| pino | 9.6.0 | Structured logging |
| morgan | 1.10.1 | HTTP request logging |

---

## 4. Project Structure

```
psproject/                          # ~/Programs/fin symlinks here
├── components/
│   ├── data/                    # Runtime data files (appdata, PS name mappings, forecast assumptions)
│   └── reports/                 # Generated report output
├── Documentation/               # Project documentation
│   ├── FC_PROJECT_STRUCTURE.md  # This file — current state of the project
│   ├── FC_NEXT_STEPS.md         # Development plan + open work + known issues
│   ├── FC_MODULE_MAPPING.md     # Forecast terminology and data mapping reference
│   ├── CRs/                     # Change Requests — CR_INDEX.md + CR001..CR0NN
│   ├── Guides/                  # Operational guides (GUIDE_BACKUP, GUIDE_RESTORE, GUIDE_TMUX)
│   ├── Testing/                 # Test overview + manual QA checklists
│   └── Archive/                 # Historical documentation (phase reports, old design docs)
├── frontend/                    # React SPA
│   ├── Dockerfile               # Multi-stage build: Vite -> nginx
│   ├── nginx.conf               # API proxy + SPA routing
│   ├── package.json
│   ├── .env-cmdrc               # Environment configurations
│   └── src/
│       ├── App.jsx              # Router, Layout wrapper, lazy routes
│       ├── main.jsx             # Entry point, ToastProvider
│       ├── components/          # Shared UI (Layout, NavigationMenu, Breadcrumbs, Footer, Toast, LoadingSpinner, EmptyState, MonthYearPicker, PeriodCountSelector, HierarchyFilter, CategorySelector, PeriodSelector, AccountSelector)
│       ├── config/routes.jsx    # Central route config (paths, icons, categories)
│       ├── contexts/            # ToastContext, ForecastContext
│       ├── features/            # Feature modules (Balances, BudgetEntry, Budgets, CashFlow, Charts, COAManagement, Database, Forecast, Transaction)
│       ├── hooks/               # Custom React hooks (useAPI, useCoa, useFormState, useModal)
│       ├── utils/               # Shared helpers (formatters, dateHelpers, cashFlowHelpers, forecastHelpers, treeTraversal, excelExporter)
│       ├── js/                  # API helpers (rest.js, handleUpload.js)
│       └── pages/               # Page components (23 pages + category landing)
├── server/                      # Express API server
│   ├── Dockerfile
│   ├── package.json
│   ├── nodemon.json
│   ├── .env-cmdrc
│   ├── db/migrations/           # PostgreSQL schema (001-006: core, 007: fc_lines + fc_line_categories + module FK columns, 008: drop old expense_category/income_category/expense_pct, 009: target_cash on scenarios, 010: tax_rate_override on modules, 011: setup_status on modules + income_expense, 012: cash_sweep_target on modules, 013: cash_sweep_band replacing target_cash on scenarios, 014: ai_reviews, 015: periodic disposal date_end, 016: opening_balance calibration columns on accounts, 018: category_source_mappings, 019: account_source_mappings, 021: collapse `categories` table into `accounts` — P&L leaves carry `is_transfer` and `ps_category_id` directly; FK columns repointed; `categories` and `category_source_mappings` dropped)
│   └── src/
│       ├── server.js            # HTTP server entry point
│       ├── app.js               # Express app config, route mounting
│       └── v2/                  # PostgreSQL-based API (all routes)
│           ├── db/              # PostgreSQL module exports + pool (DATE type parser returns YYYY-MM-DD strings, avoiding timezone shift)
│           ├── routes/          # Route handlers (accounts, aiReview, budget, categories, forecast, health, ingestPs, reports, transactions, transferMatchGroups, util)
│           ├── repositories/    # Data access layer (accounts, budget, budgetFxRates, forecast, psdata, transactions, transferMatchGroups, fcLines, accountSourceMappings)
│           └── services/        # Business logic (psCsvIngestorV2, refreshPsApiV2, aiReview.js — context builder + LLM gateway call, forecast/ engine)
├── Scripts/                     # Shell scripts
│   ├── dev-start.sh             # Start tmux development environment
│   ├── deploy-to-production.sh  # Deploy development changes to production
│   ├── sync-db-prod-to-dev.sh   # Copy production database to development
│   ├── bump-version.sh          # Increment version (patch/minor/major)
│   ├── rebuild-frontend.sh      # Rebuild and restart frontend container
│   ├── provision-vm.sh          # Create 'fin' KVM guest on vmhost
│   ├── deploy-on-vm.sh          # Clone repo + deploy on VM
│   ├── backup-mongo.sh          # Legacy (deprecated)
│   └── restore-mongo.sh         # Legacy (deprecated)
├── Backups/                     # Database backups (git-ignored)
├── certs/                       # TLS certificates (git-ignored)
├── VERSION                      # Current version number
├── docker-compose.yml           # Production: 3 services
├── docker-compose.dev.yml       # Development: postgres-dev + server-dev
└── NOTES.md                     # Quick reference notes
```

---

## 5. Frontend

### Pages & Routes

| Path | Page | Category | Description |
|------|------|----------|-------------|
| `/` | Home | - | Dashboard with quick actions |
| `/upload-ps` | UploadPS | Database | Upload PocketSmith CSV data |
| `/refresh-ps` | RefreshPS | Transactions | Refresh data via PocketSmith API; tabbed view (Review & Edit New / New Transactions / Modified) with inline transaction editing using shared `TransactionTable` + `TransactionEditModal` + `CategorySelector`. Selection checkboxes enabled for multi-select bulk operations. Accept All button in header; bulk Category button appears when rows selected. Per-row action buttons for Category, Split, Neutralize, and Accept. Clickable Date, Description, and Category cells open edit modals. **Date edit:** Click date cell to open modal with `<input type="date">`, saves via `PATCH /api/v2/transactions/:id`. When the date changes and the transaction currency differs from base currency, the server automatically recalculates `base_amount` using an implied FX rate derived from a nearby transaction (same currency, ±3 days, largest amount for stability). Toast shows old → new USD amount and the implied rate. **Bulk Category:** Select multiple rows via checkboxes, click "Category (N)" button to assign same category to all selected. **Split:** Per-row button opens a modal to divide the original amount across 2-5 entries with optional category selection. Uses `POST /api/v2/transactions/:id/split`. **Neutralize:** Per-row button creates an offsetting entry for brokerage security trades (cash-for-shares exchange). Both transactions categorized as "Transfer - Securities Trades" and marked accepted. Uses `POST /api/v2/transactions/:id/neutralize`. |
| `/backup-database` | BackupDatabase | Database | Download database backup |
| `/budget-worksheet` | BudgetWorksheetV2 | Budgeting | Redesigned budget worksheet with two-panel layout: balance comparison table (left) and budget entry form (right sidebar) always visible simultaneously. Compact toolbar with collapsible filter panel using **HierarchyFilter** pill-style components for categories (All/Income/Expense/Transfers with counts + checklist) and accounts (BS COA hierarchy groups with counts + checklist), matching the transaction pages filter pattern. PeriodSelector for date range. Reset + Apply buttons in filter footer. Active filter chips with one-click removal. KPI cards for Total Actual, Total Budget, and Difference. Balance table with double-click drill-down on Actual/Budget cells (opens existing popup modals for viewing/editing entries). Entry form auto-fills category from filter selection, supports math expressions in amount field (e.g. "100+50"), auto-calculates base amount via FX rates, and handles "All" months batch entry. Right-click context menu on category chip/badge/field opens floating CategorySelector popover for quick category switching without opening filters. Budget year defaults from Program Settings. Expense sign modal warns when positive amounts entered for expense categories. |
| `/budget-realization` | BudgetRealization | Budgeting | Budget vs actual comparison with KPI summary cards (Income, Expenses, Net Cash Flow, Savings Rate) |
| `/budget-graph` | BudgetRealizationGraph | Budgeting | Visual budget analysis |
| `/budget-variances` | BudgetVariances | Budgeting | Line items ranked by largest variance |
| `/budget-fx` | BudgetFX | Budgeting | Monthly budget FX rates per currency per year. Year selector, 12-month table with double-click editing, per-month Recalculate from average actual FX with preview modal. Uses `budget_fx_rates` DB table. |
| `/forecast-mapping` | FCLineMapping | Forecasting | Step 1 — FC Inc/Exp Mapping. Define FC Lines, assign budget categories via drag/drop (Ctrl+Click multi-select), set line types. "Generate Suggestions" opens selectable checklist of P&L parent accounts (only shows names not yet created). Independent scroll panels. Coverage bar, budget totals, category detail modal. Unassigned list excludes children of assigned parents (recursive CTE). |
| `/forecast-scenarios` | FCScenarios | Forecasting | Step 2 — Manage forecast scenarios. "+ New Scenario" immediately prompts for name. Target Cash field for auto-balance. Copy scenario with optional "Update base values from actuals" checkbox. |
| `/forecast-modules` | FCModuleManage | Forecasting | Step 3 — Configure BS modules. "Add from Actuals" creates modules from year-end balances (Select All/Clear). Setup status (New/In Progress/Complete) with color-coded badges and filter — only "Complete" included in generation. Edit form: Account read-only when matched; Name always editable (datalist suggestions from COA children when matched); Type from configurable list (FC Settings); Expense/Income Line pickers (FC Lines); Expense Amount (Base Yr) and Income Amount (Base Yr); Growth (x Inflation); Expense Growth method (Inflate / % of Asset Value); Yield Spread schedule (year + percentage, "Annual yield above/below inflation (%)"); Tax Rate Override (%); Invest/Dispose arrays with transfer flags (OneTime/Periodic/Full); Periodic transfers show Start Year, optional End Year, and Amount/Year; Full disposal handling. Generate button in edit modal footer (saves changes first, then runs forecast generation, stays on modal for View Output). `GET /modules/:id` loads nested arrays. |
| `/forecast-setup-exp` | FCExpSetup | Forecasting | Step 4 — Income/expense forecast items. "Add from FC Lines" with budget pre-fill. Account/Name/Type locked for FC Line items. Base Value = BaseYear budget amount. Setup status (New/In Progress/Complete/Exclude) with filter — only "In Progress" and "Complete" in generation. Account dropdown with "Select account..." placeholder (COA Level 2 categories). Type dropdown (Income/Expense). Engine starts from PeriodStart (BaseYear P&L covered by budget). |
| `/forecast-review` | FCReview | Forecasting | Step 5 — Review generated forecasts. P&L driven by FC Lines (`/fc-lines/review-structure`). Three column types: LastActualYear "(Actual)" from ledger, BaseYear "(Budget)" P&L from budget + BS from engine, PeriodStart+ from FC engines. Invest/Dispose transfers available from BaseYear onward. Equity bridge rows inside main table. KPI cards, age row, graph, cash target auto-balance. Year headers above Balance Sheet section. AI Review button (purple, BrainCircuit icon) opens `FCAIReviewDrawer` slide-out drawer for AI-powered plan review. Sticky top scrollbar for horizontal scrolling, thicker scrollbar (14px), `overscroll-behavior-x: contain`. |
| `/fc-settings` | FCSettings | Forecasting | FC Settings — Birth Year (age row in Review), Module Types (configurable dropdown list), FX Rate Assumptions (moved from old `/fx-options`), and AI System Prompt (textarea with default). AI system prompt stored in `app_data`. AI Review now routes through the local `ocr-llm` gateway (task `finance_plan_review`, heavy → mid local-only); no public-cloud LLM key required. |
| `/balance` | BalanceV2 | Reports & Graphs | Redesigned balance sheet. KPI cards for Net Worth (highlighted), Total Assets, Total Liabilities. Compact toolbar with inline period controls (1-3 periods with P1/P2/P3 badges + date pickers), Generate button, expand/collapse icon buttons, and Export. Reuses existing `BalanceReport` component for the hierarchical account tree table with sticky headers/columns, resizable account column, row highlighting, path-based collapse state, and Net Worth footer row. Auto-generates report on page load. |
| `/balance-trends` | BalanceTrends | Reports & Graphs | Month-end USD balance trend for selected balance sheet accounts. BS COA `HierarchyFilter` (Bank Accounts, Fidelity Stock, …) with right-click solo-select. Single-period `PeriodSelector` (presets + Custom, no Transfers/Unrealized, budget year hidden). Table: accounts as rows × month-ends as columns; sticky first column and header; native-currency badge per account; USD-only values; Total (selected, USD) footer row. Negative values rendered in red. Excel export. Auto-generates on mount; empty state until at least one account is selected. |
| `/cash-flow` | CashFlow | Reports & Graphs | Cash flow P&L analysis |
| `/cash-flow-monthly` | CashFlowMonthly | Reports & Graphs | Monthly cash flow breakdown |
| `/balance-chart` | BalanceChart | Reports & Graphs | Net worth chart over time |
| `/category-trend` | CategoryTrend | Reports & Graphs | Grouped bar chart comparing actual vs budget monthly values for selected income/expense categories over a standard period (YTD, This Year, Last Year, Last 6/12/24 Months). Expense values displayed as positive for visual comparison. |
| `/trans-actual` | TransActual | Transactions | Redesigned transaction explorer. KPI summary cards (per-currency totals, income/expenses). Unified toolbar with instant search bar, collapsible filter panel with **HierarchyFilter** components for categories and accounts. **Category HierarchyFilter:** Two-stage cascading filter — Stage 1 pill buttons (All / Income / Expense / Transfers), Stage 2 scrollable checklist of leaf categories under the active group. All items selected by default when a group is chosen; uncheck individual items to narrow. Right-click any item to solo-select (deselects all others). When Transfers group is active, a contextual **Match Status** toggle appears (All / Matched / Unmatched) filtering by `transfer_matched` flag. **Account HierarchyFilter:** Same pattern using BS COA hierarchy — pills for Bank Accounts, Fidelity Stock, CVC Investments, US/SP/PL Properties, Liabilities sub-groups, etc. Active filter chips with one-click removal. Contextual selection bar appears on row selection (Edit, Split, Neutralize, Delete). Clean table with custom checkboxes, hover row actions (split/neutralize icons), color-coded amounts, monospace tabular-nums. Split uses slide-in drawer instead of modal. Client-side filtering for period, account, category, description, value range. Shares `TransactionExplorer.css` with TransBudget. **Split:** `POST /api/v2/transactions/:id/split`. **Neutralize:** `POST /api/v2/transactions/:id/neutralize`. |
| `/trans-budget` | TransBudget | Transactions | Redesigned budget transaction explorer matching TransActual pattern. KPI summary cards, toolbar with search/filters/export, collapsible filter panel with **HierarchyFilter** components for categories (Income / Expense / Transfers) and accounts (COA hierarchy groups). Same two-stage cascading filter pattern as TransActual with right-click solo-select. Contextual selection bar (Edit, Delete — no split/neutralize). Default period: full year. Edit modal supports all fields (Date, Description, Amount, Currency, BaseAmount, Account, Category). Shares `TransactionExplorer.css` with TransActual. |
| `/transfer-analysis` | TransferAnalysis | Transactions | Transfer matching analysis. Select a period via PeriodSelector, then analyze all transfer-category transactions. Matches debit/credit pairs by same absolute base_amount within 5-day tolerance. Shows summary cards (matched pairs, manual groups, unmatched count/totals), collapsible category sections with matched pairs table (debit + credit side-by-side) and unmatched transactions table with checkboxes for manual matching. **Manual Match Groups:** Users can select 2+ unmatched transactions across categories and link them as a persistent match group (e.g., one lump credit matching multiple split debits). Linked groups appear in an auto-expanded "Manually Matched Groups" section with debit/credit totals, net amount, and an Unlink button. Sticky action bar appears when 2+ rows are checked, showing selection count, net base amount (green when zero, red otherwise), Link as Matched button, and Clear button. **Transfer Matched Flags:** Running analysis persists `transfer_matched` boolean on all transfer transactions in the period (true for auto-matched + manual groups, false for unmatched), enabling the Transfer Status filter on the Actuals page. **Change Transfer Type:** Clicking any transaction row (matched, unmatched, or manual group) opens a modal to reassign its transfer category. For matched pairs, both transactions are updated; for unmatched, only the clicked transaction; for manual groups, all group members. Uses existing `PATCH /api/v2/transactions/:id` with `category_id`. Uses `GET /api/v2/transactions/transfer-analysis`, `POST/DELETE /api/v2/transfer-match-groups`. |
| `/ledger` | Ledger | Transactions | Account ledger report with running balance. Dynamic cascading dropdown selectors follow the COA hierarchy (Type → Group → Sub-Group → Account) adapting to variable tree depth (3 or 4 levels). Prominent blue account banner shows selected account name, currency badge, and record count. Collapsible filter panel with optional period filter (PeriodSelector) and **category filter** dropdown (populated from loaded transactions, filters client-side). Toolbar with search, Add transaction (slide-in drawer with date/description/amount/currency/category fields, posts `POST /api/v2/transactions` with `source:'manual'`), **Find Duplicates** (client-side analysis identifies potential duplicates by same amount & currency within 3-day window or identical description; toggles to filtered view with warning banner showing count), and Export. Table with checkbox selection, sortable columns (Date, Description, Amount, Ccy, Category, Balance), bulk edit (description/category) and delete via selection bar. Running balance computed client-side from chronological order. **Total Amount** displayed in table footer for currently filtered transactions. Uses `LEDGER_CONFIG`/`LEDGER_EDIT_CONFIG` in `transactionConfig.js` and reuses `GET /api/v2/transactions` with account filter. |
| `/balance-calibration` | BalanceCalibration | Transactions | Standalone page for calibrating account opening balances to ensure Balance Sheet accuracy. Maps PocketSmith transaction accounts, then back-calculates opening balances from the most recent known closing balance. Three action buttons: Map PocketSmith Accounts, Load Status, Calibrate All. Status table shows account-level comparison (Calculated vs PocketSmith balance, difference, last calibrated date, PS mapped status) with per-row Recalibrate button for accounts with differences. Uses `Rest.mapPsAccounts()`, `Rest.fetchCalibrationStatus()`, `Rest.calibrateAccounts()`. |
| `/fx-options` | FXOptions | Forecasting | Forecast FX assumptions (budget rates at `/budget-fx`) |
| `/coa-management` | COAManagement | Settings | Chart of accounts CRUD with tree view (expand/collapse hierarchy), horizontal toolbar (search, filters, add), inline row actions on hover (edit, delete, add child, move), PS analysis, quick-add for accounts and categories. "Add as category" toggle in Add modal for creating categories anywhere in the hierarchy. Move modal with full-tree category picker to re-parent accounts under any node. Components: `COAManagementToolbar.jsx`, `COATreeTable.jsx`, `COATreeRow.jsx`, `COAEditModal.jsx`, `COAMoveModal.jsx`, `COACategoryPicker.jsx`. |
| `/program-settings` | ProgramSettings | Settings | Application preferences (default budget year) |

### Navigation

Category landing pages instead of dropdowns. Each category has a landing page at `/<category-slug>` showing feature cards with Lucide icons. Generated from `routes.jsx` via `getCategoryRoutes()`.

### State Management

- **React Context**: `ToastContext` (global toasts), `ForecastContext` (forecast state shared across FC pages)
- **Local state**: Page-level `useState`/`useCallback` for form state, loading, and API responses
- **Shared hooks** (`hooks/`): `useAPI` (API call management with loading/error states), `useCoa` (Chart of Accounts data and derived category/account maps), `useFormState` (form state and validation), `useModal` (modal open/close with data management)
- **Feature hooks**: `useTransactionEdit`, `useTransactionDelete`, `useTransactionSelection`, `useBudgetEntrySubmit`, `useFCExpCrud` encapsulate CRUD logic with toast notifications
- **Shared utilities** (`utils/`): `formatters` (currency/number formatting), `dateHelpers` (date manipulation), `cashFlowHelpers`, `forecastHelpers`, `treeTraversal` (tree structure navigation for COA hierarchy)

### Key Patterns

- **Shared Layout**: `Layout.jsx` renders `NavigationMenu` + `Breadcrumbs` + page content + `Footer`. Reusable `MonthYearPicker` and `PeriodCountSelector` components shared across pages
- **Shared selectors**: `HierarchyFilter` (two-stage cascading filter with group pills + drill-down checklist, right-click solo-select — used on Budget Worksheet, Actual Transactions, Budget Transactions), `CategorySelector` (COA-hierarchy, searchable — used in category quick-pick popover), `AccountSelector` (currency-grouped, searchable), `PeriodSelector` (preset-based periods) — reusable across pages
- **Collapsible sections**: Budget Worksheet and Transaction pages (Actual, Budget) use a Show/Hide toggle to maximize screen space for data tables
- **Tabbed panels**: Budget Worksheet uses a tabbed interface to switch between Balances and Budget Entry in the same card, with the selected category displayed in the tab header
- **Lazy loading**: All pages except Home use `React.lazy()` with `Suspense` + `LoadingSpinner`
- **Feature modules**: 9 feature directories under `features/` (Balances, BudgetEntry, Budgets, CashFlow, Charts, COAManagement, Database, Forecast, Transaction) with hooks, utils, and table components
- **Toast notifications**: All CRUD operations use `useToast()` for success/error feedback

### Shared Components (frontend/src/components/)

| Component | File | Description |
|-----------|------|-------------|
| Layout | `Layout.jsx` | NavigationMenu + Breadcrumbs + page content + Footer wrapper |
| NavigationMenu | `NavigationMenu.jsx` | Top navigation bar with category links |
| Breadcrumbs | `Breadcrumbs.jsx` | Page breadcrumb trail |
| LoadingSpinner | `LoadingSpinner.jsx` | Suspense fallback spinner |
| Toast | `Toast.jsx` | Toast notification popups |
| MonthYearPicker | `MonthYearPicker.jsx` | Dual month + year select, accepts className props |
| PeriodCountSelector | `PeriodCountSelector.jsx` | Dropdown for 1-3 period counts |
| **CategorySelector** | `CategorySelector/CategorySelector.jsx` | Searchable, COA-hierarchy-ordered category selector. Accepts `plTree` (from `useCoa`) for hierarchy ordering, `selectedCategories` + `onCategoriesChange` for selection, `categoryGroupOptions` for group presets (Income all, Expense all, etc.). Includes type-to-filter search input and pinned "All" option that clears category filters. Plain click selects a single item; Ctrl+click (Cmd+click on Mac) toggles multi-select. Used on Budget Worksheet, Actual Transactions, Budget Transactions, and in `TransactionEditModal` (single-select mode via `plTree` prop). |
| **PeriodSelector** | `PeriodSelector/PeriodSelector.jsx` | Preset-based period picker with standard presets: This Month, This Month Prior Year, Last Month, Last Month Prior Year, This Year, Last Year, Custom. Auto-computes `fromMonth`/`toMonth`/`actualYear`/`budgetYear` from selected preset. "Custom" reveals manual dropdowns (Budget Year hidden via `hideBudgetYear` prop). Supports controlled + uncontrolled modes (dual-state pattern). Used on Budget Worksheet, Actual Transactions, Budget Transactions. |
| **KpiCards** | `KpiCards.jsx` | Reusable KPI summary cards with Recharts mini-charts (bar/area). Used on Budget Realization and Forecast Review pages. Supports `formattedValue` override, trend icons, and responsive grid layout via `KpiCardRow`. |
| **AccountSelector** | `AccountSelector/AccountSelector.jsx` | Searchable, currency-grouped account selector. Accepts `accountOptions` (string[]) and `accountCurrencyMap` (Map from `useCoa`) to group accounts by currency. Includes type-to-filter search, "All" option pinned at top (clears individual selections when clicked), and currency group headers (USD, EUR, etc.). Plain click selects a single item; Ctrl+click (Cmd+click on Mac) toggles multi-select. `selectedAccounts` + `onAccountsChange` for selection. Account lists fetched with `leafOnly: true` to exclude parent/grouping nodes. |
| **HierarchyFilter** | `HierarchyFilter/HierarchyFilter.jsx` | Two-stage cascading filter used on Budget Worksheet, Actual Transactions, and Budget Transactions pages. **Stage 1:** Pill buttons for top-level COA groups (e.g., All / Income / Expense / Transfers for categories; Bank Accounts / Fidelity Stock / Liabilities sub-groups for accounts). Each pill shows item count. Selecting a group includes all leaf items by default. **Stage 2:** Type-to-narrow search input + compact scrollable checklist of leaf items under the active group. The search input filters the checklist case-insensitively and resets when switching groups. Uncheck individual items to narrow the selection. **Right-click** any item to solo-select (deselects all others). Props: `groups` ([{ key, label, node }] from COA tree), `onSelectionChange(leafNames[])`, optional `onGroupChange(groupKey)`, optional `extraSlot` (React node rendered below checklist — used for Transfer Match Status toggle on Actuals). CSS: `HierarchyFilter.css`. |

### Visual Environment Indicators

- **Development:** Yellow/amber browser tab (`#f59e0b`), title shows "FI [DEV]"
- **Production:** Dark blue browser tab (`#1a1f36`), title shows "FI"

Controlled by `VITE_APP_MODE` in `.env-cmdrc`, implemented in `main.jsx`.

### CSS Design System

Pure vanilla CSS with CSS custom properties (no Tailwind, SCSS, or CSS-in-JS). Global design tokens defined in `index.css`:

- **Colors:** Navy blue primary (`--primary: #1e40af`), emerald accent (`--accent: #047857`), semantic success/warning/danger, financial chart palette (7 colors)
- **Typography:** "Plus Jakarta Sans" (body), "Space Grotesk" (headings), SF Mono (financial data). Weights 400-700
- **Spacing:** `--space-xs` (0.25rem) through `--space-2xl` (3rem)
- **Border radius:** `--radius-sm` (8px) through `--radius-full` (9999px)
- **Shadows:** 4 levels (soft, md, lg, xl) plus focus ring
- **Transitions:** Fast (150ms), base (200ms), slow (300ms) with cubic-bezier easing
- **Visual effects:** Glassmorphism (backdrop-filter blur), gradient backgrounds, radial gradient body overlay

### Responsive Design

Desktop-first approach with three breakpoint tiers:

| Breakpoint | Target | Key changes |
|-----------|--------|-------------|
| `1080px` | Large tablet | 2-column grids collapse to 1-column, toolbar wraps |
| `768px` | Tablet | Hamburger nav, sidebar panels stack above content, modals go full-width, heading sizes reduce |
| `640px` | Mobile phone | Edge-to-edge navbar, full-screen modals, stacked form actions, reduced padding/font sizes, horizontal scroll for tabs/breadcrumbs, version badge hidden |

**Navigation:** Horizontal link bar inside glassmorphic pill on desktop. On mobile (768px): links hidden behind hamburger toggle, revealed as a fixed slide-out drawer (280px) with overlay backdrop. `backdrop-filter` is disabled on `.navbar__inner` at mobile to prevent CSS containing-block issues with `position: fixed` children. Brand image scales down (44px → 34px → 30px), version badge hidden at 640px. Navbar pill loses border-radius at 640px for edge-to-edge appearance.

**Tables:** Horizontal scroll via `overflow-x: auto` wrappers with gradient scroll indicators. Sticky headers with z-index layering. Reduced cell padding and font sizes at mobile breakpoints.

**Reports:** Balance sheet and cash flow use CSS custom properties (`--balance-indent-unit`, `--cashflow-indent-unit`) for tree indentation, progressively reduced at smaller breakpoints. Cash flow tree connector lines hidden at 640px.

**Modals:** Scale from fixed-width containers (`min(900px, 96vw)`) to full-screen at 640px with no border-radius. Footer action buttons stack vertically on mobile.

**Typography:** Heading sizes scale down at each breakpoint (e.g. h1: 2.25rem → 1.875rem → 1.5rem). Toast notifications reflow to fill available width at 640px.

### Mobile / PWA Shell

A dedicated mobile shell lives under `frontend/src/mobile/` and replaces the desktop layout entirely on phones / installed PWAs. It is **not** a responsive restyle of desktop pages — it's a separate set of simplified pages that reuse the existing API endpoints.

**Detection (`useIsMobile.js`):** Returns true when the page is in PWA standalone mode (`display-mode: standalone`) OR the viewport is ≤ 640px wide. Honors a `localStorage["forceDesktop"] === "true"` escape hatch so users can opt back into the full experience. Reacts to viewport resize and standalone-mode changes.

**Routing (`App.jsx` → `AppShell`):** Mobile pages live under `/m/*`. A top-level effect inside the router redirects desktop URLs → `/m/*` when on mobile, and `/m/*` → desktop URLs when not on mobile, using a `DESKTOP_TO_MOBILE` map covering the 5 mobile pages plus `/` → `/m`. Mobile and desktop layouts are mutually exclusive (no shared chrome).

**Shell components:**
- `MobileLayout.jsx` — slim top bar (logo on home, back button elsewhere) + scrollable content area + fixed bottom tab bar. Honors `safe-area-inset-*` for notched devices.
- `MobileTabBar.jsx` — fixed bottom tab bar with 5 `NavLink` tabs: Balance, Cash Flow, Refresh, Budget, Graph. Active tab uses `--primary` color.
- `MobileHome.jsx` — pure launcher (no API calls). 5 large icon + label cards plus a "Switch to desktop view" button at the bottom that sets `localStorage.forceDesktop = "true"` and reloads.
- `mobile.css` — single stylesheet of `m-*` classes. Reuses existing CSS tokens (colors, fonts, radii, spacing) from `index.css`. Enforces 44px tap targets, 16px+ base font (avoids iOS input auto-zoom), flat cards (no glassmorphism), generous vertical breathing room.

**Shared mobile helpers:**
- `periodPresets.js` — `PERIOD_PRESETS` array (This Month / Last Month / This Year / Last Year), each with a `range()` returning `{ fromDate, toDate }` as YYYY-MM-DD. Used by all mobile report pages that need a period selector.

**Mobile pages (`frontend/src/mobile/pages/`):**
- `MobileBalance.jsx` (`/m/balance`) — KPI cards (Net Worth hero + Total Assets + Total Liabilities), "as of [date]" pill, and collapsible Level-1 group cards (children of "Assets" and "Liabilities" from the balance report — Bank Accounts, Fidelity Stock, CVC, Properties, Liabilities). Tap a group to drill down to flattened leaf accounts. Single period (today). Uses existing `Rest.fetchBalanceReportV2(date)`.
- `MobileCashFlow.jsx` (`/m/cash-flow`) — Period pill row (This Month / Last Month / This Year / Last Year) at the top, KPI cards (Net hero + Income + Expenses), then "Top Expenses" list (top 8 leaf categories ranked by absolute amount, "See all N" toggle for the full list) and "Top Income" list (top 5, same toggle pattern). Uses existing `Rest.fetchCashFlowReportV2()` with `transfers: "exclude"` and `includeUnrealizedGL: false`.
- `MobileBudgetRealization.jsx` (`/m/budget-realization`) — Period pill row + 2×2 KPI grid (Income / Expenses / Net Cash Flow / Savings Rate, each showing actual + "vs budget" sub-line) + "Top Variances" card list ranked by absolute variance. Each variance card has the category name, signed delta (green for good, red for bad), an inline progress bar (actual / budget capped at 100%), and an Actual / Budget meta row. "See all N categories" toggle expands the full list. Calls `Rest.fetchCashFlowReport()` and `Rest.fetchBudgetCashFlowReport()` in parallel for the same period.
- `MobileBudgetGraph.jsx` (`/m/budget-graph`) — Period pill row + single full-bleed horizontal grouped bar chart (Recharts `BarChart` with `layout="vertical"`) showing top 10 expense categories by max(actual, budget). Each row has two bars: Actual (red if over budget, primary green otherwise) and Budget (muted). Y-axis category labels truncated to 14 chars; X-axis values formatted as `k`/`M`. Custom mobile tooltip. Reuses the same actual/budget endpoints as Budget Realization.
- `MobileRefreshPS.jsx` (`/m/refresh-ps`) — Header action bar with "Refresh from PS" button (calls `POST /api/v2/ingest-ps/refresh-ps` with `daysHistory: 7`) and "Accept all" button (sequential batches of 5 `PATCH /api/v2/transactions/:id` with `{accepted: true}`). Vertical card list of new transactions: each card shows description, signed amount, date · category · account meta line, and a per-row "Accept" pill. The category in the meta line is a tappable button (red "Uncategorized" if not yet set, primary-green underlined if set) that opens `MobileCategoryPicker`; on select, `PATCH /api/v2/transactions/:id` with `{Category}` updates the row optimistically and pushes the choice to the recents list. Optimistic removal on individual accept. Toast notifications via `.m-toast`. Edit/split/neutralize remain desktop-only.

**Shared mobile components:**
- `MobileCategoryPicker.jsx` — Full-screen overlay (`role="dialog"`) with close button, autofocused search input (16px to avoid iOS zoom), and a scrollable list of all P&L leaf categories grouped by top-level parent (Income / Expense / Transfers). A "Recent" group at the top shows the last 5 picks (persisted to `localStorage["mobileCategoryRecents"]` via `pushRecentCategory`/`getRecentCategories` exports). Search filters across all groups simultaneously. Locks body scroll while open and closes on Escape. Receives `plTree` from `useCoa()`. Used by `MobileRefreshPS` and reusable for any future mobile page that needs category selection.

**No backend changes** — every mobile page consumes existing v2 API endpoints.

---

## 6. Backend

### API Endpoints

All endpoints mounted at `/api/v2`. Nginx rewrites legacy `/api/*` paths to `/api/v2/*`. No V1 routes remain.

#### Accounts (`/api/v2/accounts`)
- `GET /` — List (query params: `section`, `accountType`, `activeOnly`, `leafOnly` — `leafOnly=true` excludes parent nodes with children) | `GET /tree` — Hierarchical tree | `GET /traits` — Traits map | `GET /balances` — Account balances
- `GET /categories` — Categories mapped to accounts | `GET /:id` — Single | `GET /:id/children` | `GET /:id/descendants`
- `POST /` — Create (auto-creates pocketsmith mapping) | `PATCH /:id` — Update | `DELETE /:id` — Soft delete
- `GET /lookup?name=X` — Find account by name with source mappings
- `GET /:id/mappings` — List source mappings | `PUT /:id/mappings` — Upsert `{ source, external_name }` | `DELETE /:id/mappings/:mappingId` — Remove mapping
- `POST /map-ps-accounts` — Maps PocketSmith transaction account IDs to local accounts | `POST /calibrate` — Back-calculates opening balances from most recent closing_balance anchor | `GET /calibration-status` — Shows calculated vs PocketSmith balance comparison

#### Budget (`/api/v2/budget`)
- `GET /versions` — List versions | `GET /versions/:id` | `POST /versions` | `POST /versions/:id/copy` | `PATCH /versions/:id`
- `GET /entries` — List entries | `GET /entries/:id` | `POST /entries` — Create (single/batch) | `PATCH /entries/:id` | `DELETE /entries/:id`
- `GET /entries/summary/by-category` | `GET /entries/summary/by-month` | `GET /compare` — Budget vs actual
- `GET /summary` — Budget vs actual by month | `GET /category-groups` — Income/Expense groups from COA
- `GET /fx-rates?year=` — Monthly budget FX rates for year | `PUT /fx-rates` — Upsert single rate | `GET /fx-rates/rate-map?year=&month=` — Rate map for budget entry creation
- `GET /fx-rates/preview?year=&month=` — Recalculate preview (all currencies) | `POST /fx-rates/recalculate` — Execute recalculate for currency/month
- `GET /` — v1 compat entries | `GET /actual-entries` — v1 compat actuals | `GET /cash-flow` — Budget cash flow P&L

#### Categories (`/api/v2/categories`)
After migration 021 the legacy `categories` table has been collapsed into `accounts`. "Categories" are P&L leaf accounts (`section='profit_loss'` with no children). The URL is preserved for frontend compatibility but is now backed by the accounts table.
- `GET /` — List P&L leaves (params: `activeOnly`, `includeTransfers`)
- `GET /lookup?name=X` — Find a P&L leaf by name (returns account row + mappings)
- `GET /:id` — Single (numeric only) | `GET /:id/mappings` — List source mappings | `PUT /:id/mappings` — Upsert `{ source, external_name }` | `DELETE /:id/mappings/:mappingId` — Remove mapping
- Source mappings now live in `account_source_mappings`; `category_source_mappings` was dropped.

#### Forecast (`/api/v2/forecast`)
- `GET /assumptions` | `PUT /assumptions` — File-based assumptions with PostgreSQL scenarios
- `GET /scenarios` | `GET /scenarios/years/:scenario` | `DELETE /scenarios/byname/:name` | `POST /scenarios/byname/:name/copy`
- `GET /modules` | `GET /modules/unmatched` | `POST /modules` | `PUT /modules/:id` | `DELETE /modules/:id`
- `POST /modules/add-from-actuals` — Returns BS account tree with year-end balances for creating new modules (excludes Bank Accounts and already-matched accounts)
- `GET /incomeexpense` | `POST /incomeexpense` | `PUT /incomeexpense/:id` | `DELETE /incomeexpense/:id`
- `POST /incomeexpense/add-from-lines` — Returns FC Lines with budget totals for bulk income/expense item creation
- `GET /entries` | `POST /generate/:scenario`
- `GET /audittrail/:scenario/:module` | `DELETE /audittrail/:scenario`

#### Health (`/api/v2/health`)
- `GET /` — Health check with DB connectivity

#### Ingest PS (`/api/v2/ingest-ps`)
- `POST /` — Ingest CSV (auto-sync) | `POST /upload-ps` — Upload CSV file | `POST /refresh-ps` — Fetch from API (auto-sync)
- `POST /clearall` — Clear staging | `POST /sync-to-transactions` — Sync staging to transactions
- `GET /psdata/count` | `GET /psdata/options` — Distinct accounts/categories
- `GET /analyze-ps` | `POST /analyze-ps` — Analyze for missing accounts/categories
- `GET /new-transactions` | `GET /modified-transactions` | `POST /review-new-transactions` — Review unaccepted transactions (queries `transactions` table where `accepted IS NOT TRUE`)
- `POST /appdata/last-refresh`

#### Reports (`/api/v2/reports`)
- `GET /balance` — Balance sheet | `GET /cash-flow` — P&L report | `GET /cash-flow/transactions` — Transactions by category
- `GET /category-trend?startDate=&endDate=&category=` — Monthly actual vs budget by category (repeatable `category` param)

#### Transactions (`/api/v2/transactions`)
- `GET /?year=&month=&category=&account=&currency=&description=&minAmount=&maxAmount=&transferMatched=&limit=&offset=` — List with filtering and pagination. `transferMatched=true|false` filters by transfer match status (populated when Transfer Analysis runs). | `GET /summary/by-category` | `GET /summary/by-month`
- `GET /:id` — Single | `POST /` — Create | `PATCH /:id` — Update (supports explicit `accepted` updates, does not auto-set) | `DELETE /:id` — Delete
- `POST /:id/split` — Split transaction into 2-5 entries. Accepts `{ splits: [{ amount, category_name? }] }`. Updates original with first split's amount; creates new rows for remaining splits. Account preserved from original, category optionally changed per split. `base_amount` calculated proportionally to preserve exchange rates. New rows get `ps_id=null`, `source='split'`. Uses DB transaction for atomicity.
- `POST /:id/neutralize` — Create offsetting entry for brokerage security trades. Accepts optional `{ category_name }` (defaults to "Transfer - Securities Trades"). Creates a new transaction with negated amount/base_amount, same account/date/currency. Both original and offset are assigned the category and marked `accepted=true`. Offset gets `source='auto-offset'`. Uses DB transaction for atomicity.
- `GET /transfer-analysis?year=&month=&dateTolerance=` — Analyze transfer transactions for a period. Fetches all transactions in `is_transfer=TRUE` categories, groups by category, and matches debit/credit pairs by same absolute `base_amount` within date tolerance (default 5 days). Excludes transactions in manual match groups from auto-matching. **FX category** (`Transfer - FX`, legacy `FX`) uses fuzzy matching: 1% amount tolerance and 1-day date window to absorb FX-spread differences between the EUR-side and USD-side base amounts. **Side effect:** persists `transfer_matched` boolean flag on all transfer transactions in the period (true for auto-matched pairs and manual group members, false for unmatched). Returns `{ data: { [category]: { matched, unmatched, matchedCount, unmatchedCount, matchedTotal, unmatchedTotal } }, manualGroups: [{ id, note, created_at, transactions }], period }`. Repository methods: `findTransfers()`, `transferMatchGroups.findMatchedTransactionIds()`, `transferMatchGroups.findAll()`, `updateTransferMatchedFlags()`.

#### Transfer Match Groups (`/api/v2/transfer-match-groups`)
- `POST /` — Create manual match group. Body: `{ transactionIds: number[], note?: string }`. Requires 2+ IDs. Returns 409 if any transaction is already in a group. Uses DB transaction for atomicity.
- `GET /?startDate=&endDate=` — List all match groups (optionally filtered by member transaction dates). Returns groups with full transaction details.
- `DELETE /:id` — Remove a match group (cascade deletes members, returning transactions to unmatched pool).

#### AI Review (`/api/v2/ai-review`)
- `POST /` — Create new AI review for a scenario (async, returns 202). Inserts a `pending` review row, fires the gateway call in the background, returns immediately with `{review}`. The background worker builds context from 6 data sources (scenario metadata, modules with nested data, inc/exp items, FX assumptions, base year budget, generated forecast entries), then `POST`s to the `ocr-llm` gateway at `${LLM_GATEWAY_URL}/task` with `task: "finance_plan_review"`. Conversation history is flattened into the prompt (single-turn endpoint). Local-only route: `ollama_heavy:qwen3.6:35b-a3b-q4_K_M → ollama_mid:qwen3:32b` — no public-cloud fallback. On completion the worker inserts the assistant message and flips status to `completed`; on failure it records `error_message` and flips to `failed`.
- `GET /:reviewId/status` — Poll for completion. Returns `{id, status, error_message, message_count, updated_at}`. Marks stale-pending reviews (>6min old) as `failed` before returning, covering the case of a server restart mid-review.
- `POST /:reviewId/message` — Send follow-up message in existing review conversation. Free-form response.
- `GET /scenario/:scenarioName` — List all reviews for a scenario.
- `GET /:reviewId` — Get full conversation history for a review.
- `DELETE /:reviewId` — Delete a review and its messages.
- `POST /apply` — Auto-apply AI-suggested changes. Supports action types: `update_module` (growth_rate, income_amount, expense_amount, tax_rate_override), `update_incexp` (base_value, growth_rate), `update_scenario` (cash_sweep_low, cash_sweep_high).

#### Utility (`/api/v2/util`)
- `GET /appdata` (merges JSON file + PostgreSQL `app_data` table) | `POST /appdata` | `POST /backup-database`
- `GET /exchange-rates` — Bulk/historical rates | `GET /exchange-rate` — Single rate lookup | `GET /currencies`
- `GET /coa/BalanceSheet` | `GET /coa/CashFlow` | `GET /coa-traits`
- `POST /coa/add` | `POST /coa/update` | `POST /coa/delete`

### Repository Pattern

| Repository | Tables |
|-----------|--------|
| `accounts.js` | accounts |
| `categories.js` | categories |
| `transactions.js` | transactions, pending_transactions |
| `budget.js` | budget_entries, budget_versions |
| `budgetFxRates.js` | budget_fx_rates |
| `forecast.js` | forecast_scenarios, forecast_modules, forecast_income_expense, forecast_entries, fc_ai_reviews, fc_ai_messages, and sub-tables |
| `fcLines.js` | fc_lines, fc_line_categories |
| `psdata.js` | psdata_staging, app_data |
| `transferMatchGroups.js` | transfer_match_groups, transfer_match_group_members |

### Forecast (FC) Module

Multi-year personal financial projection system modeled after `2026 Retirement Estimator v1.xlsm`. Generates P&L, balance sheet, and equity bridge forecasts across configurable scenarios with multi-currency support.

#### 5-Step Workflow

| Step | Page | Route | Purpose |
|------|------|-------|---------|
| 1 | FC Inc/Exp Mapping | `/forecast-mapping` | Define FC Lines (forecast income/expense lines), assign budget categories via drag/drop, set line types |
| 2 | Scenarios | `/forecast-scenarios` | Create/copy/configure scenarios with inflation, FX, tax, and target cash assumptions |
| 3 | BS Modules | `/forecast-modules` | Configure balance sheet modules (assets, liabilities, investments) with growth rates, investments, disposals |
| 4 | Income/Expenses | `/forecast-setup-exp` | Add forecast income/expense items from FC Lines with budget pre-fill |
| 5 | Review | `/forecast-review` | View generated multi-year forecast with P&L, balance sheet, KPIs, and equity bridge |

Supporting page: FC Settings (`/fc-settings`) — Birth Year (age row), Module Types (configurable list), FX Rate Assumptions, AI System Prompt. AI Review routes through the local `ocr-llm` gateway (`LLM_GATEWAY_URL` env var, default `http://192.168.1.61:8080`); no API key needed.

#### FC Lines Mapping Layer

Global mapping layer between budget categories and the forecast engine. Users define FC Lines, assign budget categories (each to exactly one line), and designate each line's destination:

| Line Type | Destination | Example |
|-----------|-------------|---------|
| `bs_module_expense` | BS module expense line picker | Prop Costs - PM4 |
| `bs_module_income` | BS module income line picker | Rental Income - PM4 |
| `forecast_expense` | Forecast expense item | Living Expenses |
| `forecast_income` | Forecast income item | Base Salary |
| `unassigned` | Not yet mapped | — |

Tables: `fc_lines`, `fc_line_categories`. Coverage indicator on mapping page shows assignment completeness.

#### Terminology

See also: `Documentation/FC_MODULE_MAPPING.md` for full data source mapping.

**Period Definitions:**

| Term | Formula | Example (PeriodStart=2027) | Description |
|------|---------|---------------------------|-------------|
| **PeriodStart** | — | 2027 | First forecast year. All FC IncExp projections begin here. |
| **BaseYear** | PeriodStart − 1 | 2026 | Budget year. P&L sourced from budget. BS modules project ending balances via engine. |
| **LastActualYear** | PeriodStart − 2 | 2025 | Most recent completed year. P&L and BS sourced from actuals (ledger/reports). |

**Value Definitions:**

| Term | Description | Example |
|------|-------------|---------|
| **PY Actual** | Prior year-end actual account value (imported from financial accounts) | 3,918,992 PLN |
| **Cost Basis** | Original cost / book value of asset at start of forecast. Used to calculate realized gains on disposal. | 3,918,992 |
| **Market Value** | Current fair market value at start of forecast. May differ from Cost Basis for assets with unrealized gains. | 3,918,992 |
| **Income Amount (Base Yr)** | User-entered base year income amount — grown at inflation for forecast periods (used when no Yield Spread schedule) | 40,000 |
| **Yield Spread** | Annual yield spread added to inflation rate to determine effective yield: `effective yield = inflation% + spread%`. Replaces old absolute "Income / Yield %" | 2.5 |
| **Expense Amount (Base Yr)** | User-entered base year expense amount — grown at inflation or % of value for forecast periods | 2,500 |

#### Engine Architecture

Located in `server/src/services/forecast/`. Four main files:

| File | Purpose |
|------|---------|
| `index.js` | Orchestration — loads scenarios, modules, FC Line name map; runs module + incexp builders; post-processing (cash sweep & auto-balance); income-sweep convergence loop (Step 7b). Only processes modules/expenses with `setup_status = 'complete'`. |
| `cash-sweep.js` | Pure computation functions for iterative year-by-year cash sweep: sweeps excess above high band into designated module, withdraws from module on shortfall below low band. Creates matching transfer pairs (bank + module sides with equal amounts) plus prior-years carry-forward entries (`_sweep_bal`) for correct cumulative MV adjustment. No yield calculation — yield handled by normal module engine on adjusted balances. |
| `fcbuilder-module.js` | BS module projections — starts from LastActualYear (BaseDate). Market value growth, investments/disposals (including BaseYear transfers), income (yield or base amount), expenses (inflation or % of value), realized/unrealized gains, tax with 1-year deferral, FX conversion, Full disposal handling (BaseYear: P&L kept as budget, future zeroed; forecast years: 50% in disposal year, 0 after), Periodic disposal expansion (repeats yearly from start to end year, capped at remaining balance), audit trail CSV |
| `fcbuilder-incexp.js` | Income/expense projections — starts from PeriodStart (BaseYear P&L covered by budget). Base year amount with inflation growth, scheduled changes, tax deferral, FX conversion |
| `fcbuilder-setup.js` | Loads FCAssump.json, builds rate schedules (inflation, FX, tax) as danfo.js DataFrames. FX keys support both `PLN`/`EUR` and legacy `USDPLN`/`USDEUR` formats. |

#### Engine Calculation Logic

**Income (BS Modules):**
- If module has Yield Spread schedule (IncomePct entries) → effective yield = inflation% + spread%, applied as: `income = avg(MV_current, MV_prior) × (inflation% + spread%) / 100`
- If no yield spread schedule but Income Amount (Base Yr) is set → grows at inflation: `income = base × (1 + inflation)^periodNum`
- Yield spread schedule presence determined by whether IncomePct entries exist (not whether values are non-zero). 0% spread = inflation-only yield; no entries = no yield schedule
- Yield spread takes priority over income_amount when schedule exists
- BaseYear income (from Income Amount) generates deferred tax in PeriodStart

**Expenses (BS Modules):**
- `expense_growth_method = 'inflation'`: `expense = base × (1 + inflation)^periodNum` for all periods
- `expense_growth_method = 'pct_of_value'`: derives implicit % from `expense_amount / market_value`, applies `% × avg(MV)` for all periods
- Expense Amount (Base Yr) is the base year value — all forecast periods apply the growth method

**Full Disposal:**
- BaseYear disposal: P&L kept as budget (no halving), all forecast years zeroed (MV, expenses, income)
- Forecast year disposal: 50% of calculated expense/income in disposal year, 0 after
- After disposal: all expense/income/growth zeroed, market value = 0

**Invest/Dispose Transfers:**
- Available from BaseYear (PeriodStart − 1) onward in the year dropdown
- BaseYear transfers adjust the ending balance that becomes PeriodStart opening balance
- Transfer-Bank entries generated for cash impact in all periods including BaseYear
- **Transfer Flags:** OneTime (single year), Periodic (repeating), Full (complete disposal — Dispose only)
- **Periodic transfers:** Repeat the specified Amount each year from Start Year through optional End Year. If no End Year, continues until account balance is depleted or plan ends. Applies to both Invest and Dispose transfers. Multiple periodic entries can define separate start/stop windows (e.g., Start 2028 @ 10k, End 2031; then Start 2040 @ 25k, no end). Engine caps each year's disposal at the available market value so balances never go negative. DB column `date_end` stores optional end date (migration 015 for disposals, migration 017 for investments).

**Tax:**
- Deferred 1 year: tax on income/gains in year N appears in year N+1
- BaseYear income generates tax in PeriodStart
- Per-module override via `tax_rate_override` (NULL = scenario default)

**FX Conversion:**
- All entries stored in USD
- Non-USD modules (PLN, EUR) converted using scenario FX assumptions
- Pre-period years use first available FX rate (forward-fill)
- Year-0 FX back-calculated from Cost Basis / Cost Basis (USD) ratio

Key engine features:
- **Setup status gating:** Only modules/expenses with `setup_status = 'complete'` are included in forecast generation — enables incremental build and review
- **Cash Sweep & Auto-Balance (iterative year-by-year):** If a module has `cash_sweep_target = true`, the engine uses `cash_sweep_low`/`cash_sweep_high` bands on the scenario. Excess cash above the high band is swept into the designated module; shortfalls below the low band trigger emergency withdrawal from the module's own balance (partial if insufficient, remainder shown as Cash Shortfall). Creates matching transfer pairs: bank-side entry (`_cash_sweep` module) and module-side entry (equal opposite amount) so entry breakdowns show matching flows. Prior-years cumulative MV adjustment written as separate `_sweep_bal` entries for correct balance sheet display. Falls back to old deposit/shortfall behavior if no sweep module designated. Audit trail CSV (Year, Action, Amount, CashBefore, CashAfter, NetModuleEffect) written per scenario.
- **Income-Sweep Convergence (Step 7b):** After the initial cash sweep, yield-based income on the sweep target module is recalculated using sweep-adjusted market values. Income depends on balance (post-sweep), but sweep depends on cash (which includes income) — creating a circular dependency. The engine iterates: (1) load sweep-adjusted MV, (2) recalculate income at effective yield, (3) compute income/tax deltas and UPDATE entries, (4) recompute cash deltas, (5) re-run `computeCashSweepIterative()`, (6) check convergence (maxDelta < $100). Typically converges in ~10 iterations. Only applies to modules with yield spread schedules (IncomePct entries). Preserves realized gain tax — only income-related tax is adjusted via delta. Generation time ~2s with convergence vs ~250ms without.
- **P&L driven by FC Lines:** All P&L entries use FC Line names as labels (not COA account names). Review page builds P&L structure from FC Lines.
- **Unified tax account:** Both BS module and IncExp engines write to "Taxes" (previously split between "Taxes US" and "Taxes")
- **Audit trail:** Per-module CSV export (LC values, USD values, entries)

#### Module Creation Helpers

- **Add from Actuals** (Modules page): `POST /forecast/modules/add-from-actuals` returns BS account tree with year-end balances; creates modules with balances pre-filled
- **Add from FC Lines** (Expenses page): `POST /forecast/incomeexpense/add-from-lines` returns FC Lines with budget totals; creates items with budget pre-fill and `budget_source_year`
- **Copy Scenario:** Deep copy with optional "Update PY Actual values from actuals" checkbox + year picker

#### Review Page Features

- **P&L driven by FC Lines:** Income/Expense sections show FC Line names grouped by type (via `/api/v2/fc-lines/review-structure`). The review-structure API also returns mapped COA category names per FC Line for actuals aggregation. No dependency on COA account hierarchy.
- **LastActualYear column:** Labeled "(Actual)". P&L from ledger actuals aggregated into FC Line names via `categoryToLineMap` (leaf COA → FC Line mapping). BS from ledger year-end balances.
- **BaseYear column:** Labeled "(Budget)". P&L from budget (via `/api/v2/forecast/base-year-values`). Transfers from FC BS Module engine. BS from FC BS Module engine. Net Cash Flow = budget P&L + engine transfers.
- **PeriodStart+ columns:** All values from FC engines (IncExp for P&L, BS Module for balance sheet).
- **Bank Accounts:** Running cash balance derived in display layer. LastActualYear = actual ledger balance (fixed). All subsequent years = prior year cash + current year Net Cash Flow. Engine Bank Accounts entries are not used.
- **Age row:** Computed from birth year setting (`year - birthYear`)
- **KPI cards:** Total Assets, Net Cash Flow, Income, Expenses with Recharts area trend charts
- **Equity bridge:** Collapsible "Change in Net Worth" rows inside the main table — Operating (excl Tax), Tax, Capital & Unrealized, Total Change in Net Worth. Operating = Net Cash Flow - Tax.
- **Cash Shortfall/Rebalance rows:** Automatically generated from target cash auto-balance
- **Net Assets row:** Summary row above the Balance Sheet section showing Assets − Liabilities per year. Checkbox for line chart selection. Double-click opens a stacked bar chart (`chartMode="bar"`) with per-account breakdown (level 2 accounts; liabilities negated). HTML tooltip shows account values and Net Assets total for hovered year.
- **Graph:** Select rows via checkboxes, click Graph to chart selected series over time. Double-click any Account column cell to instantly open the graph for that single row (selects it and opens modal). Graph modal supports `chartMode` prop: `"line"` (default polyline chart) or `"bar"` (stacked bar chart used by Net Assets).
- **Graph Quick Adjustments:** Double-clicking a data point on a line chart opens an inline adjustment modal. For P&L series (FC Exp lines): `FCGraphAdjustModal` allows adding/editing periodic changes (Fixed $, Percentage %, One-Off $) for the clicked year — pre-populates if a change already exists. For Balance Sheet series (FC Modules): `FCGraphModuleAdjustModal` loads full module data and displays Invest/Dispose transfer sections — existing transfers at the clicked year are highlighted, new rows default to that year. Both modals auto-regenerate the forecast on save and refresh the graph with updated values. Adjustable points show pointer cursor; non-adjustable series (totals, aggregates) use default cursor. Series enriched with `hasModule` flag via `fcExpByLabel` (FC Exp) and `fcModulesByLabel` (FC Module) lookup maps built from scenario data. Components: `FCGraphAdjustModal.jsx`, `FCGraphModuleAdjustModal.jsx`.
- **Row values:** Base/actual year values are resolved with budget/actual overlays via `resolveCashValue()` and `resolveBalanceValue()` helpers in `FCReviewTable.jsx`, ensuring graph series show correct values for all years (not just forecast years).
- **Cash Sweep Summary:** Green ArrowRightLeft button in toolbar opens `FCCashSweepModal` — shows the cash sweep audit trail (Year, Action, Amount, CashBefore, CashAfter, NetModuleEffect) with color-coded actions. Previously embedded as a tab in the Module Output modal, now a standalone modal on the Review page.
- **AI Review:** Purple BrainCircuit button in toolbar opens `FCAIReviewDrawer` — slide-out drawer from right with conversation history sidebar (with per-review delete buttons + "Generating…" / "Failed" status badges), message bubbles (user/assistant), follow-up input, inline "Apply" buttons parsed from AI action blocks (`update_module`, `update_incexp`, `update_scenario`), and confirmation modal before applying. Conversations persisted in PostgreSQL (`fc_ai_reviews`, `fc_ai_messages`). Backend calls the local `ocr-llm` gateway (`POST /task`, task `finance_plan_review`) — heavy → mid local-only route, no public-cloud LLM. **Async with polling:** the POST endpoints return 202 immediately; the drawer polls `GET /:reviewId/status` every 8s while any review is pending. On completion the drawer auto-loads the new message and fires both an in-app toast and (with permission) a Web Notifications API browser notification — so the user can close the drawer and continue working. **Unread indicator:** if a review completes while the drawer is closed, a pulsing red dot appears in the corner of the AI Review toolbar button (`fcAiPulse` keyframe defined in `FCReviewSelector.jsx`) until the drawer is opened. Plumbed via `onUnreadChange` prop from drawer → `aiReviewHasUnread` state in `FCReview.jsx` → `FCReviewSelector` prop. "+ New Review" is disabled while any review is in flight (single in-flight per scenario). Drawer z-index set above navigation menu (10100/10200).

#### Test Coverage

**Unit / route tests (Jest):** 73 tests — 16 FC Lines API tests, 19 engine tests (fcbuilder-module), 6 incexp tests, 8 E2E engine tests covering equity/property/fixed-income/liability/incexp/FX/tax-deferral scenarios, cash-sweep tests, 16 balance calibration tests (calibration logic, balance calculation at multiple dates, recalibration after data changes, edge cases). Engine tests use mocked data; route tests mock the repository layer. Run: `cd server && npm test`

**HTTP smoke tests:** `server/src/scripts/smoke-after-021.js` hits every endpoint whose SQL was rewritten when the `categories` table was collapsed into `accounts` (categories alias, transactions list/summary/transfer-analysis, reports cash-flow/balance/category-trend, FC Lines list/unassigned/review-structure, budget, transfer-match-groups). Asserts HTTP 200, response shape, and invariants (e.g. all 9 transfer leaves visible, FK round-trip integrity). Run against a live server: `node server/src/scripts/smoke-after-021.js` (override target with `BASE_URL=http://...`). Exits non-zero on any failure.

#### Frontend Components

29 React components in `frontend/src/features/Forecast/` (including `FCAIReviewDrawer.jsx`, `FCCashSweepModal.jsx`, `FCGraphAdjustModal.jsx`, `FCGraphModuleAdjustModal.jsx`), 14 custom hooks in `hooks/` subdirectory. Shared state via `ForecastContext`. Step navigation via `FCStepNav` component.

#### Detailed Documentation

Full design document, implementation plan, and test strategy: [Documentation/CRs/CR003_FORECAST_MODULE.md](CRs/CR003_FORECAST_MODULE.md). Terminology reference: [Documentation/FC_MODULE_MAPPING.md](FC_MODULE_MAPPING.md).

---

## 7. Database

### PostgreSQL Schema

**Enum types:** `account_type` (asset, liability, equity, income, expense), `account_section` (balance_sheet, profit_loss)

#### Core Tables

| Table | Purpose |
|-------|---------|
| `accounts` | Unified chart of accounts (BS + P&L) with hierarchy (adjacency list via `parent_id`). Calibration columns: `opening_balance`, `opening_balance_date`, `last_calibrated_at`, `ps_transaction_account_id` (migration 016). After migration 021 also carries `is_transfer` and `ps_category_id` — what used to be the `categories` table now lives as P&L leaves here. `transactions.category_id`, `budget_entries.category_id`, `fc_line_categories.category_id`, `pending_transactions.posted_category_id` all reference `accounts(id)`. |
| `account_source_mappings` | Maps external system names (PocketSmith, Quicken) to internal app accounts. Used for both BS account resolution and "category" name resolution after migration 021. `UNIQUE(source, external_name)`. Sync JOINs resolve via this table instead of `accounts.name` directly. |
| `transactions` | Actual financial transactions (`accepted` flag protects from PS refresh overwrite, `transfer_matched` boolean set by Transfer Analysis for filtering matched/unmatched transfers) |
| `pending_transactions` | Staging for new/modified PocketSmith transactions |
| `budget_versions` | Named budget versions per year |
| `budget_entries` | Individual budget line items |
| `transfer_match_groups` | User-created manual match groups for transfer transactions |
| `transfer_match_group_members` | Links transactions to match groups (unique constraint: one group per transaction) |

#### Forecast Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `forecast_scenarios` | Named forecast scenarios | `cash_sweep_low`, `cash_sweep_high` (cash band for auto-balance) |
| `forecast_modules` | Balance sheet forecast modules | `expense_fc_line_id`, `income_fc_line_id`, `expense_growth_method`, `expense_amount`, `income_amount`, `tax_rate_override`, `setup_status`, `cash_sweep_target` (unique per scenario) |
| `forecast_module_income_pct` | Module income/yield % schedules | `effective_date`, `value` |
| `forecast_module_investments` | Planned module investments | `investment_date`, `amount`, `flag` (OneTime/Periodic), `date_end` (optional end date for Periodic) |
| `forecast_module_disposals` | Planned module disposals | `disposal_date`, `amount`, `flag` (Full/OneTime/Periodic), `date_end` (optional end date for Periodic) |
| `forecast_income_expense` | Income/expense forecast items | `fc_line_id`, `budget_source_year`, `setup_status` |
| `forecast_incexp_changes` | Scheduled income/expense changes | `change_date`, `amount`, `flag` |
| `forecast_entries` | Generated forecast output | `account` (FC Line name), `forecast_year`, `amount` (USD) |
| `fc_lines` | FC Line definitions | `name`, `line_type`, `display_order` |
| `fc_line_categories` | FC Line ↔ P&L leaf account assignments | `fc_line_id`, `category_id` (UNIQUE; references `accounts(id)` after migration 021) |
| `fc_ai_reviews` | AI review sessions for forecast plans | `scenario_id`, `status`, `summary` |
| `fc_ai_messages` | AI review conversation messages | `review_id`, `role`, `content` |

#### Configuration Tables

| Table | Purpose |
|-------|---------|
| `forecast_assumptions` | Scenario-level or global assumptions (JSONB) |
| `exchange_rates` | Historical FX rates (market data from Frankfurter API). Auto-refreshed during PS sync and on-demand by balance sheet report when rates are > 3 days stale |
| `budget_fx_rates` | Monthly budget exchange rates per currency per year (user-managed, budget convention: X foreign per 1 USD) |
| `sync_metadata` | PocketSmith sync tracking |
| `audit_log` | Change audit trail (JSONB old/new values) |
| `psdata_staging` | Raw PocketSmith CSV/API data |
| `app_data` | Application metadata (last ingest/refresh timestamps) |

#### Views

| View | Purpose |
|------|---------|
| `v_balance_sheet` | Pre-joined balance sheet data |
| `v_budget_vs_actual` | Budget vs actual comparison with variance |

### Size

~29 MB, 20 tables, 25.5k transactions.

### Migrations

SQL migrations in `server/db/migrations/` run automatically on PostgreSQL container initialization via Docker's `initdb.d` volume mount. For existing databases, new migrations must be applied manually via `psql`.

---

## 8. Docker Services

### Production (`docker-compose.yml`)

| Container | Image | Ports | Purpose |
|-----------|-------|-------|---------|
| `fin-postgres` | postgres:16-alpine | 5433:5432 | PostgreSQL database |
| `fin-server` | Custom (Node.js 20) | 3005:3005 | Express API server |
| `fin-frontend` | Custom (nginx:alpine) | 3006:80, 5175:443 | SPA + API proxy |

All services connected via `fin_fin-network` Docker bridge network.

### Development (`docker-compose.dev.yml`)

Database and backend run in Docker. Frontend runs locally via npm:

| Component | How it runs | Port |
|-----------|-------------|------|
| `fin-postgres-dev` | Docker | 5434 |
| `fin-server-dev` | Docker | 3105 |
| Frontend | `npm run tail` (Vite) | 5174 |

Production and development use different ports, so both can run simultaneously.

### Volumes

**Production:** `postgres_data`, `./components/data`, `./components/reports`, `./certs`
**Development:** `postgres_data_dev`

---

## 9. Development Workflow

### Quick Start

```bash
ssh cfbieder@192.168.1.87
cd ~/psproject                     # or ~/Programs/fin (symlink)
./Scripts/dev-start.sh
```

Creates a tmux session (`fin-dev`) with 4 windows: database logs, backend (nodemon), frontend (Vite HMR), shell.

See [TMUX Guide](Guides/GUIDE_TMUX.md) for navigation details.

### Making Changes

- **Frontend** (`frontend/src/`): Save -> instant hot reload (Vite HMR)
- **Backend** (`server/src/`): Save -> auto-restart in ~1-2s (nodemon)
- **Database**: `docker compose -f docker-compose.dev.yml exec fin-postgres-dev psql -U fin -d fin`

### Frontend Environments (`.env-cmdrc`)

| npm script | API Target | Use Case |
|-----------|------------|----------|
| `npm run tail` | `http://100.94.46.62:3105` | **Development via Tailscale (recommended)** |
| `npm run dev` | `http://localhost:3105` | Development on the VM directly |
| `npm run docker` | (nginx proxy) | Production Docker build |

### Deploying to Production

```bash
./Scripts/deploy-to-production.sh
```

Backs up DB to `Backups/`, rebuilds containers, verifies health.

---

## 10. Scripts

All scripts are in the `Scripts/` folder.

| Script | Purpose | Usage |
|--------|---------|-------|
| `dev-start.sh` | Start tmux dev environment | `./Scripts/dev-start.sh` |
| `deploy-to-production.sh` | Deploy to production | `./Scripts/deploy-to-production.sh [--with-git] [--no-backup]` |
| `sync-db-prod-to-dev.sh` | Copy prod DB to dev | `./Scripts/sync-db-prod-to-dev.sh` |
| `bump-version.sh` | Version management | `./Scripts/bump-version.sh patch\|minor\|major\|X.Y.Z` |
| `rebuild-frontend.sh` | Quick frontend rebuild | `./Scripts/rebuild-frontend.sh` |
| `backup-to-remote.sh` | Backup DB + config to 192.168.1.252; prune Docker resources >48h | `./Scripts/backup-to-remote.sh` (crontab: every 2 days) |
| `provision-vm.sh` | Create VM on KVM host | `ssh cfbieder@192.168.1.61 'bash -s' < Scripts/provision-vm.sh` |
| `deploy-on-vm.sh` | Deploy app on VM | `ssh cfbieder@192.168.1.87 'bash -s' < Scripts/deploy-on-vm.sh` |

---

## 11. Backup & Restore

### Automated Remote Backup

Automated backups run every 2 days at 2:00 AM via crontab, transferring to `192.168.1.252`.

| Field | Value |
|-------|-------|
| Script | `Scripts/backup-to-remote.sh` |
| Schedule | `0 2 */2 * *` (every 2 days, 2 AM) |
| Remote | `cfbieder@192.168.1.252:/home/cfbieder/backups/fin/` |
| Retention | 30 days (auto-cleanup) |
| Log | `Backups/backup-remote.log` |

**What's backed up:** PostgreSQL dump, `.env` files, `components/data/`, `certs/`

**Docker cleanup:** Also prunes build cache, dangling images, stopped containers, and unused networks older than 48 hours.

```bash
# Manual remote backup
./Scripts/backup-to-remote.sh

# Dry run (preview only)
./Scripts/backup-to-remote.sh --dry-run

# View backup log
cat Backups/backup-remote.log

# List backups on remote
ssh cfbieder@192.168.1.252 "ls -lh /home/cfbieder/backups/fin/"
```

### Local Backup & Restore

Local backups are saved to the `Backups/` directory (git-ignored). The deploy script automatically creates a timestamped backup before deploying.

```bash
# Manual backup
mkdir -p Backups
docker exec fin-postgres pg_dump -U fin -d fin -Fc > Backups/fin_backup.dump

# Restore
docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < Backups/fin_backup.dump

# Copy backup off-VM
scp cfbieder@192.168.1.87:~/psproject/Backups/fin_backup.dump ./

# Restore from remote backup
scp cfbieder@192.168.1.252:/home/cfbieder/backups/fin/fin_backup_YYYYMMDD_HHMMSS.tar.gz .
tar xzf fin_backup_*.tar.gz
docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < fin_backup_*/database.dump
cp fin_backup_*/dot-env /home/cfbieder/psproject/.env
cp -r fin_backup_*/components-data/* /home/cfbieder/psproject/components/data/
cp -r fin_backup_*/certs/* /home/cfbieder/psproject/certs/
```

---

## 12. Git Hooks

A `prepare-commit-msg` hook automatically prepends version and date to all commit messages:

```
[v2.0.6 2026-02-13] your commit message here
```

Version is read from the `VERSION` file. The hook is local to this clone (`.git/hooks/`).

---

## 13. Environment Variables

Config uses `.env` file (git-ignored) for secrets, with defaults in `docker-compose.yml`:

| Variable | Default Value | Purpose |
|----------|---------------|---------|
| `POSTGRES_PASSWORD` | `findev123` | Database password |
| `DATABASE_URL` | `postgres://fin:findev123@fin-postgres:5432/fin` | Server DB connection |
| `PS_API_KEY` | (in docker-compose.yml) | PocketSmith API key |
| `PS_USER_ID` | `330430` | PocketSmith user ID |
| `NODE_ENV` | `production` | Server environment |
| `PORT` | `3005` | Server port |
| `LLM_GATEWAY_URL` | `http://192.168.1.61:8080` | Base URL of the local `ocr-llm` gateway (LAN). AI Review POSTs to `${LLM_GATEWAY_URL}/task` with `task: "finance_plan_review"`. Local-only route (heavy → mid); no API key required. |

> **Note:** `.env` is git-ignored. AI Review no longer needs an Anthropic API key — all LLM calls flow through the local gateway. If the gateway is unreachable, AI Review fails closed with a clear error rather than falling back to a cloud LLM.

---

## 14. Data Files

Located in `components/data/` (mounted into server container):

| File | Purpose |
|------|---------|
| `account_names.json` | PocketSmith account name mappings |
| `category_names.json` | PocketSmith category name mappings |
| `appdata.json` | Application metadata (last ingest/refresh timestamps). |
| `FCAssump.json` | Forecast assumptions (inflation, FX, tax rates) |
| `.temp/` | Temporary files for PS API refresh pipeline |

**COA in SQL:** The chart of accounts lives in the `accounts` table (adjacency list via `parent_id`) with `section` (balance_sheet / profit_loss) and `account_type` enums. The accounts repository provides `getNestedTree({ section })` returning `{ name, children }` trees via recursive CTE. All endpoints (reports, budget, forecast, COA management) use this SQL-based COA. The former `coa.json` and `coa_traits.json` files have been removed.

**Balance Sheet Calibration:** The `fetchAccountBalances()` query in `reports.js` computes balances as `opening_balance + SUM(transaction amounts)` instead of using PocketSmith's stale `closing_balance`. Opening balances are back-calculated via the `/api/v2/accounts/calibrate` endpoint using PocketSmith's live `current_balance` from the API as the authoritative anchor (falls back to most recent transaction `closing_balance` for unmapped accounts). REST helpers: `mapPsAccounts()`, `calibrateAccounts()`, `fetchCalibrationStatus()` in `frontend/src/js/rest.js`.

**FX Rate Auto-Refresh:** Exchange rates are kept current via two mechanisms: (1) the PS sync endpoint (`POST /ingest-ps/refresh-ps`) auto-refreshes all non-USD currency rates from Frankfurter API after syncing transactions, (2) the balance sheet report auto-detects stale rates (> 3 days old) and refreshes them on-demand before rendering. Shared utility: `server/src/utils/refreshExchangeRates.js`. Frankfurter API base URL: `https://api.frankfurter.dev/v1`.

---

## 15. Quick Reference

```bash
# Start dev environment
./Scripts/dev-start.sh

# Deploy to production
./Scripts/deploy-to-production.sh

# Sync prod data to dev
./Scripts/sync-db-prod-to-dev.sh

# Bump version
./Scripts/bump-version.sh patch

# Container status
docker compose ps                                    # Production
docker compose -f docker-compose.dev.yml ps          # Development

# View logs
docker compose logs -f server                        # Production
docker compose -f docker-compose.dev.yml logs -f     # Development

# Database shell
docker exec -it fin-postgres psql -U fin -d fin      # Production
docker exec -it fin-postgres-dev psql -U fin -d fin  # Development

# Stop services
docker compose down                                  # Production
docker compose -f docker-compose.dev.yml down        # Development
```

---

*Last updated: 2026-04-26*
