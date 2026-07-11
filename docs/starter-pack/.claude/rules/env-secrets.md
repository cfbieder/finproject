---
paths:
  - "**/.env*"
  - "scripts/**"
  - "Scripts/**"
---
# Env-file & secrets handling rules

- **Edit `.env` files in place** (targeted `sed`/replace on the one line you own) — never
  regenerate the whole file (`cat > .env` wipes manually-added vars; this caused a real
  outage).
- If a set-check reports the var missing, the line is **absent** — append it; a
  `sed -i "s|^VAR=.*|…|"` on a missing line silently no-ops.
- **Never print, echo, or paste secret values** — into the chat, logs, or command output.
  Verify presence by count (`grep -c '^KEY='`), set values via hidden prompt
  (`read -rsp`), one secret per command.
- New secrets: add to `.env.example` with a `CHANGE_ME` value, add a row to
  `docs/current/secrets-inventory.md` (names/locations only — never values), and confirm
  the prod compose reads it fail-loud.
- Ops scripts: `set -euo pipefail`, `--help`, preflight checks that fail fast, destructive
  actions gated behind a confirm prompt or explicit flag.
