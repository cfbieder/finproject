#!/bin/bash
# ============================================================================
# refresh-closes.sh — Scheduled daily-close refresh into PROD `security_prices`
#
# Re-fetches the last CLOSE_DAYS days of Tradier daily closes for every held
# per-share security (Scripts/backfill-tradier-prices.js) and upserts them —
# the overlap is deliberate: the upsert is keyed (security, date), so a re-run
# rewrites the same rows, and a missed night is caught up by the next one.
#
# Why this exists: `security_prices` was filled ONCE, by hand, on 2026-09-05,
# and nothing refreshed it — no scheduled close refresh was ever planned; CR061
# P1 and CR093 both treated closes as one-off backfills. Charts, MACD and
# any month-end price check silently ended at 2026-09-04 for five weeks.
#
# ⚠️ The backfill script defaults to the DEV database (localhost:5434) when no
# DATABASE_URL is set. This wrapper pins PROD (5433) explicitly — a bare cron
# line would have filled dev and left prod stale.
#
# Usage:
#   ./Scripts/refresh-closes.sh              # fetch and write (prod)
#   ./Scripts/refresh-closes.sh --dry-run    # fetch and report, write nothing
#
# Crontab — weekdays 22:30 UTC, after the US close in both summer and winter:
#   30 22 * * 1-5 /home/cfbieder/psproject/Scripts/refresh-closes.sh >> /home/cfbieder/psproject/logs/refresh-closes.log 2>&1
#
# Exits non-zero when any lookup fails, so the log surfaces it.
# ============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLOSE_DAYS="${CLOSE_DAYS:-10}"
START="$(date -u -d "-${CLOSE_DAYS} days" +%Y-%m-%d)"
# Today's bar is only a close once the session has ended. Run before 21:00 UTC
# (the later of the summer/winter closes) and it is a partial-day print — which
# the first manual run of this script wrote as 2026-10-09's "close".
if [ "$(date -u +%H)" -ge 21 ]; then END="$(date -u +%Y-%m-%d)"; else END="$(date -u -d '-1 day' +%Y-%m-%d)"; fi

APPLY="--apply"
[ "${1:-}" = "--dry-run" ] && APPLY=""

echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] refresh-closes: ${START}..${END} ${APPLY:-(dry run)}"
cd "$ROOT"
FIN_DB_PORT=5433 node Scripts/backfill-tradier-prices.js --start "$START" --end "$END" $APPLY
