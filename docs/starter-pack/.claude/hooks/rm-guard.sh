#!/usr/bin/env bash
# PreToolUse hook for Bash — allow everything except commands containing `rm`.
#
# Why this exists: prefix rules like Bash(rm:*) only match commands that START with rm,
# so `cd x && rm y` slips through the ask-list in settings.json. This inspects the whole
# command line and asks whenever `rm` appears as a command word.
#
# Test it before trusting it (a failing hook errors invisibly on every call — it does not
# block, and the protection you think you have does not exist):
#   echo '{"tool_name":"Bash","tool_input":{"command":"cd /tmp && rm -rf x"}}' | .claude/hooks/rm-guard.sh   # ask
#   echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}'              | .claude/hooks/rm-guard.sh   # allow
#   echo '{"tool_name":"Bash","tool_input":{"command":"npm run rm-cache"}}'    | .claude/hooks/rm-guard.sh   # allow (false-positive check)
set -euo pipefail

cmd=$(jq -r '.tool_input.command // empty')

if printf '%s' "$cmd" | grep -qE '(^|[|&;(`[:space:]])rm([[:space:]]|$)'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"command contains rm — confirm"}}'
else
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"auto-allow (no rm present)"}}'
fi
