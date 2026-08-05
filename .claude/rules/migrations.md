---
paths:
  - "server/db/migrations/**"
  - "server/db/*.sql"
---
# Migration rules

- Migrations are **append-only**: never edit or renumber a migration that has been
  applied anywhere (CI guard enforces this). To change course, write a new forward
  migration. Seeds are the opposite lifecycle: idempotent, re-runnable, separate.
- **Numbering:** next after the last on disk (zero-padded); never reuse; commit promptly
  to claim the number — another thread may be minting one too.
- **How migrations run here:** automatically only via `docker-entrypoint-initdb.d` on a
  fresh (empty-volume) database. On an existing dev DB, apply **through the runner** —
  `DATABASE_URL=…5434 node server/db/migrate.js` — **never `psql -f`**, which applies the SQL
  but writes no `schema_migrations` row, so the file looks unapplied forever (migration 057 did
  exactly this). Prod is then applied by `deploy-to-production.sh` at Step 2b, ahead of the code
  that references the new objects. **Step 2b(i) refuses to deploy a file absent from BOTH
  ledgers** (2026-08-05, Known Issue #15) — it reads the ledgers, so a hand-applied dev file is
  invisible to it. `--allow-unverified-migrations` overrides deliberately.
- **Backfill rule (migration-036 incident):** any schema object that reached dev/prod
  outside a migration (ad-hoc `ALTER`, AI-session change) must be captured **immediately**
  in an `IF NOT EXISTS` migration, or CI's fresh-from-migrations DB diverges and unrelated
  tests fail later. CI applies the whole chain to an empty DB (+ `server/db/ci-seed.sql`),
  so a migration that only works on a data-bearing DB fails there.
- **Editing an applied migration is forbidden** — but when it is unavoidable (041: it
  aborts the chain, so nothing later can repair it), the ledger's checksum then disagrees
  with the file **forever**, and `deploy-to-production.sh` reports drift on every run.
  Resolve it deliberately: prove the applied state matches what the current file would
  produce (re-run the file against the real DB inside a transaction and confirm it changes
  nothing), then
  `node server/db/migrate.js --accept-drift=<file>` — per file, never a blanket accept.
  A warning nobody can clear is a warning everybody learns to scroll past.
- Changing an existing live structure = **expand → migrate → contract** across separate
  deploys; the destructive step is last.
- After adding a migration: add its row to `docs/current/migrations.md` (the registry,
  with dev/prod applied status) and reference the CR.
