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
  in the UI/audit — **always beside its unresolved-record count**, never alone. A
  reconstruction can balance *while* records sit unattributed, and "✓ balances" on its own is
  read as "the import was clean", which is the stronger claim.
- **Import time is not the data's date.** Parse the vintage out of the source (an "as of"
  header, statement date, max row date) into a field **separate** from the ingest timestamp.
  Where the format carries no date, name the field for what it is (`imported_at`, not
  `as_of`) and have the UI say "imported", not "as of" — otherwise yesterday's export renders
  as current, and every staleness check silently measures when someone clicked upload.
- **The wrong file is ordinary input.** Bad uploads are **4xx naming what was expected**,
  never a 500. Guard the *decode* — a `.decode("utf-8")` ahead of validation turns a PDF or a
  spreadsheet's cp1252 export into an unhandled exception. An `accept=".csv"` on the input
  filters the picker only; drag-and-drop and the API both bypass it. Where two importable
  formats exist, sniff the header and route **server-side, once** — never re-implement the
  sniff client-side — and reject per-file, not per-batch.
- **An upstream id is a promise, not a key.** Dedupe on the full id re-books everything when the
  provider changes its id format: detect duplicates by **value** `(account, date, amount,
  description)` inside the promote path, not by id suffix. Keep consumer id columns at least as
  wide as the producer's. A guard window must cover the whole fetch window — and never verify
  one on the day the two happen to coincide.
