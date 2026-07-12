#!/usr/bin/env bash
#
# check-modal-adoption.sh — guardrail against bespoke-dialog sprawl.
#
# The canonical modal is frontend/src/components/Modal/Modal.jsx (a Radix Dialog
# under the app tokens). ~20 pre-existing pages still hand-roll `role="dialog"`
# overlays; they are being migrated onto <Modal>. This check fails if a NEW file
# introduces a bespoke `role="dialog"` that is not already in the baseline
# snapshot — forcing new modals to use <Modal> instead of another one-off overlay.
#
# Removing files from the list (as migration proceeds) is always fine. To
# intentionally allow a new bespoke dialog, refresh the baseline:
#     ./Scripts/check-modal-adoption.sh --update-baseline
#
# Usage:
#   ./Scripts/check-modal-adoption.sh                 # check (exit 1 on new files)
#   ./Scripts/check-modal-adoption.sh --update-baseline
#
set -euo pipefail

# `comm` requires both inputs collated identically — see check-button-css.sh.
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASELINE="$SCRIPT_DIR/.modal-adoption-baseline.txt"
SRC="$ROOT/frontend/src"

# Files that hand-roll a dialog, relative to frontend/src. The Modal primitive
# itself is excluded — it is the sanctioned home of role="dialog".
current_files() {
  grep -rlE 'role="dialog"' "$SRC" --include=*.jsx \
    | sed "s#^$SRC/##" \
    | grep -v '^components/Modal/' \
    | sort -u
}

if [[ "${1:-}" == "--update-baseline" ]]; then
  current_files > "$BASELINE"
  echo "Baseline refreshed: $(wc -l < "$BASELINE" | tr -d ' ') files with bespoke dialogs."
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "ERROR: baseline missing ($BASELINE). Run with --update-baseline first." >&2
  exit 2
fi

# Files present now but absent from the baseline = newly introduced sprawl.
NEW="$(comm -13 "$BASELINE" <(current_files) || true)"

if [[ -n "$NEW" ]]; then
  echo "✗ New bespoke role=\"dialog\" overlay(s) detected — use the shared <Modal>" >&2
  echo "  primitive (frontend/src/components/Modal/Modal.jsx) instead:" >&2
  echo "$NEW" | sed 's/^/    /' >&2
  echo "" >&2
  echo "  If a bespoke dialog is genuinely warranted, run:" >&2
  echo "    ./Scripts/check-modal-adoption.sh --update-baseline" >&2
  exit 1
fi

echo "✓ No new bespoke-dialog sprawl ($(current_files | wc -l | tr -d ' ') pre-existing, migrating to <Modal>)."
