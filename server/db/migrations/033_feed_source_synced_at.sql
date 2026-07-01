-- 033_feed_source_synced_at.sql — CR035 (true upstream feed sync time).
--
-- The bank-feed service now surfaces each connection's real last-sync timestamp
-- (fintable's "⚡ Last Update") on the /v1/balances contract as `source_synced_at`,
-- distinct from balance_date/fetched_at (which track fin's own daily poll). Cache
-- it here so Balance Calibration (CR023) can show true "synced N days ago" — a feed
-- that stopped refreshing upstream is now visible even when fin keeps polling it.
--
-- This corrects the v3.0.43 indicator, which read fetched_at (fin's poll) and so
-- reported "synced today" for a genuinely stale feed.
--
-- Nullable: back-fills as NULL; the next ingest cycle populates the latest row per
-- feed (the only one the recon query reads). No backfill script (the upstream value
-- is a current snapshot — historical sync times are not recoverable).
--
-- Idempotent (IF NOT EXISTS). Apply to dev (:5434) and prod (:5433) DBs manually
-- (the deploy script does not run migrations).

BEGIN;

ALTER TABLE bankfeed_balances
  ADD COLUMN IF NOT EXISTS source_synced_at TIMESTAMPTZ;

COMMIT;
