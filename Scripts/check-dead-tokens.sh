#!/usr/bin/env bash
#
# check-dead-tokens.sh — guardrail against dangling design tokens.
#
# `color: var(--text-secondary)` looks fine, lints fine, and silently does NOTHING when
# --text-secondary was never defined: the property falls back to the inherited value. The
# result is styling that quietly ignores the theme — including dark mode. CR042 T1 found
# this in KpiCards; it turned out 50 more references were dangling across the app
# (--text, --text-secondary, --text-muted, --text-primary, --font-heading).
#
# This check extracts every custom property REFERENCED via var(--x) in the frontend
# (CSS + JSX inline styles) and every one DEFINED in a stylesheet, and fails on any
# reference with no definition. There is no baseline: the correct count is zero.
#
# Usage:  ./Scripts/check-dead-tokens.sh
#
set -euo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/frontend/src"

# Tokens set at RUNTIME from a JSX inline style (style={{ "--x": n }}) rather than in a
# stylesheet — they have no CSS declaration by design, so they are not dangling.
ALLOWLIST_RE='^--(tw-|radix-|swiper-|balance-indent-level|cashflow-indent-level)$'

referenced() {
  grep -rhoE 'var\(--[A-Za-z0-9_-]+' "$SRC" --include=*.css --include=*.jsx --include=*.js \
    | sed -E 's/^var\(//' | sort -u
}

defined() {
  # `--x:` at the start of a declaration inside any stylesheet.
  grep -rhoE '^[[:space:]]*--[A-Za-z0-9_-]+[[:space:]]*:' "$SRC" --include=*.css \
    | sed -E 's/[[:space:]]*//g; s/:$//' | sort -u
}

DANGLING="$(comm -23 <(referenced) <(defined) | grep -vE "$ALLOWLIST_RE" || true)"

if [[ -n "$DANGLING" ]]; then
  echo "✗ Dangling design token(s) — referenced via var() but never defined." >&2
  echo "  These silently fall back to the inherited value and ignore the theme:" >&2
  echo "$DANGLING" | sed 's/^/    /' >&2
  echo "" >&2
  echo "  Define the token in frontend/src/index.css, or use the real one" >&2
  echo "  (--ink / --ink-secondary / --muted / --font-heading / …)." >&2
  exit 1
fi

echo "✓ No dangling design tokens ($(referenced | wc -l | tr -d ' ') referenced, all defined)."
