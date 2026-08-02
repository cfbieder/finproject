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
- **A migration may NOT assert a production data fact.** A migration that `RAISE`s because a
  row count, a mapping, or a reference row isn't what prod happens to hold **aborts the whole
  chain on an empty database** — so it takes CI down, and it takes it down *before the tests
  run*, which buries whatever else was failing. If a data check is genuinely wanted, give it
  an explicit zero-rows skip branch: guard nothing when there is nothing to guard. (Real cost
  of getting this wrong: two days of red CI, three releases and a prod deploy shipped over it.)
- **Order-independence.** A migration must not depend on a higher-numbered file, nor on which
  of two concurrently-minted numbers landed first. Two agents can be minting numbers at once.
- **The deploy runner applies every *pending* file.** A migration merged for a feature that
  has not cut over yet will be applied by the next, unrelated deploy — nobody re-reads the
  chain at deploy time. Either the migration is safe to apply early, or it does not get
  merged yet. Say which, in the CR.
- **Editing an applied migration is forbidden — and when it is truly unavoidable** (the file
  aborts the chain, so no later migration can repair it), the ledger checksum then disagrees
  with the file **forever** and the deploy reports drift on every run. Resolve it
  deliberately, never blanket: prove the applied state matches what the current file would
  produce (re-run it against the real DB inside a transaction, confirm it changes nothing),
  then accept the drift **for that one file** (`migrate --accept-drift=<file>`). A warning
  nobody can clear is a warning everybody learns to scroll past.
- After adding a migration, update the cross-environment migration matrix in
  `docs/current/`.
