#!/usr/bin/env bash
#
# check-inline-hex.sh — guardrail against naked-hex inline styles.
#
# Inline style values written as a literal hex (`color: "#808E9B"`) don't flip in
# dark mode — they freeze the light-mode palette (CR042 T6). The fix is to use a
# theme token (`color: "var(--muted)"`). This check snapshots the per-file count
# of naked-hex style values and fails if any file's count GROWS or a new file
# introduces one — so the debt only shrinks. `var(--token, #fallback)` is fine
# (the token themes; the hex is only a fallback) and is not counted.
#
# Reducing a count (as migration proceeds) is always fine. After migrating, or to
# accept a deliberate new one, refresh the baseline:
#     ./Scripts/check-inline-hex.sh --update-baseline
#
# Usage:
#   ./Scripts/check-inline-hex.sh                 # check (exit 1 on growth)
#   ./Scripts/check-inline-hex.sh --update-baseline
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASELINE="$SCRIPT_DIR/.inline-hex-baseline.txt"
SRC="$ROOT/frontend/src"

# Per-file count of NAKED hex literals in JSX, as "<count> <relpath>".
#
# Naked = a literal #hex that is NOT the fallback inside var(--token, #hex). A fallback
# is fine: the token themes, and the hex only applies if the token is missing. Everything
# else — `color: "#808E9B"`, `border: "1px solid #E8E6DF"`, a hex in a style string —
# freezes the light palette and cannot respond to dark mode.
#
# (Originally this only matched the pure `prop: "#hex"` form, which silently missed every
# composite like "1px solid #hex". Widened, then re-baselined.)
current_counts() {
  while IFS= read -r f; do
    n=$(perl -0777 -ne 's/var\(--[A-Za-z0-9-]+,\s*#[0-9A-Fa-f]{3,6}\)/VARFB/g; my @m = /#[0-9A-Fa-f]{3,6}/g; print scalar(@m)' "$f")
    if [[ "${n:-0}" -gt 0 ]]; then
      echo "$n ${f#"$SRC"/}"
    fi
  done < <(find "$SRC" -name '*.jsx' | sort) | sort -k2
}

if [[ "${1:-}" == "--update-baseline" ]]; then
  current_counts > "$BASELINE"
  echo "Baseline refreshed: $(awk '{s+=$1} END {print s+0}' "$BASELINE") naked-hex style values across $(wc -l < "$BASELINE" | tr -d ' ') files."
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "ERROR: baseline missing ($BASELINE). Run with --update-baseline first." >&2
  exit 2
fi

fail=0
while read -r count file; do
  base=$(awk -v f="$file" '$2 == f { print $1 }' "$BASELINE")
  base=${base:-0}
  if (( count > base )); then
    echo "✗ $file: naked-hex style values grew $base → $count — use a var(--token) instead of a literal #hex" >&2
    fail=1
  fi
done < <(current_counts)

if (( fail )); then
  echo "" >&2
  echo "  Inline hex freezes the light palette in dark mode (CR042 T6)." >&2
  echo "  If genuinely warranted, run: ./Scripts/check-inline-hex.sh --update-baseline" >&2
  exit 1
fi

echo "✓ No new naked-hex inline styles ($(awk '{s+=$1} END {print s+0}' "$BASELINE") baselined, shrinking)."
