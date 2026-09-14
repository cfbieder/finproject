# Data-Ingestion Baseline

> **Pack role:** the correctness floor for **importing external data and deriving state from
> it** — file/CSV/API imports, transaction reconstruction, any "upload → parse → replace →
> recompute" pipeline. [`.claude/rules/migrations.md`](.claude/rules/migrations.md) covers
> *schema* change safety; this doc covers *data* change safety, the layer above it. The
> failure modes here are quiet: they return `200 OK`, render a healthy UI, and corrupt the
> numbers behind it. Every rule below was learned from a real incident.
>
> **Last reviewed:** 2026-09-14.

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

**A tie-out never ships without its exception count.** The control total and the unresolved-
record count measure different things, and a reconstruction can balance *while* individual
records sit unattributed — orphaned legs, unmatched lines, rows parked in a review bucket.
Shown alone, "✓ balances" is read as "the import was clean", which is a stronger claim than
the invariant makes. Wherever the tie-out is surfaced, the exception count travels with it,
even when it is zero.

- *Incident:* an import receipt read `240 rows · 96 trades · ✓ Tie-out balances` for an import
  whose `needs_review` list was non-empty. Both numbers came from the same response object;
  the receipt rendered one and dropped the other, and the page that dropped it was the one
  users saw first.

## 5. Import time is not the data's date

An ingest stamps *when it ran*. That is not when the data was true, and the two drift apart
the moment a human is in the loop — the export was downloaded this morning, emailed on
Tuesday, re-uploaded on Friday.

- **Parse the vintage out of the source** where the format carries one (an "as of" header, a
  statement date, a filename date, a max row date) and store it **separately** from the ingest
  timestamp. Two fields, never one.
- **If the source carries no date, say so** — do not let the ingest timestamp stand in for it.
  Label it for what it is (`imported_at`, not `as_of`), and make any UI that shows it say
  "imported", not "as of". The words are the whole difference between a stale snapshot that
  announces itself and one that reads as current.
- **Anything reasoning about staleness needs the real field.** Freshness badges, "data is N
  hours old" warnings, and scheduled jobs that skip stale input are all measuring the wrong
  quantity if they read the ingest stamp — they report how recently someone clicked upload.
- *Incident:* a positions snapshot stamped `as_of = utcnow()` at import rendered as
  *"as of 4:02pm"* for a file downloaded the previous day. The parser had never read the
  export's own date. Caught only when a second upload path made grabbing the older download
  more likely — the display was wrong from the first import, and had been for months.

## 6. Undecodable and misrouted input is ordinary input, not an internal error

An importer that accepts uploads will be handed the wrong file. Every one of those paths is a
**4xx naming what was expected**, never a 500 and never a stack trace.

- **A client-side file filter is not validation.** An `accept=".csv"` attribute filters the
  *picker dialog* only — drag-and-drop hands the handler whatever was dropped, and the API
  accepts anything a `curl` sends. The server decodes and validates as if the filter does not
  exist, because for two of the three entry paths it does not.
- **Decode failures are the common case, not the exotic one.** A `.decode("utf-8")` placed
  before any validation turns a PDF, a UTF-16 file, or a cp1252 "Save As CSV" out of a
  spreadsheet into an unhandled exception. Guard the decode itself.
- **Where a system has more than one importable format, detect and route server-side.** Sniff
  the header and dispatch, rather than making the user declare which file is which — they will
  get it wrong, and the wrong-file error is the one class of import failure you can delete
  outright. The detection lives **once**, server-side; a client that re-implements the sniff
  duplicates rules that drift the next time the vendor renames a column.
- **Reject per-file, not per-request.** A multi-file upload where one bad file fails the whole
  batch reintroduces the friction the batch was meant to remove.

## 7. An upstream id is a promise, not a key

Deduplicating on the provider's transaction id is the natural design, and it fails in ways a
balance check cannot see — the rows it duplicates are often net-zero (transfers, both legs of a
trade), so totals still tie out.

- **An id-FORMAT change re-books the whole range.** A unique constraint on the *full* id string
  is the only guard, so when the provider re-keys (it will — measured once as every row of one
  connector re-minted under a new scheme) every re-served row is new. Suffix or prefix matching
  catches only composite ids and misses a UUID→ULID change entirely (*measured: a suffix query
  returned 0 while 28 duplicate rows sat in the ledger*). **The detector that catches every
  class is value matching** — `(account, date, amount, description)` — run before promoting
  after any upstream change.
- **One entity under two labels mints a twin.** A feed that alternates a ticker and a numeric
  id for the same holding creates a second security the first time it flips. Merge, map every
  label the source has used to one identity, and expect a third label.
- **Id width is a cross-repo contract.** A producer storing ids in `VARCHAR(200)` and a consumer
  in `VARCHAR(100)` accept a longer id upstream and throw downstream — invisible from inside
  either repo ([`cross-repo-integration.md`](cross-repo-integration.md) §4). When an upstream
  announces an id change, measure `max(length(id))` **first**.
- **A protection window must cover the fetch window, always.** A dedupe guard over a *rolling*
  window (`sync − 5 days`) beside a *fixed* fetch floor coincided exactly on cutover day, so the
  first run was perfect (41 fetched, 41 carried, 0 inserted); the next day the window walked
  forward, the floor did not, and 23 rows re-inserted under new ids. Clamp toward the fetch
  floor. **Testing on the one day two independent values agree proves nothing** — evaluate the
  expression on dates where they differ.
- **A human in the loop is not a check unless the promote step runs one.** Staging-only
  automation plus an explicit promote caught three mistakes of this class — and then 28
  duplicates reached the ledger through the promote button itself, because the gate stopped
  only the cron. Put the value match *in* the promote path.

## Adopting

1. Read this before building any import/replace or reconstruct-from-source feature.
2. The always-on distillation is [`.claude/rules/data-import.md`](.claude/rules/data-import.md)
   (path-scoped to parser/importer/loader files) — it fires when you touch ingestion code.
3. New importer → the CR's impact checklist should confirm: validate-before-destroy, real
   fixtures pinned, derived-from-full-source, reconciliation asserted.
