# Fin - Personal Finance Manager

## Architecture Overview

```
                        ┌────────────────────────────┐
                        │       nginx (port 80)      │
                        │   React SPA + API proxy    │
                        └─────────┬──────────────────┘
                                  │ /api/*
                        ┌─────────▼──────────────────┐
                        │   Express 5 (port 3005)    │
                        │   Node.js Backend          │
                        └─────────┬──────────────────┘
                                  │
                        ┌─────────▼──────────────────┐
                        │  PostgreSQL 16 (port 5432) │
                        │  fin database              │
                        └────────────────────────────┘
```

**Three-service architecture:** PostgreSQL database, Node.js/Express API server, and nginx-served React SPA. All services run in Docker containers orchestrated by Docker Compose.

---

## Quick Start

All development and production runs on the VM at `192.168.1.82`.

### Connect and Run

```bash
ssh cfbieder@192.168.1.82
cd ~/Programs/fin
docker compose up --build -d
```

- Frontend (HTTPS): https://192.168.1.82:5175
- Frontend (HTTP): http://192.168.1.82:3006
- API Server: http://192.168.1.82:3005
- PostgreSQL: 192.168.1.82:5433

### Development (on VM)

```bash
# Backend (with auto-reload)
cd server && npm install && npm run dev

# Frontend (with HMR, separate terminal)
cd frontend && npm install && npm run dev
```

### VM Provisioning (from scratch)

If the VM needs to be recreated:

```bash
# From any machine with SSH access to the KVM host
ssh cfbieder@192.168.1.61 'bash -s' < provision-vm.sh

# Wait ~3-5 min for cloud-init, then deploy
ssh cfbieder@192.168.1.82 'bash -s' < deploy-on-vm.sh
```

---

## Project Structure

```
fin/
├── components/
│   ├── data/                    # Shared JSON data files (COA, account names, etc.)
│   └── reports/                 # Generated report output
├── Documentation/               # Project documentation
├── frontend/                    # React SPA
│   ├── Dockerfile               # Multi-stage build: Vite → nginx
│   ├── nginx.conf               # API proxy + SPA routing
│   ├── package.json             # React 19, Vite 7, React Router 7
│   └── src/
│       ├── App.jsx              # Router, Layout wrapper, lazy routes
│       ├── main.jsx             # Entry point, ToastProvider
│       ├── components/          # Shared UI components
│       │   ├── Layout.jsx       # NavigationMenu + Breadcrumbs + Footer
│       │   ├── NavigationMenu.jsx / .css
│       │   ├── Breadcrumbs.jsx / .css
│       │   ├── Footer.jsx / .css
│       │   ├── LoadingSpinner.jsx / .css
│       │   └── Toast.jsx / .css
│       ├── config/
│       │   └── routes.jsx       # Central route config (paths, icons, categories)
│       ├── contexts/
│       │   ├── index.js         # Re-exports all contexts
│       │   ├── ToastContext.jsx  # Toast notification system
│       │   └── ForecastContext.jsx
│       ├── features/            # Feature-based modules
│       │   ├── Database/        # UploadForm, UploadFeedback
│       │   ├── TransactionActual/
│       │   │   ├── hooks/       # useTransActualDelete, useTransActualEdit
│       │   │   ├── utils/       # transActualUtils.js
│       │   │   └── TransactionActualTable.jsx
│       │   ├── TransactionBudget/
│       │   │   ├── hooks/       # useTransBudgetDelete, useTransBudgetEdit
│       │   │   ├── utils/       # transBudgetUtils.js
│       │   │   └── TransactionBudgetTable.jsx
│       │   └── Forecast/        # FC components (Scenarios, Modules, Exp, Review)
│       ├── js/
│       │   ├── rest.js          # API helper (fetchJson, buildUrl)
│       │   └── handleUpload.js  # File upload handler
│       └── pages/               # Page components (18 pages)
├── server/                      # Express API server
│   ├── Dockerfile
│   ├── package.json             # Express 5, pg, arquero, danfojs-node
│   ├── db/
│   │   └── migrations/          # PostgreSQL schema (run on container init)
│   │       ├── 001_initial_schema.sql
│   │       └── 002_psdata_staging.sql
│   └── src/
│       ├── server.js            # HTTP server entry point
│       ├── app.js               # Express app config, route mounting
│       ├── routes/              # Legacy routes (health, coa, util)
│       └── v2/                  # PostgreSQL-based API
│           ├── db.js            # PostgreSQL connection pool
│           ├── routes/          # Route handlers
│           │   ├── index.js     # Route aggregator (mounted at /api/v2)
│           │   ├── accounts.js
│           │   ├── budget.js
│           │   ├── categories.js
│           │   ├── forecast.js
│           │   ├── health.js
│           │   ├── ingestPs.js
│           │   ├── reports.js
│           │   ├── transactions.js
│           │   └── util.js
│           ├── repositories/    # Data access layer
│           │   ├── index.js
│           │   ├── accounts.js
│           │   ├── budget.js
│           │   ├── categories.js
│           │   ├── forecast.js
│           │   ├── psdata.js
│           │   └── transactions.js
│           └── services/        # Business logic (forecast engine)
├── certs/                       # TLS certificates for nginx (generated on VM)
├── docker-compose.yml           # 3 services: postgres, server, frontend
├── provision-vm.sh              # Create 'fin' KVM guest on vmhost (192.168.1.61)
├── deploy-on-vm.sh              # Clone repo + deploy on VM (192.168.1.82)
├── rebuild-frontend.sh          # Rebuild and restart frontend container
└── .env.example                 # Environment variable template
```

---

## Frontend

### Tech Stack

| Library | Version | Purpose |
|---------|---------|---------|
| React | 19.2.0 | UI framework |
| Vite | 7.2.4 | Build tool & dev server |
| React Router DOM | 7.9.6 | Client-side routing |
| Lucide React | 0.563.0 | SVG icon library |
| env-cmd | 11.0.0 | Environment management |

### Design System

CSS custom properties defined in global styles:

- `--primary`, `--accent` - Brand colors
- `--border`, `--bg-card` - Surface colors
- `--shadow-soft` - Consistent shadows
- `--growth-positive`, `--growth-negative` - Financial indicators

### Pages & Routes

| Path | Page | Category | Description |
|------|------|----------|-------------|
| `/` | Home | - | Dashboard with quick actions |
| `/upload-ps` | UploadPS | Database | Upload PocketSmith CSV data |
| `/refresh-ps` | RefreshPS | Database | Refresh data via PocketSmith API |
| `/backup-database` | BackupDatabase | Database | Download database backup |
| `/budget-worksheet` | BudgetInput | Budgeting | Create/edit monthly budget |
| `/budget-realization` | BudgetRealization | Budgeting | Budget vs actual comparison |
| `/budget-graph` | BudgetRealizationGraph | Budgeting | Visual budget analysis |
| `/forecast-scenarios` | FCScenarios | Forecasting | Manage forecast scenarios |
| `/forecast-modules` | FCModuleManage | Forecasting | Configure balance sheet modules |
| `/forecast-setup-exp` | FCExpSetup | Forecasting | Income/expense forecast items |
| `/forecast-review` | FCReview | Forecasting | Review generated forecasts |
| `/balance` | Balance | Reports & Graphs | Balance sheet summary |
| `/cash-flow` | CashFlow | Reports & Graphs | Cash flow P&L analysis |
| `/cash-flow-monthly` | CashFlowMonthly | Reports & Graphs | Monthly cash flow breakdown |
| `/balance-chart` | BalanceChart | Reports & Graphs | Net worth chart over time |
| `/trans-actual` | TransActual | Transactions | Actual transactions browser |
| `/trans-budget` | TransBudget | Transactions | Budget transactions browser |
| `/fx-options` | FXOptions | Settings | Exchange rate configuration |
| `/coa-management` | COAManagement | Settings | Chart of accounts management |

### Navigation

The navigation uses **category landing pages** instead of dropdowns. Each category (Database, Budgeting, Forecasting, Reports & Graphs, Transactions, Settings) has a landing page at `/<category-slug>` that shows feature cards linking to individual pages.

Category paths are generated from `routes.jsx` via `getCategoryRoutes()`. The `CategoryLandingPage` component renders cards with Lucide icons, descriptions, and links.

### State Management

- **React Context**: `ToastContext` (global toasts), `ForecastContext` (forecast state shared across FC pages)
- **Local state**: Page-level `useState`/`useCallback` for form state, loading, and API responses
- **Custom hooks**: `useTransActualEdit`, `useTransActualDelete`, `useTransBudgetEdit`, `useTransBudgetDelete` encapsulate CRUD logic with toast notifications

### Key Patterns

- **Shared Layout**: `Layout.jsx` renders `NavigationMenu` + `Breadcrumbs` + page content + `Footer`. All pages return just their `<main>` content.
- **Lazy loading**: All pages except Home use `React.lazy()` with `Suspense` + `LoadingSpinner`
- **Feature modules**: Complex features (TransactionActual, TransactionBudget, Forecast) are organized as `features/<name>/` with hooks, utils, and table components
- **Toast notifications**: All CRUD operations use `useToast()` to show success/error toasts

---

## Backend

### Tech Stack

| Library | Version | Purpose |
|---------|---------|---------|
| Express | 5.1.0 | HTTP framework |
| pg | 8.13.1 | PostgreSQL client |
| Arquero | 8.0.3 | Data transformation |
| danfojs-node | 1.2.0 | DataFrame operations |
| archiver | 7.0.1 | Backup compression |
| pino | 9.6.0 | Structured logging |
| morgan | 1.10.1 | HTTP request logging |

### API Endpoints

All v2 endpoints are mounted at `/api/v2`.

#### Transactions (`/api/v2/transactions`)
- `GET /` - List transactions (with filtering, pagination)
- `GET /:id` - Get single transaction
- `POST /` - Create transaction
- `PATCH /:id` - Update transaction
- `DELETE /` - Bulk delete transactions

#### Accounts (`/api/v2/accounts`)
- `GET /` - List all accounts
- `GET /:id` - Get single account
- `POST /` - Create account
- `PUT /:id` - Update account
- `DELETE /:id` - Delete account

#### Categories (`/api/v2/categories`)
- `GET /` - List all categories
- `GET /:id` - Get single category
- `POST /` - Create category
- `PUT /:id` - Update category
- `DELETE /:id` - Delete category

#### Budget (`/api/v2/budget`)
- `GET /entries` - List budget entries (filtered by year, version)
- `POST /entries` - Create budget entry
- `PATCH /entries/:id` - Update budget entry
- `DELETE /entries` - Bulk delete budget entries
- `GET /rates` - Get exchange rates for budget

#### Forecast (`/api/v2/forecast`)
- `GET /scenarios` - List forecast scenarios
- `POST /scenarios` - Create scenario
- `DELETE /scenarios/:id` - Delete scenario
- `POST /scenarios/:id/copy` - Copy scenario
- `POST /scenarios/:id/commit` - Generate forecast entries
- `GET /modules` - List forecast modules
- `POST /modules` - Create module
- `PUT /modules/:id` - Update module
- `DELETE /modules/:id` - Delete module
- `GET /income-expense` - List income/expense items
- `POST /income-expense` - Create income/expense item
- `PUT /income-expense/:id` - Update item
- `DELETE /income-expense/:id` - Delete item
- `GET /entries` - Get generated forecast entries
- `POST /reload-defaults` - Reset to default scenario

#### Reports (`/api/v2/reports`)
- `GET /balance` - Balance sheet report
- `GET /cash-flow` - Cash flow report
- `GET /cash-flow-monthly` - Monthly cash flow breakdown

#### Ingest PS (`/api/v2/ingest-ps`)
- `POST /` - Ingest uploaded CSV into database
- `POST /refresh-ps` - Fetch from PocketSmith API and import
- `POST /clearall` - Clear all PS staging records
- `GET /psdata/count` - Count of staging records
- `GET /analyze-ps` - Analyze PS data for missing accounts/categories
- `GET /new-transactions` - Get newly imported transactions
- `GET /modified-transactions` - Get modified transactions
- `POST /appdata/last-refresh` - Update last refresh timestamp

#### Utility (`/api/v2/util`)
- `GET /appdata` - Get application metadata
- `POST /backup-database` - Create and download PostgreSQL backup

#### Health (`/api/v2/health`)
- `GET /` - Health check with database connectivity status

### Repository Pattern

Data access uses a repository pattern (`server/src/v2/repositories/`). Each repository encapsulates SQL queries for its domain:

| Repository | Tables |
|-----------|--------|
| `accounts.js` | accounts |
| `categories.js` | categories |
| `transactions.js` | transactions, pending_transactions |
| `budget.js` | budget_entries, budget_versions |
| `forecast.js` | forecast_scenarios, forecast_modules, forecast_income_expense, forecast_entries, and sub-tables |
| `psdata.js` | psdata_staging, app_data |

### Forecast Engine

The forecast engine (`server/src/v2/services/`) generates multi-year financial projections:

1. Takes a scenario with modules (balance sheet items) and income/expense items
2. Applies growth rates, investments, disposals, and income percentage schedules
3. Produces yearly forecast entries stored in `forecast_entries`

---

## Database

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

### Migrations

SQL migrations in `server/db/migrations/` run automatically on PostgreSQL container initialization via Docker's `initdb.d` volume mount.

---

## Docker Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `fin-postgres` | postgres:16-alpine | 5433:5432 | PostgreSQL database |
| `server` | Custom (Node.js) | 3005:3005 | Express API server |
| `frontend` | Custom (nginx) | 3006:80, 5175:443 | SPA hosting + API proxy |

### Build Commands

```bash
# Full rebuild (on VM)
ssh cfbieder@192.168.1.82
cd ~/Programs/fin
docker compose up --build -d

# Rebuild single service
docker compose up --build -d frontend

# View logs
docker compose logs -f server

# Database shell
docker compose exec fin-postgres psql -U fin -d fin
```

### Volumes

- `postgres_data` - PostgreSQL data persistence
- `./components/data` - Shared JSON data files (mounted in server)
- `./components/reports` - Generated reports (mounted in server)
- `./certs` - TLS certificates (mounted in frontend/nginx)

---

## Data Files

Located in `components/data/`:

| File | Purpose |
|------|---------|
| `account_names.json` | PocketSmith account name mappings |
| `category_names.json` | PocketSmith category name mappings |
| `coa.json` | Chart of accounts definition |

These files are mounted into the server container and used during PocketSmith data ingestion to map external names to internal account/category IDs.
