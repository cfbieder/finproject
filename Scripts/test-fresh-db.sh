#!/usr/bin/env bash
#
# test-fresh-db.sh — run the backend suite against a database built the way CI builds one.
#
# The point is the DATABASE, not the tests. Dev's database is full of real rows a test can
# reach for by accident; CI's holds only what the migration chain and ci-seed.sql create.
# Five times a suite has borrowed something only dev has — the first asset account, the
# `Bank Accounts` root, and (CR080) the hardcoded id 74 for `Interest Income`, which is 11
# on a fresh database. Every one passed locally and failed in CI, and each cost a red
# `main` that nobody noticed for days. This is that CI database, before the push.
#
# Never touches dev or prod: it builds its own Postgres on its own port and removes it.
#
# Usage: ./Scripts/test-fresh-db.sh [jest args...]
#          ./Scripts/test-fresh-db.sh                          # whole backend suite
#          ./Scripts/test-fresh-db.sh src/v2/services          # one path
#        FRESH_KEEP_DB=1 ./Scripts/test-fresh-db.sh            # leave the DB up to inspect
#
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DB_CONTAINER="fin-freshdb-test"
DB_PORT="${FRESH_DB_PORT:-5437}"
DB_URL="postgres://fin:freshdb@localhost:${DB_PORT}/fin"

cleanup() {
    if [[ "${FRESH_KEEP_DB:-0}" != "1" ]]; then
        docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
    else
        echo "▸ database kept (FRESH_KEEP_DB=1): $DB_URL"
    fi
}
trap cleanup EXIT

echo "▸ throwaway Postgres on :${DB_PORT}"
docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$DB_CONTAINER" \
    -e POSTGRES_USER=fin -e POSTGRES_PASSWORD=freshdb -e POSTGRES_DB=fin \
    -p "${DB_PORT}:5432" postgres:16-alpine >/dev/null

# Postgres RESTARTS during initdb, so pg_isready answers "ready" while the server is still
# coming up and the next command dies with "terminating connection due to administrator
# command". Wait for initdb to actually finish. (Same gotcha as e2e.sh.)
until docker logs "$DB_CONTAINER" 2>&1 | grep -q "PostgreSQL init process complete"; do sleep 1; done
sleep 1

# CI runners have psql; a dev box often does not — fall back to the client inside the
# container, which is always there.
run_sql() {
    if command -v psql >/dev/null 2>&1; then
        PGPASSWORD=freshdb psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null
    else
        docker exec -i "$DB_CONTAINER" psql -U fin -d fin -q -v ON_ERROR_STOP=1 < "$1" >/dev/null
    fi
}

echo "▸ migration chain + ci-seed.sql (exactly what CI applies)"
for f in server/db/migrations/*.sql; do run_sql "$f"; done
run_sql server/db/ci-seed.sql

echo "▸ backend suite"
cd server
set +e
DATABASE_URL="$DB_URL" npx jest --ci "$@"
RC=$?
set -e

echo ""
if [ "$RC" -eq 0 ]; then
    echo "✓ green against a from-scratch database — this will not be the thing that reds CI."
else
    echo "✗ FAILED against a from-scratch database (it may still pass against dev)."
    echo "  If a suite died reaching for a row, that row is ambient: dev has it and CI does"
    echo "  not. Seed the fixture in the test, and never name a surrogate key — ids differ"
    echo "  per database. See roadmap Known Issues #12 / #21."
fi
exit "$RC"
