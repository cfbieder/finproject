#!/usr/bin/env bash
# SessionStart hook — put the trunk's CI verdict in front of the session (Known Issue #12).
#
# Five times `main` has gone red and stayed red because a red run is visible only to
# whoever opens the Actions tab, and nobody did: once for 30 consecutive pushes, through
# three releases and a prod deploy. Every instance was found by someone happening to
# look. This removes the "happening to".
#
# Asks about the newest run on main (--latest), NOT this checkout's HEAD: the tree is
# shared by several agent threads and is routinely mid-edit or behind origin, so HEAD's
# verdict is not the question. The question is whether the trunk is broken right now.
#
# Never blocks and never fails a session: any error path prints nothing and exits 0. A
# hook that can wedge a session start over a network hiccup gets removed within a week,
# and this is a notice, not a gate — the gate is deploy-to-production.sh Step 0b.

CI="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/Scripts/check-ci.sh"
[ -x "$CI" ] || exit 0

# 10s ceiling: the whole point is that the answer is cheap. If GitHub is slow, say nothing.
OUT="$(timeout 10 "$CI" --latest --quiet 2>&1)" || RC=$?
RC="${RC:-0}"

case "$RC" in
    1)
        # The one case worth interrupting for. Full detail, and say what to do about it.
        printf '🔴 CI is RED on main.\n%s\n\nProd deploys are blocked until this is green (deploy Step 0b).\nDetail: ./Scripts/check-ci.sh --latest\n' "$OUT"
        ;;
    2)  printf 'CI on main: still running — %s\n' "$OUT" ;;
    0)  printf 'CI on main: %s\n' "$OUT" ;;
    # 3 (no run) and 4 (could not ask) are not news at session start, and a hook that
    # cries wolf while offline teaches you to ignore the line that matters. Stay quiet.
    *)  : ;;
esac

exit 0
