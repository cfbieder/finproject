# Claude Code permission prompts — diagnosis method + the configuration that resulted

> How we reduced constant permission prompting to near-zero (2026-07-11), and — more
> useful — how we *diagnosed* it, since the config alone was misleading. The live config
> is `.claude/settings.json` + `.claude/hooks/allow-bash-except-rm.sh`; this guide is the
> reasoning and the verification discipline.

## Diagnose from evidence, not the config alone

Reading `settings.json` wasn't enough — the allowlist looked generous but prompts
persisted. Three checks found the real causes:

1. **`git diff` on `.claude/settings.json` + file mtime** — revealed the broad allowlist
   was written only hours earlier and *uncommitted*; most remembered prompting happened
   under the old committed rules, which were missing an `Edit` allow (so every file edit
   prompted).
2. **Pipe-testing the referenced hook script directly** — the settings pointed at
   `.claude/hooks/allow-bash-except-rm.sh`, which *didn't exist*; every Bash call fired a
   hook that exited 127.
3. **Checking all settings layers** — `~/.claude/settings.json` (user),
   `.claude/settings.local.json` (absent), `/etc/claude-code/managed-settings.json`
   (absent) — to rule out a hidden `ask`/`deny` rule overriding the project allows.

## The configuration pattern that resulted

- **Project allowlist (`.claude/settings.json`): bare tool names** — `Bash`, `Write`,
  `Read`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `NotebookEdit` — allow
  everything by default. The common miss: **`Write` and `Edit` are separate tools**;
  allowing one doesn't cover the other.
- **Keep a narrow `ask` safety net** rather than going fully unattended: `Bash(rm:*)`
  and `Bash(sudo rm:*)` still prompt.
- **Close the prefix-rule gap with a PreToolUse hook.** Prefix rules like `Bash(rm:*)`
  only match commands *starting with* `rm` — `cd x && rm y` slips through. The hook
  script inspects the whole command line and returns `permissionDecision: "ask"` if `rm`
  appears anywhere as a command word, `allow` otherwise. (A second hook auto-allows
  `WebFetch` for unattended sessions.)
- **Cover every directory the workflow actually touches** via `additionalDirectories`
  in user settings. Edits outside the project root + listed directories always prompt
  regardless of allow rules — we added the full `bank-feed` and `ocr-llm` repos, not
  just subdirectories.

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
