**Status:** IN-PROGRESS — Phases A (schema), B (cash parser), C (FX seeder), D (investment parser), and E (cash-only promote + rollback + admin UI) landed on **dev AND prod** (2026-05-22). Investment-side promote (lot walker) explicitly guarded — promote refuses to run on any batch with rows in investment staging tables until the lot walker is implemented. · Blocks CR020 (Stock Investment Module)

# CR019 — Quicken Historical Import

One-time backfill of pre-2022 financial history from Quicken into the existing PostgreSQL ledger. Imports both the cash side (bank, credit card, loan accounts → `transactions`) and the share side (brokerage holdings → new lot-tracking tables), so the system carries one continuous history back to the user's earliest Quicken record. CR020 (Stock Investment Module) depends on the investment schema this CR creates.

---

## 1. Background & Motivation

The system today has actual transaction history only from 2022 onward (PocketSmith era). Everything before 2022 lives in Quicken as QIF-exportable data and is invisible to Balance Trends, Forecast comparisons, dividend history, and any "all-time" analytics. The user has ~20 years of Quicken history to bring forward.

Beyond cash transactions, this CR is also the natural place to land the **investment data model** (per [CR020](CR020_STOCK_INVESTMENT_MODULE.md) §14). Importing 20 years of Buy/Sell/Div records is the largest, most opinionated population of `security_lots` / `security_transactions` the system will ever do — building the schema here means CR020 starts with a working dataset rather than empty tables.

Gaps closed by this CR:

- Balance Trends shows true history pre-2022 (today the chart is flat or starts at PS origin date).
- Forecast actuals can compare against decades of real data, not just three years.
- Investment lot history is recoverable (cost basis, realized gain, hold-period crossings).
- Dividend / interest income history extends back, supporting yield-on-cost analysis in CR020.

## 2. Goal

Land Quicken's full pre-cutoff history in the existing PostgreSQL ledger such that:

- Balance-trend queries for any historical date return the correct USD value via the existing `opening_balance + SUM(transactions)` formula, including pre-2022 dates.
- Investment account valuations for any historical date are computable via `SUM(open_lots × close_price_at_date)` once CR020's price-feed mechanism is in place.
- The 2021↔2022 boundary is seamless: no duplicates, no gaps, consistent transfer-pair model, brokerage balances continuous (via lot-level math for pre-2022 and the existing mark-to-market convention for post-2022).

**Non-goals:**

- Round-tripping data back to Quicken (one-way import only).
- Live sync with Quicken (Quicken is being retired).
- UI for portfolio analytics — that's CR020.
- Tradier price feed / ongoing Fidelity ingestion — that's CR020.
- FX backfill for currencies the user doesn't hold (only seed `budget_fx_rates` for currencies actually present in the import).

## 3. Scope

### In scope

- Migration `022_quicken_import.sql` creating four staging tables + two batch-lifecycle tables (`quicken_import_batches`, `quicken_calibration_audit`) + six investment tables + one enum + new `import_batch_id` columns on existing `transactions` and `transfer_match_groups`.
- QIF parser: cash actions, investment actions, transfers, splits, the `!Type:Security` master, and the `!Type:Prices` block.
- Four staging tables (`quicken_staging`, `quicken_securities_staging`, `quicken_security_master_staging`, `quicken_price_staging`) for raw parsed rows.
- Admin UI for authoring `source='quicken'` mapping rows (account → COA, category → P&L leaf, security → securities) plus a Promote review page with pre-flight diff.
- Promote step: dedupe vs existing data, transfer pairing, split expansion, lot-inventory generation, FX resolution, cash↔share linkage, `opening_balance` recalibration per affected account.
- Reconciliation report: per-account row counts, FX coverage gaps, action-type coverage, basis disagreements (Quicken vs arithmetic), unlinked cash legs.
- ECB historical FX rate seeder for non-USD currencies in the import range.
- Test fixtures for each Quicken action type encountered in the user's data.

### Out of scope

- Anything past the Quicken cutoff date (PocketSmith handles 2022+).
- Crypto, options, derivatives, non-USD securities (CR020 deferred list).
- Quicken categories that have no clean COA target (require manual COA work first).
- Reverse export.

### Dependency posture

- **Blocks CR020** — that CR explicitly waits for this one's schema (CR020 §14).
- **No code dependency on CR014/CR015** (PocketSmith replacement / re-export) — independent.

---

## 4. Data Model

### 4.1 New staging tables (this CR)

```sql
CREATE TABLE quicken_staging (
    id SERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL,
    source_file VARCHAR(255) NOT NULL,
    source_line INTEGER,
    quicken_account_name VARCHAR(200) NOT NULL,
    transaction_date DATE NOT NULL,
    amount NUMERIC(18,4) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    payee VARCHAR(500),
    memo TEXT,
    quicken_category VARCHAR(200),
    transfer_target_account VARCHAR(200),   -- non-null if QIF row was [AcctName]
    cleared_status CHAR(1),                 -- R / c / blank
    split_parent_id INTEGER REFERENCES quicken_staging(id),  -- for expanded splits
    raw_payload JSONB,                      -- original QIF tag dump for debugging
    promoted_transaction_id INTEGER,        -- set after successful promote
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_qs_batch ON quicken_staging(import_batch_id);
CREATE INDEX idx_qs_account_date ON quicken_staging(quicken_account_name, transaction_date);

CREATE TABLE quicken_securities_staging (
    id SERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL,
    source_file VARCHAR(255) NOT NULL,
    source_line INTEGER,
    quicken_account_name VARCHAR(200) NOT NULL,
    transaction_date DATE NOT NULL,
    quicken_action VARCHAR(20) NOT NULL,    -- BuyX, Sell, ReinvDiv, StkSplit, …
    quicken_security_name VARCHAR(200),
    shares NUMERIC(18,6),
    price NUMERIC(18,6),
    fees NUMERIC(18,4),
    gross_amount NUMERIC(18,4),
    quicken_lot_id VARCHAR(50),             -- preserved when QIF specifies a lot
    quicken_cost_basis NUMERIC(18,4),       -- Quicken's stored basis if present
    cleared_status CHAR(1),
    memo TEXT,
    raw_payload JSONB,
    promoted_security_tx_id INTEGER,
    promoted_cash_tx_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_qss_batch ON quicken_securities_staging(import_batch_id);
CREATE INDEX idx_qss_account_date ON quicken_securities_staging(quicken_account_name, transaction_date);
CREATE INDEX idx_qss_security_date ON quicken_securities_staging(quicken_security_name, transaction_date);

CREATE TABLE quicken_security_master_staging (
    id SERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL,
    source_file VARCHAR(255) NOT NULL,
    quicken_security_name VARCHAR(200) NOT NULL,
    ticker VARCHAR(20),
    quicken_type VARCHAR(50),                -- Stock / Bond / Mutual Fund / ETF / …
    quicken_goal VARCHAR(100),
    raw_payload JSONB,
    promoted_security_id INTEGER,            -- → securities.id after promote
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(import_batch_id, quicken_security_name)
);

CREATE INDEX idx_qsms_batch ON quicken_security_master_staging(import_batch_id);

CREATE TABLE quicken_price_staging (
    id SERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL,
    source_file VARCHAR(255) NOT NULL,
    ticker VARCHAR(20) NOT NULL,
    price_date DATE NOT NULL,
    close NUMERIC(18,6) NOT NULL,
    promoted INTEGER DEFAULT 0,              -- 0 / 1 after upsert into security_prices
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_qps_batch ON quicken_price_staging(import_batch_id);
CREATE INDEX idx_qps_ticker_date ON quicken_price_staging(ticker, price_date);

CREATE TABLE quicken_import_batches (
    id UUID PRIMARY KEY,
    label VARCHAR(200),                       -- human-friendly name (e.g., "2026-05-22 full backfill")
    parsed_at TIMESTAMPTZ,
    mapped_at TIMESTAMPTZ,                    -- last mapping save
    promoted_at TIMESTAMPTZ,                  -- non-null after successful promote
    rolled_back_at TIMESTAMPTZ,               -- non-null after rollback
    status VARCHAR(20) NOT NULL DEFAULT 'parsing',
        -- parsing | parsed | mapped | promoting | promoted | rolling_back | rolled_back | failed
    failure_reason TEXT,
    source_files JSONB,                       -- ["pko.QIF", "fidelity_stk_w_sec.QIF", ...]
    cutoff_overrides JSONB,                   -- per-account user-supplied cutoff dates per §8.1.1; format: {"<account_id>": "YYYY-MM-DD"}
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_qib_status ON quicken_import_batches(status);

CREATE TABLE quicken_calibration_audit (
    id SERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL REFERENCES quicken_import_batches(id),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    delta_amount NUMERIC(18,4) NOT NULL,      -- amount subtracted from opening_balance at promote
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(import_batch_id, account_id)
);

CREATE INDEX idx_qca_batch ON quicken_calibration_audit(import_batch_id);
```

### 4.2 Investment tables (owned-by-name here, specified by CR020 §4)

Created in the same migration to keep CR020 unblocked. Full column lists and indexes per [CR020 §4](CR020_STOCK_INVESTMENT_MODULE.md#4-data-model-owned-by-cr019-referenced-here):

- `securities` — master per instrument.
- `security_source_mappings` — `(source, external_name) UNIQUE` mirrors `account_source_mappings`.
- `security_lots` — open lots, with `handoff_marker BOOLEAN DEFAULT FALSE` and **`import_batch_id UUID`** (nullable; populated when origin is a Quicken import; required for rollback).
- `security_transactions` — events with FK `cash_transaction_id` (nullable → `transactions.id`), plus **`import_batch_id UUID`** (nullable).
- `security_lot_disposals` — sells matched to lots, plus **`import_batch_id UUID`** (nullable).
- `security_prices` — daily close history, `(security_id, price_date) UNIQUE`, plus **`import_batch_id UUID`** (nullable).

`import_batch_id` is nullable on all four tables because rows can originate from non-Quicken sources (Fidelity ingestion, manual entry, Tradier price feed) where batch tracking is owned elsewhere. Indexed only where rollback queries need it (`security_*(import_batch_id)` partial index `WHERE import_batch_id IS NOT NULL`). This is one of the [§18 commitments to CR020](#18-coordination-with-cr020).

Enum:

```sql
CREATE TYPE security_tx_type AS ENUM (
    'BUY', 'SELL', 'DIVIDEND', 'DIVIDEND_REINVEST',
    'SPLIT', 'TRANSFER_IN', 'TRANSFER_OUT', 'INTEREST', 'MISC'
);
```

### 4.3 Existing tables — minor changes

- `account_source_mappings` accepts `source='quicken'` rows as-is (designed for it per migration 019 comment).
- `accounts` — adds new `skip_transfer_analysis BOOLEAN NOT NULL DEFAULT FALSE` column. Set to `TRUE` on transfer-flagged leaves that don't have a matching pair (notably "Return of Capital"), so they don't appear as perpetually-unmatched in [/transfer-analysis](../FC_PROJECT_STRUCTURE.md). See §5.3 for usage on RoC.
- `transactions` — adds new nullable `import_batch_id UUID` column (per §13). Rows themselves carry `source='quicken-import'`.
- `transfer_match_groups` — adds new nullable `import_batch_id UUID` column (rollback support, see §6.5). Also adds new nullable `audit_provenance JSONB` column to record source-line provenance per matched pair (shape defined in §8.2.1).
- `transfer_match_group_members` — no change (cascade-deletes with parent group via existing FK).
- `budget_fx_rates` accepts seeded historical rates as-is (currency/year/month already a valid composite key).
- `transactions` repository (`findTransfers` in `server/src/v2/repositories/transactions.js:512`) — updated to add `AND c.skip_transfer_analysis = FALSE` to the WHERE clause. Without this, rows in skipped leaves would still appear in /transfer-analysis as "unmatched."

---

## 5. Parser

### 5.1 Input format

One QIF file per Quicken account (user export). Each file is one header (`!Type:Bank|CCard|Oth A|Oth L|Invst`) plus N transaction blocks separated by `^`, optionally followed by `!Type:Prices` blocks at the tail.

### 5.2 Cash action coverage (Bank / CCard / Oth A / Oth L / Cash)

| QIF tag | Meaning | Action |
|---------|---------|--------|
| `D` | Date — both formats observed in user's data: `M/D'YY` (apostrophe-year, used in `pko.QIF`) and `M/D/YY` (slash-year, used in `fidelity_stk.QIF`). Single-digit days/months may have leading space (`D7/ 1'14`). Parser supports both with 2-digit year pivot at 50: `00-49`→20xx, `50-99`→19xx. | parse → `transaction_date` |
| `T` / `U` | Amount (both fields present in user's data — `T` is canonical; `U` is "Quicken-cleaned" duplicate) | parse → `amount` |
| `P` | Payee | → `payee` |
| `M` | Memo | → `memo` |
| `L` | Category or `[AcctName]` transfer | strip brackets → `transfer_target_account`; else → `quicken_category` |
| `S/E/$` | Split lines (category / memo / amount) | expand to N child rows linked via `split_parent_id`; PKO sample has these on mortgage-payment rows (`L--Split--` followed by S/$ pairs) |
| `C` | Cleared status (`*`=cleared, `R`=reconciled, blank=uncleared) | → `cleared_status` |
| `N` | Check number | append to `memo` |

### 5.3 Investment action coverage (`!Type:Invst`)

Frequencies below come from the user's actual `fidelity_stk.QIF` (~6,669 records, 17 distinct action types). Used to validate coverage and prioritize implementation:

| Quicken action | Sample freq | `security_tx_type` | Cash side | Notes |
|----------------|-------------|--------------------|-----------|-------|
| `Buy` / `BuyX` | 1,281 | `BUY` | Neutralized pair in `transactions` | `X`-variant carries linked transfer account |
| `Sell` / `SellX` | 531 | `SELL` | Neutralized pair | basis lookup via FIFO or Quicken-supplied lot id |
| `Div` / `DivX` | 3,399 | `DIVIDEND` | Single cash credit → "Dividends" income category | dominant action — strong dividend history |
| `IntInc` / `IntIncX` | 42 | `INTEREST` | Single cash credit → "Interest Income" | |
| `MiscInc` / `MiscIncX` | 0 | `MISC` | Single cash credit → mapped category | not present in sample |
| `MiscExp` / `MiscExpX` | 0 | `MISC` | Single cash debit → mapped category | not present in sample |
| `CGShort` | 7 | `MISC` | Cash credit → "Realized Gain (Historical)" income leaf | single consolidated leaf for all historical realized gains |
| `CGLong` | 21 | `MISC` | Cash credit → "Realized Gain (Historical)" income leaf | same leaf as CGShort — no ST/LT split |
| `CGMid` | 0 | `MISC` | Cash credit → "Realized Gain (Historical)" income leaf | same leaf, not present in sample |
| `ReinvDiv` | 147 | `DIVIDEND_REINVEST` | Three cash rows: dividend income + neutralized buy pair | |
| `ReinvLg` | 10 | `DIVIDEND_REINVEST` | Three cash rows: "Realized Gain (Historical)" income + neutralized buy pair | income side hits the same consolidated leaf |
| `ReinvSh` / `ReinvMd` / `ReinvInt` | 0 | `DIVIDEND_REINVEST` | Three cash rows: matched-income + neutralized buy pair | not present in sample |
| `StkSplit` | 12 | `SPLIT` | None | Applied to lot inventory at promote time |
| `ShrsIn` | 13 | `TRANSFER_IN` | None on cash side; dedupe pair across files | true share transfer (no cash) |
| `ShrsOut` | 0 | `TRANSFER_OUT` | None on cash side; dedupe pair across files | not present in sample |
| `XIn` | 193 | (no share row) | Cash credit, paired with debit on counterparty account (`L[AcctName]`) | **Pure cash transfer**, not a security event — emit transfer-pair in `transactions` only |
| `XOut` | 59 | (no share row) | Cash debit, paired with credit on counterparty account | same as XIn, opposite direction |
| `Cash` | 406 | (no share row) | Single cash row, category from `L` tag | direct cash debit/credit within the investment account; treated like a bank-account row |
| `MargInt` | 5 | (no share row) | Single cash debit → "Margin Interest" expense | no share-side row |
| `RtrnCap` | 2 | `MISC` | Cash credit → "Return of Capital" leaf, placed under the **Transfers** parent (`is_transfer=TRUE`) **and** flagged `skip_transfer_analysis=TRUE` (§4.3) — keeps it out of P&L *and* out of Transfer Analysis as a perpetually-unmatched candidate | promote emits cash + MISC security_transactions row; reconciliation warning prompts manual lot-basis adjustment via admin UI. Holdings-value reduction is captured naturally by CR020's `lots × historical_close` computation. Volume too low to warrant automated basis logic. |
| `ShtSell` | 271 | (skip security side) | Cash credit → "Options Trading" leaf (single consolidated P&L leaf) | **OPTIONS**, not stock shorts — security names start `CALL …` / `PUT …`. CR020 §3 excludes options. Cash side preserved on a single leaf so net activity per period = realized option P&L. No `securities` / `security_lots` / `security_transactions` rows emitted. |
| `CvrShrt` | 270 | (skip security side) | Cash debit → "Options Trading" leaf (same as ShtSell) | options buy-to-close; both directions share the leaf |
| `Reminder` | 0 | (skip) | None | Quicken UI artifact, ignored |

**Options note:** the user's data has 271 ShtSell + 270 CvrShrt = ~540 option trades. CR020 explicitly excludes options. CR019's compromise: capture the cash P&L impact via the existing `transactions` ledger under an "Options Trading" expense/income category, but skip the share side entirely. Net option P&L (close − open) will manifest correctly as cash flow over a complete trade cycle.

**Unknown actions** at parse time: log to reconnaissance report, fail-loud at promote.

### 5.4 Security master blocks (`!Type:Security`)

Sample format (from `fidelity_stk_w_sec.QIF`):

```
!Type:Security
NABBOTT LABORATORIES
SABT
TStock
GGrowth & Income
^
```

Tags: `N`=name, `S`=ticker, `T`=type (Stock / Bond / Mutual Fund / ETF / …), `G`=investment goal (often empty). **Parse-phase writes to `quicken_security_master_staging` only — no writes to `securities` at parse time.** Promote-phase upserts staging rows into `securities` (idempotent on `ticker`, falls back to `name` when ticker is absent). Asset class derived from `T`: `Stock`→`stock`, `Mutual Fund`→`mf`, `Bond`→`bond`, `ETF`→`etf`, anything else→`misc` flagged for review. 667 securities in user's sample — eliminates almost all manual entry for CR020.

### 5.5 Price blocks (`!Type:Prices`)

Each block format: `"TICKER",<price>,"M/D'YY"` (single line, with leading space for single-digit months/days, e.g. `"ABT",20.0241," 4/30' 9"` = ABT $20.0241 on 2009-04-30). Each price entry is its own block separated by `^`.

The user's `fidelity_stk_w_sec.QIF` contains **384,282 price entries** covering 667 securities back to 1998 — roughly monthly density per security across 27 years. **Parse-phase writes to `quicken_price_staging` only — no writes to `security_prices` at parse time.** Promote-phase resolves `ticker → security_id` via the just-upserted `securities` rows and bulk-upserts into `security_prices` (`source='quicken'`, `import_batch_id` set) in batches of 5,000. Idempotent on `(security_id, price_date) UNIQUE`. Trivial volume for PostgreSQL (~30 MB).

### 5.6 Parse-phase write contract

To make the parse-phase invariant explicit: **a parse pass writes to exactly four staging tables plus the batch-master row**, all under the same `import_batch_id`:

1. `quicken_import_batches` — one row, upserted at parse start (`status='parsing'`) and updated on finish (`status='parsed'`, `parsed_at=NOW()`)
2. `quicken_staging` — cash rows + split parents/children
3. `quicken_securities_staging` — investment events
4. `quicken_security_master_staging` — `!Type:Security` blocks
5. `quicken_price_staging` — `!Type:Prices` blocks

Plus one **on-disk artifact** (not a table): the reconciliation report at `quicken-import/<batch>/report.{html,json}`.

Parse does **not** touch `transactions`, `securities`, `security_lots`, `security_transactions`, `security_lot_disposals`, `security_prices`, `account_source_mappings`, `security_source_mappings`, `transfer_match_groups`, or `quicken_calibration_audit`. Those are promote-only writes.

### 5.7 Single-pass parser with block-type dispatch

The parser does one scan per QIF. Each `^`-delimited block routes to a staging table based on the most recent `!Type:` header seen:

| Header in effect | Block routes to |
|---|---|
| `!Type:Cash` / `!Type:Bank` / `!Type:CCard` / `!Type:Oth A` / `!Type:Oth L` | `quicken_staging` |
| `!Type:Invst` | `quicken_securities_staging` (investment events) and/or `quicken_staging` (cash side of `XIn`/`XOut`/`Cash`/`MargInt`) per the §5.3 mapping table |
| `!Type:Security` | `quicken_security_master_staging` |
| `!Type:Prices` | `quicken_price_staging` |

Block order within a file is irrelevant because cross-block resolution (ticker → `security_id`, security name → mapped account) is deferred to promote. The previously-considered two-pass design was overkill: it added a re-read of the 16.8 MB `fidelity_stk_w_sec.QIF` without buying anything the staging-tables architecture didn't already provide.

If a future Quicken export does interleave `!Type:Security` and `!Type:Prices` in unusual order, the single-pass parser still gets the right result because both go to staging and promote-phase upserts the security master before resolving prices.

### 5.8 Reconciliation outputs at parse time

The parse pass writes nothing to `transactions` or `security_*`. It writes only to staging tables and emits one JSON reconciliation report per import batch:

- Per-account row counts, date range, currency mix
- Distinct Quicken account names, category names, security names (drives mapping)
- Distinct investment action types + frequencies
- Detected transfers (one row per `transfer_target_account` pairing)
- Detected splits (count of multi-S parents)
- Price block coverage per security (date range, row count, density)
- Currencies seen, with FX-coverage gap report against `budget_fx_rates`

---

## 6. Workflow

### 6.1 Phase 1 — Parse (idempotent)

```
quicken-import parse --files './quicken-exports/*.qif' --batch <uuid>
```

- Streams each QIF through the single-pass block-dispatch parser (§5.7) into the four staging tables under one `import_batch_id`.
- Re-running with the same batch id wipes prior staging rows for that batch first (across all four staging tables).
- Writes **only** to the four staging tables (§5.6 — parse-phase contract). No touches to `transactions`, `securities`, `security_*`, or mapping tables.
- Emits reconciliation report (HTML + JSON) at `quicken-import/<batch>/report.html`.

### 6.2 Phase 2 — Map (admin UI)

`/admin/quicken-import/:batch` shows three mapping panels, each surfacing unmapped distinct names from staging with fuzzy-match suggestions:

- **Accounts** — Quicken account → COA account (writes `account_source_mappings` with `source='quicken'`)
- **Categories** — Quicken category → P&L leaf account (same table, since CR013 collapsed categories into accounts)
- **Securities** — Quicken security name → `securities.id`. This panel **owns** the securities-master upsert: when the user accepts a row, the importer (a) upserts the `securities` row from `quicken_security_master_staging` data (idempotent on ticker, then name; creates a new row only if no existing row matches), (b) writes the `security_source_mappings` row with `source='quicken'`, and (c) writes the resolved `securities.id` back to `quicken_security_master_staging.promoted_security_id`. Promote step 1 (§6.4) is then a no-op reconciliation: it asserts every staging row has `promoted_security_id` set and fails-loud if any are missing.

A fourth tab shows **FX gaps** — currencies × months in the import range missing a `budget_fx_rates` entry, with a one-click "Seed from ECB CSV" action.

Promote is blocked until every distinct staged name has a mapping and FX gaps are zero. Mapping changes are persistent (used by future Quicken-source imports too).

### 6.3 Phase 3 — Promote review

`/admin/quicken-import/:batch/promote` shows pre-flight diff:

- Per-account: dry-run row counts, computed cutoff date (earliest existing PS transaction in target COA account), how many staging rows fall before the cutoff (will insert), how many fall after (will skip).
- Transfer pair count + pair list (deduped across files).
- Lot inventory preview: open lots at cutoff per security, total cost basis, count of disposals to record.
- Basis disagreements: Quicken-stored basis vs arithmetic, list of lot ids with deltas.
- Mark-to-market notice: no MTM transactions will be created; investment-account historical balances will be computed by Balance Trends via `lots × price` once CR020's price feed is online.

A single "Promote" button commits everything in one DB transaction.

### 6.4 Phase 4 — Promote (atomic)

Per `import_batch_id`. The CLI runs **two sequential DB transactions**:

- **Work transaction** (steps 0–10): all data writes (`transactions`, `security_*`, `accounts.opening_balance`, `transfer_match_groups`, `quicken_calibration_audit`, plus the final `quicken_import_batches` update to `status='promoted'`). On any failure inside, the entire work transaction rolls back wholesale — leaving the database exactly as it was pre-promote.
- **Status transaction** (failure path only): after the work transaction has been rolled back, a separate small transaction updates `quicken_import_batches` to `status='failed'` with `failure_reason` set. This update must be in its own transaction precisely because the work transaction's rollback would otherwise discard it, leaving the batch in a misleading `promoting` state with no failure trail.

Pseudo-code:

```js
try {
  await db.transaction(async (tx) => { /* steps 0–10, incl. status='promoted' */ });
} catch (err) {
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE quicken_import_batches SET status='failed', failure_reason=$1, updated_at=NOW() WHERE id=$2",
      [String(err.message).slice(0, 8000), batchId]
    );
  });
  throw err;
}
```

On success the single work transaction has already finalized the batch — no second transaction needed.

**Invariants the structure enforces:**

- **Split parents are metadata-only.** Rows in `quicken_staging` where `L--Split--` was the parent header have `split_parent_id IS NULL`; their child rows carry `split_parent_id` pointing at the parent. Only children are inserted into `transactions`. No code path can promote both parent and children, so double-counting is structurally impossible.
- **Cash legs have two origins.** Cash rows in `transactions` come from either (a) `quicken_staging` rows that were genuine cash-account QIF rows, or (b) cash legs synthesized at promote from `quicken_securities_staging` rows per the §5.3 mapping (e.g., a Buy emits a neutralized pair, a Div emits a single credit). Step 2 handles (a); step 3 handles (b). They never overlap.
- **1→1 transfer model (pivot, see §8.2 for full rationale).** Each transfer row in `quicken_staging` becomes a **single** transaction on the origin BS leaf with a transfer-category category. No target-side fanout. Cross-currency pairs are recognized post-hoc by Transfer Analysis's `base_amount` matching with category-aware tolerances (1% for `Transfer - FX`, exact for others). Auto-matching runs as step 11 inside the work transaction.

**Steps:**

0. **Snapshot pre-promote balances.** For each COA account that will receive imported transactions, capture today's calculated balance (`opening_balance + SUM(transactions)`) into a temp table `_pre_promote_balances(account_id, balance)`. Used by step 9 to verify that today's balance is unchanged after promote.

1. **Reconcile securities master** — Phase 2's Securities mapping panel is the sole upserter for `securities` and `security_source_mappings` rows (see §6.2). This step is an idempotent reconciliation: assert that every `quicken_security_master_staging` row in this batch has `promoted_security_id` set and that the referenced `securities.id` exists. Fail-loud if any are missing (means the user advanced to promote without completing the mapping panel — should not be reachable through the UI, but defensive). No writes to `securities` happen at promote.

2. **Insert direct cash transactions** from `quicken_staging` — **1→1 model**. Each non-parent staging row produces exactly one row in `transactions` on the origin's mapped BS leaf:
   - **Standalone non-split, non-transfer:** `account_id = origin BS leaf, category_id = mapped P&L leaf, amount = row.amount` (signed from origin's perspective). `base_amount` resolved via `budget_fx_rates(currency, year, month)` for non-USD.
   - **Split child** (`split_parent_id IS NOT NULL`): same shape as standalone. Split parents are skipped. **Pre-insert assertion:** for every split parent in scope, `SUM(child.amount) == parent.amount` within 1¢ — abort on mismatch.
   - **Transfer** (`transfer_target_account IS NOT NULL`): one row only — `account_id = origin BS leaf, amount = row.amount`. The category resolution is role-aware:
     - If the target's mapping is itself a transfer-category leaf (`is_transfer=TRUE`, user explicitly picked the category for a target-only name) — use it directly.
     - Else the target maps to a BS leaf (origin/both role) — derive the category via §8.2.3 (branch + currency comparison; cross-currency wins → `Transfer - FX`).
     - **No target-side row is created.** Pairs that span QIF files are recognized in step 11 by the auto-matcher, not by fanout. This eliminates the cross-currency bug where a single staging row's currency leaked onto the target leaf.
   - Cutoff (§8.1) is applied per-row against the origin account only. No "drop pair as a unit" — pairs are now logical-only via post-hoc matching.

3. **Synthesize investment cash legs.** For each `quicken_securities_staging` row, emit the cash side(s) per the §5.3 action mapping:
   - Buy/BuyX/Sell/SellX → 2 rows (neutralized pair, "Transfer - Securities Trades" category)
   - Div/DivX/IntInc/IntIncX/CGShort/CGLong/CGMid/MiscInc/MiscExp → 1 row (mapped income/expense category)
   - ReinvDiv/ReinvLg/ReinvSh/ReinvMd/ReinvInt → 3 rows (dividend/realized-gain income + neutralized buy pair)
   - StkSplit → 0 rows
   - XIn/XOut → 2 rows (transfer pair on origin + mapped counterparty account; shared transfer-group id captured for step 4)
   - Cash → 1 row (mapped category)
   - MargInt → 1 row (Margin Interest expense)
   - ShrsIn/ShrsOut → 0 rows
   - ShtSell/CvrShrt → 1 row ("Options Trading" leaf)
   - RtrnCap → 1 row ("Return of Capital" leaf under Transfers)

   All synthesized rows carry `source='quicken-import'`, `accepted=true`, `import_batch_id`, and `base_amount` resolved per the FX rules. The **primary** cash leg per source row (the one that represents the dominant economic event — the debit for Buys, the income credit for Divs/ReinvDivs, the credit for Sells) is written back to `quicken_securities_staging.promoted_cash_tx_id` so step 5 can stamp `cash_transaction_id` on the corresponding `security_transactions` row. The transfer pair from XIn/XOut shares a synthetic group id with the relevant step 2 entries.

4. **(Deleted under the 1→1 pivot.)** Step 4 previously auto-created `transfer_match_groups` for every fanout pair. With 1→1, pair recognition is post-hoc via Transfer Analysis (step 11 below). `transfer_match_groups` is now reserved for user-curated manual pairings created via the Transfer Analysis UI after promote — those carry a `note` and `audit_provenance` from the user's action and are not touched at promote time.

5. **Build security events, lots, and disposals.** First, apply the **per-account cutoff** to `quicken_securities_staging` rows: drop any row whose `transaction_date >= cutoff` for the staged Quicken account's mapped target (same cutoff used in step 2 per §8.1, including any per-account overrides). This prevents Quicken-era investment events that overlap PS coverage from being double-counted in `security_transactions`. Pre-flight diff surfaces a separate row: "N investment events dropped because they overlap PS coverage."

    Then walk the remaining `quicken_securities_staging` rows in `(security_id, transaction_date, source_line)` order:
   - Emit one `security_transactions` row per staging row that has a security-side per §5.3 (BUY, SELL, DIVIDEND, DIVIDEND_REINVEST, SPLIT, TRANSFER_IN, TRANSFER_OUT, INTEREST, MISC). Set `import_batch_id` and `cash_transaction_id` from `promoted_cash_tx_id` (step 3).
   - Maintain an in-memory open-lots ledger per `(account_id, security_id)`. On Buy/BuyX, push a new lot. On Sell/SellX, close lots — preserve the `quicken_lot_id` if QIF specified one, else FIFO; record cost basis used in `security_lot_disposals` (with `import_batch_id`). On StkSplit, multiply `shares` and divide `cost_per_share` for every open lot. On ShrsIn/ShrsOut, transfer lots between accounts (preserve basis, dedupe cross-file via §8.3).
   - **Persist every lot the walker created** to `security_lots` with `source='quicken'` and `import_batch_id`, regardless of final state. Lots fully closed by a Sell during the walk get `status='closed'`; lots still holding shares at the end of the walk get `status='open'`. Persisting closed lots is required because `security_lot_disposals.lot_id` is a FK pointing at the lot row consumed by the disposal — without the row, the disposal can't be linked and realized-gain history would be unrecoverable.

6. **Mark handoff.** For each investment account, compute `last_promoted_date = MAX(transaction_date)` from the `transactions` rows just inserted **for that account**. Set `handoff_marker=true` on every `security_lots` row in this batch where `status='open'` and `account_id` matches. Lots closed before `last_promoted_date` are unaffected. (Using promoted-date, not staged-date, so the §8.1 per-account cutoff is respected: lots open as of a Quicken record that was dropped because PS already covers that date don't get marked.)

7. **Insert price history** from `quicken_price_staging` → `security_prices` in 5,000-row batches with `source='quicken'`, `import_batch_id` set, idempotent on `(security_id, price_date) UNIQUE`. Ticker → `security_id` resolution uses the `securities` rows that Phase 2 upserted (§6.2) and that step 1 reconciled.

8. **Recalibrate `accounts.opening_balance`.** For each COA account that received imported transactions in steps 2 or 3, compute `delta = SUM(amount)` from those rows, then `opening_balance := opening_balance - delta`. Insert one row per touched account into `quicken_calibration_audit` (`import_batch_id`, `account_id`, `delta_amount`). Preserves the post-migration `opening_balance_date` sentinel of `'1990-01-01'` (per §9). The intent: today's calculated balance is unchanged; historical balances now reflect the imported activity.

9. **Verify balance invariant.** For each account in `_pre_promote_balances`, compute today's post-promote calculated balance and assert equality with the snapshot within 1¢. Roll back on any mismatch (with the offending account ids surfaced in `failure_reason`).

10. **Auto-match transfers (Q5 pivot addition).** Run the same matching logic as `/api/v2/transactions/transfer-analysis` (in `server/src/v2/routes/transactions.js:131`) over the batch's transaction date range, against ALL unmatched `is_transfer=TRUE AND skip_transfer_analysis=FALSE` transactions in that window (Quicken AND PS-era). Match by category:
    - **`Transfer - FX` / `FX`**: 1% `base_amount` tolerance, ±1 day
    - **Other transfer categories**: exact `base_amount` (within $0.01), ±5 days

    Set `transfer_matched=TRUE` on auto-matched pairs. Returns counts surfaced in the promote result (`autoMatched`, `unmatched`). Same logic, same outcome — wrapping at promote time eliminates a "go to TA and run analyze yourself" step the user would otherwise have to repeat for every batch.

11. **Finalize batch.** Update `quicken_import_batches` row: `status='promoted'`, `promoted_at=NOW()`. This is the last write of the work transaction. The work transaction then commits. Failure-status update is handled by the outer two-transaction wrapper (see preamble above).

### 6.5 Rollback contract

```
quicken-import rollback --batch <uuid>
```

The rollback runs in one DB transaction. It fails-loud (no partial rollback) if any pre-flight check trips.

#### 6.5.1 Pre-flight checks (refuse to proceed on any failure)

1. **Batch is in `promoted` state** — refuse if status is anything else (parsing / parsed / mapped / promoting / rolled_back / failed).
2. **No external references to this batch's lots** — refuse if any `security_lot_disposals` row has a `lot_id` pointing at a `security_lots` row in this batch **but the disposal itself is not in this batch**. Catches the CR020-era case where a Fidelity import partially closed a Quicken-opened lot — rolling back would orphan the Fidelity disposal. User must either undo the dependent activity first or accept that this batch is no longer cleanly removable.

(`securities` master rows introduced by this batch are not pre-flight checked — §6.5.4 preserves them on rollback as inert master data, so there is no orphan risk.)

#### 6.5.2 Deletions (in dependency order)

1. `transfer_match_group_members` for groups in this batch (CASCADE from FK on the parent group; explicit for clarity).
2. `transfer_match_groups WHERE import_batch_id = <uuid>`.
3. `security_lot_disposals WHERE import_batch_id = <uuid>`.
4. `security_lots WHERE import_batch_id = <uuid>`.
5. `security_transactions WHERE import_batch_id = <uuid>`.
6. `security_prices WHERE import_batch_id = <uuid>`.
7. `transactions WHERE import_batch_id = <uuid>`.

#### 6.5.3 Calibration reversal

For each row in `quicken_calibration_audit WHERE import_batch_id = <uuid>`:

```sql
UPDATE accounts SET opening_balance = opening_balance + delta_amount WHERE id = ?
```

Then `DELETE FROM quicken_calibration_audit WHERE import_batch_id = <uuid>`. Verification step asserts `accounts.opening_balance + SUM(remaining transactions)` equals the pre-rollback calculated balance per touched account, with 1¢ tolerance.

#### 6.5.4 Intentionally preserved (not rolled back)

These are deliberate design choices, not gaps:

- **`securities` master rows** introduced by this batch — preserved as inert master data. Rationale: rolling back would risk deleting rows that other (later, non-Quicken) batches may have come to reference. The master row alone has no balance-sheet or P&L impact.
- **`account_source_mappings`** and **`security_source_mappings`** added during Phase 2 — preserved so the user doesn't lose mapping work on rollback-and-retry (mapping 600+ securities is hours of work). The user can manually delete mapping rows from the admin UI if a clean slate is genuinely wanted.
- **`opening_balance_date` sentinel** (lowered from 2000-01-01 to 1990-01-01 in migration 022) — schema-level change, not per-batch. Stays at 1990-01-01.
- **Staging tables** (`quicken_staging`, `quicken_securities_staging`, `quicken_security_master_staging`, `quicken_price_staging`) — preserved for inspection and to enable re-promote without re-parsing.

#### 6.5.5 Batch row finalization

Update `quicken_import_batches`: `status='rolled_back'`, `rolled_back_at=NOW()`.

#### 6.5.6 Re-promote after rollback

A rolled-back batch can be re-promoted by re-running the promote step. Staging rows are still there; mapping rows are still there; only the materialized data was removed. The new promote gets a fresh set of `transactions` ids, `security_*` ids, and a new `quicken_calibration_audit` entry. The batch row's `promoted_at` is updated again (overwrites the original), and `rolled_back_at` is cleared.

---

## 7. UI Pages

| Route | Page | Description |
|-------|------|-------------|
| `/admin/quicken-import` | `QuickenImportList` | List of all batches with status (parsed/mapped/promoted/rolled-back) and quick links |
| `/admin/quicken-import/:batch` | `QuickenImportBatch` | Reconciliation report + three mapping panels (Accounts / Categories / Securities) + FX gap panel |
| `/admin/quicken-import/:batch/promote` | `QuickenImportPromote` | Pre-flight diff, basis disagreements, single Promote button |
| `/admin/securities` | `SecurityMaster` | Manage `securities` and `security_source_mappings` (shared with CR020) |

No mobile UI — admin tooling, desktop only.

---

## 8. Dedupe Rules

### 8.1 Cash transactions

**Per-account soft cutoff against PocketSmith-era data only.** For each `target COA account` resolved via mapping, find:

```sql
SELECT MIN(transaction_date)
FROM transactions
WHERE account_id = $target_account_id
  AND source IN ('pocketsmith', 'auto-offset');
```

The allow-list values are verified against the live codebase as of CR019 drafting (`ingestPs.js:178` stamps `'pocketsmith'`; `transactions.js:499` stamps `'auto-offset'` on neutralize partners). `'manual'` is deliberately excluded — manual rows are corrections or one-offs, not coverage; one stray manual entry from a historical date could otherwise shift the cutoff back by years and silently drop legitimate Quicken history.

Drop staged cash rows with `transaction_date >= cutoff`. Rationale for the allow-list (rather than `source != 'quicken-import'` exclude-list): prevents any future imported source, future manual-bulk-import, or calibration-tooling row from accidentally narrowing the cutoff.

#### 8.1.1 Per-account override

The auto-detected cutoff can be sensitive to outliers: if PS happens to have a single backfilled row from years before its solid coverage starts, `MIN(date)` returns the outlier date and drops most of the Quicken history. To mitigate:

- Pre-flight diff shows, **per account**: auto-detected cutoff, count of PS rows in the 90 days before that cutoff (so an isolated outlier is visible — `0` means "this one row is the only thing before solid coverage starts"), count of staged rows kept, count of staged rows that would be dropped, and a sample of the 5 newest dropped rows.
- An optional **override cutoff** field accepts a later date. If set, the importer uses `MAX(auto_cutoff, override_cutoff)` so the user is always strictly more permissive than the auto-detect — never accidentally less permissive.
- Overrides are persisted on the `quicken_import_batches` row (new JSONB column `cutoff_overrides`) so re-promote after rollback uses the same overrides without re-entry.

#### 8.1.2 Edge cases

- **NULL cutoff** (account has zero PS-era rows): entire Quicken history for that account is imported untruncated. Flagged in the diff so the user can sanity-check.
- **Account exists in Quicken but not in COA**: caught earlier by the mapping panel (§6.2). Promote is blocked until every distinct Quicken account name has a mapping or is explicitly archived.
- **Account exists in COA but Quicken QIF has no rows for it**: no cutoff calculation needed; account is simply absent from the diff.

### 8.2 Transfers — 1→1 model + post-hoc matching (pivot 2026-05-29)

**The shape of this section changed substantially.** The original draft used a 1→2 fanout at promote (one staging row → debit on origin + credit on target) with cross-file dedupe matching (§8.2.1) to collapse mirrors. That design broke on **cross-currency transfers**: amounts in PKO's PLN file (`-100 PLN to [Chase]`) and Chase's USD file (`+25 USD from [PKO]`) are real and independent (each account stores its own currency at the historical FX rate Quicken used), but ABS-amount matching can't pair them, and single-row fanout leaks the origin's currency onto the target leaf.

The pivot brings Quicken transfers into the same model PocketSmith data already uses:
- Each Quicken row → **one** transaction with `account_id = origin BS leaf, category_id = transfer-category leaf` (see §8.2.3 for picking the category).
- **No target-side fanout** at promote. The "other side" of any cross-file pair is the other file's own row when that file is also parsed.
- **Post-hoc matching** by Transfer Analysis (`/api/v2/transactions/transfer-analysis`, `routes/transactions.js:131`) pairs them via `base_amount` comparison with category-aware tolerances:
  - `Transfer - FX` (and the legacy `FX` leaf): **1% `base_amount` tolerance, ±1 day** — the only category that survives cross-currency FX drift
  - All other transfer categories: exact `base_amount` within $0.01, ±5 days
- The matcher runs automatically at the end of promote (§6.4 step 11) so the user sees pre-matched results immediately, but it can also be re-run manually in the Transfer Analysis UI at any time.

**One-sided imports are now a first-class shape, not a bug.** If user parses pko.QIF but not chase.QIF, PKO's transfer rows land as **unmatched** Transfer-category transactions. Later when chase.QIF is parsed, Chase's rows land alongside; the next Transfer Analysis run pairs them. Until then, the unmatched count just sits in the Transfer Analysis view — no calibration drift, no orphan rows.

#### 8.2.1 (Deleted.) Cross-file dedupe / positional matching algorithm

Removed in the pivot. Each file's transfer rows are now independent — pairing happens at the Transfer Analysis layer based on `base_amount`, not at staging time based on amount equality. Duplicate-entry detection within a single file (two identical transfer rows from a Quicken data-entry error) still bubbles up as two unmatched transfer rows that the user can spot and reconcile in Transfer Analysis. The `transfer_match_groups.audit_provenance` column added in migration 022 is now used only by manual user-curated match groups created post-promote.

#### 8.2.2 (Deleted.) Cutoff interaction (drop pairs as a unit)

Removed in the pivot. With 1→1, only the origin row is created per staging row, so cutoffs are applied per-row against the origin account only. There's no "pair to drop as a unit" because there's no synthesized target-side row.

#### 8.2.3 Transfer-category resolution (per row, kept and extended)

Promote needs to pick **one** transfer-category leaf for each transfer row (the row's `category_id`). The resolution depends on the role of the `transfer_target_account` name's mapping:

- **Target mapped to a transfer-category leaf** (`is_transfer=TRUE`) — this is the `target_only` role case. User explicitly picked a transfer category (e.g., `Transfer - Historical` for a closed account they don't want to track separately, or `Transfer - Bank` if they know what it should be). Use the target's mapped account_id directly as the row's category_id. No derivation.
- **Target mapped to a BS leaf** (`is_transfer=FALSE`, `section='balance_sheet'`) — this is the `origin` or `both` role case. The target has its own QIF parsed (or maps to an existing live BS account). Walk both origin's and target's parent chains and pick a category via the priority table:

| If either side's account branch is… | Category |
|---|---|
| Mortgage / Loan | `Transfer - Mortgage` |
| Securities (Fidelity Stock, CVC Investments, Fidelity Fixed Income, …) | `Transfer - Securities Trades` |
| **Different base currencies** (e.g., USD ↔ PLN bank, USD ↔ EUR brokerage) | `Transfer - FX` |
| Business-flagged account (any side) | `Transfer - Business` |
| Otherwise (Bank ↔ Bank, Bank ↔ Credit Card, …) | `Transfer - Bank` |

Categories not present in the current COA are auto-created on promote with `is_transfer=TRUE` under the `Transfers` parent. Resolution is deterministic — same pair always picks the same category, so re-promote after rollback is stable.

The cross-currency check (different base currencies on the leaf accounts) is critical for matching: only `Transfer - FX` gets the 1% tolerance in §6.4 step 11, so cross-currency rows landing in `Transfer - Bank` would never auto-match.

**`Transfer - Historical`** is a new leaf seeded under Transfers (CR §8.4 Option J). It's the catch-all the user picks for target-only names whose actual currency they don't know yet. After they later parse the target's QIF, the role transitions (target_only → both) and they remap to the BS leaf; promote can then derive the proper category via §8.2.3 priority. Older promoted rows that landed on `Transfer - Historical` can be re-categorized in Transfer Analysis at any time.

### 8.3 Security transfers across QIF files

`ShrsIn` in account B and `ShrsOut` in account A on the same date with the same shares×security → one logical move. Dedupe key `(transaction_date, security, ABS(shares), {min(acct_a, acct_b), max(acct_a, acct_b)})`.

### 8.4 Historical Accounts — closed BS account consolidation

The user's Quicken file has ~50 accounts, but only ~20 are actively tracked today. The other ~30 are closed bank accounts, retired credit cards, refinanced mortgages, dormant brokerage cash — each with historical activity worth preserving but no need to appear in current Balance Sheet or Balance Trends reports as a live line item.

**Pattern:** Create one COA leaf per closed Quicken account under a dedicated `Historical Accounts` parent (one per BS side):
- `Assets / Historical Assets / <leaf per closed asset>` — closed banks, dormant brokerage cash, retired investment subaccounts
- `Liabilities / Historical Liabilities / <leaf per closed liability>` — retired credit cards, paid-off mortgages

Each leaf:
- Carries its own currency (matching the Quicken account)
- Receives a 1:1 mapping (`quicken_account_name → this leaf`)
- Accumulates its own opening_balance recalibration via §6.4 step 8 (math is self-consistent per-leaf since the leaf is single-currency)
- Is **soft-deleted** after promote (`is_active=FALSE`) — the existing soft-delete mechanism (`DELETE /api/v2/accounts/:id`) flips the flag

**Why `is_active=FALSE`:** the codebase already filters on `a.is_active = TRUE` in every BS-aggregation query, Balance Trends, account picker, and Forecast actuals (verified against `server/src/v2/repositories/accounts.js`, `server/src/v2/routes/reports.js`, `server/src/v2/routes/accounts.js`, `server/src/v2/repositories/forecast.js`). Deactivating the leaf hides it from all default reports while preserving the underlying data — a `SELECT opening_balance + SUM(amount) FROM transactions JOIN accounts WHERE id = <leaf>` query still returns the historical balance at any date. Toggling `is_active=TRUE` (via COA Management) brings the leaf back into reports if you ever want to inspect.

**Two bootstrap children** are seeded along with the parents (`Closed Cash (default)` under Historical Assets, `Closed Debt (default)` under Historical Liabilities). They serve two purposes:
1. They make the Historical parents non-leaves so they show up in the Create-COA modal's parent picker (the `isLeaf` detector requires at least one child)
2. They double as "default umbrella" leaves for genuinely trivial closed accounts (1–3 transactions, $0 closing balance) where individual leaves would be overkill — the user can map those to the default catch-all and skip the per-account-leaf work

**Bulk UI:** the mapping panel supports multi-row selection and two bulk actions:
- **Bulk-create-and-map** — for N selected Quicken-name rows, create N new leaves under a chosen parent (name = each Quicken name, currency = each Quicken row's currency or parent default) and map each Quicken name to its new leaf in a single batch
- **Bulk-deactivate** — for N selected rows whose mapping targets are leaves you want hidden post-promote, soft-delete the target leaves (calls `DELETE /api/v2/accounts/:id`)

Together they reduce the workflow for 25 closed accounts from ~75 modal interactions to two or three batch actions.

**Interplay with the §8.2 1→1 pivot.** Option J still applies when you want **per-account year-end balance history** for a closed account — you parse its QIF, map it to its own leaf under Historical Assets/Liabilities, promote, then soft-delete the leaf. For closed accounts you **don't** care to track separately (no QIF parsed, no balance history needed), the alternative is the role-aware mapping path: the `transfer_target_account` name takes role `target_only`, the picker restricts to transfer-category leaves, and you map it to `Transfer - Historical` (or a more specific transfer leaf like `Transfer - Bank` if you know the type). Promote's 1→1 step emits a single transaction on the originating BS leaf (your active account) categorized as a transfer; nothing lands on the closed side because no QIF parses it. This second path produces no per-closed-account balance trail but keeps the originating account's history accurate and clean — a sensible default for accounts that hold no meaningful history.

**Convention, not enforcement.** Nothing in the system requires this pattern. A user could map closed Quicken accounts to a single P&L umbrella (an earlier draft considered this — Option C), or keep them as active BS leaves. The Historical Accounts pattern is the recommended workflow because it preserves per-account year-end-balance fidelity without polluting reports — but other approaches remain valid.

---

## 9. Balance Math & Calibration

The existing balance formula (`opening_balance + SUM(transactions WHERE date BETWEEN opening_balance_date AND asOfDate)`) handles back-dated transactions correctly because `opening_balance_date='2000-01-01'` (set by [migration 016](../../server/db/migrations/016_opening_balance.sql)) predates anything in the import.

But importing new transactions retroactively grows `SUM(transactions)`, shifting today's calculated balance away from reality. Promote step §6.4 step 8 fixes this by adjusting `opening_balance`:

```
new_opening_balance = old_opening_balance - SUM(imported transactions for this account)
```

Net effect on today's calculated balance: zero. Net effect on historical-date calculated balance: now correctly reflects the imported flows.

**Pre-2000 data confirmed** in user's sample (`fidelity_stk.QIF` earliest record is 1998-03-21). Migration 022 therefore lowers the sentinel: `UPDATE accounts SET opening_balance_date = '1990-01-01' WHERE opening_balance_date = '2000-01-01'`. Recalibration in §6.4 step 8 still applies; the sentinel change alone is balance-neutral because no transactions exist in the `[1990-01-01, 2000-01-01)` window today.

---

## 10. Mark-to-Market for Historical Investment Accounts

**No MTM transactions are synthesized.** This is the key insight from coordinating with CR020:

- Pre-2022: investment-account historical valuation = `SUM(open_lots × close_price_at_date)` computed live from `security_lots` + `security_prices`. Balance Trends ([CR020 §9.2](CR020_STOCK_INVESTMENT_MODULE.md#92-balance-trends-report-cr018)) drills via this path when a single investment account is selected.
- Post-2022: existing convention continues — user records monthly mark-to-market entries against a holding-value account; brokerage `opening_balance` is calibrated to total market value.

The two regimes meet cleanly at the cutover: pre-cutover brokerage cash-position is implicit in the neutralized Buy/Sell pairs (zero net cash impact), and total market value at the cutover equals the calibration anchor inherited from the PS era.

---

## 11. Mapping Layer

### 11.1 Reuses `account_source_mappings`

Migration 019's comment block already calls out future Quicken support. The `UNIQUE(source, external_name)` constraint prevents conflicting mappings; the seed insert pattern from migration 019 is the template for the seeding script here (just with `source='quicken'`).

After CR013 (migration 021) collapsed `categories` into `accounts`, the same table covers both balance-sheet account mapping and P&L category mapping — Quicken category names map to `accounts` rows where `section='profit_loss'`. The admin UI surfaces them in separate panels for ergonomics but writes to the same table.

### 11.2 Adds `security_source_mappings`

New table per CR020 §4, populated with `source='quicken'` rows during the mapping phase. Quicken security names tend to be inconsistent ("APPLE INC" vs "Apple Inc" vs "AAPL" depending on era) — the admin UI dedupes case-insensitive name variants when proposing matches.

### 11.3 Fail-loud on unmapped

Promote is blocked if any distinct staged name lacks a mapping row. Rationale: silent fallback to "Uncategorized" or auto-create would propagate noise through balance and trend reports invisibly.

---

## 12. FX Handling

### 12.1 Forward-direction usage

For each non-USD staged cash row, at promote time:

```sql
SELECT rate FROM budget_fx_rates
WHERE currency = $1 AND year = $2 AND month = $3
```

`base_amount = amount / rate` (per migration 004 comment). Missing rate → promote fails with the gap surfaced in the FX panel.

### 12.2 Seeder script

```
quicken-import seed-fx --csv ecb-eur-usd.csv --currency EUR
```

ECB publishes monthly average EUR/USD and EUR/PLN series in CSV. The script converts ECB's EUR-base rates to USD-base where needed (`USD_per_X = EUR_per_X / EUR_per_USD`) and upserts `budget_fx_rates` rows. Idempotent.

### 12.3 Investment accounts

CR020 §2 non-goal: "Multi-currency portfolio support in v1." So this CR's investment side assumes USD only (matches user's ~99% Fidelity, US-listed). Any non-USD security found is logged and skipped with a reconciliation warning.

### 12.4 Confirmed FX needs from sample

- **PKO (Cash account)** — entirely PLN. First transaction 2014-06-19; opening balance 1,500,000.00 PLN. Need ECB PLN/USD monthly rates for **2014-06 through last PKO transaction date** (~135 monthly rows). One seed-from-CSV invocation.
- **Fidelity** — USD; no FX rows needed.
- **Other Quicken accounts** — TBD; reconciliation pass will enumerate currencies before seeding.

---

## 13. Source Tagging

| Table | Column | Value |
|-------|--------|-------|
| `transactions` | `source` | `'quicken-import'` |
| `transactions` | `import_batch_id` UUID (nullable, new column) | populated on every Quicken-imported row; required for rollback |
| `transfer_match_groups` | `import_batch_id` UUID (nullable, new column) | populated on every group created during promote step 4; required for rollback |
| `security_transactions` | `source` | `'quicken'` |
| `security_transactions` | `import_batch_id` UUID (nullable, new column) | populated when source = quicken |
| `security_lots` | `source` | `'quicken'` |
| `security_lots` | `import_batch_id` UUID (nullable, new column) | populated when source = quicken |
| `security_lot_disposals` | `import_batch_id` UUID (nullable, new column) | populated when the parent disposal originated from a Quicken Sell |
| `security_prices` | `source` | `'quicken'` |
| `security_prices` | `import_batch_id` UUID (nullable, new column) | populated when source = quicken |
| `account_source_mappings` | `source` | `'quicken'` |
| `security_source_mappings` | `source` | `'quicken'` |

---

## 14. Implementation Phases

| Phase | Scope | Effort |
|-------|-------|--------|
| **A — Migration + reconnaissance** | `022_quicken_import.sql`; parser walks QIFs and emits the reconciliation report only (no inserts, no admin UI yet). Confirms action-type coverage, FX needs, security-name landscape. | S |
| **B — Cash path** | Parser → `quicken_staging`; admin UI for Accounts + Categories mapping; promote for bank/CCard/loan accounts; transfer pairing; split expansion; calibration. Investment accounts skipped. | M |
| **C — FX seeding** | ECB CSV seeder; FX gap panel in admin UI. | XS |
| **D — Investment parser** | Investment-account parser → `quicken_securities_staging`; admin UI for Securities mapping; price-block parsing into `security_prices`. | M |
| **E — Lot inventory + promote** | Chronological lot walker, FIFO + specific-lot logic, `security_lot_disposals` generation, `handoff_marker` setting, basis disagreement report. | M |
| **F — Rollback + audit** | Rollback CLI, audit-log table for calibration deltas, batch listing UI. | S |
| **G — Tests + fixtures** | Per-action fixture QIFs, parser unit tests, promote integration test (mini end-to-end with a 3-account 50-row fixture). | M |

Phases B and C parallelizable. D depends on A. E depends on D. F depends on B (and ideally E). G runs alongside throughout.

---

## 15. Test Strategy

### 15.1 Test infrastructure

| Surface | Runner | Location | Run command |
|---|---|---|---|
| Backend (parser, promote, FX) | Jest (existing per `server/jest.config.js`) | `server/src/v2/scripts/__tests__/` and `server/src/v2/routes/__tests__/` | `cd server && npm test` |
| Frontend (admin UI panels, fuzzy matcher) | Vitest (existing per CR016) | `frontend/src/pages/__tests__/`, `frontend/src/utils/__tests__/` | `cd frontend && npm test` |
| Migration | psql verification + smoke script | `server/src/scripts/smoke-after-022.js` (new, mirrors `smoke-after-021.js`) | `node server/src/scripts/smoke-after-022.js` |

**Fixture QIFs** live under `Samples/quicken/fixtures/` (new directory; the existing user-data files in `Samples/quicken/` are NOT used as test fixtures — those are too large and personal). Each fixture is small (5–30 records), self-contained, and exercises one specific scenario. Fixture file naming: `<scenario>_<account>.QIF`, e.g. `splits_cash.QIF`, `transfer_a_to_b.QIF`, `buy_sell_fifo.QIF`.

### 15.2 Per-phase test coverage

| Phase | Required tests | Fixture(s) |
|---|---|---|
| **A — Migration** | `smoke-after-022.js`: SQL queries assert 12 tables exist, 4 columns added, 4 COA leaves seeded, sentinel update applied, default changed, FKs resolve. Exit non-zero on any failure. | none |
| **B — Cash parser** | Per-action unit tests: simple cash row, split row (parent+children sum check), transfer row (bracket detection → `transfer_target_account`), both date formats (`M/D'YY` and `M/D/YY` with leading-space variants), cleared status pass-through. Idempotency: re-parsing same batch wipes prior staging rows first. | `cash_simple.QIF`, `splits_cash.QIF`, `transfer_a_to_b.QIF`, `dates_mixed.QIF` |
| **C — FX seeding** | ECB CSV → `budget_fx_rates` upsert: idempotency (re-run same CSV is no-op), date-range coverage matches CSV input, currency code preserved. | `ecb_eur_usd_2014.csv` (small slice) |
| **D — Investment parser** | Per-action unit tests for each entry in §5.3 frequency table that appears in user data: Buy, Sell, Div, ReinvDiv, ReinvLg, IntInc, CGShort, CGLong, StkSplit, ShrsIn, XIn, XOut, Cash, MargInt, RtrnCap, ShtSell, CvrShrt. Each asserts the right shape lands in `quicken_securities_staging` (and / or `quicken_staging` for cash-only actions per §5.3). | `inv_<action>.QIF` (one per action) |
| **E — Promote — Cash** | Snapshot pre-promote balance; run promote against a fixture batch; assert post-promote balance unchanged within 1¢; assert calibration audit row delta equals `-SUM(imported)`; assert split-parent assertion fires when children don't sum (negative test); assert transfer fanout emits 2 rows with shared group id. | `cash_simple.QIF`, `splits_cash.QIF`, `splits_bad_sum.QIF`, `transfer_a_to_b.QIF` |
| **E — Promote — Investment** | Per-action: Buy creates 1 lot + 2 cash rows + 1 security_transactions row; Sell with explicit lot_id closes the right lot + writes disposal; Sell without lot_id closes FIFO + writes disposal; StkSplit halves cost_per_share / doubles shares on every open lot for the security; ReinvDiv creates 3 cash rows + 1 lot + 1 security_transactions row; cash_transaction_id linkage verified per CR020 §14 item 5. | `buy_sell_fifo.QIF`, `buy_sell_speclot.QIF`, `stksplit_2for1.QIF`, `reinvdiv.QIF` |
| **E — Promote — Cost basis** | Fixture with Quicken-stored basis differing from arithmetic by $0.10 / $1.50: assert stored basis wins, $0.10 case is below $1.00 threshold so doesn't appear in disagreement report, $1.50 case does. | `basis_disagree.QIF` |
| **E — Promote — RtrnCap** | Cash row lands under "Return of Capital" leaf (verify `is_transfer=TRUE`, `skip_transfer_analysis=TRUE`); `findTransfers` query excludes RtrnCap rows; reconciliation warning emitted. | `rtrncap.QIF` |
| **F — Rollback** | Full lifecycle test: parse → map → promote → rollback. Pre-flight check refuses rollback when external disposal references batch's lot (inject a synthetic non-batch `security_lot_disposals` row first). Calibration reversed: `opening_balance` returns to pre-promote value. `transfer_match_groups WHERE import_batch_id=X` returns 0 rows. Securities and mapping rows are preserved (intentional per §6.5.4). Re-promote works after rollback. | `cash_simple.QIF` + scripted external-disposal injection |
| **G — Promote atomicity** | Inject a FK violation mid-promote (e.g., a `quicken_securities_staging` row referencing an unmapped Quicken account name that survived to promote step 6). Assert full rollback of work transaction; assert separate failure-status transaction wrote `status='failed'` with `failure_reason` set. | `synthetic_fk_violation` (in-test row construction, no fixture file needed) |

### 15.3 Smoke test pattern

`smoke-after-022.js` follows `smoke-after-021.js`'s structure: `BASE_URL` env var, axios or fetch calls against the live server, plain assertions, exit non-zero on failure. It hits the admin-UI endpoints once they exist (Phase C), in the meantime it's pure SQL via the `pg` library.

### 15.4 Frontend tests

- **Mapping UI fuzzy-match suggester** (Vitest): given unmapped Quicken names + existing COA leaves, returns suggestions in deterministic order; case-insensitive; ranks exact match > substring > Levenshtein.
- **Pre-flight diff renderer** (Vitest component test): renders kept/dropped counts, NULL-cutoff warning, FX-gap rows, basis-disagreement rows correctly given fixture API responses.
- **Promote button gating**: button is disabled when any unmapped item exists; enabled when all mappings done; click invokes `POST /api/v2/quicken-import/:batch/promote` with confirmation modal.

### 15.5 Test-data hygiene

- All fixture QIFs are committed; no per-developer setup needed.
- Tests use a separate test database (or a Postgres transaction that rolls back) — never the dev or prod fin DB.
- Each fixture has a small markdown sidecar (`<fixture>.QIF.md`) explaining what scenario it represents and which test consumes it.

---

## 16. Manual Walkthrough

End-to-end procedure for verifying each phase landed correctly. Run on dev first, then repeat on prod once dev passes.

### 16.1 After Phase A (schema scaffolding)

```bash
# 1. Verify migration applied (against the env you just migrated)
docker exec fin-postgres-dev psql -U fin -d fin -tA -c "
  SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'quicken_%';"
# expected: 6 (4 staging + 2 lifecycle)

docker exec fin-postgres-dev psql -U fin -d fin -tA -c "
  SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'security_%';"
# expected: 5 (security_lots, _source_mappings, _transactions, _lot_disposals, _prices)
#          plus 'securities' makes 6 — adjust query if needed

# 2. Verify COA leaves seeded
docker exec fin-postgres-dev psql -U fin -d fin -c "
  SELECT name, is_transfer, skip_transfer_analysis FROM accounts
    WHERE name IN ('Return of Capital','Realized Gain (Historical)','Options Trading','Margin Interest');"
# expected: 4 rows; Return of Capital has both flags TRUE

# 3. Verify sentinel update
docker exec fin-postgres-dev psql -U fin -d fin -tA -c "
  SELECT COUNT(*) FROM accounts WHERE opening_balance_date='2000-01-01';"
# expected: 0
```

If any of these don't match expectations, the migration didn't apply cleanly — investigate before continuing.

### 16.2 After Phase B (cash parser)

```bash
# 1. Run parser against the user's PKO sample (cash-only file, ~2400 records)
node server/src/v2/scripts/quicken-import.js parse \
  --files Samples/quicken/pko.QIF \
  --batch $(uuidgen)
# expected: prints batch id, parsed row count, exits 0

# 2. Inspect staging row count
docker exec fin-postgres-dev psql -U fin -d fin -tA -c "
  SELECT COUNT(*) FROM quicken_staging WHERE import_batch_id='<batch-from-step-1>';"
# expected: ~2400 (matches PKO record count modulo split-parent rows)

# 3. Verify date format handling
docker exec fin-postgres-dev psql -U fin -d fin -c "
  SELECT MIN(transaction_date), MAX(transaction_date) FROM quicken_staging WHERE import_batch_id='<batch>';"
# expected: min ~2014-06-19, max <recent date>

# 4. Verify transfer detection
docker exec fin-postgres-dev psql -U fin -d fin -tA -c "
  SELECT COUNT(*) FROM quicken_staging
    WHERE import_batch_id='<batch>' AND transfer_target_account IS NOT NULL;"
# expected: >0 (PKO sample has many transfers to BNP / Real Estate accounts)

# 5. Verify split expansion
docker exec fin-postgres-dev psql -U fin -d fin -c "
  SELECT split_parent_id, COUNT(*) FROM quicken_staging
    WHERE import_batch_id='<batch>' AND split_parent_id IS NOT NULL
    GROUP BY split_parent_id LIMIT 5;"
# expected: rows showing parents with 2+ children each
```

### 16.3 After Phase C (FX seeding)

```bash
# 1. Seed PLN/USD historical rates from ECB CSV
node server/src/v2/scripts/quicken-import.js seed-fx \
  --csv components/data/ecb-pln-usd.csv \
  --currency PLN
# expected: prints upserted row count

# 2. Verify coverage
docker exec fin-postgres-dev psql -U fin -d fin -tA -c "
  SELECT MIN(year || '-' || lpad(month::text,2,'0')),
         MAX(year || '-' || lpad(month::text,2,'0')),
         COUNT(*)
    FROM budget_fx_rates WHERE currency='PLN';"
# expected: covers 2014-06 through current month, ~130+ rows
```

### 16.4 After Phase D (investment parser)

```bash
# 1. Parse the user's Fidelity sample
node server/src/v2/scripts/quicken-import.js parse \
  --files Samples/quicken/fidelity_stk_w_sec.QIF \
  --batch $(uuidgen)
# expected: prints batch id, parsed counts per staging table, exits 0

# 2. Verify each staging table populated
docker exec fin-postgres-dev psql -U fin -d fin -tA -c "
  SELECT 'cash: '         || COUNT(*) FROM quicken_staging WHERE import_batch_id='<batch>';
  SELECT 'sec_events: '   || COUNT(*) FROM quicken_securities_staging WHERE import_batch_id='<batch>';
  SELECT 'sec_master: '   || COUNT(*) FROM quicken_security_master_staging WHERE import_batch_id='<batch>';
  SELECT 'prices: '       || COUNT(*) FROM quicken_price_staging WHERE import_batch_id='<batch>';"
# expected: cash ~400-600 (XIn/XOut/Cash/MargInt), sec_events ~6000+, sec_master ~667, prices ~384k

# 3. Verify action-type coverage in the reconciliation report
cat quicken-import/<batch>/report.json | jq '.actions'
# expected: keys for every action in the §5.3 frequency table

# 4. Verify options trades routed to cash side
docker exec fin-postgres-dev psql -U fin -d fin -tA -c "
  SELECT COUNT(*) FROM quicken_securities_staging
    WHERE import_batch_id='<batch>' AND quicken_action IN ('ShtSell','CvrShrt');"
# expected: ~540 (271 ShtSell + 270 CvrShrt from §5.3 sample frequencies)
```

### 16.5 After Phase E (promote)

```bash
# 1. On dev, complete the mapping panels via the admin UI
open http://localhost:5174/admin/quicken-import/<batch>
# Walk through: Accounts → Categories → Securities → FX gaps; resolve everything

# 2. Open the Promote review screen
open http://localhost:5174/admin/quicken-import/<batch>/promote
# Expected: pre-flight diff shows kept/dropped counts per account, dropped transfer pair count,
# basis disagreements ≥ $1.00 threshold, lot inventory preview, FX gap count = 0.

# 3. Snapshot today's balance per account before clicking Promote
docker exec fin-postgres-dev psql -U fin -d fin -c "
  SELECT a.name, a.opening_balance + COALESCE(SUM(t.amount),0) AS balance
    FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id
    WHERE a.section='balance_sheet'
    GROUP BY a.id, a.name ORDER BY a.name;" > /tmp/pre-promote-balances.txt

# 4. Click Promote in the UI, wait for success toast.

# 5. Re-snapshot today's balance, diff against pre-promote:
docker exec fin-postgres-dev psql -U fin -d fin -c "<same query>" > /tmp/post-promote-balances.txt
diff /tmp/pre-promote-balances.txt /tmp/post-promote-balances.txt
# expected: no diff (or differences ≤ 1¢ rounding)

# 6. Verify historical balance now shows non-zero on Balance Trends
open http://localhost:5174/balance-trends
# Select a brokerage account, set period to 2015-01-01..2021-12-31, generate.
# Expected: non-zero balances throughout, no longer flat-at-zero pre-PS-era.

# 7. Verify Transfer Analysis matches the imported pairs
open http://localhost:5174/transfer-analysis
# Set period to cover the import range. Expected: matched pairs show with
# `match_phase='exact'` for the bulk and a small number with `match_phase='tolerance'`.

# 8. Verify RtrnCap rows don't show as unmatched
# In /transfer-analysis with period covering the RtrnCap dates: "Return of Capital"
# should not appear in the unmatched section (filtered by skip_transfer_analysis).
```

### 16.6 After Phase F (rollback dry-run on dev)

```bash
# 1. Rollback the dev batch
node server/src/v2/scripts/quicken-import.js rollback --batch <batch>
# expected: pre-flight checks pass, deletions complete, calibration reversed

# 2. Re-snapshot balances and diff against pre-promote
docker exec fin-postgres-dev psql -U fin -d fin -c "<balance query>" > /tmp/post-rollback-balances.txt
diff /tmp/pre-promote-balances.txt /tmp/post-rollback-balances.txt
# expected: no diff (rollback restored the world)

# 3. Verify no orphans
docker exec fin-postgres-dev psql -U fin -d fin -tA -c "
  SELECT 'tx: '       || COUNT(*) FROM transactions          WHERE import_batch_id='<batch>';
  SELECT 'tmg: '      || COUNT(*) FROM transfer_match_groups WHERE import_batch_id='<batch>';
  SELECT 'sec_tx: '   || COUNT(*) FROM security_transactions WHERE import_batch_id='<batch>';
  SELECT 'lots: '     || COUNT(*) FROM security_lots         WHERE import_batch_id='<batch>';
  SELECT 'disp: '     || COUNT(*) FROM security_lot_disposals WHERE import_batch_id='<batch>';
  SELECT 'prices: '   || COUNT(*) FROM security_prices       WHERE import_batch_id='<batch>';
  SELECT 'calibration: ' || COUNT(*) FROM quicken_calibration_audit WHERE import_batch_id='<batch>';"
# expected: all zero
```

### 16.7 Prod cutover

Only after every dev step above passes:

```bash
# 1. Named backup before prod promote
./Scripts/backup-to-remote.sh
mv Backups/fin_backup_<TS>.dump Backups/pre-quicken-import-promote/

# 2. Repeat 16.2 → 16.5 against prod (fin-postgres, port 5433)

# 3. Spot-check Balance Trends, Transfer Analysis, P&L reports on prod web UI
# Use 5 sample accounts spanning bank / brokerage / credit card / mortgage / cash-foreign

# 4. If anything looks wrong, rollback per 16.6 against prod within the work session
# (don't wait days — rollback gets risky as users start interacting with the new data)
```

---

---

## 17. Open Questions

1. ~~**`import_batch_id` on `transactions`**~~ — *resolved.* Added as a nullable UUID column on `transactions` and on each of the four `security_*` tables (§13). Join-table alternative rejected: the column is cheaper to query, only ~16 bytes per row, and only populated on imported rows so non-import workflows pay no overhead.
2. ~~**Sentinel `opening_balance_date='2000-01-01'`**~~ — *resolved* by sample inspection. User has 1998 records. Migration 022 lowers sentinel to `1990-01-01`.
3. ~~**Realized-gain category for CGShort/CGLong/ReinvLg**~~ — *resolved.* Single "Realized Gain (Historical)" leaf for all of CGShort, CGLong, CGMid, and the income side of ReinvLg. No ST/LT split. Distinguishable from CR020's go-forward realized-gain computation so no double-count.
4. **`MargInt`** — does a "Margin Interest" expense category exist, or do we add one? Likely add (5 occurrences in sample, small but real).
5. **`Cash` action in investment accounts** — should categorize via the existing P&L mapping (same admin UI panel)? Yes — these are normal categorized cash rows that happen to live in an investment-account QIF. 406 of them in sample, so coverage matters.
6. ~~**Options handling — "Options Trading" category**~~ — *resolved.* Single "Options Trading" P&L leaf; both ShtSell and CvrShrt cash rows route to it. Net activity per period = realized option P&L.
7. ~~**`RtrnCap` modeling**~~ — *resolved.* Manual review. Promote emits the cash row (credit to brokerage, category "Return of Capital" — non-P&L, basis-reducing) and a `MISC` `security_transactions` row; a reconciliation warning is raised so the user adjusts cost-basis on affected lots manually in the admin UI. With 2 occurrences in 27 years this is right-sized.
8. ~~**Quicken cost-basis disagreement threshold**~~ — *resolved.* Reconciliation report threshold set to **$1.00** to keep the first pass quiet; the exact (`stored_basis - arithmetic_basis`) delta is always stored on each disposed/open lot regardless, so a tighter threshold can be applied retroactively in queries against the stored deltas if needed.
9. **FX rate granularity** — `budget_fx_rates` is monthly; some currency pairs swung 5%+ within a single 2008-era month. Monthly probably good enough for historical aggregate reports, but worth confirming.
10. **Handoff_marker quasi-static field** — set once at promote; what happens if user re-runs with additional Quicken data later (e.g., found another year of QIFs)? Recommend: re-running the promote step recomputes `handoff_marker` per account.
11. **Date format pivot year** — 2-digit years `00-49` → 20xx, `50-99` → 19xx. Confirm boundary; user has no 1949-or-earlier data so 50 is safe, but worth pinning.
12. ~~**`!Type:Security` precedes prices in file order?**~~ — *resolved.* Single-pass parser with block-type dispatch (§5.7). All block types route to their respective staging tables; ticker→security_id resolution happens at promote against the fully-staged master, independent of in-file ordering. (Previously specified as two-pass, but that was overkill given the staging-tables architecture — see history entry for 2026-05-22.)

---

## 18. Coordination with CR020

This CR commits to every item in [CR020 §14](CR020_STOCK_INVESTMENT_MODULE.md#14-notes-for-the-cr019-quicken-import-author):

| CR020 §14 item | Where addressed in this CR |
|---|---|
| 1. Six tables + indexes | §4.2 |
| 2. `security_tx_type` enum | §4.2 |
| 3. `security_source_mappings` populated with `source='quicken'` | §11.2 + §6.2 |
| 4. `handoff_marker` set on lots open at last Quicken date per account | §6.4 step 6 |
| 5. Link Quicken Buy/Sell to cash side via `cash_transaction_id` | §6.4 step 3 (synthesizes cash legs, writes back `promoted_cash_tx_id`) + step 5 (uses it on `security_transactions`) + §5.3 |
| 6. Preserve Quicken's specific-lot ID when present; FIFO default | §6.4 step 5 + §15 |
| 7. Backfill `security_prices` from Quicken's stored price history | §5.5 + §6.4 step 7 |
| (CR019-added) `import_batch_id` on `security_lots` / `security_transactions` / `security_lot_disposals` / `security_prices` | §4.2 + §13 — required for rollback |

If any of these change during implementation, the CR020 author is alerted so CR020 can be re-scoped before its work starts.

---

## 19. Follow-ups / Deferred

- Reverse export (Quicken-compatible QIF emit) — no demand.
- Live Quicken sync — Quicken being retired.
- Multi-currency security support — see CR020 §13.
- Web UI for adding historical FX rates manually (today: CSV seeder only).
- AI-assisted Quicken category mapping (suggest COA target from category name + transaction memo statistics) — possibly worth a v2.

---

## 20. Implementation Safety

CR019 touches load-bearing columns (`accounts.opening_balance`, sentinel date, `transactions.import_batch_id`) and introduces a rollback path that has never been exercised on this codebase. The following backup and dry-run steps are **required**, not advisory — they're the difference between "rollback proves buggy" being a 30-minute recovery and a hand-fix-the-balance-sheet weekend.

### 20.1 Named backups at two moments

| Moment | When | Command | Lands in |
|---|---|---|---|
| Pre-migration | After phase A code review, before applying migration 022 | `./Scripts/backup-to-remote.sh && mv Backups/fin_backup_<TS>.dump Backups/pre-quicken-import-migration/` | Both local + `192.168.1.252` |
| Pre-promote | After phase D parsing succeeds and phase E mapping is complete, immediately before the **first** Promote button click | `./Scripts/backup-to-remote.sh && mv Backups/fin_backup_<TS>.dump Backups/pre-quicken-import-promote/` | Both local + `192.168.1.252` |

Both backups are retained indefinitely (not subject to the 30-day rotation on routine backups). They live alongside `Backups/pre-categories-collapse/` from CR013, which set the precedent for migration-pre-flight retention.

### 20.2 Dry run on a clone before prod

The §6.5 rollback contract is well-specified but unexercised. Before relying on it in prod:

1. `./Scripts/sync-db-prod-to-dev.sh` — clone prod into dev
2. In dev, run the full lifecycle: `quicken-import parse … → /admin/quicken-import/:batch (map) → Promote button → quicken-import rollback --batch …`
3. After rollback, run a balance-spot-check: pick 5 BS accounts (1 USD bank, 1 PLN bank, 1 brokerage, 1 credit card, 1 mortgage); compare `opening_balance + SUM(transactions)` against pre-promote dev snapshot; assert equality within 1¢.
4. Verify no orphan rows remain: queries against `transfer_match_groups WHERE import_batch_id=…`, `security_lots WHERE import_batch_id=…`, etc. should all return zero rows after rollback.

If steps 3–4 don't both pass cleanly in dev, **do not promote in prod** — fix the rollback bug first.

### 20.3 Post-promote spot check (prod)

Immediately after the prod promote succeeds (work transaction committed, `quicken_import_batches.status='promoted'`):

1. Compare today's calculated balance per touched account against the `_pre_promote_balances` snapshot captured in step 0. Step 9's verification already does this, but a manual re-run is cheap insurance.
2. Spot-check 5 historical dates (e.g., end of 2010, 2015, 2018, 2020, 2021) on `/balance-trends` for a brokerage account — values should now show non-zero and trend reasonably; before the import they would have been flat.
3. Spot-check `/transfer-analysis` for the Quicken date range — auto-matched transfer pairs should appear with `match_phase='exact'` for the bulk and `match_phase='tolerance'` for the few ±1-day pairs.
4. Spot-check `/portfolio` (once CR020 is live) — `lots × current_close` should produce a non-zero historical-handoff position for each brokerage account.

If anything looks off and prod rollback feels risky, the `pre-quicken-import-promote` dump is the immediate-restore path — see §20.4.

### 20.4 Restore-from-backup escape hatch

If rollback fails and the prod state is inconsistent:

1. Stop the API and frontend containers (`docker compose down`).
2. Restore the `pre-quicken-import-promote.dump` into a fresh Postgres database. Existing dump in `Backups/` works with `pg_restore`. See `Scripts/restore-mongo.sh` for the parallel pattern (PostgreSQL equivalent doesn't exist yet but the syntax is standard `pg_restore --clean --if-exists -d <dbname> <dumpfile>`).
3. Restart containers.
4. The system is now exactly at the pre-promote state. Staging tables and `quicken_import_batches` are gone (they didn't exist pre-migration), so re-running the importer starts from scratch.

This is destructive of all post-promote prod activity (anything users did between promote and restore). Use only if rollback genuinely failed.

---

## 21. Update history

- **2026-05-29** — **Cash-transfer model pivot — 1→1 with post-hoc matching.** Replaced the original §6.4 step 2 fanout (1 staging row → debit+credit pair) with a single transaction per row, plus auto-run Transfer Analysis at the end of promote. Driver: the fanout leaked the source file's currency onto the target side for cross-currency transfers (PKO PLN → Chase USD), and §8.2 cross-file dedupe couldn't pair them because absolute amounts didn't match. The 1→1 model is the same shape PocketSmith data already uses; `base_amount` matching with category-aware tolerances (`Transfer - FX` 1%, others exact) handles cross-currency pair recognition correctly. Changes landed:
  - **§6.4 step 2 rewritten** — single insert per row, `account_id = origin BS, category_id = transfer-category` (resolved per §8.2.3 role-aware logic). Target side gets no row. Cutoff per-row against origin only.
  - **§6.4 step 4 deleted** — `transfer_match_groups` no longer auto-created at promote (reserved for user-curated manual pairings).
  - **§6.4 step 11 added** — auto-match via the existing Transfer Analysis logic over the batch's date range; `transfer_matched=TRUE` persisted on auto-matched pairs.
  - **§8.2.1 deleted** — cross-file positional matching gone.
  - **§8.2.2 deleted** — pair-as-unit cutoff dropping gone.
  - **§8.2.3 extended** — handles role-aware target mapping: if target's mapping is a transfer-category leaf (user explicitly picked one), use it directly; else derive via the existing priority table (cross-currency wins → `Transfer - FX`). New `Transfer - Historical` leaf seeded under Transfers as the catch-all for target-only names.
  - **§8.4 extended** — Historical Accounts pattern (per-account BS leaves) now coexists with the `Transfer - Historical` quick path: use Option J for closed accounts you want balance history on (parse their QIF); use the role-aware transfer-leaf mapping for closed accounts you don't care to track separately.
  - **Role-aware mapping picker** — API `/batches/:id` now returns `role` (origin / target_only / both / category) per Quicken name; frontend filters picker options accordingly; server-side validation rejects mismatches.
  - **Q4 rollback pre-flight** — refuses to roll back if manual `transfer_match_groups` reference the batch's transactions (user resolves them first in Transfer Analysis).
  - **Tests** — 13 promote tests rewritten for the new row counts and behavior; full suite stays at 57 passing.
- **2026-05-21** — Initial planning skeleton. Decisions captured from CR019 design conversation. Awaiting alignment with CR020 author before phase A begins.
- **2026-05-21** — Validated against user's sample QIFs (`Samples/quicken/pko.QIF`, `fidelity_stk.QIF`, `fidelity_stk_w_sec.QIF`). Findings folded in:
  - Action coverage table updated with real frequencies (17 distinct actions; Div is 3,399 — dominant).
  - Added `NCash` (406×), `NRtrnCap` (2×), `NReinvLg` (10×) to action coverage.
  - `NXIn` (193×) / `NXOut` (59×) clarified as **pure cash transfers**, not security events.
  - `NShtSell` (271×) + `NCvrShrt` (270×) identified as **options trades** (CALL/PUT in security name), not stock shorts. CR scope decision: cash-side only, no `securities`/`security_lots` rows.
  - Earliest record 1998-03-21 → opening_balance_date sentinel lowered to `1990-01-01` in migration 022. Open Question #2 closed.
  - `!Type:Security` master blocks (667 in sample) parsed into `securities` directly — eliminates manual entry for CR020.
  - Price-block volume: 384,282 entries; bulk-insert in 5,000-row batches.
  - PKO confirmed entirely in PLN since 2014-06-19 — ECB seed scope pinned.
  - Date-format parser must handle both `M/D'YY` (PKO) and `M/D/YY` (Fidelity), with leading-space single-digit padding.
  - Open Questions expanded from 8 to 12 (new: realized-gain leaf granularity, options leaf granularity, RtrnCap modeling, date pivot year, security-block ordering).
- **2026-05-21** — Three further decisions resolved from user review:
  - Options: single "Options Trading" P&L leaf (Q #6).
  - Realized gain: single "Realized Gain (Historical)" leaf, no ST/LT split (Q #3).
  - RtrnCap: manual basis-adjustment via admin UI; promote emits cash + warning (Q #7).
- **2026-05-22** — **Phase E shipped to prod.** Two pre-deploy safety fixes:
  - `runPromote` now guards against investment-side rows in the batch (refuses with a fail-loud error if `quicken_securities_staging` / `quicken_security_master_staging` / `quicken_price_staging` has any rows). Without this, a Fidelity batch promote would silently drop ~94% of the data and "succeed" promoting just XIn/XOut/Cash/MargInt rows.
  - `findTransfers` in [`server/src/v2/repositories/transactions.js:512`](../../server/src/v2/repositories/transactions.js#L512) now adds `AND c.skip_transfer_analysis = FALSE` to the WHERE clause. Matches the CR §4.3 spec; prevents future RtrnCap rows from appearing as perpetually-unmatched in `/transfer-analysis`.
  - **One new Jest test** for the guard (rejects + fails batch status). Full suite: **129 tests pass** (56 Quicken + 73 other; zero regressions).
  - **Prod deploy via `docker compose build server` + `docker compose up -d server`, then same for `frontend`** (latter needed `--force-recreate --no-deps` to work around a transient compose-error on the postgres dep). New routes verified live: `GET /api/v2/quicken-import/batches` returns `[]` (correct — no batches in prod yet); 10KB `QuickenImport-*.js` chunk baked into fin-frontend's static assets.
  - Prod admin UI now reachable at `/quicken-import` once user navigates. Empty state until a parse is run.
  - Container restart took ~30s each; no other endpoints disrupted.
- **2026-05-22** — **Phase E (cash-only vertical slice) landed on dev.** Three new artifacts:
  - [`server/src/v2/scripts/quicken-promote.js`](../../server/src/v2/scripts/quicken-promote.js) (~530 lines) — `runPromote` implements §6.4 cash-only steps (0, 2, 4, 8, 9, 10) inside a two-transaction wrapper per the §6.4 preamble. `runRollback` implements §6.5 contract. Mapping resolution, transfer-category resolution (§8.2.3 priority table with auto-create-leaf), per-account cutoff (§8.1), FX base_amount resolution, calibration audit, balance verification.
  - [`server/src/v2/routes/quickenImport.js`](../../server/src/v2/routes/quickenImport.js) — six API routes (list batches, get batch detail, list/save/clear mappings, pre-flight diff, promote, rollback). Mounted at `/api/v2/quicken-import`.
  - [`frontend/src/pages/QuickenImport.jsx`](../../frontend/src/pages/QuickenImport.jsx) + `.css` — three-view admin UI (batch list → mapping panels → pre-flight + Promote/Rollback). Filter pills (all / unmapped / accounts / categories), per-row save/clear, confirmation dialogs on destructive actions. Registered at `/quicken-import` under Database category.
  - **12 new Jest tests** at `server/src/v2/scripts/__tests__/quicken-promote.test.js` covering: row-count expectations, transfer pair signing, balance preservation within 1¢, calibration audit on BS accounts only, batch status transitions, transfer_match_groups with audit_provenance, fail-loud on unmapped names, refuses double-promote, rollback completeness, staging+mapping preservation, re-promote after rollback, rollback refusal when not in promoted state. **All 67 tests pass.**
  - **End-to-end smoke test on real PKO data** (2,397 QIF blocks): 2,711 staging rows → 3,098 transactions inserted in 3 seconds across 1,837 standalone + 215 split children + 523 transfer pairs (×2 legs); 25 BS accounts recalibrated; today's balance preserved on every account; spot-check at 2018-01-01 showed multi-year historical balances queryable (e.g., PKO sentinel at -79,090); rollback removed all 3,098 rows + 523 groups + 25 audit rows + reset opening_balance; staging (2,711 rows) and mappings (60) intentionally preserved per §6.5.4. **Bug surfaced and fixed:** empty `L` tag values in QIF were saved as empty strings; parser now normalizes to null. **Image rebuild required** before the admin UI is live in containers — backend logic and routes are written and unit-tested, but `fin-server` bakes source at build-time.
- **2026-05-22** — Phases C + D landed on dev. **Phase C** (FX seeding) added `seed-fx` subcommand to `quicken-import.js` plus `parseFxCsv` / `seedFxRates` / `runSeedFx` exports. Accepts a simple `year,month,rate` CSV (one-time spreadsheet prep from ECB raw download); upserts to `budget_fx_rates` idempotently. Smoke-tested seeding 9 PLN rows from `Samples/quicken/fixtures/fx_pln_sample.csv` for 2014-06 through 2015-02. **Phase D** (investment parser) added `parseInvstBlock`, `parseSecurityBlock`, `parsePriceBlock` (+ `parsePrice` for fractional Wall Street notation), and four new staging routes (`stageInvstAsCash` for XIn/XOut/Cash/MargInt, `stageInvstAsSecurity` for everything else, `stageSecurityMaster`, `stagePricesBulk` with 5,000-row chunks). `parseQif` rewritten to dispatch by `!Type:` header, supporting both single-header files (fidelity_stk.QIF) and per-block-header files (fidelity_stk_w_sec.QIF). **Test count: 43 (up from 18).** **Bug surfaced and fixed in real-data smoke test:** Quicken stored ~30k pre-2001 prices in Wall Street fractional notation (`"ABT",36 3/4,"..."`); original decimal-only regex dropped them. New `parsePrice` handles decimal, `whole + n/d`, and `n/d` formats. Real-data load: `fidelity_stk_w_sec.QIF` (16.8 MB, 391,618 blocks) staged 391,499 rows in 25 seconds — 654 cash, 6,006 securities events, 667 security master rows, 384,172 prices (99.97% coverage). 9 no-op Quicken bookkeeping markers (Cash action with no amount) are silently skipped per `buckets.skippedNoAmount` counter — surfaces in reconciliation report. Investment-event date range: 1998-03-23 → 2022-11-25. Price history: 1997-05-08 → 2022-11-25 across 628 distinct tickers.
- **2026-05-22** — Phase B cash parser landed on dev. New file [`server/src/v2/scripts/quicken-import.js`](../../server/src/v2/scripts/quicken-import.js) (~340 lines) implements the §5.7 single-pass block-dispatch parser for cash QIF types (Cash / Bank / CCard / Oth A / Oth L). Investment types are deferred to Phase D. Test suite at `server/src/v2/scripts/__tests__/quicken-import.test.js` (18 tests: 14 pure parsing + 4 DB-backed against `localhost:5434`); all pass. Smoke-tested against real `Samples/quicken/pko.QIF` (2,397 blocks): produced 2,711 staging rows (314 split-child expansion), 523 transfers to 24 distinct counterparties, 136 split parents, date range 2014-06-19 to 2022-11-26 — matches expectations from §5.3 sample frequencies. Fixture `Samples/quicken/fixtures/cash_simple.QIF` exercises every Phase B scenario (simple cash, transfer, split, both date formats, cleared status, check number). Next: phase C FX seeding (small) or phase D investment parser.
- **2026-05-22** — Phase A migration landed on prod. After dev verification, took named backup `Backups/pre-quicken-import-migration/pre_quicken_import_migration.dump`, applied migration to `fin-postgres` (port 5433), verified 12/12 tables, 4/4 columns, 4/4 COA leaves, 0 sentinel stragglers. 216 accounts had sentinel updated (vs 215 on dev — minor difference, expected).
- **2026-05-22** — Expanded §15 Test Strategy with concrete infrastructure (Jest for backend, Vitest for frontend, `smoke-after-022.js` for migration), per-phase fixture inventory under `Samples/quicken/fixtures/`, and test-data hygiene rules. Added §16 Manual Walkthrough — step-by-step verification procedures for each phase (A schema, B cash parser, C FX seeding, D investment parser, E promote, F rollback) plus the prod cutover sequence. Renumbered §16–§20 → §17–§21 to accommodate. Updated inline cross-references.
- **2026-05-22** — Phase A migration landed on dev. Applied `022_quicken_import.sql` via `docker exec -i fin-postgres-dev psql -U fin -d fin`. First attempt failed at the verification block because the new COA-leaf INSERTs picked up the pre-migration `opening_balance_date` DEFAULT of `'2000-01-01'`; transaction rolled back atomically. Fixed by adding `ALTER COLUMN opening_balance_date SET DEFAULT '1990-01-01'` to the sentinel-update section so the new default applies to step 6's INSERTs. Reapplied successfully: 12/12 tables created, 4/4 new columns, 4/4 COA leaves seeded, 0 sentinel stragglers. Status changed to IN-PROGRESS. Prod application deferred until phase B parser work validates the schema choices.
- **2026-05-22** — Added §19 Implementation Safety as a required pre-implementation checklist: named backups at two moments (pre-migration, pre-promote), full dry-run-then-rollback on a dev clone before any prod activity, post-promote spot-check checklist, and a restore-from-backup escape hatch documenting the disaster-recovery path. Existing automated backup infrastructure (`Scripts/backup-to-remote.sh`, every 2 days, 30-day retention) is the foundation; the new section codifies two extra named retentions (`pre-quicken-import-migration/`, `pre-quicken-import-promote/`) that mirror the `pre-categories-collapse/` precedent from CR013. Update history renumbered §19 → §20.
- **2026-05-22** — Second review-comment pass (six fixes):
  - **Failure-status atomicity** — §6.4 preamble rewritten to spell out a two-transaction wrapper (work transaction + separate failure-status transaction). Without the separation, a `status='failed'` write would itself roll back when the work transaction rolls back, leaving the batch row stuck in `promoting` with no failure trail.
  - **Security mapping ownership** — Phase 2 (§6.2) is now the sole upserter for `securities` and `security_source_mappings`. Promote step 1 demoted to an idempotent reconciliation: assert every staging row has `promoted_security_id` set, fail-loud otherwise. Removes the duplicate-creation risk.
  - **Investment-side cutoff** — §6.4 step 5 now applies the same per-account cutoff as cash (§8.1) to `quicken_securities_staging` rows before walking the lot inventory. Prevents Quicken post-cutoff investment events from creating `security_transactions` rows that overlap PS/Fidelity-era activity.
  - **Lot persistence** — §6.4 step 5 wording clarified: every lot the walker creates is persisted, regardless of final status (open or closed). Required because `security_lot_disposals.lot_id` is a FK pointing at the lot row consumed by the disposal.
  - **RoC vs Transfer Analysis** — added `skip_transfer_analysis BOOLEAN` column on `accounts` (§4.3), set TRUE on the "Return of Capital" leaf. `findTransfers` repository method updated to filter on it. Prevents RoC from appearing as perpetually-unmatched in /transfer-analysis.
  - **Transfer-match provenance** — added `audit_provenance JSONB` column on `transfer_match_groups` (§4.3); §8.2.1 specifies the shape (`{match_phase, a_side, b_side}`); §6.4 step 4 writes it during promote. Replaces the vague "audit log" reference with a concrete persistence mechanism.
  - **Cosmetic** — stale history-entry text (still mentioning `'ps-refresh'` and "two-pass parser locked in") rewritten to point at the later corrections rather than describe the superseded state as current.
- **2026-05-22** — §8.2 hardened (four fixes):
  - **§8.2.1 algorithm** split into two phases — exact-date matches consumed first, then ±1 day pass over leftovers. Eliminates the ambiguity where a row could legitimately match both an exact-date and an adjacent-date partner.
  - **§8.2.2 cutoff interaction** — transfer pairs are evaluated as a unit; if either side crosses its account's cutoff, drop the whole pair. Prevents orphan legs that would silently corrupt the other side's balance.
  - **§8.2.3 category resolution table** — explicit COA-branch → transfer-category mapping (Mortgage/Securities/FX/Business/Bank). Removes the ad-hoc category-picking that the old text implicitly required.
  - **A/B-side-only wording fixed** — removed misleading "synthetic credit leg" framing; A/B-side-only rows still emit the standard 2-leg fanout, just without a cross-file mirror to dedupe against. Reconciliation report flags this as informational, not actionable.
- **2026-05-22** — §8.1 cutoff tightened. Three changes:
  - Allow-list corrected against live codebase: `'pocketsmith'` + `'auto-offset'` only. `'ps-refresh'` removed (didn't exist). `'manual'` deliberately excluded (would cause one stray manual entry to silently drop years of Quicken history).
  - New §8.1.1: per-account override cutoff in the pre-flight UI. Auto-detected cutoff is sensitive to outliers (a single backfilled PS row from 2018 could drop most of the Quicken import); override lets the user push the cutoff later. Always strictly more permissive than auto-detect via `MAX(auto, override)`.
  - Added `cutoff_overrides JSONB` column on `quicken_import_batches` to persist overrides across rollback / re-promote.
  - New §8.1.2 enumerates edge cases (NULL cutoff, unmapped Quicken account, COA account with no Quicken data).
- **2026-05-22** — §6.4 restructured from 11 mixed-concern steps to 11 phased steps (0–10). Fixes two ordering bugs surfaced during review:
  - Bug A: investment cash legs were never synthesized as a distinct step, leaving `quicken_securities_staging.promoted_cash_tx_id` unpopulated and breaking the `cash_transaction_id` link CR020 §14 item 5 depends on. New step 3 does this synthesis explicitly per §5.3, with a `promoted_cash_tx_id` write-back contract for step 5.
  - Bug B: transfer rows were treated 1:1 by old step 3 but need to fan out 1:2 (debit on origin, credit on target). New step 2 makes the fanout explicit.
  - Smaller fix: handoff_marker now uses `MAX(promoted transaction_date)` per account (step 6), not staged date — so the §8.1 per-account cutoff is respected.
  - New step 0 captures pre-promote balances into a temp table so the verification step 9 has a defined comparison point.
  - §17 CR020 coordination table updated with new step numbers.
- **2026-05-22** — §5.7 simplified from two-pass to single-pass with block-type dispatch. The two-pass design was solving a problem the staging-tables architecture already solved (cross-block ordering is decoupled by deferring resolution to promote). Halves I/O on the 16.8 MB `fidelity_stk_w_sec.QIF`. Open Question #12 resolution rewritten accordingly.
- **2026-05-22** — Rollback hardening pass (review of §5.6 surfaced gaps in the rollback story):
  - Added `quicken_import_batches` lifecycle table (UUID PK, status, parsed_at / mapped_at / promoted_at / rolled_back_at).
  - Added `quicken_calibration_audit` table — one row per (batch, account) at promote with the calibration delta, used by rollback to reverse `opening_balance` cleanly.
  - Added `import_batch_id` to `transfer_match_groups` (existing table — minor schema change in §4.3) so promote-created groups can be cleanly deleted on rollback.
  - Rewrote §6.5 as a precise rollback contract: pre-flight checks (refuse if external references would orphan), explicit deletion order, calibration reversal with verification, intentionally preserved items (securities master, mappings), batch row finalization, re-promote semantics.
  - Fixed §5.6 cosmetic: "exactly five tables" → "four staging tables + batch-master row + on-disk report file."
  - Fixed duplicate `### 5.5` heading (Reconciliation Outputs is now §5.8).
  - §13 source-tagging table extended with `transfer_match_groups.import_batch_id`.
- **2026-05-22** — Review-comment pass. Five comments and four questions addressed:
  - **Rollback metadata** — added `import_batch_id` (nullable UUID) to `security_lots`, `security_transactions`, `security_lot_disposals`, `security_prices`. §4.2, §13, §17 updated. New row in §17 coordination table flags this as a CR019-added column beyond CR020 §14.
  - **Sentinel contradiction** — §6.4 calibration step now explicitly preserves the post-migration `1990-01-01` sentinel; no contradiction with §9.
  - **Parse-phase purity** — added two more staging tables (`quicken_security_master_staging`, `quicken_price_staging`) so parse never touches `securities` or `security_prices`. Promote-phase upserts. §5.4, §5.5, §5.6 (parse-phase write contract), §6.1 updated.
  - **Split ordering** — introduced explicit invariant: split parents are metadata-only, never promoted; only children land in `transactions`. Pre-insert assertion `SUM(children) == parent`. §6.4 step 2 rewritten.
  - **Cutoff SQL** — changed from `source != 'quicken-import'` exclude-list to an allow-list. (Initial draft mistakenly included `'ps-refresh'` and `'manual'`; later same-day pass corrected to `'pocketsmith'` + `'auto-offset'` against the live codebase — see the §8.1 history entry below.) §8.1 updated with NULL-cutoff handling.
  - **RtrnCap placement** — placed under the **Transfers** parent in the COA (`is_transfer=TRUE`), keeping it out of P&L income reports. §5.3 updated. (Later refined to also set `skip_transfer_analysis=TRUE` so it doesn't appear as perpetually-unmatched in /transfer-analysis — see follow-up history entry.)
  - **Transfer dedupe** — positional matching algorithm replaces naive triple-key. §8.2 rewritten with explicit four-step algorithm + fail-loud on count mismatches. (Later refined to two-phase exact-then-tolerance matching plus cutoff-as-unit and explicit category resolution — see the §8.2 history entry below.)
  - **Parser passes** — initially locked in as two-pass (Q #12). (Later simplified to single-pass with block-type dispatch — see §5.7 history entry below. Q #12 resolution rewritten.)
  - **Basis threshold** — set to $1.00 for reconciliation report; exact deltas always stored. Q #8 closed.
  - Open Questions count: 12 → 5 remaining (open: #4 Margin Interest, #5 Cash action mapping, #9 FX granularity, #10 handoff_marker recompute, #11 date pivot year).
