#!/usr/bin/env bash
#
# check-lint-debt.sh — ratchet for the lint rules that are DEBT rather than BREAKAGE.
#
# The CI lint step blocks on eslint ERRORS, and every rule that catches a real bug is an
# error and sits at zero: no-undef, no-unused-vars, react-hooks/rules-of-hooks,
# react-hooks/refs, react-hooks/immutability, and the toISOString guard.
#
# Two rules are deliberately WARNINGS instead (see frontend/eslint.config.js):
#
#   react-hooks/set-state-in-effect      state synced from props inside an effect. An extra
#                                        render pass, and wrong under concurrent rendering —
#                                        but not broken today. The remaining sites are
#                                        behavioral surgery across the Budget worksheets,
#                                        the Transaction filters and the mobile pages: hand
#                                        work needing browser verification per site.
#
#   react-refresh/only-export-components dev-only. When it fires, Vite does a full reload
#                                        instead of a hot swap. Zero runtime effect. Fixing
#                                        it means hoisting helpers/hooks out of component
#                                        files (TransactionTable, PeriodSelector, …) and
#                                        rewriting imports app-wide — churn on the money
#                                        path to buy hot-reload ergonomics.
#
# Left unbounded, "it's only a warning" is how a count grows back. So they are BASELINED
# here and the count may only SHRINK. Burn them down per-file when you are already in the
# file for another reason, then re-baseline.
#
# Usage:
#   ./Scripts/check-lint-debt.sh                    # verify (CI)
#   ./Scripts/check-lint-debt.sh --update-baseline  # after a burn-down
#
set -euo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASELINE="$SCRIPT_DIR/.lint-debt-baseline.txt"

RULES='react-hooks/set-state-in-effect|react-refresh/only-export-components'

cd "$ROOT/frontend"

# Count per rule from eslint's JSON output. Node is already a build dependency.
count_debt() {
  npx eslint src -f json 2>/dev/null | node -e '
    const rules = new Set(["react-hooks/set-state-in-effect", "react-refresh/only-export-components"]);
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      const counts = {};
      for (const file of JSON.parse(raw)) {
        for (const m of file.messages) {
          if (rules.has(m.ruleId)) counts[m.ruleId] = (counts[m.ruleId] || 0) + 1;
        }
      }
      for (const rule of [...rules].sort()) console.log(`${counts[rule] || 0} ${rule}`);
    });
  '
}

CURRENT="$(count_debt)"

if [[ "${1:-}" == "--update-baseline" ]]; then
  printf '%s\n' "$CURRENT" > "$BASELINE"
  echo "Baseline refreshed:"
  sed 's/^/  /' "$BASELINE"
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "No baseline at $BASELINE — run: ./Scripts/check-lint-debt.sh --update-baseline"
  exit 1
fi

fail=0
while read -r base_count rule; do
  cur_count="$(printf '%s\n' "$CURRENT" | awk -v r="$rule" '$2 == r { print $1 }')"
  cur_count="${cur_count:-0}"
  if (( cur_count > base_count )); then
    echo "✗ $rule: $cur_count (baseline $base_count) — it may only SHRINK."
    echo "  New violations were added. Fix them, or if they are genuinely warranted, discuss"
    echo "  before running: ./Scripts/check-lint-debt.sh --update-baseline"
    fail=1
  elif (( cur_count < base_count )); then
    echo "↓ $rule: $cur_count (baseline $base_count) — debt reduced. Re-baseline:"
    echo "    ./Scripts/check-lint-debt.sh --update-baseline"
  else
    echo "✓ $rule: $cur_count (at baseline)"
  fi
done < "$BASELINE"

exit "$fail"
