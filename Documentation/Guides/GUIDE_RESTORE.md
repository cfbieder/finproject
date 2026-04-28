# Database Restore Procedure — March 1, 2026

## Background

After migrating to a new server, the PostgreSQL databases (production and dev) needed to be restored. The original system was migrated from MongoDB to PostgreSQL in early February 2026. Multiple data sources were used to achieve a full restore.

## Data Sources Used

### 1. PostgreSQL tar.gz Backups (from old machine)
- `~/postgres_prod.tar.gz` (~15 MB) — raw PostgreSQL data directory backup
- `~/postgres_dev.tar.gz` (~20 MB)
- **Date of backup**: Pre-budget/forecast data entry
- **Contents**: Transactions (25,853), accounts, categories — but NO budget or forecast data

### 2. MongoDB BSON Backup (from git history)
- Commit `61c2e2d` (Dec 29, 2025) contains BSON files at:
  `mongo_backups/backup_20251229_174528/fin/`
- Collections: `budgetData` (728 docs), `FCModule` (5), `FCIncExp` (2), `fcEntries` (126), `appdata` (1)
- **Partial**: Only had data as of Dec 29, 2025

### 3. QCOW2 Disk Image (from old VM — best source)
- `fin.qcow2` (~20 GB) — full VM disk image from Feb 8, 2026
- **This was the definitive source** — contained the complete post-migration PostgreSQL database
- PostgreSQL volumes located at: `/var/lib/docker/volumes/fin_postgres_data/_data`
- Note: Volume prefix on old machine was `fin_` (not `psproject_`)

## What Was Restored

From the Feb 8 QCOW2 disk image:

| Table | Records | Notes |
|---|---|---|
| accounts | 208 | Full COA with correct hierarchy |
| categories | 143 | All categories with account mappings |
| transactions | 25,792 | 25,417 from backup + 436 newer from CSV |
| budget_entries | 786 | 3 versions across 2025-2026 |
| budget_versions | 3 | |
| forecast_scenarios | 4 | Baseline, Base Case, 2025_Base, Testing |
| forecast_modules | 33 | Balance sheet forecast items |
| forecast_entries | 2,960 | Generated forecast summaries |
| forecast_income_expense | 8 | Income/expense forecast items |
| forecast_incexp_changes | 7 | |
| forecast_module_investments | 18 | |
| forecast_module_disposals | 24 | |
| forecast_module_income_pct | 15 | |
| exchange_rates | 20,043 | Historical FX rates |

## Step-by-Step Procedure

### Restoring from PostgreSQL tar.gz Backups

Used when raw PostgreSQL data directory backups are available:

```bash
# Stop containers
docker compose stop fin-postgres server frontend
docker compose -f docker-compose.dev.yml stop fin-postgres-dev server-dev

# Restore using an alpine container (avoids needing sudo)
docker run --rm \
  -v psproject_postgres_data:/data \
  -v ~/postgres_prod.tar.gz:/backup.tar.gz \
  alpine sh -c "rm -rf /data/* && tar xzf /backup.tar.gz -C /data/ --strip-components=0 && rm -f /data/postmaster.pid"

# Start containers
docker start fin-postgres fin-server fin-frontend
```

### Extracting Data from QCOW2 Disk Image

```bash
# Mount the QCOW2 image
sudo modprobe nbd max_part=8
sudo qemu-nbd --connect=/dev/nbd0 ~/fin.qcow2
sudo mkdir -p /mnt/qcow2
sudo partprobe /dev/nbd0
sudo mount /dev/nbd0p1 /mnt/qcow2

# Copy PostgreSQL data out (note: old machine used 'fin_' prefix)
sudo cp -r /mnt/qcow2/var/lib/docker/volumes/fin_postgres_data/_data /tmp/pg_prod_feb8
sudo chown -R cfbieder:cfbieder /tmp/pg_prod_feb8

# Start a temporary PostgreSQL container with the extracted data
rm -f /tmp/pg_prod_feb8/postmaster.pid
docker run -d --name pg-feb8 -p 5555:5432 \
  -v /tmp/pg_prod_feb8:/var/lib/postgresql/data \
  -e POSTGRES_USER=fin -e POSTGRES_PASSWORD=findev123 -e POSTGRES_DB=fin \
  postgres:16-alpine

# Dump the database
docker exec pg-feb8 pg_dump -U fin -d fin -Fc > /tmp/feb8_full.dump

# Restore to production and dev
docker exec -i fin-postgres pg_restore -U fin -d fin --clean --if-exists < /tmp/feb8_full.dump
docker exec -i fin-postgres-dev pg_restore -U fin -d fin --clean --if-exists < /tmp/feb8_full.dump

# Cleanup
docker rm -f pg-feb8
sudo rm -rf /tmp/pg_prod_feb8
sudo umount /mnt/qcow2
sudo qemu-nbd --disconnect /dev/nbd0
```

### Ingesting Newer Transactions (without touching COA)

After restoring the Feb 8 backup, 436 newer transactions from the CSV were added. **Do NOT run `rebuild-db.js`** as it re-seeds the COA from a hardcoded tree and will corrupt the account hierarchy.

Instead, ingest transactions only:

```bash
cd /home/cfbieder/psproject/server
DATABASE_URL="postgres://fin:findev123@localhost:5433/fin" \
CSV_PATH="/home/cfbieder/psproject/components/data/ps-transactions.csv" \
NODE_PATH=./node_modules node -e "
const db = require('./src/v2/db');
const PsCsvIngestorV2 = require('./src/v2/services/psCsvIngestorV2');
(async () => {
  const ingestor = new PsCsvIngestorV2();
  await ingestor.ingestPsTransactionsFromCsv();
  await db.query(\`
    WITH staged AS (
      SELECT s.ps_id::bigint as ps_id, s.transaction_date, s.description1, s.description2,
        s.amount, s.currency, s.base_amount, s.base_currency, s.transaction_type,
        a.id as account_id, c.id as category_id, s.closing_balance,
        CASE WHEN s.labels IS NOT NULL AND s.labels != ''
          THEN string_to_array(s.labels, ',') ELSE NULL END as labels,
        s.memo, s.note, s.bank
      FROM psdata_staging s
      LEFT JOIN accounts a ON LOWER(s.account_name) = LOWER(a.name)
      LEFT JOIN categories c ON LOWER(s.category_name) = LOWER(c.name)
      WHERE a.id IS NOT NULL AND s.amount IS NOT NULL
        AND s.transaction_date IS NOT NULL AND s.currency IS NOT NULL
    )
    INSERT INTO transactions (ps_id, transaction_date, description1, description2,
      amount, currency, base_amount, base_currency, transaction_type, account_id,
      category_id, closing_balance, labels, memo, note, bank)
    SELECT * FROM staged
    ON CONFLICT (ps_id) DO UPDATE SET
      transaction_date=EXCLUDED.transaction_date, description1=EXCLUDED.description1,
      description2=EXCLUDED.description2, amount=EXCLUDED.amount,
      currency=EXCLUDED.currency, base_amount=EXCLUDED.base_amount,
      base_currency=EXCLUDED.base_currency, transaction_type=EXCLUDED.transaction_type,
      account_id=EXCLUDED.account_id, category_id=EXCLUDED.category_id,
      closing_balance=EXCLUDED.closing_balance, labels=EXCLUDED.labels,
      memo=EXCLUDED.memo, note=EXCLUDED.note, bank=EXCLUDED.bank
  \`);
  const r = await db.query('SELECT COUNT(*) FROM transactions');
  console.log('Transactions:', r.rows[0].count);
  await db.close();
})();
"
```

For dev, change `DATABASE_URL` to use port `5434`.

### Restoring Budget/Forecast from MongoDB BSON (Alternative Method)

If the QCOW2 image is not available, budget and forecast data can be recovered from the MongoDB BSON backup in git history:

```bash
# 1. Extract BSON files from git
mkdir -p /tmp/mongo_restore/fin
for f in budgetData.bson budgetData.metadata.json FCModule.bson FCModule.metadata.json \
         FCIncExp.bson FCIncExp.metadata.json fcEntries.bson fcEntries.metadata.json; do
  git show "61c2e2d:mongo_backups/backup_20251229_174528/fin/$f" > "/tmp/mongo_restore/fin/$f"
done

# 2. Start temporary MongoDB and restore
docker run -d --name mongofin-temp -p 27018:27017 mongo:7
docker cp /tmp/mongo_restore/fin mongofin-temp:/tmp/restore_fin
docker exec mongofin-temp mongorestore --db fin /tmp/restore_fin

# 3. Extract migration scripts from git
mkdir -p server/src/migration
git show "528ade6~1:server/src/migration/migrate-budget.js" > server/src/migration/migrate-budget.js
git show "528ade6~1:server/src/migration/migrate-forecast.js" > server/src/migration/migrate-forecast.js

# 4. Install mongoose temporarily and run migrations
cd server && npm install mongoose --no-save
MONGO_URI="mongodb://localhost:27018/fin" \
DATABASE_URL="postgres://fin:findev123@localhost:5433/fin" \
node src/migration/migrate-budget.js

MONGO_URI="mongodb://localhost:27018/fin" \
DATABASE_URL="postgres://fin:findev123@localhost:5433/fin" \
node src/migration/migrate-forecast.js

# 5. Cleanup
npm uninstall mongoose
rm -rf src/migration
docker rm -f mongofin-temp
rm -rf /tmp/mongo_restore
```

**Note**: The BSON backup is from Dec 29, 2025 and has fewer records than the Feb 8 PostgreSQL backup (e.g., 727 budget entries vs 786).

## Key Git Commits for Recovery

| Commit | Content |
|---|---|
| `61c2e2d` | MongoDB BSON backup files (Dec 29, 2025) |
| `528ade6~1` | Last commit with migration scripts (migrate-budget.js, migrate-forecast.js) |
| `528ade6` | Commit that removed migration scripts |

## Important Notes

- **Do NOT run `rebuild-db.js` after restoring from backup** — it re-seeds the COA from a hardcoded tree that differs from the actual database hierarchy and will corrupt the account structure.
- The Docker volume prefix on the old machine was `fin_`, on the new machine it is `psproject_`.
- Always remove `postmaster.pid` from extracted PostgreSQL data directories before starting a container with them.
- Port mappings: Production PostgreSQL = 5433, Dev PostgreSQL = 5434.
- The dev server (fin-server-dev) uses port 3105 — if a node process is running on that port outside Docker, it will prevent the container from starting.
