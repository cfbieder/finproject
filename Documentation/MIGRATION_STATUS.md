# Fin Project - Full Status Report

**Date:** 2026-02-07
**Machine:** Linux 6.8.0-90-generic (Ubuntu)
**Location:** `/home/cfbieder/Programs/fin`

---

## 1. Git Status

| Field | Value |
|-------|-------|
| Remote | `https://github.com/cfbieder/psproject.git` |
| Branch | `main` (only branch) |
| Remote sync | **1 commit ahead of origin/main** (unpushed) |
| Stashes | None |

### Unpushed commit (on local, not on GitHub)

```
82f49b8 upgrade ui
```

Files in that commit:
- `Documentation/PROJECT_STRUCTURE.md` (new)
- `frontend/src/components/DataTable.css` (new)
- `frontend/src/components/Layout.jsx`
- `frontend/src/features/CashFlow/CashFlowReport.css`
- `frontend/src/features/Forecast/FCModulesTable.css`
- `frontend/src/features/TransactionActual/TransactionActualTable.jsx`
- `frontend/src/features/TransactionBudget/TransactionBudgetTable.jsx`
- `frontend/src/pages/COAManagement.css`
- `frontend/src/pages/PageLayout.css`
- `frontend/src/pages/RefreshPS.css`

### Uncommitted changes (modified, not staged)

| File | Changes |
|------|---------|
| `frontend/index.html` | Moved Google Fonts from CSS @import to HTML link tags with preconnect |
| `frontend/src/index.css` | Removed @import for Google Fonts (moved to index.html) |
| `frontend/src/pages/PageLayout.css` | Removed all `composes:` CSS Modules syntax (11 usages inlined), fixed stray `font-weight: 600` outside rule block, budget realization table decluttering |

**Action needed:** Commit and push these changes, or they will be lost.

---

## 2. Recent Commit History

```
82f49b8 upgrade ui
4e265e2 UI polish: replace emoji with Lucide icons, extract inline styles
560d6c5 Remove tracked mongo_backups from repository
9d2f2f4 Wire useToast() into pages and hooks for success/error notifications
1eb951c UI overhaul: category landing pages, shared layout, professional polish
43bef3f Remove remaining MongoDB dependencies and dead code
528ade6 migration part 3
5be8026 migration continued
294ca5a migration continued
824d6ff ve update
67779cb new migration plan developed
```

---

## 3. Architecture

### Services (Docker Compose)

| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| `fin-postgres` | `postgres:16-alpine` | `5433:5432` | PostgreSQL database |
| `fin-server` | `fin-server` (Node 20) | `3005:3005` | Express API server |
| `fin-frontend` | `fin-frontend` (nginx:alpine) | `3006:80`, `5175:443` | React SPA + reverse proxy |

### Access URLs

| URL | Description |
|-----|-------------|
| `https://localhost:5175` | Frontend (HTTPS, self-signed cert) |
| `http://localhost:3006` | Frontend (HTTP, redirects to HTTPS) |
| `http://localhost:3005` | API server direct |
| `localhost:5433` | PostgreSQL direct (user: `fin`, password: `findev123`, db: `fin`) |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19.2.0 + Vite 7.2.4 + React Router DOM 7.9.6 |
| Icons | Lucide React |
| Charts | Recharts |
| Backend | Node.js 20 + Express |
| Database | PostgreSQL 16 |
| Proxy | Nginx (SSL termination + SPA routing + API rewrite) |

---

## 4. Database

### Size: 38 MB

### Tables (20 total)

| Table | Rows | Purpose |
|-------|------|---------|
| `psdata_staging` | 25,417 | Raw imported PocketSmith data |
| `transactions` | 25,417 | Processed transaction records |
| `exchange_rates` | 20,043 | Currency exchange rate history |
| `forecast_entries` | 2,960 | Forecast line items |
| `budget_entries` | 786 | Budget line items |
| `accounts` | 208 | Financial accounts |
| `categories` | 143 | Transaction categories |
| `forecast_modules` | 33 | Forecast module definitions |
| `forecast_module_disposals` | 24 | Module disposal events |
| `forecast_module_investments` | 18 | Module investment entries |
| `forecast_module_income_pct` | 15 | Module income percentages |
| `forecast_income_expense` | 8 | Income/expense forecast data |
| `forecast_incexp_changes` | 7 | Income/expense change records |
| `forecast_scenarios` | 4 | Forecast scenario configs |
| `budget_versions` | 3 | Budget version history |
| `app_data` | 2 | Application settings |
| `sync_metadata` | 1 | Last sync timestamps |
| `pending_transactions` | 0 | Pending transaction queue |
| `forecast_assumptions` | 0 | Forecast assumption params |
| `audit_log` | 0 | Audit trail |

### Migration files

- `server/db/migrations/001_initial_schema.sql` - Full schema (tables, views, enums, indexes)
- `server/db/migrations/002_psdata_staging.sql` - PocketSmith data staging table

### Docker volume

- Name: `fin_postgres_data`
- Mountpoint: `/var/lib/docker/volumes/fin_postgres_data/_data`

---

## 5. Files NOT in Git (must be manually transferred)

### SSL Certificates

```
certs/localhost.pem
certs/localhost-key.pem
```

Required for HTTPS. Generate on new machine with:
```bash
# Install mkcert if not available
mkcert -install
mkdir -p certs
cd certs
mkcert localhost
```

### Shared Data Files

```
components/data/account_names.json
components/data/category_names.json
components/data/coa.json
components/data/coa_traits.json
components/data/appdata.json
components/data/psdata.json
components/data/FCAssump.json
components/data/FCAssump copy.json
components/data/coa copy.json
```

These are mounted into the server container and referenced by environment variables. They ARE in the git repo (not gitignored), so they will transfer with `git clone`.

### Database Data

The PostgreSQL data lives in a Docker volume (`fin_postgres_data`), NOT in the git repo. To transfer:

**Option A: pg_dump/restore (recommended)**
```bash
# On OLD machine - export
docker exec fin-postgres pg_dump -U fin -d fin -Fc > fin_backup.dump

# Transfer fin_backup.dump to new machine

# On NEW machine - first start postgres, then restore
docker compose up -d fin-postgres
docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < fin_backup.dump
```

**Option B: Volume copy**
```bash
# On OLD machine
docker run --rm -v fin_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/pgdata.tar.gz -C /data .

# On NEW machine
docker volume create fin_postgres_data
docker run --rm -v fin_postgres_data:/data -v $(pwd):/backup alpine tar xzf /backup/pgdata.tar.gz -C /data
```

---

## 6. Environment Variables

No `.env` file exists. All config uses defaults from `docker-compose.yml`:

| Variable | Default Value | Purpose |
|----------|---------------|---------|
| `POSTGRES_PASSWORD` | `findev123` | Database password |
| `DATABASE_URL` | `postgres://fin:findev123@fin-postgres:5432/fin` | Server DB connection |
| `PS_API_KEY` | (long hex string in docker-compose.yml) | PocketSmith API key |
| `PS_USER_ID` | `330430` | PocketSmith user ID |
| `NODE_ENV` | `production` | Server environment |
| `PORT` | `3005` | Server port |

---

## 7. Setup on New Machine

### Prerequisites

| Tool | Tested Version |
|------|----------------|
| Node.js | v25.2.0 |
| npm | 11.6.2 |
| Docker | 29.1.3 |
| Docker Compose | v2.40.3 |
| Git | any recent |
| mkcert | for SSL certs |

### Steps

```bash
# 1. Clone repository
git clone https://github.com/cfbieder/psproject.git fin
cd fin

# 2. Generate SSL certificates
mkdir -p certs
cd certs
mkcert localhost
cd ..

# 3. Export database from old machine (run on OLD machine)
docker exec fin-postgres pg_dump -U fin -d fin -Fc > fin_backup.dump
# Transfer fin_backup.dump to new machine's fin/ directory

# 4. Start services
docker compose up -d

# 5. Wait for postgres to be healthy, then restore data
docker compose exec fin-postgres pg_isready -U fin
docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < fin_backup.dump

# 6. Verify
curl -k https://localhost:5175          # Frontend loads
curl http://localhost:3005/api/v2/health # API responds (if health endpoint exists)
```

### If building frontend locally (dev mode)

```bash
cd frontend
npm install
npx vite            # Dev server at http://localhost:5173
npx vite build      # Production build to dist/
```

---

## 8. Frontend Pages / Routes

| Route | Page | Table System |
|-------|------|-------------|
| `/` | Home (category landing) | - |
| `/balance` | Balance Sheet | `balance-report-table` |
| `/cash-flow` | Cash Flow Report | `balance-report-table` in `cash-flow-report` |
| `/cash-flow-monthly` | Monthly Cash Flow | `balance-report-table` in `cash-flow-report` |
| `/trans-actual` | Transaction Actual | `trans-budget-table` |
| `/trans-budget` | Transaction Budget | `trans-budget-table` |
| `/budget-input` | Budget Input | `budget-options-table` |
| `/budget-realization` | Budget vs Actual | `balance-report-table` in `cash-flow-report` |
| `/forecast-modules` | Forecast Modules | `fc-modules-table` |
| `/forecast-scenarios` | Forecast Scenarios | `fc-scenarios-table` |
| `/forecast-setup-exp` | Expense Setup | `trans-budget-table` |
| `/forecast-review` | Forecast Review | `trans-budget-table` |
| `/coa-management` | Chart of Accounts | `coa-table` |
| `/refresh-ps` | Refresh PocketSmith | `balance-report-table` |
| `/upload-ps` | Upload CSV | - |
| `/fx-options` | FX Options | - |
| `/balance-chart` | Balance Chart | - |
| `/backup` | Backup Database | - |

---

## 9. API Routes

All API routes are under `/api/v2/`. Nginx rewrites legacy `/api/*` paths to `/api/v2/*`.

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v2/accounts` | List accounts |
| GET | `/api/v2/accounts/categories` | Account categories |
| GET | `/api/v2/budget/entries` | Budget entries |
| POST | `/api/v2/budget/entries` | Create budget entry |
| PUT | `/api/v2/budget/entries/:id` | Update budget entry |
| DELETE | `/api/v2/budget/entries/:id` | Delete budget entry |
| GET | `/api/v2/budget/versions` | Budget versions |
| GET | `/api/v2/forecast/modules` | Forecast modules |
| POST | `/api/v2/forecast/modules` | Create module |
| PUT | `/api/v2/forecast/modules/:id` | Update module |
| DELETE | `/api/v2/forecast/modules/:id` | Delete module |
| GET | `/api/v2/forecast/scenarios` | Forecast scenarios |
| GET | `/api/v2/forecast/incomeexpense` | Income/expense data |
| GET | `/api/v2/forecast/assumptions` | Forecast assumptions |
| GET | `/api/v2/forecast/entries` | Forecast entries |
| GET | `/api/v2/reports/balance` | Balance report |
| GET | `/api/v2/reports/cash-flow` | Cash flow report |
| GET | `/api/v2/transactions` | List transactions |
| PUT | `/api/v2/transactions/:id/category` | Update category |
| GET | `/api/v2/exchange-rates` | Exchange rates |
| POST | `/api/v2/sync/refresh` | Sync from PocketSmith |
| POST | `/api/v2/sync/upload` | Upload CSV |
| POST | `/api/v2/backup/export` | Export database |
| POST | `/api/v2/backup/import` | Import database |

---

## 10. Known Issues / Notes

1. **Legacy Docker images still present:** `fin-frontend-legacy` (65MB) and `fin-mongodb` (845MB) can be pruned on new machine - they're from the MongoDB era.

2. **`components/data/` copy files:** `FCAssump copy.json` and `coa copy.json` appear to be backups - can likely be removed.

3. **`/var/run/docker.sock` mount:** The server container has access to the Docker socket (used for backup/restore operations).

4. **Build is warning-free** after fixing the stray CSS and removing `composes` syntax.

5. **No test suite** exists currently.

6. **MongoDB fully removed** - all references cleaned up in commit `43bef3f`.
