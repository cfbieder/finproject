#!/usr/bin/env bash
# PreToolUse hook for Bash: auto-allow every command unless it contains an
# rm invocation anywhere (compound commands like `cd x && rm y` slip past
# prefix rules such as Bash(rm:*), so we inspect the whole command line).
cmd=$(jq -r '.tool_input.command // empty')
if printf '%s' "$cmd" | grep -qE '(^|[|&;(`[:space:]])rm([[:space:]]|$)'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"command contains rm — confirm"}}'
else
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"auto-allow (no rm present)"}}'
fi
