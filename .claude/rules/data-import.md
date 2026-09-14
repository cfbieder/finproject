---
paths:
  - "server/src/v2/converters/**"
  - "server/src/v2/routes/ingest*"
  - "server/src/v2/routes/quickenImport.js"
  - "server/src/v2/routes/bankFeed.js"
  - "server/src/v2/services/manualStatementImport.js"
  - "server/src/v2/services/psCsvIngestorV2.js"
  - "server/src/v2/services/refreshBankFeedV2.js"
  - "server/src/v2/services/reconcileToFeed.js"
  - "server/src/v2/scripts/quicken-*.js"
  - "server/src/v2/scripts/load-bank-statement.js"
  - "server/src/v2/scripts/import-*.js"
---
# Data-import rules

Full reasoning: `docs/guides/data-ingestion-baseline.md`. External data imports fail
*silently* — 200 OK over corrupt/missing data. Make each failure loud.

- **Validate before you destroy.** A replacing import parses + validates to a non-empty,
  sane result **before** any delete/truncate/overwrite. Order is `parse → validate →
  delete → insert`, never delete-then-parse. A parse that yields zero rows is a **4xx
  error, not a 200** over a wiped table. Offer a `dry_run` that writes nothing.
- **External exports are unstable — fail loud, never silent-default.** Match headers/keys
  case-insensitively (trim whitespace/BOM); don't hard-code casing or column position. A
  missing **required** column is a hard error — never a silent `0`/`null`/`""` default on
  a money/quantity/date field. Pin real (scrubbed) exports as test fixtures and
  parametrize over every seen variant (Quicken, MX/bank-feed, OCME statements).
- **Raw append-only + idempotent; derived rebuilt from ALL raw, never the delta.** Ingest
  into an append-only table idempotent on a content hash (exclude unstable fields like
  running balances/timestamps; add an occurrence index for legal duplicate rows).
  Recompute derived tables from the **full** raw set — a delta-rebuild orphans records
  whose lifecycle spans two imports.
- **Assert a reconciliation invariant** on every import that reconstructs quantitative
  state (balances, P&L): reconstructed totals tie out to the source within a known
  residual; **fail the import** otherwise and surface the tie-out in the UI/audit —
  **always beside its unresolved-record count**, never alone. A reconstruction can balance
  *while* records sit unattributed (`needs_review`, orphan legs), and "✓ balances" on its
  own reads as "the import was clean", which is the stronger claim.
- **Import time is not the data's date.** Parse the vintage out of the source (statement
  date, "as of" header, max row date) into a field **separate** from the ingest timestamp;
  where the format carries none, name it `imported_at` and have the UI say "imported", not
  "as of" — otherwise every staleness check measures when someone clicked upload.
- **The wrong file is ordinary input.** A bad upload is a **4xx naming what was expected**,
  never a 500 — guard the decode (a PDF or a cp1252 export must not throw). `accept=".csv"`
  filters the picker only; drag-and-drop and the API bypass it. Where two formats are
  importable, sniff and route **server-side, once**, and reject per-file, not per-batch.
- **An upstream id is a promise, not a key.** `ON CONFLICT (bank_feed_external_id)` on the
  full string is the only ledger guard, so an upstream id-format change re-books the range
  silently. Before a promote after any upstream change, check duplicates by **value**
  `(account_id, transaction_date, amount, description)` — a suffix match found 0 of 28 real
  duplicates (CR059 §22). Fin's feed-id columns are `VARCHAR(100)` against bank-feed's
  `VARCHAR(200)`: when an upstream announces an id change, measure `max(length(...))` first.
  A guard window must cover the whole fetch window — never verify one on the day the two
  happen to coincide.
