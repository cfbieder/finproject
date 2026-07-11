---
name: db-ops
description: Database operations for this project — creating/applying schema migrations, backing up or restoring the Postgres database, running the restore drill, or syncing prod data into dev (with mandatory PII scrub). Use when asked to migrate the DB, back up, restore, verify backups, or copy/sync production data to development.
---

# Database operations (condensed)

Full reasoning: `infra-bootstrap.md` §4–§5, `script-library.md` §5–§7 + §11,
`security-baseline.md`. Migration conventions also load automatically as a rule when
touching `migrations/**`.

## Migrations

- Append-only, NOT idempotent, numbered; ledger table answers "applied on THIS volume?";
  the cross-env matrix in `docs/current/` answers "applied everywhere?". Update both.
- Apply via **`exec` inside the backend container** — the deploy's migrate step is the ONLY
  mechanism that applies migrations (`initdb.d` only seeds an empty volume).
- Live-structure change = expand → migrate → contract across separate deploys; read-flip
  behind an env flag; destructive step last = the cutover.
- Seeds: separate lifecycle — idempotent/upsert, run right after migrations on deploy.

## Backup

- Pre-deploy: automatic `pg_dump -Fc` (the deploy script does this — never skip on a
  migration deploy).
- On-demand: `./scripts/backup-db.sh [--keep N]`. Off-host: `backup-to-remote.sh` on cron
  (off-host copy = real DR). PBS-backed hosts: the paperkey MUST be escrowed or backups are
  unrecoverable.

## Restore + the quarterly drill

- Restore: `pg_restore --clean --if-exists --no-owner` from the `-Fc` dump.
- **Quarterly drill (an untested backup is a hypothesis):** restore the latest dump into a
  scratch DB (`<<APP>>_restoretest`), assert expected tables + plausible row counts, boot
  the app against it read-only if cheap, then drop the scratch DB. Record the drill date in
  `docs/current/status.md`.
- Fresh-host migration: **restore, don't bootstrap** — a long-lived migration chain often
  isn't replayable from scratch; the dump carries the ledger, then apply only the delta.
  Media lives on volumes, not in the dump — copy it separately.

## Prod → dev sync — PII scrub is MANDATORY

Real production data (for clinic/client projects: personal/medical data) must not sit raw
on a dev box (GDPR). The sync sequence is:

1. Row-count sanity print → explicit destructive confirm.
2. Dump prod → restore into dev (`--clean --if-exists --no-owner`).
3. **Run the scrub script** (`scripts/scrub-dev-data.sh` / `.sql`, per script-library §7):
   pseudonymize names/emails/phones/addresses/free-text notes, preserving row counts, FK
   integrity, and value shapes. Refuse to skip it unless the user explicitly confirms the
   data contains no personal data.
4. Reset the dev login password (prod hashes would lock you out).
5. `--with-uploads` also syncs files — scrub/exclude any that are themselves personal data.

If no scrub script exists yet for this project, **write it before the first sync**: derive
the column list from the schema (every `*name*`, `*email*`, `*phone*`, `*address*`,
free-text/note columns on person-linked tables) and keep it exhaustive with a
schema-introspection CI guard.
