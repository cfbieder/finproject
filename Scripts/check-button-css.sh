#!/usr/bin/env bash
#
# check-button-css.sh — guardrail against button-class sprawl.
#
# The canonical button system lives in frontend/src/components/buttons.css as the
# `.btn` family. Per-page `*-btn` / `*-button` class families are being migrated
# onto it. This check fails if a NEW button-ish class DEFINITION appears in the
# CSS that is not already in the baseline snapshot — forcing new UI to use `.btn`
# instead of inventing another one-off button class.
#
# Removing classes (as migration proceeds) is always fine. To intentionally add a
# new allowed class, refresh the baseline:
#     ./Scripts/check-button-css.sh --update-baseline
#
# Usage:
#   ./Scripts/check-button-css.sh                 # check (exit 1 on new classes)
#   ./Scripts/check-button-css.sh --update-baseline
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASELINE="$SCRIPT_DIR/.button-class-baseline.txt"
SRC="$ROOT/frontend/src"

current_classes() {
  grep -rhoE '\.[A-Za-z0-9_-]*(btn|button)[A-Za-z0-9_-]*' "$SRC" --include=*.css \
    | sort -u
}

if [[ "${1:-}" == "--update-baseline" ]]; then
  current_classes > "$BASELINE"
  echo "Baseline refreshed: $(wc -l < "$BASELINE" | tr -d ' ') button classes."
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "ERROR: baseline missing ($BASELINE). Run with --update-baseline first." >&2
  exit 2
fi

# Classes present now but absent from the baseline = newly introduced sprawl.
NEW="$(comm -13 "$BASELINE" <(current_classes) || true)"

if [[ -n "$NEW" ]]; then
  echo "✗ New button class definition(s) detected — use the shared .btn system" >&2
  echo "  (frontend/src/components/buttons.css) instead of a one-off class:" >&2
  echo "$NEW" | sed 's/^/    /' >&2
  echo "" >&2
  echo "  If this class is genuinely warranted, run:" >&2
  echo "    ./Scripts/check-button-css.sh --update-baseline" >&2
  exit 1
fi

echo "✓ No new button-class sprawl ($(current_classes | wc -l | tr -d ' ') known classes)."
