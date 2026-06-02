-- 025_fidelity_feeds.sql — CR024 Phase 1 (Fidelity market-value balances).
--
-- Adds the local cache of bank-feed reported balances and two per-account-mapping
-- flags so the balance sheet can read market value from the feed (read-override)
-- for the Fidelity accounts, while their transactions stay suppressed until
-- Phase 2's activity categorizer ships.
--
-- Idempotent (IF NOT EXISTS). Apply to dev (:5434) and prod (:5433) DBs manually
-- (the deploy script does not run migrations).

BEGIN;

-- 1. Local cache of bank-feed reported balances (from the /v1/balances contract).
--    Keyed on the stable feed Account UUID (matches account_source_mappings.external_name).
--    Forward-only daily snapshots; the balance-sheet read-override picks the
--    latest row with balance_date <= asOfDate per feed account.
CREATE TABLE IF NOT EXISTS bankfeed_balances (
    id BIGSERIAL PRIMARY KEY,
    feed_account_external_id VARCHAR(100) NOT NULL,   -- bank-feed Account UUID
    balance DECIMAL(20,4) NOT NULL,
    currency CHAR(3) NOT NULL,
    balance_date DATE NOT NULL,
    source VARCHAR(20) NOT NULL,                       -- 'fintable' (actual upstream)
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    raw JSONB,
    UNIQUE(feed_account_external_id, balance_date, source)
);

CREATE INDEX IF NOT EXISTS idx_bfb_account_date
  ON bankfeed_balances(feed_account_external_id, balance_date DESC);

-- 2. Per-account-mapping flags on the existing source-mappings table [CR024].
--    balance_from_feed — when TRUE, the balance sheet reads this fin account's
--      value from bankfeed_balances (market value), bypassing opening_balance+Σtx.
--    trade_treatment   — Phase 2: how BUY/SELL post for this account
--      ('offset' → Transfer-Securities-Trades, 'income' → cash-basis option P&L).
--    Defaults keep every existing pocketsmith/quicken/bank-feed mapping unchanged.
ALTER TABLE account_source_mappings
  ADD COLUMN IF NOT EXISTS balance_from_feed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trade_treatment VARCHAR(20) NOT NULL DEFAULT 'offset';

COMMIT;
