**Status:** ✅ COMPLETED (P1 + P2) — [Plan](../FC_NEXT_STEPS.md#cr036) — P1: bank-feed service deployed 2026-07-01 (commit `91c2911`) + fin v3.0.45–47, live-verified in prod. **P2 (interactive column-mapper) shipped 2026-07-05** — bank-feed commit `31dd0fc` (migration 004 `manual_profiles`, `/v1/manual/inspect`, saved-profile registry, inline mapper specs on `/parse`, per-row currency column) + fin **v3.0.59** (mapper UI in `ManualStatementUpload.jsx` with typed statement balance, `statedBalance` override threading, dynamic format list). E2E-verified on dev: unknown-format CSV → inspect → inline-mapping preview (signs flipped, per-row currency, typed-balance drift) → save profile → auto-detect matches it thereafter. **P3 remains optional/unscoped** (ocr-llm mapping-guess, PDF/OCR).

## P2 as-built (2026-07-05)

- **Service (bank-feed `31dd0fc`):** `manual_profiles` table (migration 004; spec stored as `json`, same declarative shape as built-ins). `profiles/index.js` gains `inspect()` (CSV tokenize + header-row heuristic + sample rows), `validateProfileSpec()` (normalizes mapper specs; defaults `match.headerContains` to the date+amount column names so saved profiles auto-detect), `detectProfileFrom()` (built-ins win ties, then saved), and **per-row currency column** support (`columns.currency` — the multi-currency case §6 designed for). `/v1/manual/parse` accepts `profile` (inline spec) or `profile_id` (built-in → saved → 404); `/v1/manual/inspect` and `POST /v1/manual/profiles` (upsert by label slug) added; `GET /v1/manual/profiles` merges built-ins + saved (`custom: true`). +9 tests (109 total… service suite 100 passing incl. new).
- **fin (v3.0.59):** client + routes proxy `inspect`/`save-profile`; `preview`/`commit` thread `profile` (inline spec) and **`statedBalance {magnitude, date}`** — mapper profiles carry no preamble balance regex, so the user types the statement's printed balance and the standard hypothetical-drift gate still runs (per §6: reconcile against the statement's own balance, not today's). `ManualStatementUpload.jsx`: format dropdown is now dynamic (built-ins + saved), "Map columns…" opens the mapper — sample-row table, column pickers (date/amount/description/category/currency), date-format + sign-convention selects (signed / outflows-positive / split debit+credit), typed balance + as-of — then Preview-with-mapping and **Save format** (auto-selects the saved profile). Null-balance previews get an explicit hint instead of a misleading "will not reconcile".
- **Verified:** service 100/100 tests; fin 96 service tests + build/lint; live dev E2E (inspect → 422 on auto-detect → inline preview with flipped signs and drift → save → list → auto-detect matches saved). Test profile removed from the shared service DB afterwards.

# CR036 — Manual Statement Upload (Stale-Feed Fallback)

**Created:** 2026-07-01

## Implementation status (P1 — 2026-07-01)

Built and tested, **not yet deployed** (running dev/prod containers still run pre-CR036 code):

- **bank-feed service** — format layer `src/profiles/index.js` (dependency-free CSV tokenizer incl. the `="0721"` Excel-guard, declarative profile registry, header auto-detect, deterministic synthetic `external_id` with file-local occurrence index, statement-balance regex) + preinstalled **Barclays / Luxury Card** profile; `src/routes/manual.js` (`POST /v1/manual/parse` stateless format layer, `POST /v1/manual/commit` trusted writer → feed_transactions + feed_balances, `GET /v1/manual/profiles`); registered in `server.js`. Tests: `tests/manualProfiles.test.js` (10). Full suite **94/94**.
- **fin** — generalized the promote-side dedup (`refreshBankFeedV2.promote`) from PS-only to **any-source overlap**, scoped to `source='manual'` staging rows so the live-feed path is byte-for-byte unchanged (avoids the same-amount ±1-day false-collapse regression); adds a `skippedDup` counter and a `link` vs `skip` branch (stamp an un-stamped PS twin, else skip a true duplicate without mutating it). New `services/manualStatementImport.js` owns sign alignment + dedup preview + drift; `POST /api/v2/bank-feed/manual/{preview,commit}` + `GET /manual/profiles`; `bankFeedClient` gained a JSON-body path + `manualParse`/`manualCommit`/`manualProfiles`. Tests: `manualStatementImport.test.js` (9 sign-math). UI: `ManualStatementUpload.jsx` modal + an "Upload statement" button per row on **Balance Reconciliation**.
- **Live read-only validation** against the real stale Luxury Card + the attached statement: parsed 46/46 rows, **29 classified already-in-ledger, 17 genuinely new** (the 06-25→06-29 post-staleness rows + a few earlier gaps the feed missed), residual **drift −194.99** (small/plausible → the gate surfaces it for accept-or-calibrate). This run caught a real bug — the preview candidate query omitted `account_id`, so `findPsMatch` rejected every candidate and deduped nothing; fixed. **Lesson: unit tests with hand-built candidates that happened to include `account_id` passed while the real query was wrong — always exercise the dedup against the live ledger.**

**Deploy order (when ready):** bank-feed service first (new `/v1/manual/*`), then fin. No DB migration in either repo (feed_transactions/feed_balances already allow `source='manual'`; no new fin columns).

**Created (plan):** 2026-07-01
**Track:** v3 (must not depend on the v4 `FIN_MULTI_TENANT`/`AUTH_ENABLED` flags).
**Realizes:** [CR021](CR021_BANK_FEED_SERVICE.md) **Phase 4 (Excel/CSV upload)**, deferred at CR021 time, now pulled forward as a resilience fallback.
**Adjacent to:** [CR035](CR035_FEED_SYNC_FRESHNESS.md) (staleness detection — the trigger that tells the owner *when* to reach for this), [CR025](CR025_MANUAL_TRANSACTION_ENTRY.md) (hand entry — this is the bulk-file analogue), [CR033](CR033_MANUAL_CALIBRATION.md) (calibrate/MTM reconcile actions this reuses).

## 1. Background & Problem

Aggregated feeds go stale. The upstream chain (Plaid → institution, e.g. **Luxury Card = Barclays**) periodically stops updating — currently 5 days stale, surfaced by CR035. When that happens the owner has no way to keep the ledger current except waiting for the feed to recover or hand-entering rows one at a time (CR025). Meanwhile the bank itself offers a downloadable statement/CSV export that already contains every transaction plus a stated closing balance.

We want a **manual upload fallback**: drop in the bank's own export, import **only the rows not already present**, and use the statement's **stated balance as a reconciliation gate**. It must be **flexible across banks** — each provider exports a slightly different CSV shape (column names/order, date format, sign convention, preamble, where the balance line sits).

### Reference sample — Barclays / Luxury Card (`CreditCard_YYYYMMDD_YYYYMMDD.csv`)

```
Barclays Bank Delaware
Account Number: XXXXXXXXXXXX9915
Account Balance as of June 30 2026:    $7930.84

Transaction Date,Description,Category,Amount,Card Last 4 Digits,Purchased by
06/29/2026,"APPLE.COM/US","DEBIT","-1389.93",="0721",KATARZYNA H BIEDERMANN
...
```

Salient properties (a superset of what the format layer must handle):
- **4 preamble lines** before the header (bank name, masked account #, **balance line**, blank).
- Balance embedded in prose: `Account Balance as of June 30 2026:    $7930.84`.
- **Signed `Amount`**, negative = debit (purchase). This is a **liability** card.
- No stable per-transaction ID in the export.
- Genuine same-day collisions possible (e.g. paired `KLM …` charges; two `FUNCTION HEALTH` credits on different days — the disambiguator must be robust to both).
- Noise columns (`Card Last 4 Digits`, `Purchased by`, `Category`) that we keep in `raw` but don't map.

## 2. Goals & Non-Goals

### Goals
- Manual upload of a bank's own statement export as a **first-class feed source** (`source='manual'`) inside the **bank-feed microservice** — the single ingestion funnel, not a second path.
- **Import only new rows:** dedup against everything already on that account (any `source`), and be **idempotent** on re-upload of overlapping statements.
- **Reconcile to the stated total:** parse the statement's closing balance, run it through the existing `balance-recon`, and make a non-zero residual drift a **loud gate** before commit — not a silent import.
- **Flexible across banks** via an **interactive column-mapper** with **saved per-institution profiles**; ship with a **preconfigured Barclays/Luxury Card profile** so it works day one.
- **Dry-run preview** (N new / M skipped-duplicates / computed-vs-stated balance / drift) before any write.

### Non-Goals
- Not a generic ETL platform. Just enough to cover the banks the owner actually exports.
- No COA mapping / categorize / accept-edit-split here — that stays in the main app's existing promote + review-queue flow (rows land `accepted=FALSE` like any feed row).
- Not a replacement for the live feed — it's the fallback for when the feed is down/stale. When the feed recovers, its rows dedup against the manually-uploaded ones (same key), so no double-count.
- No OCR/PDF statement parsing in this CR (CSV/Excel only; PDF is a possible later extension via ocr-llm).

## 3. Architecture

**Decision (owner, 2026-07-01): Option A — ingest in the bank-feed microservice.** The CSV becomes just another `source` behind the existing `/v1/*` contract. Everything downstream (`refreshBankFeedV2` dedup/sign/promote, `balance-recon`, staleness view) reuses unchanged. Rejected Option B (upload directly into fin's `bankfeed_staging`) because it bypasses the canonical `feed_transactions` store and re-fragments the single-source-of-truth CR023 just consolidated.

```
Owner ──upload CSV──►  bank-feed service
                        POST /v1/manual/preview   (parse + map + dry-run, NO write)
                        POST /v1/manual/commit     (write feed_transactions + feed_balances)
                          │
                          ├─ Format layer:  profile registry → parse → canonical rows
                          ├─ feed_transactions  (source='manual', synthetic external_id)
                          └─ feed_balances      (source='manual', from the statement balance line)
                          │
   fin main app  ◄──/v1/*──┘   normal refreshBankFeedV2 poll promotes new rows,
                               balance-recon compares computed vs stated → drift gate
```

### 3.1 Format layer (the flexibility core)

A **declarative profile** per institution — JSON/config, not code — so new banks are added without a deploy where possible:

```jsonc
{
  "id": "barclays_luxury_card",
  "label": "Barclays / Luxury Card",
  "match": { "headerContains": ["Transaction Date","Amount","Card Last 4 Digits"] },
  "preamble": { "skipUntilHeaderRow": true },      // or fixed skipRows: 4
  "columns": {                                      // canonical ← source header
    "transaction_date": "Transaction Date",
    "description": "Description",
    "amount": "Amount",
    "currency": { "const": "USD" }
  },
  "date": { "format": "MM/DD/YYYY" },
  "amount": { "signed": true, "debitIsNegative": true },  // vs split debit/credit cols
  "balance": { "from": "preamble", "regex": "Account Balance as of .*?:\\s*\\$([\\d,.]+)",
               "asOf": { "regex": "as of ([A-Za-z]+ \\d{1,2} \\d{4})" } },
  "accountMatch": { "last4": "9915" }               // hint → feed_account mapping
}
```

Flow for an **unknown** format:
1. Parse rows generically, detect the header, show a **preview grid**.
2. Owner maps each canonical field to a source column (dropdowns), sets date format + sign rule, points at the balance.
3. **Save as a new profile** → next upload of that bank is one-click (auto-matched via `match.headerContains`).

Barclays profile ships **preinstalled** so the reference case needs no mapping step. (Optional later: an ocr-llm one-shot *"guess the mapping"* to pre-fill the mapper — deterministic parser still does the numeric work; not in P1.)

### 3.2 Dedup ("only new items")

Two distinct problems; the existing code only solves the first:

1. **Re-upload idempotency.** Exports have no stable ID → synthesize a deterministic
   `external_id = hash(feed_account, iso_date, amount@4dp, normalized_description, occurrence_index)`.
   `occurrence_index` = the Nth identical (date,amount,desc) tuple *within the file*, so genuine same-day/same-amount duplicates survive and re-uploads collapse cleanly against `feed_transactions UNIQUE(account_id, external_id)`.
2. **Overlap with rows already imported (any source).** The current `findPsMatch` only dedups feed rows against **PocketSmith** rows. Generalize the promote-side match to compare an incoming manual row against **all existing transactions on that account** in the upload's date window, using the existing key `(account, |amount|@4dp, currency, date ±1 day)` + normalized-description tie-break. Unmatched → insert (`accepted=FALSE`); matched → link/skip. This is the change that makes "import only new" true when a stale feed had partially populated the period.

### 3.3 Reconcile-to-total (the safety gate)

- The parsed **statement balance** → a `feed_balances` row (`source='manual'`, `balance_date` = the "as of" date).
- The existing `balance-recon` computes `drift = (opening_balance + Σtx) − (stated_balance × feed_sign)`. Barclays is a liability card → `feed_sign` / `feed_negate_tx` already carry the sign convention; the profile's `debitIsNegative` must be set to agree with those mapping flags (validated in preview).
- **Gate:** the **preview** shows computed-vs-stated + drift. Commit is allowed but a non-zero drift is flagged prominently (likely a parse/sign error or a missing/extra row). After commit, the owner can run the existing `calibrate` reconcile action to re-anchor residual drift, exactly as for a live feed.

## 4. Data / Schema Touchpoints

- **bank-feed service** (`~/Programs/fin/bank-feed`): `feed_transactions.source` / `feed_balances.source` already permit `'manual'`; the `raw` JSON column stores the untouched CSV row. New: profile registry storage (table or config dir), and the two `/v1/manual/*` endpoints. Retire the `POST /v1/excel/upload` 501 stub (or repoint it).
- **fin main app** (`server/src/v2`): generalize the promote-side dedup match beyond PS (`converters/bankFeedToCanonical.js` `findPsMatch` → account-scoped, any-source); no new fin migration expected in P1 (manual rows flow through the existing `source='bank-feed'` promote path with `source='manual'` provenance preserved). Confirm during design — **any DB-layer change gets owner sign-off per CLAUDE.md before coding.**

## 5. Phasing

- **P1 — Working Barclays path.** `/v1/manual/preview` + `/v1/manual/commit`; preinstalled Barclays profile; synthetic `external_id` + occurrence-index; generalized any-source overlap dedup; statement-balance parse → `feed_balances`; dry-run preview with drift gate; minimal upload UI. **Unblocks the current stale Luxury Card now.**
- **P2 — Interactive column-mapper + profile registry.** Header auto-detect, mapping UI, save/label/auto-match profiles → true multi-bank flexibility (owner asked to build this in this CR, not defer it).
- **P3 (optional).** ocr-llm mapping-guess assist; wire CR035 staleness so a stale `balance-recon` row surfaces an **"Upload statement"** action inline; PDF/OCR statements.

## 6. Open Questions / Risks

- **Sign-convention agreement.** Profile `debitIsNegative` vs mapping `feed_sign`/`feed_negate_tx` must not double-flip. Preview must show the resulting signed sample rows so the owner catches it before commit.
- **Partial-period statements.** An export covering only part of the gap won't reconcile to the *current* balance — reconcile against the statement's own "as of" balance/date, not today's.
- **Same-day identical duplicates** across separate uploads (not within one file) — occurrence-index is file-local; two uploads that each contain the same real transaction dedup via the (date,amount,desc) key, but two *distinct* identical transactions split across files need the ±1-day + description key to hold. Acceptable; flagged for test coverage.
- **Currency.** Barclays is USD-only; multi-currency exports (Wise/Revolut) need a currency column in the profile — designed for, exercised in P2.

## 7. Test Plan (outline)

- Parser: Barclays fixture → correct row count, signs, and parsed balance/as-of.
- Idempotency: re-upload same file → 0 new. Upload overlapping file → only the non-overlap rows new.
- Overlap dedup: pre-seed account with feed rows, upload statement covering them → matched, not duplicated.
- Reconcile: computed balance from parsed rows == stated balance (drift < 0.01) on the fixture; a deliberately corrupted row → drift flagged.
- Same-day collision fixture (paired KLM / dual FUNCTION HEALTH) → both retained.
