**Status:** IN-PROGRESS — Phase A (migration 023) + Phase B (converter/staging/dedup + tests) shipped in v2.8.0 (2026-05-31), released ahead of the dev-walkthrough gate as dormant infrastructure. — [Plan](../FC_NEXT_STEPS.md#cr022)

# CR022 — Bank Feed Parallel Import (Additive Second Source)

**Created:** 2026-05-30
**Follows:** [CR021](CR021_BANK_FEED_SERVICE.md) (Bank Feed Service — the upstream service this CR consumes).
**Does NOT supersede:** PocketSmith. PS remains the live feed throughout CR022. A PS-removal CR is explicitly out of scope and will be opened separately (tentatively CR023) only after CR022 has run side-by-side in production for at least one full month with no data-quality regressions.

## 1. Background

CR021 stood up the standalone `bank-feed` service (`~/Programs/fin/bank-feed/`) behind a pinned `/v1/*` REST contract. Phases 0–3 shipped 2026-05-30: the service ingests fintable.io's Google Sheet on an hourly schedule and exposes 7 live PKO accounts, 127 transactions, and 7 balance snapshots through `/v1/transactions`, `/v1/accounts`, and `/v1/balances`. CR021's Phase 7 added a read-only diagnostic in fin (`/api/v2/bank-feed/diagnostic`, page at `/bank-feed-diagnostic`) that proxies the contract end-to-end. The contract has been spiked, the data is real, the network path works.

**What CR021 did NOT do** is write any bank-feed data into fin's `transactions` table. Today every row in `transactions` still arrives via the PocketSmith path (`source='pocketsmith'`). CR022's job is to wire the second import route — bank-feed → fin canonical `transactions` — as an additive parallel ingest that runs alongside PS without modifying any PS code path.

### 1.1 Fidelity status (investigation 2026-05-30)

CR021's plan assumed Fidelity would land via the bank-feed Excel/CSV adapter (Phase 4, not yet built). A direct check today against `/api/v2/bank-feed/diagnostic` confirms **no Fidelity data is in the bank-feed yet**:

- 7 accounts, all PKO PLN/EUR/USD via the single `fintable` connection — identical to yesterday.
- Most recent cron sync (job #5, 2026-05-30 17:52 UTC) fetched 7 account rows / 127 transaction rows; 0 new accounts, 0 new transactions inserted.
- Case-insensitive search across `feed_accounts` / `feed_transactions` / `bank_connections` for "fidelity", "brokerage", "investment", "usaa": no hits.

This means CR022 itself is **PKO-only** for its initial deliverable. Fidelity arrival on the bank-feed side is gated on either (a) the user finishing the fintable Fidelity setup so it appears in the Sheet, or (b) CR021 Phase 4 (Excel/CSV upload) shipping. Either way it remains additive to CR022's promote logic — once Fidelity rows appear in `/v1/transactions` they flow through the same pipeline.

### 1.2 Structural gap surfaced during investigation

The investigation also found a real structural problem in `bank-feed/src/services/fintableSync.js:11-36`: `ensureConnection()` hardcodes `PKO_INSTITUTION_ID='PKO_BPKOPLPW'` onto a single `bank_connections` row, and every account fintable returns is upserted under that connection regardless of the per-row `⚡ Institution` column the converter already reads. Even after Fidelity arrives in the Sheet, it will land mislabeled as PKO Bank Polski. This is a CR021-side bug fix and is captured here as a coordinating dependency — CR022 cannot finish multi-institution support until bank-feed `fintableSync.js` is generalized.

## 2. Goals & Non-Goals

### Goals

- **Additive parallel import.** New code path at `POST /api/v2/ingest-bank-feed/refresh` (and friends) that fetches from bank-feed `/v1/transactions`, stages, then promotes into the existing `transactions` table with `source='bank-feed'`. The PS code path is untouched **except** for one additive, flag-guarded reverse-dedup lookup in `refreshPsApiV2.js` (R2.2 — drop a PS row that duplicates an already-present bank-feed row). With `BANK_FEED_DEDUP_ENABLED=false` or no matching bank-feed row, PS behavior is byte-for-byte unchanged.
- **Per-account opt-in + cross-source dedup (R1 + R2).** See §2.3. R1 makes every bank-feed account an explicit user decision (unmapped = pending, never silently ingested) via a new `account_source_mappings.ignored` flag. R2 prevents 2× row duplication during the parallel run by linking matching PS and bank-feed transactions onto one canonical row. Both are must-have; both thread through §3–§9.
- **Reuse fin's review surface.** The existing `/api/v2/ingest-ps/review-new-transactions` query already selects `WHERE accepted IS NOT TRUE` with no source filter, so bank-feed rows surface in the existing review queue for free. PATCH endpoints under `/api/v2/transactions/:id` already work on any source.
- **Dev walkthrough as a gating phase.** Before pushing to prod, the CR includes a numbered manual walkthrough against `fin-server-dev` that exercises ingest + promote + dedup + review-UI end-to-end on real data, with a `pg_dump` rollback bracket.
- **Automated tests required.** Backend Jest (normalizer + dedup + account-mapping + error envelope), DB-backed promote tests gated by `SKIP_DB_TESTS`, and a new `smoke-bank-feed.js` script. Frontend helper tests only if non-trivial logic is extracted to a util.
- **Minimal schema change.** One additive migration (`023_bank_feed_import.sql`): one new column on `transactions`, one partial-unique index, one parallel staging table, one `sync_metadata` seed. No CHECK constraint on `source`. PS `ps_id` semantics untouched.
- **Provider-agnostic discriminator.** Use `source='bank-feed'` in `transactions.source` (matches CR021 §3.3 commitment). Actual upstream (`fintable`, future `plaid`, etc.) is stored in `bankfeed_staging.source` and `raw` JSONB for diagnostics — never leaks into the canonical table.

### Non-Goals

- **Removing PocketSmith.** PS stays live and untouched throughout this CR. Removal is a separate future CR after a one-month parallel-run window.
- **Replacing the existing transaction-review UI** at `/trans-actual` / `RefreshPS.jsx`. The review queue is source-agnostic at the SQL layer; CR022 may add a sibling refresh page (RefreshBankFeed.jsx) but does not modify the existing PS page.
- **Retiring CR015** (PS re-export). Already OBSOLETE per CR021.
- **Investment-side schema changes.** Stock/lot data lands via CR020 (and CR019's promote logic); CR022 is cash-side only. If fintable produces a Fidelity row, it goes into `transactions` (or is skipped if it carries `category_hint='investment'` and we decide to defer) — but no new investment columns are added in this CR.
- **Generalizing `pending_transactions`** (the PS-specific accept-before-promote table). Bank-feed rows write directly into `transactions` with `accepted=FALSE` and use the same review queue. Generalizing `pending_transactions` is only justified if PS and bank-feed coexist long-term — they explicitly will not.
- **Bank-feed-side fixes.** The multi-institution `fintableSync.js` hardcoding (above §1.2), the missing `updated_since` query param on `/v1/transactions`, and exposing per-transaction `balance_after_transaction` on the canonical contract — these are CR021 follow-ups, not CR022 work. CR022 ships against the contract as it stands today, plus an explicit handoff entry to bank-feed for the additive v1 changes.
- **Anything in CR023+.** PS code removal, fin v3 namespace, contract-versioning to v2 — all future CRs.

### 2.3 Additional requirements (added 2026-05-31)

Two requirements the user explicitly flagged that must be in CR022's scope:

**R1 — Per-account opt-in (ignore-list).** The fintable Google Sheet may contain accounts that don't exist (or shouldn't be tracked) in fin's COA — e.g. a brokerage sub-account that fin treats as a roll-up, or test accounts the user created in fintable but never wants imported. CR022 must support a **per-account opt-in/opt-out list** on the fin side: the user can mark a bank-feed account as "ignored" and its transactions never land in fin's `transactions` table. Implementation: add a new `account_source_mappings.ignored BOOLEAN DEFAULT FALSE` column (the existing source-mappings table is the right home — it's already (source, external_name) keyed). The orchestrator skips any bank-feed account whose mapping has `ignored=TRUE`. Surface in the Bank Feed Diagnostic page (CR021 Phase 7) with a toggle per account. Default behavior for unmapped accounts: **opt-in required** — i.e., a bank-feed account that has no row in `account_source_mappings` yet is treated as **pending review** (transactions stage but do not promote into `transactions` until the user explicitly maps + un-ignores). This forces the user to make an explicit decision for every new account fintable surfaces, preventing silent accidental ingest.

**R2 — Duplicate-avoidance mechanism during PS + bank-feed parallel run.** Both PS and bank-feed will be importing the same real-world bank transactions during the ≥1-month observation window in §G. Without a deliberate dedup mechanism, the user's `transactions` table will accumulate one row per real transaction per source = **2x rows for every PKO transaction.** CR022 must include:
  1. **Cross-source dedup at promote time.** When promoting a bank-feed staged row, check for an existing `transactions` row with `source='pocketsmith'` matching on `(account_id, transaction_date, ABS(amount), currency)` within a ±1-day tolerance window. If found, **link** the bank-feed external_id to that existing row (set `transactions.bank_feed_external_id = <new>`) rather than insert a new row. The bank-feed row becomes the authoritative source for that transaction going forward (its raw payload is richer than PS's), but the row's `id` stays stable so downstream FKs (transfer match groups, splits, etc.) don't break.
  2. **Reverse direction (PS arrives after bank-feed)** — when PS sync runs and stages a transaction that matches an already-present bank-feed row, the PS row is silently dropped (we already have the data). Implementation: extend `refreshPsApiV2.js` accept-flow with the same (account_id, date, ABS(amount), currency) lookup against bank-feed rows.
  3. **Diagnostic counter** — `/api/v2/bank-feed/diagnostic` (and the page) surface a per-account `merged_with_ps_count` showing how many bank-feed rows linked to existing PS rows vs how many were genuinely new. A healthy parallel-run shows roughly 1:1 — divergence means PS or bank-feed is missing transactions.
  4. **Dedup-disable flag** — env var `BANK_FEED_DEDUP_ENABLED=true` (default). Setting to `false` is the rollback path if cross-source matching mis-fires; reverts to source-segregated rows.
  5. **Test fixtures** explicitly cover: (a) PS first then bank-feed (link), (b) bank-feed first then PS (drop), (c) same-day same-amount duplicate that's actually two distinct transactions (must NOT merge — needs a heuristic, perhaps description hash or hour-of-day if available).

Both R1 and R2 are **must-have** for CR022 to ship safely. They affect schema (R1 column on `account_source_mappings`, R2 already covered by `bank_feed_external_id` on `transactions`), tests (§5), and the dev walkthrough (§7 must include exercising both the ignore-list toggle and the cross-source dedup with a synthetic duplicate row).

### 2.4 Runtime configuration (env vars)

The fin server reaches the bank-feed service via two env vars, injected into the server container by both `docker-compose.yml` and `docker-compose.dev.yml`:

- **`BANK_FEED_URL`** — base URL of the CR021 microservice (default `http://host.docker.internal:3007`).
- **`BANK_FEED_API_KEY`** — auth key (**secret**; default empty `${BANK_FEED_API_KEY:-}`). Lives in root `.env` only; never commit it.
- **`BANK_FEED_DEDUP_ENABLED`** — R2 dedup toggle (default `true`); see §2.3.4 / §3.

**`.env` gotcha (resolved 2026-05-31):** these vars live in the git-ignored-but-historically-tracked root `.env`. The version scripts (`bump-version.sh`, `deploy-to-production.sh`) used to overwrite `.env` wholesale and wiped `BANK_FEED_*` during the v2.8.0 release; both now edit only the `VITE_APP_VERSION` line in place (preserving secrets). The key value was never committed. See [FC_PROJECT_STRUCTURE.md §13](../FC_PROJECT_STRUCTURE.md#13-environment-variables).

## 3. Architecture

### 3.1 Two ingest paths, one canonical table

```
┌─────────────────────────────┐
│  PocketSmith REST API       │
└──────────────┬──────────────┘
               │ pocketsmith.js
               ▼
┌─────────────────────────────┐
│  psdataConverter.js         │
│  refreshPsApiV2.js          │
│  (PS-specific shape)        │
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│  psdata_staging             │  ← PS-specific columns; UNTOUCHED by CR022
└──────────────┬──────────────┘
               │ syncStagingToTransactions  (CTE upsert on ps_id)
               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  transactions  (single canonical table)         │
│  - source VARCHAR(20):  'pocketsmith' | 'bank-feed' | ...       │
│  - ps_id BIGINT UNIQUE  (NULL for non-PS rows)                  │
│  - bank_feed_external_id VARCHAR(100) (NULL for non-bank-feed)  │
│  - accepted BOOLEAN — review-state, source-agnostic             │
└─────────────────────────────────────────────────────────────────┘
               ▲
               │ syncBankfeedStagingToTransactions  (CTE upsert on
               │   bank_feed_external_id; skips ignored/unmapped accounts [R1];
               │   links to matching source='pocketsmith' rows instead of
               │   inserting [R2])
┌──────────────┴──────────────┐
│  bankfeed_staging           │  ← NEW; shaped to canonical contract
└──────────────┬──────────────┘
               ▲
               │ bankFeedToCanonical.js  (NEW converter)
               │
┌──────────────┴──────────────┐
│  bankFeedClient.js          │  ← already exists (Phase 7 spike)
└──────────────┬──────────────┘
               │ HTTP + X-API-Key
               ▼
┌─────────────────────────────┐
│  bank-feed service          │  (CR021)
│  http://host.docker.internal:3007/v1/*
│  fintable → GoCardless → PKO │
└─────────────────────────────┘
```

Both staging tables write into the same `transactions` table. Review/edit/accept UI reads from `transactions` with no source filter and works unchanged for both. `account_source_mappings` already discriminates by `source` (`pocketsmith` rows + `quicken` rows coexist there today); bank-feed mappings are added with `source='bank-feed'`.

**Two gates sit between `bankfeed_staging` and `transactions` (added by §2.3 R1 + R2):**

1. **Opt-in gate (R1).** The promote CTE joins `account_source_mappings WHERE source='bank-feed'`. A staged row promotes **only** if its `feed_account_external_id` resolves to a mapping that is both present and **not** `ignored`. Three outcomes per feed account:
   - **mapped + `ignored=FALSE`** → rows promote to `transactions`.
   - **mapped + `ignored=TRUE`** → rows stay in `bankfeed_staging`, never promote; reported under `ignoredAccounts` in the summary.
   - **unmapped** (no `account_source_mappings` row yet) → rows stay in `bankfeed_staging`, never promote; reported under `unmappedAccounts`. Unmapped is **pending review**, not silent ingest — the user must explicitly map + un-ignore before any transaction lands.

2. **Cross-source dedup gate (R2).** For each staged row that clears the opt-in gate, before inserting a new `transactions` row the promote step looks for an existing `source='pocketsmith'` row matching `(account_id, ABS(amount), currency)` with `transaction_date` within ±1 day. On a hit it **links** — sets `transactions.bank_feed_external_id` on the existing PS row and does **not** insert — so the row `id` stays stable and downstream FKs (transfer groups, splits) don't break. The bank-feed payload becomes the authoritative `raw` for that transaction. Gated by `BANK_FEED_DEDUP_ENABLED` (default `true`); set `false` to fall back to source-segregated rows. The reverse direction (PS staging a row that matches an existing bank-feed row → PS row dropped) lives in the PS accept-flow, see §3.2.

These gates make the diagram's single "promote" arrow a three-way decision (insert / link / hold), not an unconditional upsert.

### 3.2 New code surfaces in fin

| File | Purpose |
|---|---|
| `server/db/migrations/023_bank_feed_import.sql` | Adds `bank_feed_external_id` column + partial-unique index + `bankfeed_staging` table + `sync_metadata` seed + **`account_source_mappings.ignored BOOLEAN DEFAULT FALSE` [R1]** |
| `server/src/v2/services/bankFeedClient.js` | Exists (Phase 7); already has `transactions()`, `accounts()`, `balances()`, `health()` |
| `server/src/v2/converters/bankFeedToCanonical.js` | NEW. Normalizes `/v1/transactions` shape → `bankfeed_staging` row shape. Handles signed-decimal-as-string `amount`, pending filter, `raw` passthrough |
| `server/src/v2/repositories/bankfeedStaging.js` | NEW. INSERT into `bankfeed_staging`, dedup by `(source, external_id)`, queries for promote |
| `server/src/v2/services/refreshBankFeedV2.js` | NEW. Orchestrator: fetch → convert → stage → promote. Mirrors `processTransactionsV2()` shape but bank-feed-specific. **Promote step enforces R1 opt-in gate (skip `ignored`/unmapped accounts) and R2 cross-source dedup (link to matching PS row instead of insert), behind `BANK_FEED_DEDUP_ENABLED`. Summary carries `ignoredAccounts`, `unmappedAccounts`, and per-account `mergedWithPsCount`.** |
| `server/src/v2/routes/ingestBankFeed.js` | NEW. Routes: `POST /refresh`, `POST /sync-to-transactions`, `POST /review-new-transactions`, `GET /count`. Mirrors `ingestPs.js` surface shape for symmetry |
| `server/src/v2/services/refreshPsApiV2.js` | EXISTS — **one additive change [R2.2]:** the accept/promote flow gains a reverse-direction lookup. When a PS staged row matches an existing `source='bank-feed'` row on `(account_id, ABS(amount), currency)` within ±1 day, the PS row is dropped (data already present) rather than inserted. Guarded by the same `BANK_FEED_DEDUP_ENABLED` flag. This is the **only** edit to a PS code path in CR022; it is purely additive (no behavior change when no bank-feed row matches). |
| `server/src/v2/routes/bankFeed.js` | EXISTS (Phase 7 diagnostic) — extend `/api/v2/bank-feed/diagnostic` to return per-account `ignored` state and `merged_with_ps_count` [R1 toggle source + R2.3 counter]. Add `PATCH /api/v2/bank-feed/accounts/:externalId/ignore` (or reuse the account-mappings endpoint) to flip `ignored`. |
| `server/src/scripts/smoke-bank-feed.js` | NEW. Live-server smoke covering health → accounts → ingest → idempotency → source filter |
| `frontend/src/pages/RefreshBankFeed.jsx` *(optional)* | Sibling page to `RefreshPS.jsx` if a dedicated refresh button surface is wanted. Page-level. |
| `frontend/src/utils/bankFeedHelpers.js` *(optional)* | Extracted pure helpers if the page grows any non-trivial formatting/diff logic. Tested via Vitest |

### 3.3 Source value, external_id, staging — design decisions pinned

- **`source='bank-feed'`** in `transactions.source`. Generic, matches CR021 §3.3, survives upstream swaps (fintable → Plaid → whatever). The actual upstream is preserved in `bankfeed_staging.source` (`'fintable'` today) and inside `raw` JSONB.
- **`bank_feed_external_id VARCHAR(100)`** on `transactions`, partial-unique where NOT NULL. Cannot reuse `ps_id` (BIGINT vs string — fintable IDs are composite hashes, future Plaid IDs are strings, GoCardless IDs are UUIDs). Partial-unique keeps PS rows (NULL) outside the constraint.
- **Parallel `bankfeed_staging` table** shaped one-to-one with the canonical contract (CR021 §3.2). Do NOT overload `psdata_staging` — different column set (`merchant`, `category_hint`, `pending`, `raw` JSONB vs PS's `description2`, `parent_categories`, `closing_balance`, `bank`, `labels`); CR021 §3.3 explicitly commits "`psdata_staging` frozen in place, never touched".
- **Insert with `accepted=FALSE`** — categorization quality from fintable/GoCardless is unproven on PKO data; force every row through the existing review UI. Matches PS post-CR011 flow.
- **Opt-in is the default for unmapped accounts (R1).** A bank-feed account with no `account_source_mappings` row never promotes — it sits in `bankfeed_staging` and surfaces under `unmappedAccounts`. This is deliberately *fail-closed*: fintable can surface new/test/roll-up accounts at any time, and silent ingest of an account the user never vetted is worse than making them click a toggle once. `ignored=TRUE` is the explicit opt-*out* for a mapped account the user wants suppressed (e.g. a brokerage sub-account fin treats as a roll-up).
- **Cross-source dedup links, it does not delete (R2).** On a PS↔bank-feed match the existing row's `id` is preserved and only `bank_feed_external_id` is stamped on it; we never delete-and-reinsert, because transfer-match groups and splits hold FKs to that `id`. Match key is `(account_id, ABS(amount), currency)` within ±1 day — currency is in the key because multi-currency PKO accounts can carry same-magnitude amounts in PLN/EUR/USD on the same day. The known false-merge risk (two genuinely distinct same-day, same-amount transactions) is handled by a tie-break heuristic and called out in tests §5.2 / risks §8.
- **Dedup is reversible via `BANK_FEED_DEDUP_ENABLED` (default `true`).** Flipping to `false` is the rollback path if matching mis-fires; it reverts to source-segregated rows (one row per source) without a schema change.

## 4. Phased Plan

### Phase A — Schema migration (½ day)

Apply `023_bank_feed_import.sql` (see §6 below) to dev. Verify the partial-unique index permits multiple PS rows with `bank_feed_external_id=NULL` and rejects duplicate `bank_feed_external_id` values across bank-feed rows. Confirm the new `account_source_mappings.ignored` column exists and defaults `FALSE` for all existing rows **[R1]**. Backfill nothing — PS rows already have NULL `bank_feed_external_id` by default, and existing mappings default `ignored=FALSE` (so PS/quicken mappings are unaffected).

### Phase B — Converter + repository (1 day)

- `bankFeedToCanonical.js` with deterministic unit tests on fixtures. Handles: signed-decimal-as-string `amount` → numeric (no float drift on `-123.4500`); `pending=true` rows filtered out of staging; `transaction_date` stays `YYYY-MM-DD` string; `raw` passes through as JSONB.
- `bankfeedStaging.js` repository: `insertMany`, `findUnpromoted`, `findByExternalId`. ON CONFLICT(source, external_id) DO UPDATE on insert.
- **Cross-source match helper [R2].** A pure function `findPsMatch(stagedRow, psCandidates)` (or a parameterized SQL predicate) implementing the `(account_id, ABS(amount), currency)` + ±1-day key plus the same-day/same-amount tie-break heuristic. Unit-tested in isolation (no DB) so the link/drop/distinct cases of §5.2 are deterministic. Both the bank-feed promote step and the PS reverse-dedup (Phase C) call this one helper so the two directions can't drift apart.

### Phase C — Orchestrator + routes (1-2 days)

- `refreshBankFeedV2.js` 4-step pipeline: (1) fetch via `bankFeedClient.transactions({since})`; (2) normalize via `bankFeedToCanonical`; (3) stage via `bankfeedStaging.insertMany`; (4) promote via `syncBankfeedStagingToTransactions` (CTE mirroring `ingestPs.js:96-229` but joining `account_source_mappings WHERE source='bank-feed'` and writing `source='bank-feed'`, `bank_feed_external_id=staging.external_id`, `accepted=FALSE`). Returns `{ingest, sync}` shape mirroring PS for UI symmetry.
- **Promote-step gating in step (4) [R1 + R2]:**
  - **R1 opt-in gate.** The mapping join is `INNER` and filtered `ignored IS NOT TRUE`, so an `ignored=TRUE` or unmapped account contributes zero promoted rows. The CTE emits two summary arrays: `ignoredAccounts` (mapped but suppressed) and `unmappedAccounts` (no mapping yet). Both kinds of rows remain in `bankfeed_staging` for a later pass once the user maps/un-ignores them — nothing is dropped.
  - **R2 cross-source dedup.** For each staged row that clears the gate, the CTE (or a follow-up step) runs the `findPsMatch` predicate against existing `source='pocketsmith'` rows. On a hit: `UPDATE transactions SET bank_feed_external_id=staging.external_id, raw=staging.raw WHERE id=<matched PS id>` and **do not insert**; increment that account's `mergedWithPsCount`. On no hit: insert as normal. The whole dedup branch is wrapped in `if (process.env.BANK_FEED_DEDUP_ENABLED !== 'false')`; disabled → always insert.
  - Summary shape extends to `{inserted, updated, skipped, protectedCount, ignoredAccounts, unmappedAccounts, mergedWithPsCount, unmappedCategories}` — a superset of the PS summary, so the existing `/review-new-transactions` UI still reads the fields it knows.
- **PS reverse-dedup in `refreshPsApiV2.js` [R2.2].** Add a guarded lookup in the PS accept/promote flow: before inserting a staged PS row, call the shared `findPsMatch`-equivalent against existing `source='bank-feed'` rows; on a hit, skip the insert (the bank-feed row is authoritative) and count it. Same `BANK_FEED_DEDUP_ENABLED` guard. No other PS behavior changes.
- `ingestBankFeed.js` route mount under `/api/v2/ingest-bank-feed/`. Endpoints: `POST /refresh` (full pipeline), `POST /sync-to-transactions` (staging→canonical only), `POST /review-new-transactions` (proxies to existing review query — or rely on the PS one since it's source-agnostic), `GET /count`.
- **Diagnostic surface [R1 toggle + R2 counter].** Extend `routes/bankFeed.js` `/diagnostic` to return per-account `{ ignored, mapped, merged_with_ps_count }`, and add the ignore-toggle endpoint (`PATCH .../accounts/:externalId/ignore` or reuse account-mappings). The CR021 Phase 7 page (`BankFeedDiagnostic.jsx`) gains a per-account ignore toggle and a `merged_with_ps_count` column.

### Phase D — Automated tests (1 day)

- `server/src/v2/services/__tests__/bankFeedImport.test.js` — unit tests with mocked `bankFeedClient` and mocked repository. Coverage: normalizer determinism, in-batch dedup, account-mapping fallback, error envelope (5xx retryable, 4xx not), **R1 opt-in gate (ignored account → 0 promoted; unmapped account → 0 promoted + listed; mapped+un-ignored → promoted), and the `findPsMatch` helper's link/drop/distinct cases [R2]**.
- Same file: DB-backed `dbDescribe` block (gated by `SKIP_DB_TESTS`) connecting to `postgres://fin:findev123@localhost:5434/fin`. Coverage: 5-row promote, idempotent re-promote, `accepted=TRUE` protection, **R1 ignore-skip on a real mapping row, and the three R2 cross-source scenarios (PS-first→link, bank-feed-first→PS-drop, same-day same-amount distinct→two rows)**.
- `server/src/v2/routes/__tests__/ingestBankFeed.test.js` — route tests with mocked services. Coverage: default-since behavior, explicit since, 5xx mapping, 4xx mapping.
- `server/src/scripts/smoke-bank-feed.js` — live-server smoke against `BASE_URL=http://localhost:3005`. Coverage: health 200, accounts ≥7, ingest with 14-day window, idempotency on re-call, `?source=bank-feed` filter returns ≥1 row, **and `/diagnostic` returns per-account `ignored` + `merged_with_ps_count` fields [R1/R2 surface]**.
- Fixtures at `server/src/v2/services/__tests__/fixtures/bank-feed-transactions.json` — 10-20 mixed rows incl. duplicate external_id, pending=true, signed amounts, multi-currency, **plus the R2 dedup trio: (a) a row whose `(account_id, date, ABS(amount), currency)` matches a seeded PS row → link; (b) a row with no PS match → insert; (c) two same-day, same-amount, same-account rows that are genuinely distinct (distinct merchant/description) → must NOT merge into each other or onto one PS row**.

### Phase E — Dev walkthrough gate (½ day, manual)

See §7 for the full numbered walkthrough. This is a hard gate before any prod push. Includes a `pg_dump` rollback bracket on `fin-postgres-dev:5434`. The walkthrough must also exercise **R1** (mark one account `ignored`, confirm its rows never promote; leave one account unmapped, confirm it stays pending) and **R2** (inject a synthetic PS row that duplicates a bank-feed transaction, confirm the bank-feed promote links rather than inserts, and confirm `merged_with_ps_count` increments).

### Phase F — Production push (½ day)

- Apply `023_bank_feed_import.sql` to prod.
- Deploy fin-server with the new routes.
- Run `BASE_URL=http://100.94.46.62:3105 node server/src/scripts/smoke-bank-feed.js` against dev one last time, then against prod after deploy.
- Trigger an initial bank-feed refresh covering the last 90 days. Confirm review queue surfaces the new rows.
- Keep PS refresh running on its existing cadence. Both feeds now write in parallel.
- Add `bank-feed → fin` to the daily release-checklist smoke.

### Phase G — Parallel-run observation (≥1 month, no code)

PS and bank-feed run side-by-side. Monitor:

- Per-account daily totals: bank-feed vs PS for PKO accounts. Drift triage if > tolerance.
- Review-queue volume: bank-feed-sourced unaccepted rows handled at expected rate.
- Idempotency: re-running `POST /refresh` produces `sync.inserted=0`.
- bank-feed `feeds_health` from `/v1/health/feeds` — no `is_stale=true` for live accounts.
- **`merged_with_ps_count` per account [R2.3].** A healthy parallel run trends toward ~1:1 link-vs-PS — i.e. nearly every bank-feed transaction finds its PS twin. A rising count of *unmerged* new bank-feed rows (or PS rows surviving the reverse-dedup) means one feed is seeing transactions the other isn't — investigate before it compounds. This counter is the primary signal that justifies eventually retiring PS in CR023.
- **R1 hygiene.** Watch `unmappedAccounts` in refresh summaries — a new entry means fintable surfaced an account the user hasn't vetted. It stays pending (no silent ingest) until mapped or ignored.

No removal of PS happens during this phase. After 1 month of clean parallel run **with `merged_with_ps_count` showing consistent ~1:1 linkage**, open the PS-removal CR.

## 5. Test Plan

### 5.1 Backend Jest unit tests

`server/src/v2/services/__tests__/bankFeedImport.test.js`. All mocks; no DB, no network. Pattern mirrors `quicken-import.test.js` and `fc-lines.test.js`.

Assertions:

1. `normalizeFeedTransaction({external_id, source:'fintable', amount:'-123.4500', currency:'PLN', transaction_date:'2026-05-15', pending:false, ...})` → row with `source='fintable'`, numeric `amount=-123.45` (no float drift), `pending=false`, raw payload preserved.
2. `pending=true` rows are filtered out before staging.
3. Feeding the same `external_id` twice in one batch → 1 insert; second insert hits ON CONFLICT and updates.
4. Account-mapping: feed `account_id` with a row in `account_source_mappings WHERE source='bank-feed'` → staged with the mapped `account_id`. Without a mapping → staged with `account_id=NULL` and listed in `unmappedAccounts` summary.
5. Error envelope: client throws `{status:502}` → import returns `{ok:false, error, retryable:true}`. AbortError → same envelope, `retryable:true`. `{status:401}` → `{ok:false, retryable:false}`.
6. **R1 opt-in gate.** Mapping with `ignored=TRUE` → account's rows are NOT promoted and appear in `ignoredAccounts`. Mapping absent → rows NOT promoted, appear in `unmappedAccounts`. Mapping present + `ignored=FALSE` → rows promoted. Assert no path promotes an unmapped/ignored account.
7. **R2 `findPsMatch` helper (pure).** (a) staged row vs a PS candidate with same `account_id`, same `currency`, `ABS(amount)` equal, date within ±1 day → returns the PS match. (b) amount sign differs but ABS equal → still matches (sign convention differs across feeds). (c) date 2 days apart → no match. (d) different currency, same magnitude → no match. (e) two distinct same-day same-amount candidates → tie-break heuristic resolves to at most one match (the distinct-transaction case does not double-link).
8. **R2 dedup flag.** With `BANK_FEED_DEDUP_ENABLED='false'`, a row that would otherwise link is inserted as a new `source='bank-feed'` row instead (no PS lookup performed).

Run: `cd server && npm test -- bankFeedImport`.

### 5.2 Backend Jest DB-backed promote tests

Same file, `dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe`. Connect to `postgres://fin:findev123@localhost:5434/fin`. Per-test cleanup by unique batch identifier; never `TRUNCATE` shared tables.

Assertions:

1. Promote 5 normalized rows (all mapped + un-ignored, no PS twins) → 5 `transactions` rows with `source='bank-feed'`, `bank_feed_external_id` set, `accepted=false`, `ps_id=NULL`.
2. Re-running same promote → 0 new inserts, n updates (idempotent).
3. Manually flip 1 row to `accepted=TRUE`, re-promote → that row is NOT overwritten; other 4 rows still update.
4. Summary shape: `{inserted, updated, skipped, protectedCount, ignoredAccounts, unmappedAccounts, mergedWithPsCount, unmappedCategories}` — a superset of `ingestPs.syncStagingToTransactions`'s shape; the existing `/review-new-transactions` UI reads its known fields unchanged.
5. **R1 ignore-skip.** Seed a `account_source_mappings` row for one feed account with `ignored=TRUE`; promote a batch containing rows for that account + a mapped/un-ignored account → only the un-ignored account's rows land; the ignored account's rows stay in `bankfeed_staging` (`promoted_transaction_id IS NULL`) and appear in `ignoredAccounts`.
6. **R2 PS-first → link.** Seed a `source='pocketsmith'` row, then promote a bank-feed staged row matching `(account_id, ABS(amount), currency)` within ±1 day → **0 new `transactions` rows**; the PS row now has `bank_feed_external_id` set, its `id` unchanged; `mergedWithPsCount` for that account = 1.
7. **R2 bank-feed-first → PS drop.** Seed a `source='bank-feed'` row, run the PS accept/promote path on a matching staged PS row → the PS row is NOT inserted; existing bank-feed row untouched; PS summary reports it dropped.
8. **R2 distinct-not-merged.** Seed one PS row; promote two bank-feed rows that are same-day/same-account/same-amount but distinct (different merchant/description) → at most one links to the PS row; the other inserts as a new `transactions` row. Net: 2 real transactions, 2 canonical rows — never collapsed to 1.
9. **R2 flag off.** With `BANK_FEED_DEDUP_ENABLED='false'`, repeat assertion 6 → a NEW `source='bank-feed'` row is inserted alongside the PS row (source-segregated); PS row's `bank_feed_external_id` stays NULL.

Run: `cd server && npm test -- bankFeedImport` (with dev Postgres running on :5434).

### 5.3 Backend Jest route tests

`server/src/v2/routes/__tests__/ingestBankFeed.test.js`. Mock `bankFeedClient` and the staging repository.

Assertions:

1. `POST /api/v2/ingest-bank-feed/refresh` with no body triggers full sync (default `since` from `sync_metadata`); returns `{ingest, sync}` shape; calls client with default since.
2. `POST /api/v2/ingest-bank-feed/refresh` body `{sinceDays:7}` → client called with `since` = today − 7d.
3. Client throws `{status:502}` → route returns 502 with `{error, bank_feed_url}` (matches existing `/api/v2/bank-feed/diagnostic` error shape from CR021 Phase 7).
4. Client throws AbortError → route returns 504.

Run: `cd server && npm test -- ingestBankFeed`.

### 5.4 Live-server smoke

`server/src/scripts/smoke-bank-feed.js`. Mirrors `smoke-after-021.js`: bare `http.request`, `check()`/`assert()` harness, non-zero exit on failure, `BASE_URL` override.

Sequence:

1. `GET /api/v2/bank-feed/health` → `{status:'ok'}`.
2. `GET /api/v2/bank-feed/accounts` → array length ≥ 7 (current PKO production count).
3. `POST /api/v2/ingest-bank-feed/refresh` body `{sinceDays:14}` → 200; response includes `sync.inserted`, `sync.updated`, `sync.skipped` triple, no 5xx.
4. Re-run step 3 within 60s → `sync.inserted=0` (dedup).
5. `GET /api/v2/transactions?source=bank-feed&limit=5` → ≥ 1 row with canonical fields.
6. `GET /api/v2/transactions?source=pocketsmith&limit=1` → ≥ 1 row (PS path still alive — regression net).
7. `GET /api/v2/bank-feed/diagnostic` → each account object carries `ignored` (boolean) and `merged_with_ps_count` (number) fields **[R1/R2 surface present]**.

Run: `BASE_URL=http://localhost:3005 node server/src/scripts/smoke-bank-feed.js`.

### 5.5 Regression nets

- Existing `smoke-after-021.js` re-run after CR022 lands — catches accidental breakage in PS JOINs (categories/accounts/transfers).
- Add one assertion to `smoke-after-021.js`: `GET /api/v2/transactions?source=pocketsmith&limit=1` returns a PS-sourced row. Proves the discriminator landed without nuking historical PS rows.
- Manual check post-deploy: existing PS `RefreshPS.jsx` page still renders, refresh still works, review queue still surfaces unaccepted PS rows.

### 5.6 Frontend tests

Only if non-trivial logic ends up in `frontend/src/utils/bankFeedHelpers.js`. Mirror `cashFlowHelpers.test.js` pattern: Vitest, jsdom, no network. 10-15 tests max. Page-level UI (`RefreshBankFeed.jsx` if added, and the `BankFeedDiagnostic.jsx` ignore-toggle from R1) does not get component tests — CR016 scoped vitest to utils. If the diagnostic page derives anything beyond a raw boolean for the ignore toggle or formats `merged_with_ps_count` (e.g. a 1:1-ratio badge), extract that to `bankFeedHelpers.js` and test it here; otherwise no frontend tests are required for R1/R2.

Run: `cd frontend && npm test -- bankFeedHelpers`.

### 5.7 Release checklist update

Append to `Documentation/Testing/TEST_OVERVIEW.md` §"Running everything before a release":

```
BASE_URL=http://localhost:3005 node server/src/scripts/smoke-bank-feed.js
```

Bump backend Jest tally; add rows for the two new test files.

## 6. Schema Migration

### 6.1 `server/db/migrations/023_bank_feed_import.sql`

```sql
BEGIN;

-- 1. External-ID column on transactions (string, nullable, partial-unique).
--    PS rows leave it NULL; bank-feed rows populate it.
--    Cannot reuse ps_id (BIGINT) because bank-feed IDs are strings
--    (fintable composite hash today; Plaid/UUID in the future).
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS bank_feed_external_id VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_bank_feed_external_id
  ON transactions(bank_feed_external_id)
  WHERE bank_feed_external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tx_source
  ON transactions(source);

-- 2. Parallel staging table shaped to the canonical contract (CR021 §3.2).
--    Do NOT overload psdata_staging — different column set, would add noise
--    and CR021 §3.3 commits psdata_staging is "frozen in place, never touched".
CREATE TABLE IF NOT EXISTS bankfeed_staging (
    id BIGSERIAL PRIMARY KEY,
    external_id VARCHAR(100) NOT NULL,
    source VARCHAR(20) NOT NULL,              -- 'fintable' | 'plaid' | 'excel' (actual upstream, from contract)
    feed_account_external_id VARCHAR(100),    -- bank-feed Account UUID
    transaction_date DATE NOT NULL,
    amount DECIMAL(15,4) NOT NULL,            -- signed; outflow negative per contract
    currency CHAR(3) NOT NULL,
    base_amount DECIMAL(15,4),
    base_currency CHAR(3) DEFAULT 'USD',
    description VARCHAR(500),
    merchant VARCHAR(200),
    category_hint VARCHAR(100),
    pending BOOLEAN DEFAULT FALSE,
    raw JSONB,                                -- opaque source payload (GoCardless JSON, etc.)
    promoted_transaction_id BIGINT REFERENCES transactions(id),
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_bfs_external ON bankfeed_staging(external_id);
CREATE INDEX IF NOT EXISTS idx_bfs_date ON bankfeed_staging(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bfs_feed_account ON bankfeed_staging(feed_account_external_id);
CREATE INDEX IF NOT EXISTS idx_bfs_unpromoted
  ON bankfeed_staging(promoted_transaction_id)
  WHERE promoted_transaction_id IS NULL;

-- 3. Sync metadata row so bank-feed ingest tracks last_sync_at independently.
INSERT INTO sync_metadata (sync_type, last_sync_status)
VALUES ('bank_feed_transactions', 'pending')
ON CONFLICT (sync_type) DO NOTHING;

-- 4. Per-account opt-out flag on the existing source-mappings table [R1].
--    Default FALSE keeps every existing pocketsmith/quicken mapping unaffected.
--    A bank-feed account with ignored=TRUE never promotes; an account with NO
--    mapping row stays "pending" (opt-in required) and also never promotes.
ALTER TABLE account_source_mappings
  ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
```

That is the entire schema delta. R2 needs **no** new column — it reuses `transactions.bank_feed_external_id` (added in step 1) as the link target. No CHECK constraint on `transactions.source` (the PS path doesn't have one either; adding one now risks breaking historical 'split'/'auto-offset' values written elsewhere). No new column on `transactions` beyond `bank_feed_external_id`; the only `account_source_mappings` change is the additive `ignored` flag.

### 6.2 No backfill needed

- Existing PS rows already have `bank_feed_external_id=NULL` by default — the partial-unique index ignores them.
- `account_source_mappings` rows for `source='bank-feed'` are created during the dev walkthrough (manual mapping pass through the UI) — not in the migration.

### 6.3 Rollback

```sql
BEGIN;
DROP TABLE IF EXISTS bankfeed_staging;
DROP INDEX IF EXISTS uq_tx_bank_feed_external_id;
DROP INDEX IF EXISTS idx_tx_source;
ALTER TABLE transactions DROP COLUMN IF EXISTS bank_feed_external_id;
ALTER TABLE account_source_mappings DROP COLUMN IF EXISTS ignored;   -- [R1]
DELETE FROM sync_metadata WHERE sync_type = 'bank_feed_transactions';
COMMIT;
```

Safe because no PS-side code references any of the new objects. Dropping `ignored` is safe too — the PS/quicken accept paths never read it; only the bank-feed promote gate does. (R2 leaves no schema to roll back: the link target `bank_feed_external_id` is already dropped above, and any links written into it vanish with the column.)

## 7. Dev Walkthrough

Hard gate before Phase F. Run against `fin-server-dev` on the dev VM. Includes a `pg_dump` rollback bracket.

> Open questions before running:
> - Confirm CR022 has chosen `POST /api/v2/ingest-bank-feed/refresh` with body `{sinceDays}` as the trigger endpoint (this walkthrough assumes that shape — adjust commands if Phase C lands on a different name).
> - Confirm `source='bank-feed'` is the discriminator value (walkthrough greps for that string).
> - Confirm `fin-server-dev` env has `BANK_FEED_URL=http://host.docker.internal:3007` and `BANK_FEED_API_KEY` set (already configured per `docker-compose.dev.yml:45-46`).
> - Confirm `BANK_FEED_DEDUP_ENABLED` is unset or `true` for STEP 6/6b (cross-source dedup ON) **[R2]**; STEP 6b's optional branch toggles it `false`.
> - **[R1]** This walkthrough deliberately leaves one PKO account unmapped in STEP 5 to exercise the unmapped=pending default. If you instead map all 7, you won't see a non-empty `unmappedAccounts` — re-skip one to test it.

```bash
# ──────────────────────────────────────────────────────────────────────
# STEP 0 — Pre-flight: confirm bank-feed service is up
# ──────────────────────────────────────────────────────────────────────
curl -s -H "Authorization: Bearer $BANK_FEED_API_KEY" \
  http://localhost:3007/v1/health
# Expect: {"status":"ok","version":"1.0.0"}

curl -s http://localhost:3105/api/v2/bank-feed/diagnostic | jq '.accounts | length'
# Expect: 7  (current PKO production count)

# ──────────────────────────────────────────────────────────────────────
# STEP 1 — Backup dev DB (rollback safety net)
# ──────────────────────────────────────────────────────────────────────
docker exec fin-postgres-dev pg_dump -U fin -d fin -F c \
  > ~/fin-dev-pre-cr022-$(date +%Y%m%d).dump

ls -lh ~/fin-dev-pre-cr022-*.dump
# Keep this file until prod cutover completes.

# ──────────────────────────────────────────────────────────────────────
# STEP 2 — Apply migration 023 to dev
# ──────────────────────────────────────────────────────────────────────
docker exec -i fin-postgres-dev psql -U fin -d fin \
  < server/db/migrations/023_bank_feed_import.sql

# Verify schema
docker exec fin-postgres-dev psql -U fin -d fin -c \
  "\d transactions" | grep bank_feed_external_id
# Expect: bank_feed_external_id | character varying(100) |

docker exec fin-postgres-dev psql -U fin -d fin -c "\d bankfeed_staging"
# Expect: table with the columns from §6.1

docker exec fin-postgres-dev psql -U fin -d fin -c \
  "SELECT sync_type, last_sync_status FROM sync_metadata WHERE sync_type='bank_feed_transactions';"
# Expect: bank_feed_transactions | pending

docker exec fin-postgres-dev psql -U fin -d fin -c \
  "\d account_source_mappings" | grep ignored
# Expect: ignored | boolean | not null | default false   [R1]

# ──────────────────────────────────────────────────────────────────────
# STEP 3 — Restart fin-server-dev so it picks up new routes
# ──────────────────────────────────────────────────────────────────────
docker compose -f docker-compose.dev.yml restart server

# Verify route mounted
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3105/api/v2/ingest-bank-feed/refresh \
  -H "Content-Type: application/json" -d '{"sinceDays":1}'
# Expect: 200 (or 207 with summary)

# ──────────────────────────────────────────────────────────────────────
# STEP 4 — Confirm staging populated, but no transactions promoted yet
#          (because account_source_mappings for source='bank-feed' don't exist)
# ──────────────────────────────────────────────────────────────────────
docker exec fin-postgres-dev psql -U fin -d fin -c \
  "SELECT COUNT(*) FROM bankfeed_staging;"
# Expect: > 0 (likely 127 if sinceDays covers the live window)

docker exec fin-postgres-dev psql -U fin -d fin -c \
  "SELECT COUNT(*) FROM transactions WHERE source='bank-feed';"
# Expect: 0   (no mappings yet → unmappedAccounts)

curl -s -X POST http://localhost:3105/api/v2/ingest-bank-feed/refresh \
  -H "Content-Type: application/json" -d '{"sinceDays":14}' | jq '.sync.unmappedAccounts'
# Expect: array with 7 entries (the PKO accounts)

# ──────────────────────────────────────────────────────────────────────
# STEP 5 — Create account_source_mappings for bank-feed (manual pass)
# ──────────────────────────────────────────────────────────────────────
# For each bank-feed account UUID, INSERT a row mapping it to the fin
# accounts table id. Use the existing /account-mappings UI or SQL:

# List bank-feed account external_ids:
curl -s http://localhost:3105/api/v2/bank-feed/accounts \
  | jq '.[] | {external_id, name, currency}'

# Then for each, INSERT (replace <fin_acct_id> and <bank_feed_external_id>):
docker exec fin-postgres-dev psql -U fin -d fin -c \
  "INSERT INTO account_source_mappings (account_id, source, external_name)
   VALUES (<fin_acct_id>, 'bank-feed', '<bank_feed_external_id>')
   ON CONFLICT (source, external_name) DO UPDATE SET account_id=EXCLUDED.account_id;"

# Repeat for all 7 PKO accounts.

# ──────────────────────────────────────────────────────────────────────
# STEP 6 — Re-run refresh, now with mappings in place
# ──────────────────────────────────────────────────────────────────────
curl -s -X POST http://localhost:3105/api/v2/ingest-bank-feed/refresh \
  -H "Content-Type: application/json" -d '{"sinceDays":14}' \
  | jq '.sync | {inserted, updated, skipped, mergedWithPsCount, ignoredAccounts, unmappedAccounts}'
# Expect: unmappedAccounts empty, ignoredAccounts empty.
# NOTE [R2]: dev already holds PS PKO history, so most bank-feed rows will LINK
# to existing pocketsmith rows, not insert. Expect mergedWithPsCount > 0 and
# inserted possibly small (only transactions PS hasn't seen). This is the
# dedup working — NOT a bug. inserted+merged together should cover the window.

docker exec fin-postgres-dev psql -U fin -d fin -c \
  "SELECT source, COUNT(*) FROM transactions GROUP BY source ORDER BY source;"
# Expect: 'pocketsmith' | M (UNCHANGED count — links stamp bank_feed_external_id
#   onto existing PS rows, they don't create new ones); 'bank-feed' | N where N =
#   only the genuinely-new (unmatched) bank-feed transactions.

docker exec fin-postgres-dev psql -U fin -d fin -c \
  "SELECT COUNT(*) FROM transactions WHERE source='pocketsmith' AND bank_feed_external_id IS NOT NULL;"
# Expect: > 0  — these are the PS rows the bank-feed feed linked onto [R2].

# ──────────────────────────────────────────────────────────────────────
# STEP 6a — R1: per-account opt-out (ignore-list)
# ──────────────────────────────────────────────────────────────────────
# Pick one mapped bank-feed account and mark it ignored. Its rows must stop
# promoting; existing promoted rows for it are left alone (ignore is forward-
# looking, not a retro-delete).
docker exec fin-postgres-dev psql -U fin -d fin -c \
  "UPDATE account_source_mappings SET ignored=TRUE
   WHERE source='bank-feed' AND external_name='<bank_feed_external_id_to_ignore>';"

# Stage a fresh row for that account (or re-run refresh) and confirm it does NOT promote:
curl -s -X POST http://localhost:3105/api/v2/ingest-bank-feed/refresh \
  -H "Content-Type: application/json" -d '{"sinceDays":14}' \
  | jq '.sync.ignoredAccounts'
# Expect: array containing the ignored external_id.

# Confirm staging still holds its rows unpromoted:
docker exec fin-postgres-dev psql -U fin -d fin -c \
  "SELECT COUNT(*) FROM bankfeed_staging s
     JOIN account_source_mappings m
       ON m.source='bank-feed' AND m.external_name=s.feed_account_external_id
    WHERE m.ignored=TRUE AND s.promoted_transaction_id IS NULL;"
# Expect: > 0  — ignored account's rows held, not promoted [R1].

# Un-ignore to restore for the rest of the walkthrough:
docker exec fin-postgres-dev psql -U fin -d fin -c \
  "UPDATE account_source_mappings SET ignored=FALSE
   WHERE source='bank-feed' AND external_name='<bank_feed_external_id_to_ignore>';"

# Also confirm the unmapped=pending default: leave one account WITHOUT a mapping
# (skip it in STEP 5) and verify it shows in unmappedAccounts and never promotes.

# ──────────────────────────────────────────────────────────────────────
# STEP 6b — R2: cross-source dedup with a synthetic duplicate
# ──────────────────────────────────────────────────────────────────────
# Insert a synthetic PS row that duplicates a known bank-feed transaction, then
# re-promote and confirm the bank-feed row LINKS to it rather than inserting.
# Pick a real bank-feed staged row first:
docker exec fin-postgres-dev psql -U fin -d fin -c \
  "SELECT external_id, feed_account_external_id, transaction_date, amount, currency
   FROM bankfeed_staging ORDER BY transaction_date DESC LIMIT 1;"

# Insert a matching pocketsmith row (replace <…> from the row above + its mapped account_id;
# use a date within ±1 day and the same ABS(amount)+currency). Give it a sentinel ps_id.
docker exec fin-postgres-dev psql -U fin -d fin -c \
  "INSERT INTO transactions (account_id, source, ps_id, transaction_date, amount, currency, accepted)
   VALUES (<mapped_account_id>, 'pocketsmith', 999000001, '<date>', <amount>, '<currency>', FALSE);"

# Re-run promote and check the merge counter + the link:
curl -s -X POST http://localhost:3105/api/v2/ingest-bank-feed/refresh \
  -H "Content-Type: application/json" -d '{"sinceDays":14}' \
  | jq '.sync.mergedWithPsCount'
# Expect: count incremented for that account.

docker exec fin-postgres-dev psql -U fin -d fin -c \
  "SELECT id, source, bank_feed_external_id FROM transactions WHERE ps_id=999000001;"
# Expect: the synthetic PS row now has bank_feed_external_id set, same id — LINKED, not duplicated [R2].

# Confirm no second row was created for that external_id:
docker exec fin-postgres-dev psql -U fin -d fin -c \
  "SELECT COUNT(*) FROM transactions WHERE bank_feed_external_id='<that_external_id>';"
# Expect: 1 (the linked PS row only).

# Optional flag check: set BANK_FEED_DEDUP_ENABLED=false, restart server, re-run —
# now the same external_id inserts a SEPARATE source='bank-feed' row (source-segregated).
# Re-enable (true) before continuing. Delete the synthetic PS row in cleanup.

# ──────────────────────────────────────────────────────────────────────
# STEP 7 — Idempotency check
# ──────────────────────────────────────────────────────────────────────
curl -s -X POST http://localhost:3105/api/v2/ingest-bank-feed/refresh \
  -H "Content-Type: application/json" -d '{"sinceDays":14}' \
  | jq '.sync.inserted'
# Expect: 0 (everything already in canonical table or linked)

# ──────────────────────────────────────────────────────────────────────
# STEP 8 — Review queue surfaces bank-feed rows
# ──────────────────────────────────────────────────────────────────────
# Frontend: open http://100.100.162.49:5174/refresh-ps
# Expect: the existing review queue now includes rows with source='bank-feed'

# Or via API:
curl -s -X POST http://localhost:3105/api/v2/ingest-ps/review-new-transactions \
  -H "Content-Type: application/json" -d '{}' \
  | jq '[.transactions[] | select(.source=="bank-feed")] | length'
# Expect: > 0

# ──────────────────────────────────────────────────────────────────────
# STEP 9 — PS path still works (regression check)
# ──────────────────────────────────────────────────────────────────────
curl -s -X POST http://localhost:3105/api/v2/ingest-ps/refresh-ps \
  -H "Content-Type: application/json" -d '{"daysHistory":1}' \
  | jq '.sync | {inserted, updated, skipped}'
# Expect: 200, sensible counts, NO errors mentioning bank_feed_external_id

# ──────────────────────────────────────────────────────────────────────
# STEP 10 — Backend smoke regression
# ──────────────────────────────────────────────────────────────────────
BASE_URL=http://localhost:3105 node server/src/scripts/smoke-after-021.js
# Expect: all checks pass

BASE_URL=http://localhost:3105 node server/src/scripts/smoke-bank-feed.js
# Expect: all 6 checks pass

# ──────────────────────────────────────────────────────────────────────
# ROLLBACK (only if anything above fails irrecoverably)
# ──────────────────────────────────────────────────────────────────────
# Option A — schema-only rollback (keeps PS data intact):
docker exec -i fin-postgres-dev psql -U fin -d fin <<'SQL'
BEGIN;
-- Undo R2 links + the synthetic walkthrough row BEFORE dropping the column.
DELETE FROM transactions WHERE ps_id = 999000001;          -- synthetic dup from STEP 6b
-- (bank_feed_external_id links on real PS rows vanish with the column drop below,
--  but the PS rows themselves are kept — links never deleted PS data.)
DROP TABLE IF EXISTS bankfeed_staging;
DROP INDEX IF EXISTS uq_tx_bank_feed_external_id;
DROP INDEX IF EXISTS idx_tx_source;
ALTER TABLE transactions DROP COLUMN IF EXISTS bank_feed_external_id;
ALTER TABLE account_source_mappings DROP COLUMN IF EXISTS ignored;   -- [R1]
DELETE FROM sync_metadata WHERE sync_type = 'bank_feed_transactions';
DELETE FROM account_source_mappings WHERE source = 'bank-feed';
DELETE FROM transactions WHERE source = 'bank-feed';
COMMIT;
SQL

# Option B — full DB restore from the pre-CR022 dump:
docker exec -i fin-postgres-dev pg_restore -U fin -d fin -c \
  < ~/fin-dev-pre-cr022-<YYYYMMDD>.dump
```

Only after steps 1–10 pass green is Phase F (prod push) authorized.

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `account_source_mappings` mis-pointed during step 5; bank-feed rows land on wrong fin account | Medium | High | Step 6 prints `inserted`/`unmappedAccounts` — visual check before continuing. Rollback option A wipes only bank-feed rows. |
| Duplicate detection between PS and bank-feed: same PKO transaction arrives via both feeds and both insert into `transactions` | High | High (if unhandled) | **In scope — R2.** Cross-source dedup links the bank-feed row onto the matching PS row at promote time on `(account_id, ABS(amount), currency)` ±1 day; reverse direction drops the PS row. `BANK_FEED_DEDUP_ENABLED=false` is the rollback. `merged_with_ps_count` is the health signal. |
| **R2 false-merge**: two genuinely distinct same-day, same-account, same-amount transactions collapse onto one row | Low–Medium | High | Match key includes a tie-break heuristic (description/merchant hash, or hour-of-day if the contract exposes it). Tests §5.2 assertion 8 asserts two distinct rows stay two rows. If the contract lacks any disambiguator, the heuristic falls back to *not* merging (prefer a visible duplicate in the review queue over a silent data loss). |
| **R1 lockout**: user forgets to map a new fintable account, its transactions silently never appear | Medium | Medium | By design unmapped = pending, not dropped — rows wait in `bankfeed_staging` and surface in every refresh summary's `unmappedAccounts` + the diagnostic page. Phase G monitoring (§4) calls out watching that list. Trade-off accepted: a visible "pending" backlog beats silent ingest of an unvetted account. |
| bank-feed `fintableSync.js` PKO hardcoding (§1.2) means future Fidelity rows land mislabeled | Certain (after Fidelity arrives) | Medium | Coordinating dependency on CR021 follow-up. Fidelity is not in the bank-feed yet (§1.1) so no immediate blocker. Track in `bank-feed/HANDOFFS.md`. |
| `accepted=TRUE` rows protected from re-promote, but an `accepted=FALSE` row gets its category edited then re-promoted overwrites it | Low | Medium | Mirrors existing PS behavior (PS's `accepted IS NOT TRUE` guard). User accepts the row to lock it. Document in release notes. |
| `category_hint` from fintable/GoCardless is low-quality and the review queue floods | High | Low | All bank-feed rows land with `accepted=FALSE`, forcing a manual categorization pass. Same workflow PS uses today. |
| Schema migration applied to prod before CR022 code is deployed; new column exists with nothing writing to it | Low | None | Additive migration is harmless on its own — `bank_feed_external_id` defaults NULL, `bankfeed_staging` sits empty. Sequence is still apply migration, then deploy code. |
| Bank-feed `/v1/transactions` lacks an `updated_since` query param; backdated edits on the fintable side aren't picked up by incremental sync | Medium | Medium | First cut uses `since=` (transaction_date) on a 14-day rolling window. Track the `updated_since` ask in `bank-feed/HANDOFFS.md` as a v1 additive change. |
| Test data drift: live bank-feed counts change between Jest runs and smoke runs | Certain | Low | Smoke uses `≥` not `=`. Jest uses fixtures, never live data. |

## 9. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-30 | **CR022 scoped as additive parallel import — NOT a PS replacement** | CR021 explicitly deferred the v3 cutover to a future CR. Going additive de-risks the work: PS keeps running, review queue is source-agnostic, schema delta is one column + one staging table. Removal of PS becomes its own follow-up CR after a ≥1-month parallel-run observation window. |
| 2026-05-30 | **Discriminator: `source='bank-feed'` (generic) — NOT `'fintable'` or `'plaid'`** | Matches CR021 §3.3 commitment to a provider-agnostic main app. Survives upstream swaps. Actual upstream preserved in `bankfeed_staging.source` and `raw` JSONB. |
| 2026-05-30 | **Add `bank_feed_external_id VARCHAR(100)` — do NOT reuse `ps_id`** | `ps_id` is BIGINT; bank-feed IDs are strings (fintable composite hash, future Plaid IDs, GoCardless UUIDs). Repurposing `ps_id` would require changing its type and breaks ~15 PS callsites. Partial-unique index keeps the constraint scoped. |
| 2026-05-30 | **Parallel `bankfeed_staging` table — do NOT overload `psdata_staging`** | Different column set (`merchant`, `category_hint`, `pending`, `raw` JSONB vs PS-specific). CR021 §3.3 commits `psdata_staging` is "frozen in place". Reusing it adds ~5 nullable columns and leaves half the table NULL on every bank-feed row. |
| 2026-05-30 | **Insert bank-feed rows with `accepted=FALSE`** | Categorization quality from fintable/GoCardless is unproven on PKO data. Forces every row through the existing review UI, mirroring PS post-CR011 flow. |
| 2026-05-30 | **No CHECK constraint on `transactions.source`** | PS path doesn't have one either; adding one now risks breaking historical 'split'/'auto-offset' values written elsewhere. The discriminator stays free-form. |
| 2026-05-30 | **`pending_transactions` not generalized** | PS-specific table. Bank-feed review flow runs directly off `transactions WHERE source='bank-feed' AND accepted=FALSE`. Generalizing only justified if PS and bank-feed coexist long-term — they explicitly will not. |
| 2026-05-30 | **Dev walkthrough is a hard gate before prod push** | The schema delta is small but the integration surface is broad (5 new files + 1 migration). Manual walkthrough surfaces issues a test suite can't (account-mapping UX, review-UI mixing PS and bank-feed rows). `pg_dump` bracket is cheap insurance. |
| 2026-05-30 | **`updated_since` contract gap deferred to CR021 follow-up, not blocking CR022** | First-cut uses transaction_date-based `since=` on a rolling 14-day window. Backdated edits are visible to bank-feed but not pulled into fin until they fall inside the window. Acceptable for initial parallel-run; tracked as a v1 additive change in `bank-feed/HANDOFFS.md`. |
| 2026-05-31 | **R1 — per-account opt-in via `account_source_mappings.ignored`; unmapped = pending (fail-closed)** | fintable can surface new/test/roll-up accounts at any time. Silent ingest of an unvetted account is worse than a one-time toggle. Reuses the existing (source, external_name)-keyed mappings table rather than a new table. Unmapped accounts stage but never promote, forcing an explicit per-account decision. |
| 2026-05-31 | **R2 — cross-source dedup links onto the existing row (keeps `id` stable), does not insert-and-reconcile** | During the ≥1-month parallel run both feeds carry the same PKO transactions; without dedup the table doubles. Linking (stamp `bank_feed_external_id` on the matched PS row) preserves the canonical `id` so transfer-match groups and splits keep their FKs. Match key `(account_id, ABS(amount), currency)` ±1 day; reverse direction drops the later PS row. |
| 2026-05-31 | **R2 dedup is flag-gated (`BANK_FEED_DEDUP_ENABLED`, default true) and is the ONLY PS-code edit** | A single guarded reverse-lookup in `refreshPsApiV2.js` is unavoidable to drop PS rows that duplicate bank-feed rows. Gating it keeps the "additive, PS untouched" promise intact: flag off (or no match) → PS behaves byte-for-byte as before. `false` is also the mis-fire rollback. |
| 2026-05-31 | **R2 false-merge resolved conservatively: when ambiguous, do NOT merge** | Two distinct same-day/same-amount transactions must not collapse. With no disambiguator the heuristic prefers a visible duplicate in the review queue over silent data loss. Tested explicitly (§5.2 #8). |

---

*Living document. Update §9 Decision Log as choices are made. CR022 closes after Phase F completes and ≥1-month parallel-run observation begins.*
