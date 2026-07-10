# Fin - Personal Finance Manager

**Single-source rule (2026-06-12):** this document is the *current-state snapshot* — architecture, stack, structure, endpoints, schema, workflow. Feature/CR detail lives **only in the CR files** ([CRs/CR_INDEX.md](CRs/CR_INDEX.md)); the plan lives in [FC_NEXT_STEPS.md](FC_NEXT_STEPS.md); migrations live in [MIGRATIONS.md](MIGRATIONS.md). The pre-restructure full text (with per-page implementation essays) is archived at [Archive/FC_PROJECT_STRUCTURE_FULL_2026-06-12.md](Archive/FC_PROJECT_STRUCTURE_FULL_2026-06-12.md).

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

**Three-service architecture (production):** PostgreSQL, Node.js/Express API, nginx-served React SPA — Docker Compose orchestrated. A separate **bank-feed microservice** (own gitignored repo at `bank-feed/`, port 3007) supplies bank data over a versioned `/v1/*` contract (CR021).

---

## 2. Infrastructure

### VM

| Field | Value |
|-------|-------|
| IP | `192.168.1.87` (LAN) / `100.94.46.62` (Tailscale) |
| OS | Ubuntu 24.04 LTS (Noble) |
| vCPUs / RAM / Disk | 4 / 8 GB / 77 GB (LVM) |
| User | `cfbieder` (sudo with password — NOPASSWD no longer active, verified 2026-07-05; SSH key auth) |
| Project path | `/home/cfbieder/psproject` (symlink: `~/Programs/fin` → `~/psproject`) |

KVM host: `192.168.1.61` (Cockpit `https://192.168.1.61:9090`, pools `vm-ssd`/`vm-hdd`). Tailscale: `https://fin.tail413695.ts.net` → production frontend; auto-starts on boot.

### Access URLs

| Environment | Frontend HTTPS | Frontend HTTP | API | Database |
|-------------|---------------|---------------|-----|----------|
| **Production** | `https://192.168.1.87:5175` | `http://192.168.1.87:3006` | `http://192.168.1.87:3005` | `127.0.0.1:5433` / `100.94.46.62:5433` |
| **Production (Tailscale)** | `https://fin.tail413695.ts.net` | - | - | - |
| **Development** | `http://100.94.46.62:5174` | - | `http://100.94.46.62:3105` | `127.0.0.1:5434` / `100.94.46.62:5434` |

> **Postgres is NOT LAN-exposed** (CR034, 2026-06-12): the published DB ports bind to localhost + the Tailscale IP only.

---

## 3. Tech Stack

**Frontend:** React 19, Vite 7 (+ vite-plugin-pwa/workbox — installable PWA, cache-first hashed assets, network-only API), React Router 7, Lucide icons, Recharts, xlsx (SheetJS), env-cmd. Design system: "Mindful Minimalist" (warm cream, forest-green accents, Outfit font, soft shadows, rounded geometry).

**Backend:** Express 5, pg 8, Arquero, danfojs-node, archiver, pino, morgan. Node 20.

---

## 4. Project Structure

```
psproject/                          # ~/Programs/fin symlinks here
├── components/data|reports/        # Runtime data files / generated reports
├── Documentation/
│   ├── FC_PROJECT_STRUCTURE.md     # This file — current state
│   ├── FC_NEXT_STEPS.md            # Plan + open work + known issues
│   ├── MIGRATIONS.md               # DB migrations registry (one line per migration)
│   ├── FC_MODULE_MAPPING.md        # Forecast terminology reference
│   ├── OCME_BANK_FEED_IMPORT_GUIDE.md
│   ├── CRs/                        # Change Requests — CR_INDEX.md + CR001..CR0NN
│   ├── Guides/  Testing/  Archive/
├── frontend/                       # React SPA (Dockerfile: Vite → nginx; nginx.conf proxies /api)
│   └── src/
│       ├── App.jsx  main.jsx  config/routes.jsx
│       ├── components/             # Shared UI (Layout, Sidebar, TopStrip, CommandPalette, HelpPanel,
│       │                           #  Toast, HierarchyFilter, CategorySelector, AccountSelector,
│       │                           #  PeriodSelector, KpiCards, ConfirmModal, MtmDateControl,
│       │                           #  ErrorBoundary (route-level, CR037), …)
│       ├── contexts/  hooks/  utils/  js/   # ToastContext/ForecastContext; useAPI/useCoa/…; rest.js
│       ├── features/               # Balances, BudgetEntry, Budgets, CashFlow, Charts,
│       │                           #  COAManagement, Database, Forecast, Transaction
│       ├── mobile/                 # Dedicated /m/* shell (see §5)
│       └── pages/                  # 25+ page components
├── server/                         # Express API
│   ├── db/migrations/              # 001..034 SQL — registry in Documentation/MIGRATIONS.md
│   ├── db/ci-seed.sql              # CI baseline COA rows (NOT a migration)
│   └── src/
│       ├── server.js  app.js
│       ├── services/forecast/      # FC engine (index, cash-sweep, fcbuilder-*)
│       └── v2/                     # PostgreSQL API (all routes)
│           ├── db/                 # pool (DATE parser → YYYY-MM-DD strings)
│           ├── routes/  repositories/  services/  scripts/
├── Scripts/                        # dev-start, deploy-to-production, sync-db-prod-to-dev,
│                                   #  bump-version, rebuild-frontend, backup-to-remote, v4-up, …
├── .github/workflows/ci.yml        # CI: backend tests (fresh DB) + frontend build + secret scan
├── docker-compose.yml              # Production (project name: psproject)
├── docker-compose.dev.yml          # Development (postgres-dev + server-dev)
├── docker-compose.v4.yml           # Isolated v4/CR027 stack (flags ON, own volume)
└── VERSION  NOTES.md
```

---

## 5. Frontend

### Pages & Routes

Detail for each page lives in its CR file (linked) — this table is a directory, not a spec.

| Path | Page | Category | Summary |
|------|------|----------|---------|
| `/` | Home | - | Live dashboard: net-worth/cash-flow KPIs (shared `useOverview` hook, also MobileHome) + "needs attention" strip (`AttentionStrip`) + quick actions ([CR038](CRs/CR038_HOME_DASHBOARD_ATTENTION.md)) |
| `/upload-ps` | UploadPS | Database | One-time PocketSmith CSV upload (live PS API removed — [CR030](CRs/CR030_AUTOMATED_PS_RETIREMENT.md)) |
| `/refresh-feeds` | RefreshFeeds | Transactions | **"Refresh Feeds"** — bank-feed review queue: refresh, tabbed review/edit, category suggestions, bulk accept, per-row kebab actions (Edit/Split/Neutralize/Transfer/Accept), group-by-account; renamed from `/refresh-ps` in v3.0.57 (old URL redirects) ([CR022](CRs/CR022_BANK_FEED_PARALLEL_IMPORT.md)/[CR028](CRs/CR028_SECURITIES_TRADE_NEUTRALIZATION.md)) |
| `/backup-database` | BackupDatabase | Database | Download DB backup (tar.gz of pg_dump) |
| `/budget-worksheet` | BudgetWorksheetV2 | Budgeting | Two-panel worksheet: balance comparison + entry form; HierarchyFilter; math expressions; FX auto-base |
| `/budget-realization` | BudgetRealization | Budgeting | Budget vs actual with KPI cards |
| `/budget-graph` | BudgetRealizationGraph | Budgeting | Visual budget analysis |
| `/budget-variances` | BudgetVariances | Budgeting | Line items ranked by variance |
| `/budget-fx` | BudgetFX | Budgeting | Monthly budget FX rates per currency/year (`budget_fx_rates`) |
| `/forecast-mapping` | FCLineMapping | Forecasting | FC step 1 — define FC Lines, assign budget categories |
| `/forecast-scenarios` | FCScenarios | Forecasting | FC step 2 — scenarios (copy, sweep band, target cash) |
| `/forecast-modules` | FCModuleManage | Forecasting | FC step 3 — BS modules (add-from-actuals, growth/yield/invest/dispose, sweep priority) |
| `/forecast-setup-exp` | FCExpSetup | Forecasting | FC step 4 — income/expense items from FC Lines |
| `/forecast-review` | FCReview | Forecasting | FC step 5 — multi-year review: P&L by FC Lines, BS, KPI cards, ΔNet-Assets bridge, graphs with quick-adjust, Cash Sweep summary, AI Review drawer |
| `/forecast-compare` | FCCompare | Forecasting | FC step 6 — compare two scenarios (baseline A vs B): KPI deltas, P&L/BS delta grids (client-side diff reconciling with Review), recharts A-vs-B lines + diverging delta bars, deterministic "where they differ" commentary ([CR040](CRs/CR040_FORECAST_SCENARIO_COMPARE.md); AI narrative = P3, pending) |
| `/fc-settings` | FCSettings | Forecasting | Birth year, module types, FX assumptions, AI system prompt |
| `/balance` | BalanceV2 | Reports & Graphs | Balance sheet (KPI cards, 1–3 periods, tree table, export) |
| `/balance-trends` | BalanceTrends | Reports & Graphs | Period-end balance series × accounts; Month/Quarter/Year interval; USD/Local/Both; export ([CR018](CRs/CR018_BALANCE_TRENDS.md)) |
| `/cash-flow` | CashFlow | Reports & Graphs | Cash flow P&L |
| `/cash-flow-periods` | CashFlowPeriods | Reports & Graphs | Cash flow per period column (Month/Quarter/Year) |
| `/balance-sheet-periods` | BalanceSheetPeriods | Reports & Graphs | Balance sheet as of each period end |
| `/balance-chart` | BalanceChart | Reports & Graphs | Assets vs Liabilities bars over time (period selector) |
| `/category-trend` | CategoryTrend | Reports & Graphs | Actual vs budget per category, grouped bars |
| `/trans-actual` | TransActual | Transactions | Transaction explorer: search, HierarchyFilter, KPI cards, edit/split/neutralize/delete ([CR008](CRs/CR008_HIERARCHY_FILTER.md)) |
| `/trans-budget` | TransBudget | Transactions | Budget-transaction explorer (same pattern) |
| `/transfer-analysis` | TransferAnalysis | Transactions | Auto + manual transfer matching, match groups, orphan Remove/Neutralize ([CR009](CRs/CR009_TRANSFER_ANALYSIS.md)/[CR028](CRs/CR028_SECURITIES_TRADE_NEUTRALIZATION.md)) |
| `/ledger` | Ledger | Transactions | Account ledger; **Balance column = true account balance** (server `running_balance`, v3.0.28); duplicates finder; add/bulk-edit ([CR031](CRs/CR031_LEDGER_FILTER_PARITY_YEAR_RANGE.md)); edit modal supports **Amount/Currency + read-only USD Amount** (v3.0.42, shared with Actuals) |
| `/balance-calibration` | BalanceCalibration | Transactions | Bank-feed reconciliation `<BalanceReconciliation/>`: computed vs feed, calibrate/MTM, feed+status filters, flip-tx ([CR023](CRs/CR023_POCKETSMITH_REMOVAL.md)) |
| `/manual-calibration` | ManualCalibration | Transactions | Non-fed twin: computed vs user-typed balance, calibrate/MTM with as-of date ([CR033](CRs/CR033_MANUAL_CALIBRATION.md)) |
| `/manual-entry` | ManualTransactionEntry | Transactions | Rapid hand entry of actual transactions ([CR025](CRs/CR025_MANUAL_TRANSACTION_ENTRY.md)) |
| `/quicken-import` | QuickenImport | Database | Quicken QIF import admin: parse/map/preflight/promote/rollback ([CR019](CRs/CR019_QUICKEN_IMPORT.md)) |
| `/fx-options` | FXOptions | Forecasting | Forecast FX assumptions |
| `/coa-management` | COAManagement | Settings | COA CRUD tree editor, move/re-parent, feed badge ([CR010](CRs/CR010_COA_MANAGEMENT.md)) |
| `/program-settings` | ProgramSettings | Settings | App preferences (default budget year) |

### Navigation & Layout

- **Sidebar layout (CR026, ON in prod since v3.0.0):** collapsible VS Code-style `Sidebar` + `TopStrip` (breadcrumbs, ⌘K search, help, install, theme). Flag: `localStorage.navLayout` → `VITE_NAV_LAYOUT` build arg → legacy top `NavigationMenu` fallback. Groups from `SIDEBAR_GROUPS`/`getSidebarNav()` in `routes.jsx`. Collapsed rail shows hover flyouts.
- **Dark mode:** `[data-theme="dark"]` token overrides in `index.css`; `useTheme` hook (default light, persisted, no-FOUC script). 100% coverage of reachable surfaces.
- **⌘K CommandPalette** + **HelpPanel** drawer (shortcuts + glossary).
- Category landing pages at `/<category-slug>` generated from `routes.jsx`.

### State, Patterns, Shared Components

- **Context:** `ToastContext`, `ForecastContext`; page-level `useState` otherwise. Shared hooks: `useAPI`, `useCoa` (COA + derived maps — currently refetches per consumer, caching is backlogged), `useOverview` (Home/MobileHome KPI data, CR038), `useFormState`, `useModal`; feature hooks for CRUD+toasts.
- **Shared selectors:** `HierarchyFilter` (two-stage group pills + checklist, right-click solo, opt-in `singleSelect`), `CategorySelector`, `AccountSelector`, `PeriodSelector` (presets + opt-in `enableYearRange`), `MonthYearPicker`, `PeriodCountSelector`, `KpiCards`, `ConfirmModal`, `MtmDateControl`.
- **Patterns:** lazy routes (`React.lazy`+Suspense), feature modules under `features/`, toasts on all CRUD, collapsible filter panels, `.page-shell` page width wrapper.
- `utils/periodHelpers.js` — shared period-end series engine (Month/Quarter/Year, partial-period `(MTD/QTD/YTD)` handling) used by Balance Trends / BS Periods / Balance Chart / Cash Flow Periods.

### CSS Design System

Vanilla CSS with custom-property tokens in `index.css` (colors, type, spacing, radius, shadows, transitions) + dark-theme override layer. Canonical `.btn` family in `components/buttons.css`; `npm run lint:buttons` (via `Scripts/check-button-css.sh`) blocks new ad-hoc `*-btn` classes. `.page-shell` owns page max-width/gutters. Breakpoints: 1080/768/640px, desktop-first.

### Mobile / PWA Shell

Separate simplified pages under `frontend/src/mobile/` at `/m/*` (not a responsive restyle). `useIsMobile`: standalone PWA, viewport ≤640, or coarse pointer ≤900 (with fine-pointer-only `forceDesktop` escape). `MobileLayout` + bottom `MobileTabBar` (Overview, Balance, Cash Flow, Budget, Graph). Pages: MobileHome (live overview), MobileBalance, MobileCashFlow, MobileBudgetRealization, MobileBudgetGraph, MobileRefreshFeeds (refresh + summary + read-only list of imported/pending-review transactions, v3.0.35), MobileReconcile (`/m/reconcile` — fed drift/stale + manual drift, tap-to-reconcile with two-tap confirm, MTM books last month-end; CR038 P4, v3.0.57), MobileBalanceTrends, MobileLedger (read-only; running balance still seeds at 0 — Known Issue #5). All consume existing v2 endpoints.

---

## 6. Backend

### API Endpoints

All mounted at `/api/v2` (nginx rewrites legacy `/api/*`). Behavioural detail in the linked CRs.

**Accounts (`/accounts`):** `GET /` (filters incl. `leafOnly`) · `/tree` · `/traits` · `/balances` · `/categories` · `/:id`(+children/descendants) · `POST /` · `PATCH /:id` · `DELETE /:id` (soft) · `GET /lookup?name=` · `GET|PUT|DELETE /:id/mappings`.

**Budget (`/budget`):** versions CRUD+copy · entries CRUD (single/batch) · summaries (by-category/by-month/compare) · `fx-rates` (get/upsert/rate-map/preview/recalculate) · v1-compat `GET /`, `/actual-entries` (date-range aware, CR031), `/cash-flow`.

**Categories (`/categories`):** P&L leaf accounts post-migration-021 (URL preserved; backed by `accounts`). List/lookup/single + mappings.

**Forecast (`/forecast`):** assumptions get/put · scenarios (list/years/delete-by-name/copy) · modules CRUD + `add-from-actuals` · incomeexpense CRUD + `add-from-lines` · entries · `POST /generate/:scenario` · audittrail.

**Health (`/health`).**

**Ingest PS (`/ingest-ps`):** CSV upload path only (`POST /`, `/upload-ps`, `/clearall`, `/sync-to-transactions`, `/analyze-ps`, psdata count/options) + review queue (`/new-transactions`, `/modified-transactions`, `POST /review-new-transactions`) + `/appdata/last-refresh`. PS-API refresh removed (CR030).

**Ingest bank feed (`/ingest-bank-feed`):** `POST /refresh {sinceDays}` — stage + promote from the bank-feed service ([CR022](CRs/CR022_BANK_FEED_PARALLEL_IMPORT.md)).

**Bank feed (`/bank-feed`):** read-only proxy + `GET /balance-recon` (institution-enriched + true upstream sync time `feed_synced_at` from the feed's `source_synced_at`, fail-open) · `POST /reconcile/:accountId` (`asOf/dryRun/force/bookDate`) · `PATCH /reconcile-mode/:accountId` · `PATCH /feed-negate-tx/:accountId` · `GET /fed-accounts` · diagnostic ([CR023](CRs/CR023_POCKETSMITH_REMOVAL.md)/[CR024](CRs/CR024_FIDELITY_FEEDS.md)) · **manual statement upload (stale-feed fallback, [CR036](CRs/CR036_MANUAL_STATEMENT_UPLOAD.md), v3.0.45; P2 mapper v3.0.59): `GET /manual/profiles` (built-in + mapper-saved) · `POST /manual/inspect` (headers/samples for the mapper) · `POST /manual/save-profile` · `POST /manual/preview` (parse + any-source dedup + hypothetical drift, no writes; accepts `profileId`, inline `profile` spec, and typed `statedBalance`) · `POST /manual/commit` (write to the service, promote only-new, reconcile; same params). Service `manualStatementImport.js` owns sign alignment (feed_negate_tx / feed_sign / account_type); the bank-feed microservice owns parsing via `POST /v1/manual/{parse,commit}` + declarative format profiles (`bank-feed/src/profiles/`, preinstalled Barclays / Luxury Card). UI: per-row "Upload statement" on Balance Reconciliation → `ManualStatementUpload.jsx`.**

**Manual calibration (`/manual-calibration`):** `GET /recon?asOf=` · `PUT /balance/:accountId` · `DELETE /balance/:accountId` · `PATCH /reconcile-mode/:accountId` · `POST /reconcile/:accountId` ([CR033](CRs/CR033_MANUAL_CALIBRATION.md)).

**Quicken import (`/quicken-import`):** `POST /parse` · batches list/detail/mappings/preflight/promote/rollback/delete ([CR019](CRs/CR019_QUICKEN_IMPORT.md)).

**Reports (`/reports`):** `GET /balance` · `/cash-flow` (+`/transactions`) · `/category-trend`.

**Transactions (`/transactions`):** `GET /` (rich filters; single-account ledger requests get per-row `running_balance` — v3.0.28) · summaries · `GET /:id` · `POST /` (CR025: `accepted` default TRUE for `source='manual'`) · `PATCH /:id` · `DELETE /:id` · `POST /:id/split` · `POST /:id/neutralize` (pair-or-mirror + dryRun + CR032 guard — see [CR028](CRs/CR028_SECURITIES_TRADE_NEUTRALIZATION.md)/[CR032](CRs/CR032_CORE_CASH_SWEEP_NEUTRALIZATION.md)) · `POST /:id/transfer` · `POST /category-suggestions` · `GET /transfer-analysis`.

**Transfer match groups (`/transfer-match-groups`):** `POST /` · `GET /` · `DELETE /:id`.

**AI Review (`/ai-review`):** async create (202 + background gateway call to local `ocr-llm`, task `finance_plan_review`) · `GET /:reviewId/status` poll · follow-up message · per-scenario list · get/delete · `POST /apply` ([CR006](CRs/CR006_AI_REVIEW.md)).

**Utility (`/util`):** appdata get/post · exchange-rates/currencies · COA read+add/update/delete · `POST /backup-database` (execFile pg_dump → tar.gz download) · `GET /attention-summary` (Home strip counts: unreviewed tx, KI#7 verify-USD rows, stale feeds, fed+manual drift — [CR038](CRs/CR038_HOME_DASHBOARD_ATTENTION.md)).

### Repositories

`accounts`, `transactions` (+pending), `budget`, `budgetFxRates`, `forecast` (+sub-tables, AI reviews), `fcLines`, `psdata` (+app_data), `transferMatchGroups`, `accountSourceMappings`, `bankFeedReconciliation`, `manualReconciliation`.

### Forecast (FC) Module

Multi-year projection engine in `server/src/services/forecast/` (`index.js` orchestration + convergence, `cash-sweep.js` priority-ordered sweep ([CR017](CRs/CR017_CASH_SWEEP_PHASE_C.md)), `fcbuilder-module.js`, `fcbuilder-incexp.js`, `fcbuilder-setup.js`). 5-step UI workflow (mapping → scenarios → modules → inc/exp → review). FC Lines decouple budget categories from forecast outputs ([CR004](CRs/CR004_FC_LINES_MAPPING.md)). Terminology + period definitions: [FC_MODULE_MAPPING.md](FC_MODULE_MAPPING.md); full engine spec: [CR003](CRs/CR003_FORECAST_MODULE.md); calculation rules (yield spread, disposal halving, tax 1-yr deferral, FX) archived in the full doc.

### Reconciliation Engines

- **Feed-driven** ([CR023](CRs/CR023_POCKETSMITH_REMOVAL.md)): `services/reconcileToFeed.js` — per-mapping `reconcile_mode` `'calibrate'` (re-anchor `opening_balance`) | `'mtm'` (month-end cat-88 Unrealized-G/L entry, 15% phantom-gain guard, optional `bookDate`); sign axes `feed_sign` (balance) + `feed_negate_tx` (transactions); sync-before-reconcile (fail-open).
- **Manual** ([CR033](CRs/CR033_MANUAL_CALIBRATION.md)): `services/reconcileManual.js` — deliberate parallel fork for non-fed leaf accounts against user-typed `manual_balances`; shared `services/fx.js` for non-USD base amounts.
- **Neutralization** ([CR028](CRs/CR028_SECURITIES_TRADE_NEUTRALIZATION.md)/[CR032](CRs/CR032_CORE_CASH_SWEEP_NEUTRALIZATION.md)): pair-or-mirror with dry-run; core-sweep auto-mirror at promote.

### Tests

247 backend Jest tests (engine, services, repositories, scripts, `v2/utils/validate`; DB-backed suites self-seed against `DATABASE_URL`) — run `cd server && npm test`. 103 frontend Vitest helper tests — `cd frontend && npm test`. HTTP smoke: `node server/src/scripts/smoke-after-021.js`. **CI** (`.github/workflows/ci.yml`) runs the backend suite against a fresh migrations+[`ci-seed.sql`](../server/db/ci-seed.sql) Postgres, the frontend build (lint advisory until the 160-error debt clears), and a tracked-secret grep gate. Inventory: [Testing/TEST_OVERVIEW.md](Testing/TEST_OVERVIEW.md).

### Operational scripts (`server/src/v2/scripts/`)

One-time/idempotent admin CLIs — all require `DATABASE_URL` (no embedded credentials since CR034): `quicken-import.js` / `quicken-promote.js` / `quicken-verify.js` ([CR019](CRs/CR019_QUICKEN_IMPORT.md)), `ps-anchor.js`, `retire-handoff.js`, `seed-cr019-coa.js`, `copy-quicken-to-prod.js`, `seed-bankfeed-cutoffs.js`, `seed-ps-lower-cutoffs.js`, `seed-cr023-reconcile-modes.js`, `seed-cr024-fidelity-*.js`, `mtm-reconcile.js`, `backfill-cr032-core-sweeps.js`, `ps-exit-monitor.js`. Usage in the owning CR file.

---

## 7. Database

**Enums:** `account_type` (asset/liability/equity/income/expense), `account_section` (balance_sheet/profit_loss), `security_tx_type`.

### Core tables

| Table | Purpose |
|-------|---------|
| `accounts` | Unified COA (BS + P&L) with `parent_id` hierarchy; calibration columns (`opening_balance`, `opening_balance_date`, `manual_reconcile_mode`); P&L leaves carry `is_transfer`/`ps_category_id` (migration 021) |
| `account_source_mappings` | External↔internal name map per source (pocketsmith/quicken/bank-feed) + per-mapping feed policy: `ignored`, `promote_from_date`, `balance_from_feed`, `trade_treatment`, `reconcile_mode`, `feed_sign`, `feed_negate_tx` |
| `transactions` | Ledger (`accepted`, `transfer_matched`, `bank_feed_external_id`, `import_batch_id`, `source`) |
| `pending_transactions`, `psdata_staging`, `bankfeed_staging`, `quicken_*` (12 tables) | Staging per source |
| `bankfeed_balances` / `manual_balances` | Feed-reported / user-entered balance snapshots |
| `budget_versions`, `budget_entries`, `budget_fx_rates` | Budgeting |
| `transfer_match_groups` (+`_members`) | Manual transfer matching |
| `forecast_*` (scenarios, modules + income_pct/investments/disposals, income_expense + changes, entries), `forecast_assumptions` (CR039 document store — inflation/FX/tax/category/scenario periods, formerly `FCAssump.json`; migration 034), `fc_lines` (+`_categories`), `fc_ai_reviews`/`fc_ai_messages` | Forecast |
| `exchange_rates`, `sync_metadata`, `audit_log`, `app_data` | Config/infra |

Views: `v_balance_sheet`, `v_budget_vs_actual`. Size: ~30 MB, ~36k transactions.

### Migrations

Registry (one line per migration, 001–034): **[MIGRATIONS.md](MIGRATIONS.md)**. They auto-run only on a fresh (empty-volume) Postgres via `initdb.d`; on existing DBs apply manually with `psql` **before** deploying dependent code. CI proves the chain applies to an empty database. A real runner is CR027A scope.

---

## 8. Docker Services

| Stack | File | Containers | Ports (host) |
|-------|------|------------|--------------|
| Production | `docker-compose.yml` (project **psproject**) | fin-postgres / fin-server / fin-frontend | DB 5433 (localhost+Tailscale), API 3005, web 3006/5175 |
| Development | `docker-compose.dev.yml` | fin-postgres-dev / fin-server-dev (+ local Vite :5174) | DB 5434 (localhost+Tailscale), API 3105 |
| v4 (CR027) | `docker-compose.v4.yml` (project **finv4**) | fin-postgres-v4 / fin-server-v4 | DB 5435, API 3205; own volume, flags ON |

Notes: `POSTGRES_PASSWORD` is **required** (no default — compose fails fast; set it in `.env`). The prod data volume is pinned to the legacy name `fin_postgres_data` (see comment in `docker-compose.yml`). Prod frontend build args: `VITE_NAV_LAYOUT=sidebar`, `VITE_APP_VERSION` from `.env`.

---

## 9. Development Workflow

```bash
ssh cfbieder@192.168.1.87 && cd ~/psproject
./Scripts/dev-start.sh        # tmux: db logs / nodemon / Vite HMR / shell
```

- Frontend: instant HMR. Backend: nodemon restart. DB shell: `docker exec -it fin-postgres-dev psql -U fin -d fin`.
- Frontend env per `frontend/.env-cmdrc` (local, untracked — template `.env-cmdrc.example`): `npm run tail` (Tailscale API, recommended) / `npm run dev` / `npm run docker`.
- Deploy: `./Scripts/deploy-to-production.sh` (backs up DB, rebuilds, health-checks). Apply any new migration to prod **first**.
- Dual-track v3/v4: see [DEV_WORKFLOW.md](DEV_WORKFLOW.md) and CR027 §Step 0.
- **CI:** every push/PR to `main` runs `.github/workflows/ci.yml` (backend tests on fresh DB, frontend build, secret scan).

---

## 10. Scripts (`Scripts/`)

| Script | Purpose |
|--------|---------|
| `dev-start.sh` | tmux dev environment |
| `deploy-to-production.sh` | Backup → rebuild → health-check deploy (`[--with-git] [--no-backup]`) |
| `sync-db-prod-to-dev.sh` | Copy prod DB to dev |
| `bump-version.sh` | patch/minor/major/X.Y.Z (edits `.env` VITE_APP_VERSION in place) |
| `rebuild-frontend.sh` | Quick frontend rebuild |
| `backup-to-remote.sh` | DB+config to 192.168.1.252 (cron every 2 days, 30-day retention) + Docker prune |
| `check-button-css.sh` | `.btn` guardrail (also `npm run lint:buttons`) |
| `v4-up.sh`, `sync-db-prod-to-v4.sh` | Isolated v4 stack |
| `provision-vm.sh`, `deploy-on-vm.sh` | KVM provisioning |
| `boot-reconcile-docker.sh`, `fin-docker-reconcile.service` | Boot-time `compose up -d` on prod/dev/bank-feed stacks — fixes dockerd reboot race that leaves postgres containers detached from their networks (seen 2026-07-04); unit installed + enabled in `/etc/systemd/system/` 2026-07-05 |
| `backup-mongo.sh`, `restore-mongo.sh` | **Dead (Mongo era)** — deletion backlogged |

---

## 11. Backup & Restore

- **Automated:** `backup-to-remote.sh` via cron (`0 2 */2 * *`) → `cfbieder@192.168.1.252:~/backups/fin/` (DB dump, `.env` files, `components/data/`, `certs/`; 30-day retention; log `Backups/backup-remote.log`).
- **Local:** `Backups/` (git-ignored); deploy script auto-backs-up first. Manual: `docker exec fin-postgres pg_dump -U fin -d fin -Fc > Backups/fin_backup.dump`; restore with `pg_restore --clean --if-exists`. Full restore runbook: [Guides/GUIDE_RESTORE.md](Guides/GUIDE_RESTORE.md).

---

## 12. Git

- Single trunk `main` (also the prod deploy source). A local `prepare-commit-msg` hook prepends `[vX.Y.Z YYYY-MM-DD]`.
- Multi-agent git discipline (explicit-pathspec commits, no force-push, `.env` never committed): see [CLAUDE.md](../CLAUDE.md).

---

## 13. Environment Variables

Secrets live in **untracked** files (since CR034, 2026-06-12): root `.env` (compose), `server/.env-cmdrc`, `frontend/.env-cmdrc` — templates: [`.env.example`](../.env.example), `server/.env-cmdrc.example`, `frontend/.env-cmdrc.example`.

| Variable | Where | Purpose |
|----------|-------|---------|
| `POSTGRES_PASSWORD` | `.env` (**required**, no compose default) | DB password for the `fin` user (rotated 2026-06-12) |
| `DATABASE_URL` | derived in compose / set for scripts+tests | Server & CLI DB connection; **no embedded fallback anywhere** |
| `BANK_FEED_URL` | `.env` | bank-feed service base URL (default `http://host.docker.internal:3007`) |
| `BANK_FEED_API_KEY` | `.env` (secret) | Auth for `/v1/*`; empty disables bank-feed calls; shared with the OCME consumer |
| `LLM_GATEWAY_URL` | compose default `http://192.168.1.61:8080` | Local ocr-llm gateway for AI Review (no cloud key needed) |
| `CORS_ORIGINS` | optional | Comma-separated CORS allowlist override (defaults cover dev/prod/Tailscale — `app.js`) |
| `BANK_FEED_SYNC_MAX_AGE_MIN` | optional (default 60) | Sync-before-reconcile freshness window |
| `BANK_FEED_DEDUP_ENABLED`, `BANK_FEED_CUTOFF_ENABLED` | optional | CR022/CR023 guards |
| `NODE_ENV`, `PORT` | compose | Runtime |

Removed 2026-06-12: `PS_API_KEY`/`PS_USER_ID` (dead since CR030), `ANTHROPIC_API_KEY` (replaced by the local gateway), all `findev123` defaults.

---

## 14. Data Files (`components/data/`, mounted into the server container)

`account_names.json` / `category_names.json` (PS name mappings), `appdata.json` (metadata). `FCAssump.json` is **retired** (CR039, migration 034 — forecast assumptions live in the `forecast_assumptions` table; the file remains on disk one release as a fallback artifact, nothing reads it). COA lives in SQL (`accounts` table; `getNestedTree({section})`). Balance sheet = `opening_balance + Σ transactions` with feed read-override for `balance_from_feed` leaves (CR024); FX rates auto-refresh from Frankfurter API when >3 days stale (`server/src/utils/refreshExchangeRates.js`).

---

## 15. Quick Reference

```bash
./Scripts/dev-start.sh                               # dev env
./Scripts/deploy-to-production.sh                    # deploy
./Scripts/sync-db-prod-to-dev.sh                     # prod → dev data
./Scripts/bump-version.sh patch                      # version
docker compose ps                                    # prod status
docker compose -f docker-compose.dev.yml ps          # dev status
docker exec -it fin-postgres psql -U fin -d fin      # prod DB shell
docker exec -it fin-postgres-dev psql -U fin -d fin  # dev DB shell
cd server && npm test                                # backend tests (needs DATABASE_URL)
cd frontend && npm test && npm run build             # frontend tests + build
```

---

*Last updated: 2026-06-12*
