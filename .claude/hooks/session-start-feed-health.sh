#!/usr/bin/env bash
# SessionStart hook — say when a bank consent has expired (CR060).
#
# PSD2 consents lapse roughly every 90 days, and 8 of the 13 connections are
# GoCardless. When one dies the feed stops SILENTLY: no error, no failed sync,
# just a balance that stops moving. The upstream reports `needs_reconnect` from
# day zero and, until now, nothing read it — the owner found out by opening the
# reconcile page and noticing, or three days later via the staleness proxy.
#
# ⚠️ Deliberately NOT a cron job writing to a log. This repo retired
# `backup-to-remote.sh` on 2026-09-01 after it failed EVERY RUN for 74 days into
# a logfile nobody read. A log is not an alert. This puts the fact in front of a
# session, the same way the CI hook does, because that is a place someone
# actually looks.
#
# Never blocks and never fails a session: every path exits 0. Silence means
# "nothing to say OR could not ask" — a hook that cries wolf when the API is
# down teaches you to ignore the line that matters, which is the CI hook's rule
# and the reason it stays quiet on "no run".

API="${FIN_API:-http://localhost:3005}"

# 5s ceiling. The whole value here is that the answer is cheap; if the API is
# slow or down, that is not this hook's news to break.
OUT="$(timeout 5 curl -sf "$API/api/v2/util/attention-summary" 2>/dev/null)" || exit 0
[ -n "$OUT" ] || exit 0

N="$(printf '%s' "$OUT" | python3 -c '
import sys, json
try:
    print(json.load(sys.stdin).get("needsReconnect", {}).get("count", 0) or 0)
except Exception:
    print(0)
' 2>/dev/null)" || exit 0

case "$N" in
    ''|0) exit 0 ;;
    1) printf '🔴 1 bank connection needs re-authorising — its feed has stopped.\n   Fix: Settings → Bank Feed Setup → Re-authorise. Then re-check the account mapping (a reconnect can re-key accounts).\n' ;;
    *) printf '🔴 %s bank connections need re-authorising — their feeds have stopped.\n   Fix: Settings → Bank Feed Setup → Re-authorise. Then re-check the account mapping (a reconnect can re-key accounts).\n' "$N" ;;
esac

exit 0
