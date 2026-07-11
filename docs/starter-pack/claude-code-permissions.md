# Claude Code Permission Prompts — diagnosis method + baseline configuration

> **Pack role:** how to get an agent session down to near-zero permission prompts
> *safely* — and, more useful, how to **diagnose** why prompts persist, since the config
> alone is misleading. Distilled from a real debugging session where a generous-looking
> allowlist still prompted constantly. Companion to the `.claude/` layer this pack ships.
>
> **Last reviewed:** 2026-07-11.

## Diagnose from evidence, not the config alone

Reading `settings.json` isn't enough. Three checks find the real causes:

1. **`git diff` on `.claude/settings.json` + file mtime** — is the allowlist you're
   reading actually the one your remembered prompting happened under? (Real case: the
   broad allowlist was written only hours earlier and uncommitted; the old committed
   rules were missing an `Edit` allow, so every file edit prompted.)
2. **Pipe-test the referenced hook script directly** — a settings file can point at a
   hook that doesn't exist or crashes; then every matching tool call fires a hook that
   errors (e.g. exit 127) on each invocation.
3. **Check all settings layers** — `~/.claude/settings.json` (user),
   `.claude/settings.local.json`, `/etc/claude-code/managed-settings.json` (managed) —
   to rule out a hidden `ask`/`deny` rule overriding the project allows.

## The baseline configuration pattern

- **Project allowlist (`.claude/settings.json`): bare tool names** — `Bash`, `Write`,
  `Read`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `NotebookEdit` — allow
  everything by default. The common miss: **`Write` and `Edit` are separate tools**;
  allowing one doesn't cover the other.
- **Keep a narrow `ask` safety net** rather than going fully unattended: `Bash(rm:*)`
  and `Bash(sudo rm:*)` still prompt.
- **Close the prefix-rule gap with a PreToolUse hook.** Prefix rules like `Bash(rm:*)`
  only match commands *starting with* `rm` — `cd x && rm y` slips through. A small hook
  inspects the whole command line and returns `permissionDecision: "ask"` if `rm`
  appears anywhere as a command word, `allow` otherwise:

  ```bash
  #!/usr/bin/env bash
  # PreToolUse hook for Bash: allow everything except commands containing rm.
  cmd=$(jq -r '.tool_input.command // empty')
  if printf '%s' "$cmd" | grep -qE '(^|[|&;(`[:space:]])rm([[:space:]]|$)'; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"command contains rm — confirm"}}'
  else
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"auto-allow (no rm present)"}}'
  fi
  ```

- **Cover every directory the workflow actually touches** via `additionalDirectories`
  in user settings. Edits outside the project root + listed directories always prompt
  regardless of allow rules — list each sibling repo the workflow edits (the *whole*
  repo, not a subdirectory).

## Verification discipline for hooks

- Pipe-test the script standalone with synthesized stdin:
  `echo '{"tool_name":"Bash","tool_input":{"command":"..."}}' | bash hook.sh`
  covering **allow**, **ask**, and **false-positive** cases (`npm run rm-cache` must
  *not* trigger).
- `jq -e` both settings files to confirm valid JSON and correct nesting — a malformed
  settings file silently disables everything in it.

## Operational gotchas

- Sessions opened before a settings change **keep the old rules until reloaded** (open
  `/hooks` once or restart the session).
- A missing/failing hook script **doesn't block or prompt — it errors invisibly** on
  every call, so the protection you think you have may not exist. Test it, don't assume.
- Answering "Yes" (once) at prompts leaves no trace; "Always allow" writes rules into
  `settings.local.json` — if that file is empty after weeks of use, the allowlist was
  never actually growing.
- **MCP connector tools need their own allow rules** (`mcp__<server>` or
  `mcp__<server>__<tool>`); the built-in tool allows don't cover them. Only allowlist
  read-only servers/tools by default.
- **Commit the settings + hook once they work** — an uncommitted allowlist is exactly
  the drift that makes the next diagnosis harder (check #1 above).
