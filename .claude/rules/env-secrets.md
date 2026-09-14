---
paths:
  - "**/.env*"
  - "Scripts/**"
---
# Env-file & secrets handling rules

- **Edit `.env` files in place** (targeted replace on the one line you own) — never
  regenerate the whole file (`cat > .env` wipes manually-added vars).
- If a set-check reports a var missing, the line is **absent** — append it; a
  `sed -i "s|^VAR=.*|…|"` on a missing line silently no-ops.
- **Never print, echo, or paste secret values** — into chat, logs, or command output.
  Verify presence by count (`grep -c '^KEY='`), set values via hidden prompt
  (`read -rsp`), one secret per command.
- **There is no safe redaction of a multi-secret file.** Verify an `.env` edit with
  `grep -c '^KEY='`, `cut -d= -f1`, or `git diff --stat` — never by printing the lines you
  changed, masked or not. Two exposures in three days (2026-09-06, 2026-09-08 —
  [secrets-inventory](../../docs/current/secrets-inventory.md)): a `sed` whose `&` re-inserted
  the match it claimed to hide, and a mask narrower than the region printed.
  `docker compose config` prints every resolved secret too — reduce it to names first.
- **`.env` is never committed** (it carries the real DB password and bank-feed API key).
- New secrets: add to `.env.example` with a placeholder value, add a row to
  `docs/current/secrets-inventory.md` (names/locations only — never values), and keep the
  compose reference fail-loud.
