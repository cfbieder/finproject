#!/usr/bin/env bash
#
# sync-db-prod-to-v4.sh — Seed the isolated v4 database from a prod snapshot.
#
# Mirrors sync-db-prod-to-dev.sh but targets the v4 stack (fin-postgres-v4 /
# postgres_data_v4). Use it to get realistic data into v4 for CR027 testing.
#
# After the restore, v4 holds prod data in the `public` schema (single-tenant
# baseline = today's behavior). Once CR027A lands, run its reorg to split this
# into shared / control-plane / tenant_owner (+ tenant_demo) schemas.
#
# Usage: ./Scripts/sync-db-prod-to-v4.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

BACKUP_FILE="fin_prod_to_v4_$(date +%Y%m%d_%H%M%S).dump"

echo "=========================================="
echo "  Sync Production DB → v4"
echo "=========================================="
echo ""

# Production must be running to dump from.
if ! docker ps --format '{{.Names}}' | grep -q '^fin-postgres$'; then
    echo "ERROR: Production database (fin-postgres) is not running."
    echo "Start production first: docker compose up -d"
    exit 1
fi

# Start the v4 database if it isn't up yet.
if ! docker ps --format '{{.Names}}' | grep -q '^fin-postgres-v4$'; then
    echo "v4 database (fin-postgres-v4) is not running. Starting it…"
    docker compose -f docker-compose.v4.yml up -d fin-postgres-v4
    echo "Waiting for the v4 database to be ready…"
    until docker exec fin-postgres-v4 pg_isready -U fin -d fin >/dev/null 2>&1; do
        sleep 1
    done
fi

echo "Step 1: Dumping production database…"
echo "----------------------------------------"
docker exec fin-postgres pg_dump -U fin -d fin -Fc > "$BACKUP_FILE"
echo "✓ Dumped to: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
echo ""

echo "Step 2: Restoring into the v4 database…"
echo "----------------------------------------"
echo "WARNING: This REPLACES all data in the v4 database (fin-postgres-v4)."
echo "         Prod and dev are NOT touched."
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled. Backup file preserved: $BACKUP_FILE"
    exit 0
fi

docker exec -i fin-postgres-v4 pg_restore -U fin -d fin --clean --if-exists < "$BACKUP_FILE"
echo ""
echo "✓ Restored into v4."
echo ""

# Verify.
V4_COUNT=$(docker exec fin-postgres-v4 psql -U fin -d fin -tAc "SELECT COUNT(*) FROM transactions")
PROD_COUNT=$(docker exec fin-postgres psql -U fin -d fin -tAc "SELECT COUNT(*) FROM transactions")
echo "Verification:"
echo "  Production transactions: $PROD_COUNT"
echo "  v4 transactions:         $V4_COUNT"
if [ "$V4_COUNT" -eq "$PROD_COUNT" ]; then
    echo "  ✓ Counts match!"
else
    echo "  ⚠ Counts don't match — investigate."
fi

echo ""
echo "Cleaning up backup file…"
rm "$BACKUP_FILE"
echo "✓ Removed $BACKUP_FILE"
echo ""
echo "=========================================="
echo "  v4 seeded with production data (public schema)."
echo "  Next (once CR027A exists): run the schema-per-tenant reorg to create"
echo "  shared / control-plane / tenant_owner / tenant_demo schemas."
echo "=========================================="
