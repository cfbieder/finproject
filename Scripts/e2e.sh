#!/usr/bin/env bash
#
# e2e.sh — run the Playwright money-path smoke tests against a THROWAWAY stack.
#
# Never touches dev or prod: it builds its own Postgres, applies the migration chain from
# scratch, seeds a deterministic world (server/db/e2e-seed.sql), boots the real server
# against it, serves the BUILT frontend bundle, and tears the lot down afterwards.
#
# Locally:  ./Scripts/e2e.sh
# In CI:    DATABASE_URL=… SKIP_DB_SETUP=1 ./Scripts/e2e.sh   (CI provides the Postgres service)
#
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DB_CONTAINER="fin-e2e-db"
DB_PORT="${E2E_DB_PORT:-5436}"
API_PORT="${E2E_API_PORT:-3998}"
WEB_PORT="${E2E_WEB_PORT:-4173}"
DB_URL="${DATABASE_URL:-postgres://fin:e2e@localhost:${DB_PORT}/fin}"

API_PID=""
WEB_PID=""

cleanup() {
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
  if [[ "${SKIP_DB_SETUP:-0}" != "1" && "${E2E_KEEP_DB:-0}" != "1" ]]; then
    docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. A throwaway Postgres, built from the migration chain — same recipe as CI.
# ---------------------------------------------------------------------------
if [[ "${SKIP_DB_SETUP:-0}" != "1" ]]; then
  echo "▸ throwaway Postgres on :${DB_PORT}"
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$DB_CONTAINER" \
    -e POSTGRES_USER=fin -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=fin \
    -p "${DB_PORT}:5432" postgres:16-alpine >/dev/null

  # GOTCHA (same one the restore drill hit): postgres RESTARTS during initdb, so pg_isready
  # answers "ready" while the server is still coming up and the next command dies with
  # "FATAL: terminating connection due to administrator command". Wait for initdb to finish.
  until docker logs "$DB_CONTAINER" 2>&1 | grep -q "PostgreSQL init process complete"; do sleep 1; done
  sleep 1
fi

# Apply a .sql file. CI runners have psql; a dev box often does not — fall back to the
# client inside the Postgres container, which is always there.
run_sql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null
  else
    docker exec -i "$DB_CONTAINER" psql -U fin -d fin -q -v ON_ERROR_STOP=1 < "$1" >/dev/null
  fi
}

echo "▸ migrations + seeds"
for f in server/db/migrations/*.sql; do run_sql "$f"; done
run_sql server/db/ci-seed.sql
run_sql server/db/e2e-seed.sql

# ---------------------------------------------------------------------------
# 2. The real server, against that database.
# ---------------------------------------------------------------------------
echo "▸ API on :${API_PORT}"
( cd server && DATABASE_URL="$DB_URL" NODE_ENV=production PORT="$API_PORT" node src/server.js \
    > "$ROOT/.e2e-api.log" 2>&1 ) &
API_PID=$!
for _ in $(seq 1 40); do
  curl -sf -m 1 "http://localhost:${API_PORT}/api/v2/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf -m 2 "http://localhost:${API_PORT}/api/v2/health" >/dev/null || {
  echo "✗ API did not come up"; tail -20 "$ROOT/.e2e-api.log"; exit 1; }

# ---------------------------------------------------------------------------
# 3. The BUILT frontend bundle (not the dev server) — test what ships.
# ---------------------------------------------------------------------------
echo "▸ build + serve frontend on :${WEB_PORT}"
( cd frontend && npm run build >/dev/null 2>&1 )
( cd frontend && API_PROXY_TARGET="http://localhost:${API_PORT}" \
    npx vite preview --port "$WEB_PORT" --strictPort > "$ROOT/.e2e-web.log" 2>&1 ) &
WEB_PID=$!
for _ in $(seq 1 40); do
  curl -sf -m 1 "http://localhost:${WEB_PORT}/" >/dev/null 2>&1 && break
  sleep 0.5
done

# ---------------------------------------------------------------------------
# 4. Playwright.
# ---------------------------------------------------------------------------
echo "▸ playwright"
cd frontend
E2E_BASE_URL="http://localhost:${WEB_PORT}" npx playwright test "$@"
