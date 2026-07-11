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
- **`.env` is never committed** (it carries the real DB password and bank-feed API key).
- New secrets: add to `.env.example` with a placeholder value, add a row to
  `docs/current/secrets-inventory.md` (names/locations only — never values), and keep the
  compose reference fail-loud.
