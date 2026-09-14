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
- **There is no safe redaction of a multi-secret file.** Verify an `.env` edit with
  `grep -c '^KEY='`, `cut -d= -f1`, or `git diff --stat` — never by printing the lines you
  changed with the values "masked". Two real exposures in three days, by two mechanisms: a
  `sed 's/\(KEY=\).*/\1<redacted: &>/'` whose `&` re-inserts the whole match (it *looks*
  redacted in the script), and a mask pattern narrower than the region printed, so the
  neighbouring secrets reached the transcript in clear. `docker compose config` prints every
  resolved secret too — reduce it to names or counts before it reaches the terminal.
- New secrets: add to `.env.example` with a `CHANGE_ME` value, add a row to
  `docs/current/secrets-inventory.md` (names/locations only — never values), and confirm
  the prod compose reads it fail-loud.
- Ops scripts: `set -euo pipefail`, `--help`, preflight checks that fail fast, destructive
  actions gated behind a confirm prompt or explicit flag.
