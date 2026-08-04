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
  # Kill by PID first, then SWEEP THE PORTS.
  #
  # PID alone is not enough: `npx vite preview` spawns vite as a CHILD, so `$!` is the npx
  # wrapper and killing it leaves vite holding :4173 — which is how this suite ended up with
  # orphans on both ports and, in July, three weeks of runs reporting on stale code. The port
  # sweep is safe precisely because `require_free_port` proved both ports were FREE before we
  # started: anything listening on them now is ours.
  for pid in "$API_PID" "$WEB_PID"; do
    [[ -n "$pid" ]] || continue
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    kill -9 "$pid" 2>/dev/null || true
  done
  if command -v ss >/dev/null 2>&1; then
    for port in "$API_PORT" "$WEB_PORT"; do
      for pid in $(ss -ltnp "sport = :${port}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u); do
        kill -9 "$pid" 2>/dev/null || true
      done
    done
  fi
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
# REFUSE to run if something is ALREADY listening on a port we are about to own.
#
# This suite silently tested three-week-old code. A `node src/server.js` orphaned on :3998 on
# 2026-07-14 kept answering, our own server failed to bind, and the health checks below could
# not tell the difference — they only ever asked "does something answer?", and something did.
# Every run between 07-14 and 08-04 reported on that stale process while claiming to test the
# working tree. It surfaced only because the old build rejected fields CR062 and CR064 P6 had
# added after it, which read as a CR069 regression.
#
# Both ports, because a stale BUNDLE on the web port is exactly as misleading as a stale
# server on the API one — and the frontend port had its own orphan when this was written.
require_free_port() {
    local port="$1" what="$2"
    command -v ss >/dev/null 2>&1 || return 0
    ss -ltn "sport = :${port}" 2>/dev/null | grep -q LISTEN || return 0
    echo "✗ Something is already listening on :${port} (${what}) — refusing to run."
    echo "  An orphan there would answer our readiness check and the suite would silently"
    echo "  test ITS code instead of this working tree (see roadmap: the 2026-07-14 orphan"
    echo "  that went unnoticed for three weeks)."
    ss -ltnp "sport = :${port}" 2>/dev/null | tail -n +2
    exit 1
}
require_free_port "$API_PORT" "API"
require_free_port "$WEB_PORT" "frontend"

echo "▸ API on :${API_PORT}"
# `exec` so $! is NODE, not the subshell wrapping it.
#
# This is the ROOT CAUSE of the orphan above, not just a tidy-up: without it `$!` holds the
# subshell's pid, `cleanup` kills the subshell, and node is reparented to init and keeps the
# port. That is how a server started on 2026-07-14 was still answering three weeks later while
# every e2e run reported on it.
( cd server && exec env DATABASE_URL="$DB_URL" NODE_ENV=production PORT="$API_PORT" \
    node src/server.js > "$ROOT/.e2e-api.log" 2>&1 ) &
API_PID=$!
for _ in $(seq 1 40); do
  curl -sf -m 1 "http://localhost:${API_PORT}/api/v2/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf -m 2 "http://localhost:${API_PORT}/api/v2/health" >/dev/null || {
  echo "✗ API did not come up"; tail -20 "$ROOT/.e2e-api.log"; exit 1; }

# ...and prove the thing answering is OURS. Belt and braces: the guard above is a race (a
# process could bind between the check and our start), and this cannot be fooled by any server
# we did not spawn.
if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "✗ The API process we started is gone, but :${API_PORT} still answers —"
    echo "  something else owns that port. Refusing to report on another server's code."
    tail -20 "$ROOT/.e2e-api.log"; exit 1
fi

# ---------------------------------------------------------------------------
# 3. The BUILT frontend bundle (not the dev server) — test what ships.
# ---------------------------------------------------------------------------
echo "▸ build + serve frontend on :${WEB_PORT}"
( cd frontend && npm run build >/dev/null 2>&1 )
( cd frontend && API_PROXY_TARGET="http://localhost:${API_PORT}" \
    exec npx vite preview --port "$WEB_PORT" --strictPort > "$ROOT/.e2e-web.log" 2>&1 ) &
WEB_PID=$!
for _ in $(seq 1 40); do
  curl -sf -m 1 "http://localhost:${WEB_PORT}/" >/dev/null 2>&1 && break
  sleep 0.5
done
# Same assertion the API gets: a bundle that never came up must fail HERE, with its log,
# rather than as forty opaque Playwright timeouts.
curl -sf -m 2 "http://localhost:${WEB_PORT}/" >/dev/null || {
  echo "✗ frontend did not come up"; tail -20 "$ROOT/.e2e-web.log"; exit 1; }

# ---------------------------------------------------------------------------
# 4. Playwright.
# ---------------------------------------------------------------------------
echo "▸ playwright"
cd frontend
E2E_BASE_URL="http://localhost:${WEB_PORT}" npx playwright test "$@"
