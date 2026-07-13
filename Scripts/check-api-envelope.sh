#!/usr/bin/env bash
#
# check-api-envelope.sh — ratchet for the v2 API's response-shape inconsistency (CR043 N8).
#
# The v2 API grew two success conventions: most handlers return `{ data: … }`, a minority
# return the value BARE. A caller therefore has to KNOW which — and guessing wrong fails
# SILENTLY: `undefined.map` never runs, so the page just renders empty, with no error
# anywhere. That is not hypothetical. It is exactly how the Modify Transfer modal broke:
#
#     GET /forecast/modules       → bare array   (no Invest/Dispose)
#     GET /forecast/modules/:id   → { data: … }  (joins the transfer tables)
#
# The modal read the list, found no transfers on it, and told the user "no transfers for
# this year" — for two years, while the Review behind it displayed the very transfer it was
# denying. A green unit test on the year-matching predicate passed throughout, because the
# predicate was never reached with data.
#
# Migration is per-endpoint and needs no flag day: the frontend reads through
# `Rest.unwrap()`, which accepts BOTH shapes, so a consumer works before and after its
# endpoint is converted. Convert an endpoint, update its consumers to unwrap(), re-baseline.
#
# This counts the remaining BARE success responses. The count may only SHRINK.
#
# Usage:
#   ./Scripts/check-api-envelope.sh                    # verify (CI)
#   ./Scripts/check-api-envelope.sh --update-baseline  # after converting endpoints
#
set -euo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROUTES="$ROOT/server/src/v2/routes"
BASELINE="$SCRIPT_DIR/.api-envelope-baseline.txt"

# A bare success response: res.json(<identifier>) — i.e. not res.json({...}).
# Error responses (res.status(4xx).json({error})) are object literals and so never match.
count_bare() {
  grep -rhoE "res\.json\([a-zA-Z_][a-zA-Z0-9_.]*\)" "$ROUTES"/*.js | sort | uniq -c |
    awk '{ total += $1 } END { print total + 0 }'
}

CURRENT="$(count_bare)"

if [[ "${1:-}" == "--update-baseline" ]]; then
  echo "$CURRENT" > "$BASELINE"
  echo "Baseline refreshed: $CURRENT bare (non-enveloped) success responses."
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "No baseline at $BASELINE — run: ./Scripts/check-api-envelope.sh --update-baseline"
  exit 1
fi

BASE="$(cat "$BASELINE")"

if (( CURRENT > BASE )); then
  echo "✗ Bare (non-enveloped) API responses: $CURRENT (baseline $BASE) — it may only SHRINK."
  echo
  echo "  A new endpoint returns its payload bare instead of { data: … }. Callers then have"
  echo "  to know which convention it uses, and guessing wrong renders an empty page with no"
  echo "  error (see the Modify Transfer bug, v3.0.98). Return { data: … }."
  echo
  grep -rnE "res\.json\([a-zA-Z_][a-zA-Z0-9_.]*\)" "$ROUTES"/*.js | sed 's|.*/routes/|  |'
  exit 1
fi

if (( CURRENT < BASE )); then
  echo "↓ Bare API responses: $CURRENT (baseline $BASE) — N8 debt reduced. Re-baseline:"
  echo "    ./Scripts/check-api-envelope.sh --update-baseline"
  exit 0
fi

echo "✓ Bare API responses: $CURRENT (at baseline). Shrink me: see CR043 N8."
