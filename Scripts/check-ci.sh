#!/usr/bin/env bash
#
# check-ci.sh — what does CI say about this commit? (Known Issue #12)
#
# `main` has gone red and stayed red five times without anything saying so — once for
# 30 consecutive pushes, through three releases and a prod deploy. Every instance was
# found by someone happening to open the Actions tab. This is that tab, on the terminal
# the work already happens in, so the answer is one command instead of a context switch.
#
# Usage: ./check-ci.sh [ref] [--quiet] [--wait[=SECONDS]]
#          ref      commit/branch/tag to ask about (default HEAD)
#          --quiet  one line, for scripts. deploy-to-production.sh Step 0b calls this.
#                   RED always prints in full, quiet or not — it is the one verdict
#                   that must not be summarised away.
#          --wait   block until the run finishes (default 600s, --wait=N to change),
#                   then report the settled verdict.
#
# --wait exists because of how /close actually runs: push, then deploy immediately. CI
# takes ~2 minutes, so a gate that refused "pending" would refuse EVERY release, and a
# guard that fires on every legitimate run is one people learn to bypass reflexively —
# which is worse than no guard. Waiting also covers the few seconds after a push where
# GitHub has not registered the run yet and "no run" is merely early, not absent. That
# grace applies ONLY to a pushed commit; an unpushed one will never get a run, so
# waiting on it would just burn ten minutes to reach the same answer.
#
# Exit codes are the interface — deploy-to-production.sh branches on them:
#   0  green      every workflow on this commit completed successfully
#   1  RED        at least one workflow failed / was cancelled / timed out
#   2  pending    a run exists but has not finished
#   3  no run     nothing ran for this commit — usually it was never pushed
#   4  unknown    could not ask GitHub (gh missing, unauthenticated, offline)
#
# 4 is deliberately NOT fatal to a deploy. "I could not check" is not "it is red", and a
# gate that blocks prod during a GitHub outage is one that gets disabled the first time
# it does. It prints loudly and lets the caller decide; 1, 2 and 3 are the refusals.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(cd "$SCRIPT_DIR/.." && pwd)"

REF="HEAD"
QUIET=false
WAIT=0
POLL=15
for arg in "$@"; do
    case "$arg" in
        --quiet|-q) QUIET=true ;;
        --wait)     WAIT=600 ;;
        --wait=*)   WAIT="${arg#*=}" ;;
        --help|-h)  sed -n '3,34p' "${BASH_SOURCE[0]}" | sed 's/^#\ \?//'; exit 0 ;;
        *)          REF="$arg" ;;
    esac
done

say() { [ "$QUIET" = true ] || printf '%s\n' "$@"; }

if ! SHA="$(git rev-parse --verify "$REF^{commit}" 2>/dev/null)"; then
    echo "check-ci: not a commit: $REF" >&2
    exit 4
fi
SHORT="${SHA:0:7}"
# A friendly name when there is one (tag, or the branch for HEAD//a branch ref); for a
# bare sha `rev-parse --abbrev-ref` returns empty, and "$SHORT" alone reads better than
# a dangling separator.
LABEL="$(git describe --tags --exact-match "$SHA" 2>/dev/null || true)"
[ -z "$LABEL" ] && LABEL="$(git rev-parse --abbrev-ref "$REF" 2>/dev/null || true)"
case "$LABEL" in ""|HEAD|"$SHA") WHERE="$SHORT" ;; *) WHERE="$LABEL @ $SHORT" ;; esac

if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
    echo "⚠ check-ci: cannot reach GitHub (gh missing or not authenticated) — CI UNKNOWN for $SHORT"
    exit 4
fi

# --limit 20 covers re-runs and any second workflow; a commit has far fewer.
# `timeout` so a hung network cannot stall a deploy that is otherwise ready to go.
# gh carries its own jq, so --jq needs no jq on the host.
#
# $SHA is the FULL 40-char sha, and must be: `gh run list --commit` matches on the whole
# string and returns an empty list for an abbreviated one, with no error and no warning.
# Hence the rev-parse above rather than passing $REF through. The mistake is self-punishing
# in the safe direction — empty reads as "no run" (exit 3), which REFUSES a deploy rather
# than waving one through — but it reads like a fact and is not one.
PUSHED=true
[ -z "$(git branch -r --contains "$SHA" 2>/dev/null)" ] && PUSHED=false

# Ask GitHub once. Sets VERDICT (green|red|pending|none|unknown) and DETAIL.
evaluate() {
    VERDICT=""; DETAIL=""
    local runs
    if ! runs="$(timeout 20 gh run list --commit "$SHA" --limit 20 \
            --json workflowName,status,conclusion,url,createdAt \
            --jq '.[] | [.workflowName, .status, (.conclusion // "-"), .createdAt, .url] | @tsv' 2>/dev/null)"; then
        VERDICT="unknown"
        return
    fi
    if [ -z "$runs" ]; then
        VERDICT="none"
        return
    fi

    # Worst-first: a failure alongside a still-running job is red, not pending.
    local any_bad=false any_pending=false name status conclusion created url state mark
    while IFS=$'\t' read -r name status conclusion created url; do
        [ -z "$name" ] && continue
        case "$conclusion" in
            failure|cancelled|timed_out|startup_failure|action_required) any_bad=true ;;
        esac
        [ "$status" != "completed" ] && any_pending=true
        state="$conclusion"; [ "$state" = "-" ] && state="$status"
        case "$state" in success) mark="✓" ;; failure) mark="✗" ;; *) mark="·" ;; esac
        DETAIL+="$(printf '    %s %-22s %-12s %s' "$mark" "$name" "$state" "$created")"$'\n'
        [ "$state" != "success" ] && DETAIL+="        $url"$'\n'
    done <<< "$runs"

    if   [ "$any_bad" = true ];     then VERDICT="red"
    elif [ "$any_pending" = true ]; then VERDICT="pending"
    else                                 VERDICT="green"
    fi
}

# Wait only on verdicts that can still change on their own: a run in flight, or a pushed
# commit whose run GitHub has not registered yet. red and green are settled, and an
# unpushed commit will never acquire a run however long we sit here.
DEADLINE=$(( SECONDS + WAIT ))
while :; do
    evaluate
    case "$VERDICT" in
        red|green|unknown) break ;;
        none) [ "$PUSHED" = false ] && break ;;
    esac
    [ "$SECONDS" -ge "$DEADLINE" ] && break
    if [ "$VERDICT" = "pending" ]; then
        echo "· $WHERE — CI still running, waiting… (${SECONDS}s of ${WAIT}s)"
    else
        echo "· $WHERE — no run registered yet, waiting… (${SECONDS}s of ${WAIT}s)"
    fi
    sleep "$POLL"
done

case "$VERDICT" in
    unknown)
        echo "⚠ check-ci: GitHub query failed or timed out — CI UNKNOWN for $SHORT"
        exit 4
        ;;
    none)
        say "$WHERE — no CI run"
        if [ "$PUSHED" = false ]; then
            say "    not on any remote branch, so CI never saw it — push it to have it verified"
        else
            say "    pushed, but no workflow ran for it"
        fi
        [ "$QUIET" = true ] && echo "$WHERE — NO CI RUN"
        exit 3
        ;;
    red)
        echo "$WHERE — ✗ CI is RED"
        printf '%s' "$DETAIL"
        exit 1
        ;;
    pending)
        say "$WHERE — · CI still running"
        say "$(printf '%s' "$DETAIL")"
        [ "$QUIET" = true ] && echo "$WHERE — CI still running"
        exit 2
        ;;
    green)
        say "$WHERE — ✓ green"
        say "$(printf '%s' "$DETAIL")"
        [ "$QUIET" = true ] && echo "$WHERE — CI green"
        exit 0
        ;;
esac
