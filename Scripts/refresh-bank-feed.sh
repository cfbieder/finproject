#!/bin/bash
# ============================================================================
# refresh-bank-feed.sh — Scheduled fin-side bank-feed ingest (CR022 G1)
#
# Pulls the latest bank-feed transactions into fin's STAGING table only
# (POST /api/v2/ingest-bank-feed/ingest). It deliberately does NOT promote
# into the ledger — promotion stays behind the "Import now" button on the
# Refresh Bank Feed page so nothing touches `transactions` unattended (mirrors
# the human-in-the-loop model of the PocketSmith refresh).
#
# Pipeline context (two distinct schedules):
#   1. Google Sheet → bank-feed service   : bank-feed's own cron (hourly)
#   2. bank-feed → fin staging            : THIS script (configurable cron)
#   3. staging → ledger                   : manual, via the UI button
#
# Usage:
#   ./Scripts/refresh-bank-feed.sh              # stage last 14 days
#   SINCE_DAYS=30 ./Scripts/refresh-bank-feed.sh
#   BASE_URL=http://192.168.1.87:3005 ./Scripts/refresh-bank-feed.sh
#   ./Scripts/refresh-bank-feed.sh --dry-run    # show the request, don't send
#
# Crontab (daily 06:00, like backup-to-remote.sh runs on its own cadence):
#   0 6 * * * /home/cfbieder/psproject/Scripts/refresh-bank-feed.sh >> /home/cfbieder/psproject/logs/refresh-bank-feed.log 2>&1
#
# Exits non-zero on HTTP failure so cron mail / log surfaces it.
# ============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
SINCE_DAYS="${SINCE_DAYS:-14}"
ENDPOINT="${BASE_URL}/api/v2/ingest-bank-feed/ingest"
DRY_RUN="${1:-}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ "$DRY_RUN" = "--dry-run" ]; then
  log "DRY RUN — would POST ${ENDPOINT} body {\"sinceDays\":${SINCE_DAYS}}"
  exit 0
fi

log "Staging bank-feed transactions (sinceDays=${SINCE_DAYS}) via ${ENDPOINT}"

# Capture body + HTTP status separately.
HTTP_BODY=$(mktemp)
trap 'rm -f "$HTTP_BODY"' EXIT
STATUS=$(curl -s -o "$HTTP_BODY" -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"sinceDays\":${SINCE_DAYS}}" \
  --max-time 120)

if [ "$STATUS" != "200" ]; then
  log "ERROR: HTTP ${STATUS} from ${ENDPOINT}"
  cat "$HTTP_BODY"
  exit 1
fi

# Pull a few fields for the log line if jq is available; else dump raw.
if command -v jq > /dev/null 2>&1; then
  STAGED=$(jq -r '.ingest.staged // "?"' "$HTTP_BODY")
  FETCHED=$(jq -r '.ingest.fetched // "?"' "$HTTP_BODY")
  INSERTED=$(jq -r '.ingest.insertedCount // "?"' "$HTTP_BODY")
  UPDATED=$(jq -r '.ingest.updatedCount // "?"' "$HTTP_BODY")
  log "OK: fetched=${FETCHED} staged=${STAGED} (new=${INSERTED} updated=${UPDATED}). Promotion remains manual via the UI."
else
  log "OK (install jq for a parsed summary):"
  cat "$HTTP_BODY"
fi
