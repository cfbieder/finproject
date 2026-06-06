#!/usr/bin/env bash
#
# v4-up.sh — Bring the isolated v4 / CR027 stack up/down (CR027 §"Step 0").
#
# The v4 stack runs ALONGSIDE prod (5433/3005/5175) and dev (5434/3105) on its
# own ports and its own Postgres volume (postgres_data_v4). It never touches
# prod or dev data.
#
# Usage:
#   ./Scripts/v4-up.sh [up|down|logs|psql|status]
#     up      build + start the v4 stack (default)
#     down    stop the v4 stack (keeps the volume/data)
#     logs    tail server-v4 logs
#     psql    open a psql shell on the v4 database
#     status  show v4 container state
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

COMPOSE="docker compose -f docker-compose.v4.yml"
CMD="${1:-up}"

case "$CMD" in
  up)
    echo "Starting v4 stack (build)…"
    $COMPOSE up -d --build
    echo ""
    echo "=========================================="
    echo "  v4 / CR027 stack is up"
    echo "=========================================="
    echo "  API:      http://localhost:3205   (health: /api/v2/health)"
    echo "  Database: localhost:5435  (user fin / db fin)"
    echo "  Volume:   postgres_data_v4  (isolated from prod & dev)"
    echo "  Flags:    FIN_MULTI_TENANT=1  AUTH_ENABLED=1"
    echo ""
    echo "  Seed it with prod data:   ./Scripts/sync-db-prod-to-v4.sh"
    echo ""
    echo "  Frontend (Vite, host) against the v4 API, e.g.:"
    echo "    cd frontend && VITE_API_BASE=http://localhost:3205 npm run dev -- --port 5275"
    echo "    (adjust to the project's actual API-base env var)"
    echo "=========================================="
    ;;
  down)
    echo "Stopping v4 stack (data volume preserved)…"
    $COMPOSE down
    ;;
  logs)
    $COMPOSE logs -f server-v4
    ;;
  psql)
    docker exec -it fin-postgres-v4 psql -U fin -d fin
    ;;
  status)
    $COMPOSE ps
    ;;
  *)
    echo "Usage: $0 [up|down|logs|psql|status]" >&2
    exit 1
    ;;
esac
