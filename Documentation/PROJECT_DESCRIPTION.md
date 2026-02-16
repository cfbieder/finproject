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

**Three-service architecture:** PostgreSQL database, Node.js/Express API server, and nginx-served React SPA. All services run in Docker containers orchestrated by Docker Compose.

---

## 2. Infrastructure

### VM

| Field | Value |
|-------|-------|
| IP | `192.168.1.82` (static, bridged via `br0`) |
| OS | Ubuntu 24.04 LTS (Noble) |
| vCPUs / RAM / Disk | 2 / 4 GB / 40 GB (qcow2 overlay) |
| User | `cfbieder` (sudo NOPASSWD, SSH key auth) |
| Docker | 29.2.1, Compose v5.0.2 |
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
ssh cfbieder@192.168.1.82          # VM (primary)
ssh cfbieder@192.168.1.61          # KVM host (VM management only)
```

### Tailscale

- URL: `https://fin.tail413695.ts.net`
- Proxies to: `https+insecure://localhost:5175` (production frontend)
- Auto-starts on boot via systemd

### Access URLs

| Environment | Frontend HTTPS | Frontend HTTP | API | Database |
|-------------|---------------|---------------|-----|----------|
| **Production** | `https://192.168.1.82:5175` | `http://192.168.1.82:3006` | `http://192.168.1.82:3005` | `192.168.1.82:5433` |
| **Production (Tailscale)** | `https://fin.tail413695.ts.net` | - | - | - |
| **Development** | `http://100.100.162.49:5174` | - | `http://100.100.162.49:3105` | `100.100.162.49:5434` |

---

## 3. Tech Stack

### Frontend

| Library | Version | Purpose |
|---------|---------|---------|
| React | 19.2.0 | UI framework |
| Vite | 7.2.4 | Build tool & dev server |
| React Router DOM | 7.9.6 | Client-side routing |
| Lucide React | 0.563.0 | SVG icon library |
| env-cmd | 11.0.0 | Environment management |

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
fin/
├── components/
│   ├── data/                    # Runtime data files (appdata, PS name mappings, forecast assumptions)
│   └── reports/                 # Generated report output
├── Documentation/               # Project documentation
│   ├── PROJECT_DESCRIPTION.md   # This file
│   ├── PROJECT_ROADMAP.md       # Future work and known issues
│   ├── TMUX_GUIDE.md            # tmux development guide
│   └── Old/                     # Archived documentation
├── frontend/                    # React SPA
│   ├── Dockerfile               # Multi-stage build: Vite -> nginx
│   ├── nginx.conf               # API proxy + SPA routing
│   ├── package.json
│   ├── .env-cmdrc               # Environment configurations
│   └── src/
│       ├── App.jsx              # Router, Layout wrapper, lazy routes
│       ├── main.jsx             # Entry point, ToastProvider
│       ├── components/          # Shared UI (Layout, NavigationMenu, Breadcrumbs, Footer, Toast, LoadingSpinner, MonthYearPicker, PeriodCountSelector, CategorySelector, PeriodSelector, AccountSelector)
│       ├── config/routes.jsx    # Central route config (paths, icons, categories)
│       ├── contexts/            # ToastContext, ForecastContext
│       ├── features/            # Feature modules (Balances, BudgetEntry, Budgets, CashFlow, Charts, COAManagement, Database, Forecast, Transaction)
│       ├── js/                  # API helpers (rest.js, handleUpload.js)
│       └── pages/               # Page components (20 pages + category landing)
├── server/                      # Express API server
│   ├── Dockerfile
│   ├── package.json
│   ├── nodemon.json
│   ├── .env-cmdrc
│   ├── db/migrations/           # PostgreSQL schema (001_initial_schema.sql, 002_psdata_staging.sql)
│   └── src/
│       ├── server.js            # HTTP server entry point
│       ├── app.js               # Express app config, route mounting
│       └── v2/                  # PostgreSQL-based API (all routes)
│           ├── db.js            # PostgreSQL connection pool
│           ├── routes/          # Route handlers (accounts, budget, categories, forecast, health, ingestPs, reports, transactions, util)
│           ├── repositories/    # Data access layer (accounts, budget, categories, forecast, psdata, transactions)
│           └── services/        # Business logic (psCsvIngestorV2, refreshPsApiV2)
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
├── docker-compose.dev.yml       # Development: postgres-dev only
└── NOTES.md                     # Quick reference notes
```

---

## 5. Frontend

### Pages & Routes

| Path | Page | Category | Description |
|------|------|----------|-------------|
| `/` | Home | - | Dashboard with quick actions |
| `/upload-ps` | UploadPS | Database | Upload PocketSmith CSV data |
| `/refresh-ps` | RefreshPS | Database | Refresh data via PocketSmith API; tabbed view (Review & Edit New / New Transactions / Modified) with inline transaction editing using shared `TransactionTable` + `TransactionEditModal` + `CategorySelector` |
| `/backup-database` | BackupDatabase | Database | Download database backup |
| `/budget-worksheet` | BudgetInput | Budgeting | Budget worksheet with collapsible filter controls (PeriodSelector, CategorySelector, AccountSelector), tabbed Balances/Budget Entry panel showing selected category |
| `/budget-realization` | BudgetRealization | Budgeting | Budget vs actual comparison |
| `/budget-graph` | BudgetRealizationGraph | Budgeting | Visual budget analysis |
| `/budget-variances` | BudgetVariances | Budgeting | Line items ranked by largest variance |
| `/forecast-scenarios` | FCScenarios | Forecasting | Manage forecast scenarios |
| `/forecast-modules` | FCModuleManage | Forecasting | Configure balance sheet modules |
| `/forecast-setup-exp` | FCExpSetup | Forecasting | Income/expense forecast items |
| `/forecast-review` | FCReview | Forecasting | Review generated forecasts |
| `/balance` | Balance | Reports & Graphs | Balance sheet summary |
| `/cash-flow` | CashFlow | Reports & Graphs | Cash flow P&L analysis |
| `/cash-flow-monthly` | CashFlowMonthly | Reports & Graphs | Monthly cash flow breakdown |
| `/balance-chart` | BalanceChart | Reports & Graphs | Net worth chart over time |
| `/trans-actual` | TransActual | Transactions | Actual transactions browser with collapsible filter bar (PeriodSelector, CategorySelector, AccountSelector), description search, value range filters, date format mm/dd/yy |
| `/trans-budget` | TransBudget | Transactions | Budget transactions browser with collapsible filter bar (PeriodSelector, CategorySelector, AccountSelector), value range filters, date format mm/dd/yy |
| `/fx-options` | FXOptions | Settings | Exchange rate configuration |
| `/coa-management` | COAManagement | Settings | Chart of accounts CRUD, PS analysis, quick-add |

### Navigation

Category landing pages instead of dropdowns. Each category has a landing page at `/<category-slug>` showing feature cards with Lucide icons. Generated from `routes.jsx` via `getCategoryRoutes()`.

### State Management

- **React Context**: `ToastContext` (global toasts), `ForecastContext` (forecast state shared across FC pages)
- **Local state**: Page-level `useState`/`useCallback` for form state, loading, and API responses
- **Custom hooks**: `useTransactionEdit`, `useTransactionDelete`, `useTransactionSelection`, `useBudgetEntrySubmit`, `useFCExpCrud` encapsulate CRUD logic with toast notifications

### Key Patterns

- **Shared Layout**: `Layout.jsx` renders `NavigationMenu` + `Breadcrumbs` + page content + `Footer`. Reusable `MonthYearPicker` and `PeriodCountSelector` components shared across pages
- **Shared selectors**: `CategorySelector` (COA-hierarchy, searchable), `AccountSelector` (currency-grouped, searchable), `PeriodSelector` (preset-based periods) — reusable across pages
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
| **CategorySelector** | `CategorySelector/CategorySelector.jsx` | Searchable, COA-hierarchy-ordered category selector. Accepts `plTree` (from `useCoa`) for hierarchy ordering, `selectedCategories` + `onCategoriesChange` for selection, `categoryGroupOptions` for group presets (Income all, Expense all, etc.). Includes type-to-filter search input. Used on Budget Worksheet (multi-select) and in `TransactionEditModal` (single-select mode via `plTree` prop). |
| **PeriodSelector** | `PeriodSelector/PeriodSelector.jsx` | Preset-based period picker with standard presets: This Month, This Month Prior Year, Last Month, Last Month Prior Year, This Year, Last Year, Custom. Auto-computes `fromMonth`/`toMonth`/`actualYear`/`budgetYear` from selected preset. "Custom" reveals manual dropdowns (Budget Year hidden via `hideBudgetYear` prop). Supports controlled + uncontrolled modes (dual-state pattern). Used on Budget Worksheet, Actual Transactions, Budget Transactions. |
| **AccountSelector** | `AccountSelector/AccountSelector.jsx` | Searchable, currency-grouped account multi-select. Accepts `accountOptions` (string[]) and `accountCurrencyMap` (Map from `useCoa`) to group accounts by currency. Includes type-to-filter search, "All" option pinned at top, and currency group headers (USD, EUR, etc.). `selectedAccounts` + `onAccountsChange` for selection. Used on Budget Worksheet, Actual Transactions, Budget Transactions. Eliminates the need for a separate currency filter on transaction pages. |

### Visual Environment Indicators

- **Development:** Yellow/amber browser tab (`#f59e0b`), title shows "FI [DEV]"
- **Production:** Dark blue browser tab (`#1a1f36`), title shows "FI"

Controlled by `VITE_APP_MODE` in `.env-cmdrc`, implemented in `main.jsx`.

---

## 6. Backend

### API Endpoints

All endpoints mounted at `/api/v2`. Nginx rewrites legacy `/api/*` paths to `/api/v2/*`. No V1 routes remain.

#### Accounts (`/api/v2/accounts`)
- `GET /` — List | `GET /tree` — Hierarchical tree | `GET /traits` — Traits map | `GET /balances` — Account balances
- `GET /categories` — Categories mapped to accounts | `GET /:id` — Single | `GET /:id/children` | `GET /:id/descendants`
- `POST /` — Create | `PATCH /:id` — Update | `DELETE /:id` — Soft delete

#### Budget (`/api/v2/budget`)
- `GET /versions` — List versions | `GET /versions/:id` | `POST /versions` | `POST /versions/:id/copy` | `PATCH /versions/:id`
- `GET /entries` — List entries | `GET /entries/:id` | `POST /entries` — Create (single/batch) | `PATCH /entries/:id` | `DELETE /entries/:id`
- `GET /entries/summary/by-category` | `GET /entries/summary/by-month` | `GET /compare` — Budget vs actual
- `GET /summary` — Budget vs actual by month | `GET /category-groups` — Income/Expense groups from COA
- `GET /` — v1 compat entries | `GET /actual-entries` — v1 compat actuals | `GET /cash-flow` — Budget cash flow P&L

#### Categories (`/api/v2/categories`)
- `GET /` — List | `GET /tree` — Hierarchical tree | `GET /totals` — Category totals
- `GET /:id` — Single | `POST /` — Create | `PATCH /:id` — Update | `DELETE /:id` — Soft delete

#### Forecast (`/api/v2/forecast`)
- `GET /assumptions` | `PUT /assumptions` — File-based assumptions with PostgreSQL scenarios
- `GET /scenarios` | `GET /scenarios/years/:scenario` | `DELETE /scenarios/byname/:name` | `POST /scenarios/byname/:name/copy`
- `GET /modules` | `GET /modules/unmatched` | `POST /modules` | `PUT /modules/:id` | `DELETE /modules/:id`
- `GET /incomeexpense` | `POST /incomeexpense` | `PUT /incomeexpense/:id` | `DELETE /incomeexpense/:id`
- `GET /entries` | `POST /generate/:scenario`
- `GET /audittrail/:scenario/:module` | `DELETE /audittrail/:scenario`

#### Health (`/api/v2/health`)
- `GET /` — Health check with DB connectivity

#### Ingest PS (`/api/v2/ingest-ps`)
- `POST /` — Ingest CSV (auto-sync) | `POST /upload-ps` — Upload CSV file | `POST /refresh-ps` — Fetch from API (auto-sync)
- `POST /clearall` — Clear staging | `POST /sync-to-transactions` — Sync staging to transactions
- `GET /psdata/count` | `GET /psdata/options` — Distinct accounts/categories
- `GET /analyze-ps` | `POST /analyze-ps` — Analyze for missing accounts/categories
- `GET /new-transactions` | `GET /modified-transactions` | `POST /review-new-transactions` — Review editable new transactions (queries `psdata_staging` LEFT JOIN `transactions`)
- `POST /appdata/last-refresh`

#### Reports (`/api/v2/reports`)
- `GET /balance` — Balance sheet | `GET /cash-flow` — P&L report | `GET /cash-flow/transactions` — Transactions by category

#### Transactions (`/api/v2/transactions`)
- `GET /` — List (with filtering, pagination) | `GET /summary/by-category` | `GET /summary/by-month`
- `GET /:id` — Single | `POST /` — Create | `PATCH /:id` — Update | `DELETE /:id` — Delete

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
| `forecast.js` | forecast_scenarios, forecast_modules, forecast_income_expense, forecast_entries, and sub-tables |
| `psdata.js` | psdata_staging, app_data |

### Forecast Engine

Located in `server/src/v2/services/`. Generates multi-year financial projections:
1. Takes a scenario with modules (balance sheet items) and income/expense items
2. Applies growth rates, investments, disposals, and income percentage schedules
3. Produces yearly forecast entries stored in `forecast_entries`

---

## 7. Database

### PostgreSQL Schema

**Enum types:** `account_type` (asset, liability, equity, income, expense), `account_section` (balance_sheet, profit_loss)

#### Core Tables

| Table | Purpose |
|-------|---------|
| `accounts` | Chart of accounts with hierarchy (adjacency list via `parent_id`) |
| `categories` | PocketSmith categories mapped to accounts |
| `transactions` | Actual financial transactions |
| `pending_transactions` | Staging for new/modified PocketSmith transactions |
| `budget_versions` | Named budget versions per year |
| `budget_entries` | Individual budget line items |

#### Forecast Tables

| Table | Purpose |
|-------|---------|
| `forecast_scenarios` | Named forecast scenarios |
| `forecast_modules` | Balance sheet forecast modules |
| `forecast_module_income_pct` | Module income percentage schedules |
| `forecast_module_investments` | Planned module investments |
| `forecast_module_disposals` | Planned module disposals |
| `forecast_income_expense` | Income/expense forecast items |
| `forecast_incexp_changes` | Scheduled income/expense changes |
| `forecast_entries` | Generated forecast output |

#### Configuration Tables

| Table | Purpose |
|-------|---------|
| `forecast_assumptions` | Scenario-level or global assumptions (JSONB) |
| `exchange_rates` | Historical FX rates |
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

SQL migrations in `server/db/migrations/` run automatically on PostgreSQL container initialization via Docker's `initdb.d` volume mount.

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

Only the database runs in Docker. Backend and frontend run locally via npm:

| Component | How it runs | Port |
|-----------|-------------|------|
| `fin-postgres-dev` | Docker | 5434 |
| Backend | `npm run dev` (nodemon) | 3105 |
| Frontend | `npm run tail` (Vite) | 5174 |

Production and development use different ports, so both can run simultaneously.

### Volumes

**Production:** `postgres_data`, `./components/data`, `./components/reports`, `./certs`
**Development:** `postgres_data_dev`

---

## 9. Development Workflow

### Quick Start

```bash
ssh cfbieder@192.168.1.82
cd ~/Programs/fin
./Scripts/dev-start.sh
```

Creates a tmux session (`fin-dev`) with 4 windows: database logs, backend (nodemon), frontend (Vite HMR), shell.

See [TMUX_GUIDE.md](TMUX_GUIDE.md) for navigation details.

### Making Changes

- **Frontend** (`frontend/src/`): Save -> instant hot reload (Vite HMR)
- **Backend** (`server/src/`): Save -> auto-restart in ~1-2s (nodemon)
- **Database**: `docker compose -f docker-compose.dev.yml exec fin-postgres-dev psql -U fin -d fin`

### Frontend Environments (`.env-cmdrc`)

| npm script | API Target | Use Case |
|-----------|------------|----------|
| `npm run tail` | `http://100.100.162.49:3105` | **Development via Tailscale (recommended)** |
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
| `provision-vm.sh` | Create VM on KVM host | `ssh cfbieder@192.168.1.61 'bash -s' < Scripts/provision-vm.sh` |
| `deploy-on-vm.sh` | Deploy app on VM | `ssh cfbieder@192.168.1.82 'bash -s' < Scripts/deploy-on-vm.sh` |

---

## 11. Backup & Restore

All backups are saved to the `Backups/` directory (git-ignored).

The deploy script automatically creates a timestamped backup before deploying.

```bash
# Manual backup
mkdir -p Backups
docker exec fin-postgres pg_dump -U fin -d fin -Fc > Backups/fin_backup.dump

# Restore
docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < Backups/fin_backup.dump

# Copy backup off-VM
scp cfbieder@192.168.1.82:~/Programs/fin/Backups/fin_backup.dump ./
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

No `.env` file. All config uses defaults from `docker-compose.yml`:

| Variable | Default Value | Purpose |
|----------|---------------|---------|
| `POSTGRES_PASSWORD` | `findev123` | Database password |
| `DATABASE_URL` | `postgres://fin:findev123@fin-postgres:5432/fin` | Server DB connection |
| `PS_API_KEY` | (in docker-compose.yml) | PocketSmith API key |
| `PS_USER_ID` | `330430` | PocketSmith user ID |
| `NODE_ENV` | `production` | Server environment |
| `PORT` | `3005` | Server port |

---

## 14. Data Files

Located in `components/data/` (mounted into server container):

| File | Purpose |
|------|---------|
| `account_names.json` | PocketSmith account name mappings |
| `category_names.json` | PocketSmith category name mappings |
| `appdata.json` | Application metadata (last ingest/refresh timestamps) |
| `FCAssump.json` | Forecast assumptions (inflation, FX, tax rates) |
| `.temp/` | Temporary files for PS API refresh pipeline |

**COA in SQL:** The chart of accounts lives in the `accounts` table (adjacency list via `parent_id`) with `section` (balance_sheet / profit_loss) and `account_type` enums. The accounts repository provides `getNestedTree({ section })` returning `{ name, children }` trees via recursive CTE. All endpoints (reports, budget, forecast, COA management) use this SQL-based COA. The former `coa.json` and `coa_traits.json` files have been removed.

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

*Last updated: 2026-02-16*
