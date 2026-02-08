# Fin Project - Full Status Report

**Date:** 2026-02-08
**Production VM:** `192.168.1.82` (Ubuntu 24.04 LTS, KVM guest)
**Project Path:** `/home/cfbieder/Programs/fin`

---

## 1. Infrastructure

### VM Host

| Field | Value |
|-------|-------|
| KVM Host | `192.168.1.61` (user: `cfbieder`, SSH key auth) |
| Hypervisor | KVM/libvirt (`qemu:///system`) |
| Storage Pools | `vm-ssd` (`/mnt/vm-ssd`), `vm-hdd` (`/mnt/vm-hdd`) |
| Cockpit | `https://192.168.1.61:9090` |

### VM Storage (all in `vm-ssd` pool)

| File | Size | Purpose |
|------|------|---------|
| `fin-base.qcow2` | 598 MB | Ubuntu 24.04 cloud image (backing store) |
| `fin.qcow2` | ~7 GB | VM disk (40 GB qcow2 overlay on base image) |
| `fin-seed.iso` | 368 KB | Cloud-init seed ISO |

All VM images are stored in `/mnt/vm-ssd/` via the `vm-ssd` libvirt storage pool. Nothing is stored in `/tmp`.

### VM (fin)

| Field | Value |
|-------|-------|
| IP | `192.168.1.82` (static, bridged via `br0`) |
| Gateway / DNS | `192.168.1.1` |
| OS | Ubuntu 24.04 LTS (Noble) |
| vCPUs | 2 |
| RAM | 4 GB |
| Disk | 40 GB (qcow2 overlay) |
| User | `cfbieder` (sudo NOPASSWD, SSH key auth) |
| Autostart | Enabled (`virsh autostart fin`) |
| Docker | 29.2.1 |
| Docker Compose | v5.0.2 |

### SSH Access

```bash
# From dev machine to VM:
ssh cfbieder@192.168.1.82

# From dev machine to KVM host:
ssh cfbieder@192.168.1.61

# From KVM host to VM:
ssh cfbieder@192.168.1.82

# VM management (from KVM host):
virsh --connect qemu:///system list --all
virsh --connect qemu:///system start fin
virsh --connect qemu:///system shutdown fin
virsh --connect qemu:///system console fin
```

### VM Provisioning

The VM is provisioned via `provision-vm.sh`, which:
- Downloads the Ubuntu 24.04 cloud image to a staging directory
- Uploads it to the `vm-ssd` libvirt pool via `virsh vol-create-as` / `virsh vol-upload`
- Creates a qcow2 overlay disk with backing store
- Generates a cloud-init ISO (static IP, SSH keys, Docker install)
- Creates the VM with `virt-install`

All operations use libvirt volume management (no sudo required, user must be in `libvirt` group).

To recreate the VM from scratch:
```bash
# On KVM host — destroy and remove old VM (if exists)
virsh --connect qemu:///system destroy fin
virsh --connect qemu:///system undefine fin --remove-all-storage

# From dev machine — run provisioning script
ssh cfbieder@192.168.1.61 'bash -s' < provision-vm.sh

# Wait ~3-5 min for cloud-init, then deploy
ssh cfbieder@192.168.1.82 'bash -s' < deploy-on-vm.sh
```

---

## 2. Git Status

| Field | Value |
|-------|-------|
| Remote | `https://github.com/cfbieder/psproject.git` |
| Branch | `main` (only branch) |
| Remote sync | Up to date with `origin/main` |

### Recent Commit History

```
b11a718 migration completed
d6e325e fix: remove composes CSS syntax, fix stray CSS, move fonts to HTML link tags, add migration docs
82f49b8 upgrade ui
4e265e2 UI polish: replace emoji with Lucide icons, extract inline styles
560d6c5 Remove tracked mongo_backups from repository
9d2f2f4 Wire useToast() into pages and hooks for success/error notifications
1eb951c UI overhaul: category landing pages, shared layout, professional polish
43bef3f Remove remaining MongoDB dependencies and dead code
528ade6 migration part 3
5be8026 migration continued
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
| `https://192.168.1.82:5175` | Frontend (HTTPS, mkcert cert) |
| `http://192.168.1.82:3006` | Frontend (HTTP) |
| `http://192.168.1.82:3005` | API server direct |
| `192.168.1.82:5433` | PostgreSQL direct (user: `fin`, password: `findev123`, db: `fin`) |

From the VM itself, `localhost` works in place of `192.168.1.82`.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19.2.0 + Vite 7.2.4 + React Router DOM 7.9.6 |
| Icons | Lucide React |
| Charts | Recharts |
| Backend | Node.js 20 + Express 5 |
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

### Database Backup / Restore

```bash
# SSH to VM
ssh cfbieder@192.168.1.82

# Export
docker exec fin-postgres pg_dump -U fin -d fin -Fc > fin_backup.dump

# Restore (on same or new machine)
docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < fin_backup.dump
```

---

## 5. Files NOT in Git

### SSL Certificates (on VM)

```
~/Programs/fin/certs/localhost.pem      (covers localhost + 192.168.1.82)
~/Programs/fin/certs/localhost-key.pem
```

Generated with mkcert. To regenerate:
```bash
cd ~/Programs/fin/certs
mkcert localhost 192.168.1.82
mv localhost+1.pem localhost.pem
mv localhost+1-key.pem localhost-key.pem
```

### Local-only nginx change (on VM, not committed)

`frontend/nginx.conf` has `server_name localhost 192.168.1.82 _` instead of the original value. This is intentional — the VM IP differs from the old dev machine.

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

These ARE in the git repo (not gitignored) and transfer with `git clone`.

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

## 7. Common Operations

### Restart the stack

```bash
ssh cfbieder@192.168.1.82
cd ~/Programs/fin
docker compose restart
```

### Rebuild after code changes

```bash
ssh cfbieder@192.168.1.82
cd ~/Programs/fin
git pull
docker compose up -d --build
```

### View logs

```bash
docker compose logs -f              # all services
docker compose logs -f server       # server only
docker compose logs -f fin-postgres # database only
```

### Check container health

```bash
docker compose ps
```

### VM management (from KVM host)

```bash
ssh cfbieder@192.168.1.61
virsh --connect qemu:///system list --all       # list VMs
virsh --connect qemu:///system shutdown fin      # graceful shutdown
virsh --connect qemu:///system start fin         # start VM
virsh --connect qemu:///system reboot fin        # reboot VM
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

1. **`/api/v2/accounts/categories`** returns 500 — pre-existing issue, not migration-related.

2. **`/api/v2/exchange-rates`** returns 404 — pre-existing issue, route may not be implemented.

3. **`components/data/` copy files:** `FCAssump copy.json` and `coa copy.json` appear to be backups — can likely be removed.

4. **`/var/run/docker.sock` mount:** The server container has access to the Docker socket (used for backup/restore operations).

5. **Build is warning-free** after fixing the stray CSS and removing `composes` syntax.

6. **No test suite** exists currently.

7. **MongoDB fully removed** — all references cleaned up in commit `43bef3f`.

8. **Cloud-init ISO** still attached to the VM as a CD-ROM. Harmless but can be ejected:
   ```bash
   # On KVM host
   virsh --connect qemu:///system change-media fin sda --eject
   ```

9. **Database is empty after VM recreation** — schema is auto-applied from migrations but data must be restored from a backup.

---

## 11. Migration History

| Date | Event |
|------|-------|
| 2026-02-08 | Recreated VM after loss (cloud image was in /tmp). All images now in /mnt/vm-ssd via libvirt pool. Added `provision-vm.sh` and `deploy-on-vm.sh` scripts. |
| 2026-02-07 | Migrated from dev machine to KVM VM at 192.168.1.82 |
| Earlier | Migrated from MongoDB to PostgreSQL 16 |
| Earlier | UI overhaul: Lucide icons, shared layout, category landing pages |
