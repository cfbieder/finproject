#!/usr/bin/env bash
#
# sync-db-prod-to-dev.sh — Copy production database to development
#
# This script:
# 1. Dumps the production database
# 2. Restores it to the development database
# 3. Allows safe testing with real production data
#
# Usage: ./sync-db-prod-to-dev.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

BACKUP_FILE="fin_prod_to_dev_$(date +%Y%m%d_%H%M%S).dump"

echo "=========================================="
echo "  Sync Production DB to Development"
echo "=========================================="
echo ""

# Check if production is running
if ! docker ps --format '{{.Names}}' | grep -q '^fin-postgres$'; then
    echo "ERROR: Production database (fin-postgres) is not running"
    echo "Please start production first: docker compose up -d"
    exit 1
fi

# Check if development is running
if ! docker ps --format '{{.Names}}' | grep -q '^fin-postgres-dev$'; then
    echo "WARNING: Development database (fin-postgres-dev) is not running"
    echo "Starting development environment..."
    docker compose -f docker-compose.dev.yml up -d fin-postgres-dev
    echo "Waiting for development database to be ready..."
    sleep 5
fi

echo "Step 1: Dumping production database..."
echo "----------------------------------------"
docker exec fin-postgres pg_dump -U fin -d fin -Fc > "$BACKUP_FILE"
echo "✓ Production database dumped to: $BACKUP_FILE"
echo "  Size: $(du -h "$BACKUP_FILE" | cut -f1)"
echo ""

echo "Step 2: Restoring to development database..."
echo "----------------------------------------"
echo "WARNING: This will REPLACE all data in the development database!"
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled. Backup file preserved: $BACKUP_FILE"
    exit 0
fi

# Restore to development
docker exec -i fin-postgres-dev pg_restore -U fin -d fin --clean --if-exists < "$BACKUP_FILE"

echo ""
echo "✓ Database restored to development!"
echo ""

# Verify restoration
DEV_COUNT=$(docker exec fin-postgres-dev psql -U fin -d fin -tAc "SELECT COUNT(*) FROM transactions")
PROD_COUNT=$(docker exec fin-postgres psql -U fin -d fin -tAc "SELECT COUNT(*) FROM transactions")

echo "Verification:"
echo "  Production transactions: $PROD_COUNT"
echo "  Development transactions: $DEV_COUNT"

if [ "$DEV_COUNT" -eq "$PROD_COUNT" ]; then
    echo "  ✓ Counts match!"
else
    echo "  ⚠ WARNING: Counts don't match. Please investigate."
fi

echo ""
echo "Cleaning up backup file..."
rm "$BACKUP_FILE"
echo "✓ Temporary backup file removed"

echo ""
echo "=========================================="
echo "  Sync Complete!"
echo "=========================================="
echo ""
echo "Development environment ready with production data:"
echo "  Frontend: https://localhost:5176"
echo "  API:      http://localhost:3105"
echo "  Database: localhost:5434"
echo ""
echo "Start all dev services: docker compose -f docker-compose.dev.yml up -d"
echo "=========================================="
