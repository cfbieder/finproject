---
paths:
  - "**/migrations/**"
  - "**/alembic/**"
  - "**/prisma/migrations/**"
---
# Migration rules

- Schema migrations are **append-only and NOT idempotent**: never edit or renumber a
  migration that has been applied anywhere. To change course, write a new forward migration.
- Seeds are the opposite lifecycle: **idempotent/upsert, re-runnable**, kept separate from
  schema migrations.
- Never assume a migration number is free: take the next after the last on disk; on
  collision, yield to the committed/lower owner and renumber yours higher; commit + push
  promptly to claim it.
- Migrations are applied by **`exec` inside the running backend container** (or the
  project's migrate script) — never by a host tool pointed at a DB port, and never assumed
  applied because files are mounted in `initdb.d` (that runs only on an empty volume).
- Changing an existing live structure = **expand → migrate → contract** across separate
  deploys; the destructive step is last and is the cutover.
- **Backfill rule:** any schema object that reached a live DB *outside* a migration
  (ad-hoc `ALTER`, AI-session change) must be captured **immediately** in an
  `IF NOT EXISTS` migration — no-op where already applied — or a from-scratch replay
  (CI, fresh install) silently diverges and unrelated tests fail much later.
- After adding a migration, update the cross-environment migration matrix in
  `docs/current/`.
