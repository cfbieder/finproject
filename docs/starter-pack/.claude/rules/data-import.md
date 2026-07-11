---
paths:
  - "**/*import*"
  - "**/*ingest*"
  - "**/parsers/**"
  - "**/parser*"
  - "**/loaders/**"
---
# Data-import rules

Full reasoning: [`data-ingestion-baseline.md`](../../data-ingestion-baseline.md). External
data imports fail *silently* — 200 OK over corrupt/missing data. Make each failure loud.

- **Validate before you destroy.** A replacing import parses + validates to a non-empty, sane
  result **before** any delete/truncate/overwrite. Order is `parse → validate → delete →
  insert`, never delete-then-parse. A parse that yields zero rows is a **4xx error, not a
  200** over a wiped table. Offer a `dry_run` that writes nothing.
- **External exports are unstable — fail loud, never silent-default.** Match headers/keys
  case-insensitively (trim whitespace/BOM); don't hard-code casing or column position. A
  missing **required** column is a hard error — never a silent `0`/`null`/`""` default on a
  money/quantity/date field (that corrupts every downstream number behind a healthy UI). Pin
  real (scrubbed) exports as test fixtures and parametrize over every seen variant.
- **Raw append-only + idempotent; derived rebuilt from ALL raw, never the delta.** Ingest into
  an append-only table idempotent on a content hash (exclude unstable fields like running
  balances/timestamps; add an occurrence index for legal duplicate rows). Recompute derived
  tables from the **full** raw set every import — a delta-rebuild orphans records whose
  lifecycle spans two imports.
- **Assert a reconciliation invariant** on every import for quantitative reconstruction
  (P&L/inventory/balances): the reconstructed totals tie out to the source within a known
  residual (often $0.00). Assert it and **fail the import** if it doesn't; surface the tie-out
  in the UI/audit.
