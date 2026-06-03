**Status:** DONE (both phases on prod) — **Phase 1 (v2.11.0)** market-value balances + **Phase 2 (v2.13.0, 2026-06-03)** investment-activity cash flow, activated via a per-account cutover cutoff (zero double-count). Remaining: review-queue triage of the promoted Fidelity rows; CR020 still owns lot/cost-basis. — [Plan](../FC_NEXT_STEPS.md#cr024)

> **Phase 2 ACTIVATED on prod (v2.13.0, 2026-06-03).** The PS-dedup double-count risk (reports count `accepted=FALSE` rows, and Fidelity's many identical amounts defeat the conservative tie-break → a dry-run found 26 ambiguous rows that would double-count) was resolved with a **per-account cutover cutoff** instead of blind dedup: migration `027_promote_from_date.sql` adds `account_source_mappings.promote_from_date`; the promote holds any bank-feed row dated before the cutoff (PS owns that period). `seed-cr024-fidelity-cutoffs.js` sets cutoff = (PS last tx on that account) + 1, set-once. Cutoffs: 26/27→2026-05-23, 28→2026-05-27, 30/31→2026-05-16. **Activation result (prod):** un-ignored the 5 accounts, promoted **60 Fidelity rows** (Option Trade 20, Transfer-Securities-Trades 19, Dividend 15, Interest 4, Transfer-Bank 2), **33 suppressed**, **linked=0** and **0 PS rows at/after any cutoff → zero double-count by construction**. Phase 1 balances intact; rows land `accepted=FALSE` for review. As the user stops manual PS uploads, the daily stage-only cron keeps new Fidelity rows (all post-cutoff) staged; they land in the ledger on the next manual promote (Refresh Feeds → Import), human-in-the-loop by design.

> **Phase 2 as-built (dev, 2026-06-03).** bank-feed shipped the additive `activity_type` on `/v1/transactions` (compute-on-read from `raw.parsed.type`; bank-feed `797df90`). fin side: migration `026_fidelity_activity.sql` (`bankfeed_staging.activity_type` + `.suppressed`); converter carries `activity_type`; pure `categorizeFidelityActivity(activity_type, trade_treatment)` (INTEREST→Interest Income, DIVIDEND→Financial Income - Dividend, REI+offset-trades→Transfer - Securities Trades, Options BUY/SELL→Option Trade via `trade_treatment=income`, CONTRIBUTION/WITHDRAWAL→Transfer - Bank, LOAN/JOURNALED/OPTIONEXPIRATION→suppress, PAYMENT/unknown/null→review); promote resolves category names→ids (fail-loud), suppresses net-zero plumbing, and assigns `category_id` on insert (still `accepted=FALSE`). **Dev walkthrough (un-ignored the 5 accounts, promoted):** 233 inserted, 130 suppressed (OPTIONEXPIRATION 50 / LOAN 46 / JOURNALED 34), categorization exact (Option Trade 80, Transfer-Securities-Trades 46, Dividend 25, Interest 8, Transfer-Bank 8); Phase 1 balances unaffected; 188/188 backend tests. **⚠ Prod activation risk (dev can't test it — dev PS frozen, `linked=0`):** on prod, PS still feeds Fidelity (manual uploads), so most bank-feed rows should LINK to PS twins (R2 dedup → no double-count); but Fidelity has many identical small amounts, and the §8 conservative don't-merge-when-ambiguous tie-break may leave both PS+bank-feed copies → double-count in cash flow. **Must run a prod dedup dry-run (would-link vs would-insert) before un-ignoring on prod.** Code is deploy-safe dormant (Fidelity stays `ignored` on prod until explicitly un-ignored).

> **Phase 1 as-built (dev, 2026-06-02).** Migration `025_fidelity_feeds.sql` applied to dev (`bankfeed_balances`, `account_source_mappings.balance_from_feed` + `.trade_treatment`). `refreshBankFeedV2.ingestBalances()` folds `/v1/balances` into the local cache on the cron `/ingest` path (best-effort; non-fatal). `reports.js fetchAccountBalances` gained the leaf-level read-override (feed value for as-of ≥ snapshot, additive fallback earlier; parents aggregate overridden leaves). `seed-cr024-fidelity-mappings.js` (idempotent) maps the 5 accounts `balance_from_feed=TRUE`, keeping `ignored=TRUE` (tx suppressed until Phase 2). ps-anchor already skips all 5 (BROKERAGE_CONTAINERS = Fidelity Stock 25 + Fidelity Fixed Income 29) and had 0 stray anchor rows — no change needed. **Verified live on dev:** `/ingest` cached 13/13 balances (0 unresolved); balance sheet shows Bond $1,204,472 (was ~$1.01M), Stocks $1,174,360, IRA $292,025, Options $83,796, Cash Mgt $790,076; parents roll up (Fidelity Fixed Income $1,994,548, Fidelity Stock $1,550,181); PKO accounts unchanged (no override leak); pre-feed dates fall back to additive. Backend suite 178/178. **Prod DEPLOYED + verified (v2.11.0, 2026-06-02):** migration 025 applied to prod inside a pg_dump bracket **before** the code deploy; `deploy-to-production.sh` shipped v2.11.0 (all containers healthy); seed run on prod (5 accounts `balance_from_feed=TRUE`); `/ingest` cached 13/13 balances (0 unresolved). Verified: balance sheet shows feed values (Bond $1,204,472, Stocks $1,174,360, IRA $292,025, Options $83,796, Cash Mgt $790,076), parents roll up (Fidelity Fixed Income $1,994,548, Fidelity Stock $1,550,181), **0 Fidelity rows promoted into the ledger** (tx suppressed), idempotent re-ingest. The daily 06:00 stage-only cron now refreshes the balance cache automatically.

# CR024 — Fidelity Feeds: market-value balances + investment-activity cash flow

**Created:** 2026-06-02
**Follows:** [CR021](CR021_BANK_FEED_SERVICE.md) (bank-feed service), [CR022](CR022_BANK_FEED_PARALLEL_IMPORT.md) (cash-side parallel import — Fidelity was explicitly scoped *out*).
**Relates to:** [CR020](CR020_STOCK_INVESTMENT_MODULE.md) (lot-level investment module) — CR024 is the cash-flow-grain + market-value-balance layer; it does **not** do lot/cost-basis tracking, which stays CR020. Resolves FC_NEXT_STEPS Known Issue #4 (Fidelity brokerage balances wrong; fix is to feed from `feed_balances`).

## 1. Background

CR022 stood up the additive bank-feed → fin `transactions` import for the **cash-side** PKO accounts and deliberately left the 6 Fidelity accounts `ignored=TRUE, account_id=NULL` (stage but never promote), because fin's balance model `opening_balance + Σ(amount)` is correct for cash/checking but **wrong for brokerage** (which is market value, not a transaction sum).

This CR stands up the Fidelity feeds properly, in two layers that answer two different questions and do not conflict:

- **Balance sheet** — what is each account *worth*? → market value from the bank-feed `feed_balances` (read-override).
- **Cash flow** — what *income/activity* flowed through? → import the Fidelity activity stream and categorize by SnapTrade activity type.

### 1.1 Investigation findings (verified live 2026-06-02)

All 6 Fidelity accounts are **SnapTrade-sourced** (through the same fintable Google Sheet as PKO). Live reported balances and staged-row counts:

| Feed account | type | reported balance (`feed_balances`) | staged tx | Σ(tx amounts) |
|---|---|---|---|---|
| Cash Management | checking | $790,076 | 34 | **0.00** |
| Fixed Income | brokerage | $1,204,472 | 22 | **0.00** |
| Stocks | brokerage | $1,174,360 | 60 | **0.00** |
| Rollover IRA | brokerage | $292,025 | 35 | **0.00** |
| Options | brokerage | $83,796 | 181 | **0.00** |
| Individual | other | $41,000 | 6 | **0.00** |

**Decisive finding:** `Σ(captured tx amounts) = 0.00` for *every* account, including Cash Management. The feed is a recent window of churn that nets to zero, with **no inception baseline**. SnapTrade history reaches only back to 2024-05-31 (Stocks 2024-06-10, Options 2024-11-18, Individual 2026-05-20) — not to inception. `feed_balances` itself only starts **2026-05-30** (forward-only daily snapshots from the bank-feed Phase 5 work).

**Consequence:** `opening_balance + Σ(amount)` cannot derive any Fidelity balance — not even the cash account. The only authoritative balance is `feed_balances`. True *historical* market value (pre-2026-05-30) is **not recoverable** from this feed (would need CR020's lot model × a daily price series).

**Rich activity data exists in the bank-feed DB** (`feed_transactions.raw.parsed`): SnapTrade `type`, `units`, `price`, `symbol`, `option_type` — but the **`/v1/transactions` contract exposes none of it** (only `amount/description/merchant/category_hint`, and `category_hint` is `null` for SnapTrade rows). So fin cannot categorize income-vs-trades today; Phase 2 depends on a bank-feed contract addition.

### 1.2 fin-side COA targets (verified prod 2026-06-02)

| Feed account | → fin account | Notes |
|---|---|---|
| Rollover IRA | 26 Fidelity IRA | clean |
| Stocks | 27 Fidelity Stocks (opening_balance −$302,786) | negative OB = the broken half-neutralized state this CR fixes |
| Options | 28 Fidelity Options ($0) | clean |
| Cash Management | 30 Fidelity Cash Mgt | clean (cash account) |
| Fixed Income | **31 Fidelity Bond** (−$314,299, 604 tx, computed ~$899,842 → corrected to $1.20M) | leaf under parent category **29 Fidelity Fixed Income** (29 also rolls up 30 Cash Mgt) — 29 is NOT mapped; it aggregates its fed leaves |
| Individual | — | **leave ignored** (user instruction) |

Income/transfer categories that already exist: Interest Income (74), Financial Income - Dividend (72), Financial Income - Other Investments (79), Transfer - Securities Trades (206), Transfers (200).

## 2. Goals & Non-Goals

### Goals
- **Correct brokerage balances** on the balance sheet via a `feed_balances` read-override for the mapped Fidelity accounts (fixes e.g. Fidelity Bond reading ~$1.01M vs. real $1.20M).
- **Itemized investment income in cash flow** — INTEREST → Interest Income and DIVIDEND → Dividend Income for every Fidelity account (the must-have), plus option P&L and trade handling per §3.3.
- **Per-account trade handling** — a mapping-time `trade_treatment` setting (`offset` default | `income`) governs how BUY/SELL post, so the Options account books cash-basis option P&L while equity accounts auto-offset.
- **No double-count** — imported transactions drive cash-flow reports only; `feed_balances` drives the balance-sheet number. The two layers are independent.
- **Reuse the CR022 pipeline** — the same staging → promote → review-queue path; this CR adds a Fidelity activity categorizer and a balance read-override on top.

### Non-Goals
- **Lot / cost-basis / holdings / FIFO realized-gain tracking** — stays CR020. CR024 is cash-flow-grain.
- **Reconstructing historical market value** (pre-2026-05-30) — not recoverable from this feed; out of scope.
- **Removing PocketSmith / touching the PS path** — unchanged.
- **The Individual account** — stays ignored.

## 3. Architecture

### 3.1 Phase 1 — Balance correctness (market value)

**Where the balance comes from.** fin already receives balances via the existing CR021 `/v1/balances` endpoint — **Phase 1 needs no bank-feed change.** A new local table `bankfeed_balances` in fin caches the latest `feed_balances` per feed account, refreshed by the existing stage-only daily cron (and on demand). The balance-sheet fetcher reads it for feed-owned accounts.

**Read-override.** A mapped Fidelity account flagged `balance_from_feed=TRUE` has its as-of balance computed as `latest bankfeed_balances.balance WHERE balance_date <= asOfDate` instead of `opening_balance + Σ(tx)`. **The override applies at the leaf level only; parent category nodes aggregate their (overridden) children unchanged** — e.g. the parent category **29 Fidelity Fixed Income** sums its fed leaves 30 Cash Mgt ($790K) + 31 Bond ($1.20M), so it needs no mapping of its own. Applies only for as-of dates ≥ the earliest cached balance (2026-05-30); **for earlier dates the existing additive value renders unchanged** (no fabricated history — per §9 Q-history). Blast radius: `balanceSheetFetcher.js` and the as-of-date balance reports (Balance Sheet, Balance Trends, Balance Sheet Periods) that call it. Forecast base values already use a separate hand-entered/broker-reported `market_value` field (decoupled from the tx stream since 2026-05-04), so the forecast path is unaffected.

**ps-anchor cleanup.** CR019's `ps-anchor.js` wrongly anchored account 26 to PS's stale closing_balance. Phase 1 deletes that anchor (`DELETE FROM transactions WHERE account_id=26 AND source='ps-anchor'`) and confirms ps-anchor's existing skip-guard excludes all feed-owned brokerage accounts (26/27/28/30/31).

### 3.2 Phase 2 — Investment-activity cash flow

**bank-feed dependency (`Finance → bank-feed` handoff, §7).** The `/v1/transactions` contract gains one additive optional field **`activity_type`** (string, nullable), populated from `raw.parsed.type` for SnapTrade rows (null for GoCardless/PKO rows). Additive within v1. With `trade_treatment` per-account, fin does **not** need a separate `is_option` flag — one field suffices.

**Fidelity activity categorizer (fin).** At promote, a Fidelity staged row is routed by `activity_type`:

### 3.3 Activity-type → treatment mapping (grounded in the live 338-row inventory)

| `activity_type` | Rows | Treatment | Suggested category |
|---|---|---|---|
| INTEREST | 11 | **Income** | Interest Income (74) |
| DIVIDEND | 28 | **Income** | Financial Income - Dividend (72) |
| REI (reinvestment) | 14 | **Auto-offset** (the dividend reinvested into shares; offsets so cash isn't double-counted) | Transfer - Securities Trades (206) |
| BUY | 78 | **Per-account `trade_treatment`** | `offset`→206 · `income`→**76 Option Trade** |
| SELL | 61 | **Per-account `trade_treatment`** | `offset`→206 · `income`→**76 Option Trade** |
| OPTIONEXPIRATION | 52 | **Suppress** (all $0.00, expired worthless) | not promoted |
| JOURNALED | 38 | **Suppress** (net-zero ±10,882 position journaling) | not promoted |
| LOAN | 51 | **Suppress** (securities-lending, net-zero ±collateral) | not promoted |
| CONTRIBUTION | 8 | **Transfer, matchable** (cash IN — $190K/$100K/$41K; not income) | Transfers (200) / Transfer - Bank — surfaces in Transfer Analysis |
| WITHDRAWAL | 6 | **Transfer, matchable** (cash OUT — −$162K; not expense) | Transfers (200) — surfaces in Transfer Analysis |
| PAYMENT | 1 | **Review** (ambiguous −$1,500) | uncategorized → review queue |

- **All promoted rows land `accepted=FALSE`** (review-queue, matches CR022) — the categorizer pre-fills a *suggested* category; nothing auto-accepts.
- **Suppressed types** (LOAN/JOURNALED/OPTIONEXPIRATION) stay in `bankfeed_staging` with a "suppressed" marker, never promote (auditable, net-zero, keeps cash flow clean).
- `trade_treatment` default is `offset` (conservative). Set Options→`income`; equity/IRA/Fixed-Income→`offset`.
- **Why per-account, not per-transaction:** option and equity trades share `BUY`/`SELL`; Fidelity segregates options into their own account, so a per-account toggle resolves them cleanly where an `is_option` flag would be fragile.

### 3.4 Account states (extends CR022 R1)
`account_source_mappings` (source='bank-feed') gains two columns:
- `trade_treatment VARCHAR(20) DEFAULT 'offset'` — `offset` | `income`, governs BUY/SELL routing.
- `balance_from_feed BOOLEAN DEFAULT FALSE` — when TRUE, balance-sheet reads `bankfeed_balances` for this account's mapped fin account.

## 4. Phased Plan

### Phase 1 — Balance correctness (no bank-feed dependency)
1. Migration `025_fidelity_feeds.sql`: `bankfeed_balances` table; `account_source_mappings.trade_treatment`, `.balance_from_feed`.
2. Ingest `/v1/balances` → `bankfeed_balances` (orchestrator step + cron hook).
3. `balanceSheetFetcher.js` read-override for `balance_from_feed` accounts (as-of ≥ earliest cached; else existing additive).
4. Map the 5 accounts (Rollover IRA→26, Stocks→27, Options→28, Cash Mgmt→30, Fixed Income→31), set `balance_from_feed=TRUE`, leave Individual ignored.
5. ps-anchor cleanup (delete account-26 anchor; confirm skip-guard).
6. Tests: read-override unit (feed vs additive by as-of date), `bankfeed_balances` ingest idempotency.

### Phase 2 — Investment-activity cash flow (after bank-feed handoff lands)
7. bank-feed: add `activity_type` to `/v1/transactions` (the handoff).
8. fin converter: carry `activity_type` into `bankfeed_staging`.
9. Fidelity categorizer: the §3.3 routing (income / offset / per-account trade_treatment / transfer / suppress) at promote.
10. Mapping UI: `trade_treatment` control + `balance_from_feed` toggle on the Bank Feed Setup page.
11. Un-ignore + map the Fidelity accounts; promote; review queue triage.
12. Tests: each activity_type → expected treatment; `trade_treatment=income` vs `offset` for BUY/SELL; REI offset pairing; CONTRIBUTION/WITHDRAWAL transfer; suppress types not promoted.

### Phase 3 — Observation
Reconcile each mapped account's `feed_balances` vs the balance sheet; confirm cash flow shows interest/dividend/option income and that CONTRIBUTION/WITHDRAWAL match as transfers.

## 5. Schema — `025_fidelity_feeds.sql`
```sql
BEGIN;
CREATE TABLE IF NOT EXISTS bankfeed_balances (
    id BIGSERIAL PRIMARY KEY,
    feed_account_external_id VARCHAR(100) NOT NULL,   -- bank-feed Account UUID
    balance DECIMAL(20,4) NOT NULL,
    currency CHAR(3) NOT NULL,
    balance_date DATE NOT NULL,
    source VARCHAR(20) NOT NULL,                       -- 'fintable'
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    raw JSONB,
    UNIQUE(feed_account_external_id, balance_date, source)
);
CREATE INDEX IF NOT EXISTS idx_bfb_account_date
  ON bankfeed_balances(feed_account_external_id, balance_date DESC);

ALTER TABLE account_source_mappings
  ADD COLUMN IF NOT EXISTS trade_treatment VARCHAR(20) NOT NULL DEFAULT 'offset',
  ADD COLUMN IF NOT EXISTS balance_from_feed BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;
```
Rollback drops both columns and the table; safe (only the read-override and categorizer read them).

## 6. Risks
- **Phase 2 gated on the cross-repo change** — single-CR sequencing (user choice) means the whole CR ships after the bank-feed `activity_type` lands. Phase 1 is built and testable independently in the meantime.
- **Activity-type completeness** — §3.3 enumerates all 11 types seen in the live 338 rows, but SnapTrade can emit others (FEE, OPTIONASSIGNMENT, MERGER, …). The categorizer must have a **fail-safe default** (unknown type → uncategorized → review queue, never silently dropped or mis-booked).
- **Read-override boundary** — a visible step at 2026-05-30 where accounts jump from the (wrong) additive value to the (correct) feed value. Accepted per §9 Q-history; document it on the report.
- **CONTRIBUTION/WITHDRAWAL transfer matching** — the other leg may be a PKO/bank-feed cash row or external; unmatched ones sit as transfers (excluded from income/expense), which is still correct for cash flow.
- **Options noise** — 181 rows, mostly LOAN/JOURNALED/OPTIONEXPIRATION suppressed; the income signal is the ~90 BUY/SELL rows.

## 7. bank-feed handoff (to append to `~/Programs/fin/bank-feed/HANDOFFS.md`)
`## YYYY-MM-DD [Finance → bank-feed] Expose SnapTrade activity_type on /v1/transactions` — add an additive optional `activity_type` (string|null) to the Transaction shape on `/v1/transactions` (and the contract README), populated from `raw.parsed.type` for SnapTrade rows (null for GoCardless). Enables fin (CR024 Phase 2) to categorize Fidelity income vs. trades. Additive within v1; no consumer breakage. `units`/`price`/`symbol`/`option_type` are **not** needed yet (deferred to CR020).

## 8. Tests
Backend Jest: categorizer routing per activity_type; trade_treatment income/offset; REI offset; CONTRIBUTION/WITHDRAWAL transfer; suppress-not-promoted; unknown-type fail-safe → review. Read-override: feed value for as-of ≥ earliest, additive for earlier; `bankfeed_balances` ingest idempotency. Smoke: balance-sheet for a feed-owned account returns the feed value; a Fidelity refresh promotes categorized rows.

## 9. Resolved mapping decisions
- **Q1 — Fixed Income mapping → RESOLVED: feed `Fixed Income` → leaf 31 Fidelity Bond.** COA structure (confirmed with user 2026-06-02): **29 "Fidelity Fixed Income" is a parent *category*** (top-level, `parent_id=1`) that rolls up **30 Fidelity Cash Mgt** + **31 Fidelity Bond**. The feed's two accounts map to the two leaves (Cash Management→30, Fixed Income→31); the read-override sits on the leaves and 29 aggregates them — 29 is **not** mapped or retired. *Note (not CR024 scope):* forecast modules 94 (2026 Base) + 167 (2026 Downside) forecast at the parent 29 with hand-entered `market_value` $1,241,052 — legitimate roll-up forecasting, but that figure now under-states the fed reality (~$1.99M = $790K + $1.20M); the user may want to revisit the forecast base once the feed lands.
- **Q2 — Options income category → RESOLVED: 76 "Option Trade"** (income). The near-duplicate 219 "Options Trading" (0 references) was **deleted from prod 2026-06-02**.

## 10. Decision log
- **2026-06-02** — CR opened. Scope resolved with user: (1) brokerages **value-only** feed_balances anchor, no lot tracking; (2) mechanism = **balance-sheet read-override**; (3) pre-feed history = **existing additive value unchanged**; (4) **import + categorize** activity for cash flow, interest/dividend income a must across all accounts, option buy/sell → **cash-basis** income, non-option buy/sell → auto-offset; (5) **single CR, both phases**; (6) trade handling = **per-account `trade_treatment`** setting (user's refinement, validated against data); (7) CONTRIBUTION/WITHDRAWAL = **transfer, matchable**. Activity-type mapping grounded in the live 338-row inventory.
