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

### Production Environment

Production runs entirely in Docker containers:

```bash
ssh cfbieder@192.168.1.82
cd ~/Programs/fin
docker compose up -d
```

**Access Points:**
- **Tailscale HTTPS:** https://fin.tail413695.ts.net (recommended)
- Frontend (HTTPS): https://192.168.1.82:5175
- Frontend (HTTP): http://192.168.1.82:3006
- API Server: http://192.168.1.82:3005
- PostgreSQL: 192.168.1.82:5433

**Environment Indicator:** Blue browser tab

### Development Environment

Development uses **Docker only for the database**. The backend and frontend run locally via npm for instant code reload:

```
┌─────────────────────────────────────────────────────────────┐
│  VM (192.168.1.82)                                          │
│                                                             │
│  ┌─────────────────────┐   ┌──────────────────────────┐    │
│  │ Docker               │   │ Local npm processes      │    │
│  │                      │   │                          │    │
│  │  fin-postgres-dev    │   │  Backend (nodemon)       │    │
│  │  Port 5434           │◄──│  npm run dev             │    │
│  │                      │   │  Port 3105               │    │
│  └──────────────────────┘   │                          │    │
│                              │  Frontend (Vite HMR)     │    │
│                              │  npm run tail            │    │
│                              │  Port 5174               │    │
│                              └──────────────────────────┘    │
│                                        ▲                     │
│  Tailscale IP: 100.100.162.49          │                     │
└────────────────────────────────────────┼─────────────────────┘
                                         │
                              ┌──────────┴─────────────┐
                              │ Remote machine          │
                              │ (access via Tailscale)  │
                              └─────────────────────────┘
```

**What runs where:**

| Component | How it runs | Port | Auto-reload? |
|-----------|-------------|------|--------------|
| **Database** | Docker (`fin-postgres-dev`) | 5434 | N/A |
| **Backend** | Local `npm run dev` (nodemon) | 3105 | Yes (~1-2s on file save) |
| **Frontend** | Local `npm run tail` (Vite) | 5174 | Yes (instant HMR) |

Development and production use different ports, so both can run simultaneously.

**Access Points (via Tailscale from remote machine):**
- Frontend: `http://100.100.162.49:5174`
- Dev Backend: `http://100.100.162.49:3105`
- Dev Database: `100.100.162.49:5434`

**Environment Indicator:** Yellow browser tab, "[DEV]" in page title

**Features:**
- Frontend: Hot module replacement (instant updates on save)
- Backend: Auto-restart via nodemon (~1-2 seconds on save)
- Separate database with production data for safe testing
- Production remains fully running (no port conflicts)

### Starting Development

Use the tmux script for the recommended setup:

```bash
ssh cfbieder@192.168.1.82
cd ~/Programs/fin
./Scripts/dev-start.sh
```

This creates a tmux session with 4 windows:
1. **database** - Starts Docker `fin-postgres-dev` + shows logs
2. **backend** - Runs `npm run dev` in `server/` (nodemon)
3. **frontend** - Runs `npm run tail` in `frontend/` (Vite HMR)
4. **shell** - Command shell for scripts

See [TMUX_GUIDE.md](TMUX_GUIDE.md) for navigation and usage details.

**Note:** `Scripts/dev-start.sh` only starts the database in Docker. It does NOT start `server-dev` from `docker-compose.dev.yml`. The backend runs directly on the VM via nodemon for instant code reload.

### VM Provisioning (from scratch)

If the VM needs to be recreated:

```bash
# From any machine with SSH access to the KVM host
ssh cfbieder@192.168.1.61 'bash -s' < Scripts/provision-vm.sh

# Wait ~3-5 min for cloud-init, then deploy
ssh cfbieder@192.168.1.82 'bash -s' < Scripts/deploy-on-vm.sh
```

---

## Project Structure

```
fin/
├── components/
│   ├── data/                    # Shared JSON data files (COA, account names, etc.)
│   └── reports/                 # Generated report output
├── docs/               # Project documentation
│   ├── PROJECT_STRUCTURE.md     # This file - project architecture
│   ├── MIGRATION_PLAN.md        # MongoDB → PostgreSQL migration plan
│   ├── MIGRATION_STATUS.md      # Migration completion status
│   └── DOCKER.md                # Docker setup and deployment
├── frontend/                    # React SPA
│   ├── Dockerfile               # Multi-stage build: Vite → nginx
│   ├── nginx.conf               # API proxy + SPA routing
│   ├── package.json             # React 19, Vite 7, React Router 7
│   ├── .env-cmdrc               # Environment configurations (development, tail, production, etc.)
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
│   ├── nodemon.json             # Nodemon configuration for auto-restart in dev
│   ├── .env-cmdrc               # Backend environment configurations
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
├── VERSION                      # Current version number (e.g., 2.0.1)
├── docker-compose.yml           # Production: 3 services (postgres, server, frontend)
├── docker-compose.dev.yml       # Development: postgres-dev only (backend + frontend via npm)
├── Scripts/                     # Shell scripts
│   ├── provision-vm.sh          # Create 'fin' KVM guest on vmhost (192.168.1.61)
│   ├── deploy-on-vm.sh          # Clone repo + deploy on VM (192.168.1.82)
│   ├── rebuild-frontend.sh      # Rebuild and restart frontend container
│   ├── sync-db-prod-to-dev.sh   # Copy production database to development
│   ├── deploy-to-production.sh  # Deploy development changes to production
│   ├── bump-version.sh          # Increment version (patch/minor/major)
│   ├── dev-start.sh             # Start tmux development environment
│   ├── backup-mongo.sh          # Legacy MongoDB backup (deprecated)
│   └── restore-mongo.sh         # Legacy MongoDB restore (deprecated)
├── NOTES.md                     # Quick reference notes
└── .env.example                 # Environment variable template
```

---

## Development & Deployment Scripts

### Version Management

**`Scripts/bump-version.sh`** - Semantic version management

```bash
./Scripts/bump-version.sh patch    # 2.0.0 → 2.0.1
./Scripts/bump-version.sh minor    # 2.0.0 → 2.1.0
./Scripts/bump-version.sh major    # 2.0.0 → 3.0.0
./Scripts/bump-version.sh 2.1.5    # Set specific version
```

Updates:
- `VERSION` file
- All `VITE_APP_VERSION` entries in `frontend/.env-cmdrc`
- `package.json` files (root, frontend, server)
- Optionally creates git commit and tag

The version is displayed in the navigation menu navbar and can be incremented at any time.

### Database Management

**`Scripts/sync-db-prod-to-dev.sh`** - Copy production data to development

```bash
./Scripts/sync-db-prod-to-dev.sh
```

- Creates PostgreSQL backup from production database
- Restores backup to development database
- Includes safety prompts and transaction count verification
- Allows testing with real production data in a safe development environment

### Deployment

**`Scripts/deploy-to-production.sh`** - Deploy changes to production

```bash
./Scripts/deploy-to-production.sh           # Deploy without git operations
./Scripts/deploy-to-production.sh --with-git # Deploy with git commit/push
```

- Creates database backup before deployment
- Rebuilds and restarts production containers
- Verifies container health after deployment
- Git operations are opt-in (use `--with-git` flag)

**`Scripts/rebuild-frontend.sh`** - Quick frontend rebuild

```bash
./Scripts/rebuild-frontend.sh
```

Rebuilds and restarts only the frontend container (faster than full deployment).

### Environment Management

**Frontend environments** (`.env-cmdrc`):

| Environment | npm script | API Base | Use Case |
|-------------|-----------|----------|----------|
| `development` | `npm run dev` | `http://localhost:3105` | **Development on the VM** (local backend) |
| `tail` | `npm run tail` | `http://100.100.162.49:3105` | **Development via Tailscale** (recommended) |
| `docker` | `npm run docker` | (empty - uses nginx proxy) | Production Docker build |
| `production` | `npm run production` | `http://192.168.1.82:3005` | Direct production API access |

All development environments point to port 3105 (the local npm backend). The `tail` env is the standard choice since development is done remotely via Tailscale.

**Backend environments** (`.env-cmdrc`):

| Environment | npm script | Database | Port |
|-------------|-----------|----------|------|
| `development` | `npm run dev` | `localhost:5434` | 3105 |
| `production` | `npm run dok` | (Docker network) | 3005 |

### Visual Environment Indicators

The application uses visual cues to distinguish environments:

- **Development:** Yellow/amber browser tab color (`#f59e0b`), page title shows "FI [DEV]"
- **Production:** Dark blue browser tab color (`#1a1f36`), page title shows "FI"

This is controlled by `VITE_APP_MODE` in `.env-cmdrc` and implemented in `main.jsx`.

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

### Production Environment

Configured in `docker-compose.yml`:

| Container | Image | Ports | Purpose |
|-----------|-------|-------|---------|
| `fin-postgres` | postgres:16-alpine | 5433:5432 | PostgreSQL database |
| `fin-server` | Custom (Node.js) | 3005:3005 | Express API server |
| `fin-frontend` | Custom (nginx) | 3006:80, 5175:443 | SPA hosting + API proxy |

All services connected via `fin_fin-network` Docker bridge network.

### Development Environment

Only the database runs in Docker for development. Backend and frontend run locally via npm:

| Component | How it runs | Port |
|-----------|-------------|------|
| `fin-postgres-dev` | Docker (`docker-compose.dev.yml`) | 5434:5432 |
| Backend | Local `npm run dev` (nodemon) | 3105 |
| Frontend | Local `npm run tail` (Vite) | 5174 |

**Note:** `docker-compose.dev.yml` also defines a `server-dev` container (port 3105), but this is NOT used for active development. The local npm backend with nodemon provides instant auto-reload on file changes, which the Docker container does not (it requires a rebuild).

### Tailscale Integration

The VM has Tailscale installed for secure remote HTTPS access:

```bash
# View Tailscale status
sudo tailscale status

# View serve configuration
sudo tailscale serve status
```

**Current configuration:**
- Tailscale URL: `https://fin.tail413695.ts.net`
- Proxies to: `https+insecure://localhost:5175` (production frontend)
- Auto-starts on boot via systemd

This provides automatic HTTPS certificates and secure access to the application from any device on your Tailnet without exposing ports to the internet.

### Build Commands

```bash
# Production - Full rebuild
docker compose up --build -d

# Production - Rebuild single service
docker compose up --build -d frontend

# Production - View logs
docker compose logs -f server

# Development - Start database only
docker compose -f docker-compose.dev.yml up -d fin-postgres-dev

# Development - Start backend (separate terminal)
cd server && npm run dev

# Development - Start frontend (separate terminal)
cd frontend && npm run tail

# Database shell (production)
docker compose exec fin-postgres psql -U fin -d fin

# Database shell (development)
docker compose -f docker-compose.dev.yml exec fin-postgres-dev psql -U fin -d fin
```

### Volumes

**Production:**
- `postgres_data` - PostgreSQL data persistence
- `./components/data` - Shared JSON data files (mounted in server)
- `./components/reports` - Generated reports (mounted in server)
- `./certs` - TLS certificates (mounted in frontend/nginx)

**Development:**
- `postgres_data_dev` - Development PostgreSQL data persistence (separate from production)

---

## Development Workflow

### Typical Development Session

1. **Start development environment:**
   ```bash
   # Option A: Using tmux (recommended)
   ./Scripts/dev-start.sh

   # Option B: Manual (3 terminals)
   docker compose -f docker-compose.dev.yml up -d fin-postgres-dev
   cd server && npm run dev        # Terminal 1: backend (nodemon)
   cd frontend && npm run tail     # Terminal 2: frontend (Vite)
   ```

2. **Sync production data (if needed):**
   ```bash
   ./Scripts/sync-db-prod-to-dev.sh
   ```

3. **Make changes:**
   - Frontend changes: Save → Instant hot reload
   - Backend changes: Save → Auto-restart in ~1-2 seconds (via nodemon)
   - Database changes: Run SQL directly in dev database

4. **Test changes:**
   - Access via Tailscale: `http://100.100.162.49:5174`
   - Yellow tab confirms development environment

5. **Increment version (when ready):**
   ```bash
   ./Scripts/bump-version.sh patch
   ```

6. **Deploy to production:**
   ```bash
   ./Scripts/deploy-to-production.sh
   ```

7. **Verify production:**
   - Access via Tailscale: `https://fin.tail413695.ts.net`
   - Blue tab confirms production environment

### Key Development Features

**Hot Module Replacement (Frontend):**
- Changes to React components appear instantly in browser
- No manual refresh needed
- Preserves application state during updates

**Auto-Restart (Backend):**
- Nodemon watches `src/` and `db/` directories
- Restarts server automatically on file changes
- 1-second delay to batch multiple changes
- See `server/nodemon.json` for configuration

**Separate Databases:**
- Production and development use completely separate PostgreSQL instances
- Safe to experiment with schema changes in development
- Use `Scripts/sync-db-prod-to-dev.sh` to refresh development data from production
- Development database persists across container restarts

**Environment Isolation:**
- Production and development use completely separate databases (ports 5433 vs 5434)
- Production backend (port 3005) and dev backend (port 3105) use different ports — no conflicts
- Both environments can run simultaneously

### Best Practices

1. **Always test in development first** - Never make changes directly in production
2. **Sync data regularly** - Keep development database current with `Scripts/sync-db-prod-to-dev.sh`
3. **Use version numbers** - Increment version before deploying significant changes
4. **Monitor deployments** - Check container health after deployment
5. **Keep tmux running** - Detach from tmux (Ctrl+b d) instead of stopping; reattach when needed

---

## Data Files

Located in `components/data/`:

| File | Purpose |
|------|---------|
| `account_names.json` | PocketSmith account name mappings |
| `category_names.json` | PocketSmith category name mappings |
| `coa.json` | Chart of accounts definition |

These files are mounted into the server container and used during PocketSmith data ingestion to map external names to internal account/category IDs.
