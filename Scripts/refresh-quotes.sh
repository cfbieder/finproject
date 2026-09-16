#!/bin/bash
# ============================================================================
# refresh-quotes.sh — Scheduled live-quote refresh (CR090 P2)
#
# Fetches market quotes for the held, per-share securities and stores them in
# `security_quotes` (POST /api/v2/investments/quotes/refresh). It changes no
# ledger row, no balance and no position: a quote is a market fact stored beside
# the custodian's price, never instead of it (CR090 §2).
#
# Why scheduled rather than fetched when the page loads: the upstream is public
# and has 503'd four batches in five when measured (CR061 §5), so a page that
# fetched on render would demo its own outage. The page reads what is stored and
# states how old it is; a failed run leaves the previous quotes in place.
#
# Usage:
#   ./Scripts/refresh-quotes.sh              # fetch and store
#   ./Scripts/refresh-quotes.sh --dry-run    # show the request, don't send
#
# Crontab — every 15 minutes, weekdays, 13:00–21:00 UTC. The host runs UTC and
# US market hours are 13:30–20:00 UTC in summer and 14:30–21:00 UTC in winter,
# so the window covers both without a DST rule. Outside a session the upstream
# returns the last print unchanged, which the UNIQUE(security_id, quoted_at)
# index absorbs as a no-op:
#   */15 13-20 * * 1-5 /home/cfbieder/psproject/Scripts/refresh-quotes.sh >> /home/cfbieder/psproject/logs/refresh-quotes.log 2>&1
#
# Exits non-zero on HTTP failure so cron mail / the log surfaces it.
# ============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3005}"
ENDPOINT="${BASE_URL}/api/v2/investments/quotes/refresh"
DRY_RUN="${1:-}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ "$DRY_RUN" = "--dry-run" ]; then
  log "DRY RUN — would POST ${ENDPOINT}"
  exit 0
fi

HTTP_BODY=$(mktemp)
trap 'rm -f "$HTTP_BODY"' EXIT
STATUS=$(curl -s -o "$HTTP_BODY" -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  --max-time 120)

if [ "$STATUS" != "200" ]; then
  log "ERROR: HTTP ${STATUS} from ${ENDPOINT}"
  cat "$HTTP_BODY"
  exit 1
fi

if command -v jq > /dev/null 2>&1; then
  REQ=$(jq -r '.data.requested // "?"' "$HTTP_BODY")
  STORED=$(jq -r '.data.stored // "?"' "$HTTP_BODY")
  UNCHANGED=$(jq -r '.data.unchanged // "?"' "$HTTP_BODY")
  REFUSED=$(jq -r '.data.refused | length' "$HTTP_BODY")
  FAILED=$(jq -r '.data.failed | length' "$HTTP_BODY")
  MISSING=$(jq -r '.data.missing | length' "$HTTP_BODY")
  ERR=$(jq -r '.data.error // ""' "$HTTP_BODY")
  log "OK: asked=${REQ} stored=${STORED} unchanged=${UNCHANGED} refused=${REFUSED} failed=${FAILED} no-quote=${MISSING}${ERR:+ (partial: ${ERR})}"
  # Both kinds are named every run: a refusal is a units error the magnitude
  # guard caught, a failure is a symbol the endpoint would not answer for.
  jq -r '.data.refused[]? | "  refused \(.symbol): \(.reason)"' "$HTTP_BODY"
  jq -r '.data.failed[]? | "  failed  \(.symbol): \(.reason)"' "$HTTP_BODY"
else
  log "OK (install jq for a parsed summary):"
  cat "$HTTP_BODY"
fi
