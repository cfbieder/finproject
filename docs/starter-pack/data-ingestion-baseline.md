# Data-Ingestion Baseline

> **Pack role:** the correctness floor for **importing external data and deriving state from
> it** — file/CSV/API imports, transaction reconstruction, any "upload → parse → replace →
> recompute" pipeline. [`.claude/rules/migrations.md`](.claude/rules/migrations.md) covers
> *schema* change safety; this doc covers *data* change safety, the layer above it. The
> failure modes here are quiet: they return `200 OK`, render a healthy UI, and corrupt the
> numbers behind it. Every rule below was learned from a real incident.
>
> **Last reviewed:** 2026-07-11.

## Why

Ingestion bugs don't crash — they *lie*. A wrong file wipes the live dataset and returns
success; a recased header defaults a money column to zero and every derived total is
plausibly wrong; a rebuild from only the new rows silently drops records that closed across
two imports. The UI stays green the whole time. The four rules below make each failure
**loud and early** instead of silent and downstream.

## 1. Validate before you destroy — never replace on an unvalidated parse

An import that **replaces** existing data (delete-then-insert, truncate-then-load, full
snapshot swap) must parse and validate to a **non-empty, sane result BEFORE the destructive
step** — and abort with an error *before* deleting if it doesn't.

- Order of operations is the whole game: **parse → validate → (only now) delete → insert**,
  never delete-then-parse. A wrong or unreadable file must fail with the old data intact.
- A destructive import that finds nothing to insert is an **error, not an empty success** —
  return `4xx`, not `200`. "Imported 0 rows" over a wiped table is data loss wearing a
  success banner.
- Offer a `dry_run` that parses + reports counts and writes nothing, so the destructive path
  is only taken once the parse is proven.
- *Incident:* a positions importer deleted-then-inserted and returned `200`; a mis-typed
  upload parsed to zero rows and silently wiped the live snapshot.

## 2. External exports are unstable inputs — fail loud, never silent-default

Anything you didn't generate (broker/bank CSVs, partner API payloads, spreadsheet exports)
will change its **header casing, column names, encoding, and column order** between versions
without warning. Parse defensively and treat drift as a hard error.

- Match headers/keys **case-insensitively** (and trim whitespace/BOM); don't hard-code exact
  casing or column position.
- A missing or unresolvable **required** column is a **hard error** — never a silent default.
  A silent `0` / `null` / `""` fallback on a money, quantity, or date column is the most
  dangerous line you can write: it corrupts every downstream computation behind a UI that
  looks fine.
- **Pin real exports as test fixtures.** Commit an actual (scrubbed) sample of each format
  and parametrize the parser tests over all seen variants, so a format the code already
  handles can't silently regress.
- *Incident:* a vendor recased `Average Cost Basis` → `Average cost basis`; the case-sensitive
  lookup missed, fell back to `0.0` premium, and corrupted credit/max-loss/P&L for every row.

## 3. Raw is append-only + idempotent; derived is rebuilt from ALL raw — never the delta

Separate the two lifecycles explicitly:

- **Raw ingest table:** append-only, **idempotent on a content hash** so re-importing an
  overlapping file is a no-op, not a duplicate. Merge (union), don't replace.
- **Derived tables** (aggregates, reconstructed entities, rollups): **recompute from the full
  raw set on every import**, never incrementally from just the newly-added rows. A
  delta-rebuild orphans anything whose lifecycle spans two imports (an entity opened in
  import A and closed in import B) and silently drops it from the results.
- **Idempotency-hash hygiene:** exclude unstable fields (running balances, import
  timestamps, row order) from the dedup hash, or re-imports won't dedupe. When genuinely
  identical rows are legal (repeated partial fills), add an explicit occurrence index to the
  hash so they don't collapse into one.
- *Incident:* rebuilding reconstructed trades from only the new import (not all transactions)
  orphaned cross-import closes and dropped $3,455 of realized P&L.

## 4. Assert a reconciliation invariant on every import

For any pipeline that reconstructs quantitative state (financial P&L, inventory, balances),
compute an **independent tie-out and assert it on every import** — don't trust that the
transform was correct because it didn't throw.

- Pick a control total the data must satisfy: the reconstructed figures reconcile to the raw
  source to **within $0.00** (or a known, explained residual). Assert it; **fail the import**
  if it doesn't reconcile.
- Keep the invariant cheap and always-on (every import, not a nightly job) so a bad import is
  caught at ingest, not discovered weeks later in a report.
- Expose the tie-out (accounted vs. residual) in the UI/audit view so a human can see it held.
- *Incident:* a `$38,659.98` transaction book was asserted fully accounted with `$0.00`
  residual on every import — the invariant is what proved the reconstruction correct.

## Adopting

1. Read this before building any import/replace or reconstruct-from-source feature.
2. The always-on distillation is [`.claude/rules/data-import.md`](.claude/rules/data-import.md)
   (path-scoped to parser/importer/loader files) — it fires when you touch ingestion code.
3. New importer → the CR's impact checklist should confirm: validate-before-destroy, real
   fixtures pinned, derived-from-full-source, reconciliation asserted.
