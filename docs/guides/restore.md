# Database Restore — Runbook

> **This procedure was actually executed and verified, most recently on 2026-11-02** (see §Drill log).
> It is not a plan; it is a transcript of a restore that worked, turned into steps.
>
> The old file here was a narrative of the one-off March 2026 server migration, not a
> runnable procedure — archived at
> [restore-2026-03-01-migration.md](../archive/restore-2026-03-01-migration.md).

## What we have

- **PBS leg `fin-pg`** — encrypted, every 6 h from `/etc/cron.d/pg-backup-pbs` (root only), log in
  `/var/log/pg-backup-pbs.log`. This is the off-box backup. `backup-to-remote.sh` is retired.
- **Pre-deploy dump** — `./Scripts/deploy-to-production.sh` takes a `pg_dump -Fc` of prod to
  `Backups/fin_backup_<YYYYMMDD>_<HHMMSS>.dump`, and **shreds it after a healthy deploy**, so
  `Backups/` normally holds no dump at all. That is policy, not a fault.

A `-Fc` (custom-format) dump is restored with `pg_restore`, **not** `psql`.

---

## A. Rehearsal — restore into a throwaway (safe, ~1 min, do this first)

Never rehearse against a live container. This spins an isolated Postgres, restores into
it, and touches nothing else.

```bash
docker rm -f fin-restore-drill 2>/dev/null
docker run -d --name fin-restore-drill \
  -e POSTGRES_USER=fin -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=fin \
  postgres:16-alpine

# ⚠️ GOTCHA: postgres restarts DURING initdb. `pg_isready` says "ready" while the server
# is still coming up, and the restore then dies with:
#     FATAL: terminating connection due to administrator command
# Wait for the init process to COMPLETE, not just for the port to answer:
until docker logs fin-restore-drill 2>&1 | grep -q "PostgreSQL init process complete"; do sleep 1; done

# A fresh dump straight into the container, so no plaintext dump lands on the host:
docker exec fin-postgres pg_dump -U fin -d fin -Fc | docker exec -i fin-restore-drill sh -c 'cat > /tmp/b.dump'
docker exec fin-restore-drill pg_restore -U fin -d fin --no-owner --no-privileges /tmp/b.dump
docker exec fin-restore-drill rm -f /tmp/b.dump
```

Expect **0 errors** and a few seconds.

### Verify it — row counts are NOT enough

```bash
docker exec fin-restore-drill psql -U fin -d fin -tAc "
SELECT 'transactions='||count(*) FROM transactions
UNION ALL SELECT 'accounts='||count(*) FROM accounts
UNION ALL SELECT 'forecast_entries='||count(*) FROM forecast_entries
UNION ALL SELECT 'schema_migrations='||count(*) FROM schema_migrations;"
```

Counts should match prod **as of the backup's timestamp** — prod will legitimately be
*ahead* (the bank feed keeps ingesting). A small positive delta on `transactions` is
expected, not a fault; confirm it with
`SELECT count(*) FROM transactions WHERE created_at > '<backup time>'`.

**The real test is that the application works and the numbers agree.** Boot the actual
server image against the restored DB:

```bash
IP=$(docker inspect fin-restore-drill --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
IMG=$(docker inspect fin-server --format '{{.Config.Image}}')
docker run -d --name fin-restore-drill-api --network bridge -p 3999:3005 \
  -e DATABASE_URL="postgres://fin:drill@${IP}:5432/fin" -e NODE_ENV=production -e PORT=3005 "$IMG"

curl -s localhost:3999/api/v2/health
curl -s "localhost:3999/api/v2/reports/balance?asOfDate=$(date +%F)"   # compare to :3005
```

Gold standard — regenerate a forecast on the restored copy and check it reproduces prod
byte-for-byte:

```bash
curl -s -X POST "http://localhost:3999/api/v2/forecast/generate/2026%20Base"

CK() { docker exec "$1" psql -U fin -d fin -tAc "
  SELECT count(*)||' md5='||md5(string_agg(t,'|' ORDER BY t)) FROM (
    SELECT account||'~'||coalesce(module,'')||'~'||forecast_year::text||'~'||round(amount::numeric,2)::text AS t
    FROM forecast_entries fe JOIN forecast_scenarios s ON s.id=fe.scenario_id
    WHERE s.name='2026 Base') x;"; }
CK fin-postgres; CK fin-restore-drill     # identical before the regenerate
```

⚠️ **After the regenerate this matches prod only if prod's stored forecast is current.** A scenario
edited since its last generate moves on regeneration (see the 2026-11-02 row), and that is not a restore
fault. Compare before regenerating, then checksum every table:

```sql
-- run on both, diff the output; a regenerate changes forecast_entries only
DO $$ DECLARE r record; c text; n bigint; BEGIN
  CREATE TEMP TABLE tck(t text, n bigint, c text);
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*), md5(COALESCE(string_agg(x::text, %L ORDER BY x::text), %L)) FROM %I x', '|', '', r.tablename) INTO n, c;
    INSERT INTO tck VALUES (r.tablename, n, c);
  END LOOP;
END $$;
SELECT t||' '||n||' '||c FROM tck ORDER BY t;
```

### Tear down

```bash
docker rm -f fin-restore-drill-api fin-restore-drill
```

---

## B. Real restore into prod (destructive — read twice)

Only after A passes with the dump you intend to use.

```bash
# 1. Take a dump of the CURRENT prod first, even if you think it's broken.
docker exec fin-postgres pg_dump -U fin -Fc fin > Backups/pre-restore-$(date +%Y%m%d_%H%M%S).dump

# 2. Stop the app so nothing writes mid-restore. Leave Postgres up.
docker compose stop server frontend

# 3. Restore. --clean --if-exists drops the existing objects first; without it you get
#    duplicate-key errors on top of live data.
docker cp <chosen>.dump fin-postgres:/tmp/r.dump
docker exec fin-postgres pg_restore -U fin -d fin --clean --if-exists --no-owner --no-privileges /tmp/r.dump

# 4. Bring the app back and verify BEFORE declaring victory.
docker compose start server frontend
curl -s localhost:3005/api/v2/health
# check the balance sheet + a forecast scenario against what you expect
```

**Do not** `docker volume rm fin_postgres_data`. The volume is pinned by name in
`docker-compose.yml`; destroying it is a separate, worse problem than a bad restore.

---

## Drill log

| Date | Backup | Result |
|---|---|---|
| **2026-11-02** | Fresh `pg_dump -Fc` (8.9 MB), schema through 084 | ✅ **PASS.** Restored in **6 s, 0 errors**. **All 68 tables, 601,099 rows, checksum-identical to prod**, apart from `forecast_entries` once the drill had regenerated it. The running `fin-server` image booted against it; balance report at 2026-11-02 byte-identical. Stored `2026 Base` matched before regenerating (1,611 rows, md5 `9dbf9c09…`); regenerating gave 1,606 rows, twice identically (md5 `aabc9e3d…`), and differed from prod because prod's stored forecast dates from 2026-10-15 and the scenario's 2027 rates were set 2026-11-01. **Not exercised: the encrypted PBS leg `fin-pg`** — its credentials are root-only and were not used; last restore-tested 2026-07-14. Its log shows backups running (latest 2026-11-02 06:05, rc=0). |
| **2026-07-13** | `fin_backup_20260713_032215.dump` (3.7 MB) | ✅ **PASS.** Restored in **3 s, 0 errors**. All row counts faithful (`transactions` 37,040 vs prod's 37,050 — the 10 extra are bank-feed rows ingested at 11:52, *after* the backup; explained, not a fault). The real `psproject-server` image booted against it. Balance sheet at 2026-07-01 **byte-identical to prod** (net worth $14,291,347.29, checksum `7e58543608f2`). Forecast engine regenerated "2026 Base" on the restored copy and reproduced prod's stored entries **exactly** (1426 entries, md5 `381ca7190649ee316db7d0d32250785d`). **Found:** the `pg_isready`-during-initdb trap, now documented above — it silently fails the restore. |

**Cadence:** re-run drill A after any schema migration that changes a table's shape, and
at least twice a year. An untested backup is not a backup.
