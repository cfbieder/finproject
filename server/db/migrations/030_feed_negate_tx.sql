-- 030_feed_negate_tx.sql — CR023/CR028 per-mapping transaction-sign flip.
--
-- Some upstreams behind fintable report a feed's TRANSACTIONS with the opposite
-- sign to fin's convention. Two independent things can be flipped per account:
--   * BALANCE sign  → already handled by `feed_sign` (migration 029): the
--       monitor/reconcile compute expected = feed_balance * COALESCE(feed_sign, ...).
--   * TRANSACTION sign → THIS column. When TRUE, the bank-feed promote negates a
--       row's amount + base_amount so it lands in fin's convention.
--
-- They are independent: e.g. Chase credit cards report purchases POSITIVE and
-- balance POSITIVE-owed → feed_negate_tx=TRUE (flip tx) + feed_sign=NULL (default
-- liability -1 for the balance). PKO VISA reports tx NEGATIVE (already fin's
-- convention) but balance POSITIVE → feed_negate_tx=FALSE + feed_sign=NULL.
-- Plaid/US cards like the Luxury/Amex report both negative → both no-flip
-- (feed_negate_tx=FALSE, feed_sign=+1).
--
-- Governs FUTURE promotes only (does not rewrite already-promoted rows) — set it
-- before an account's feed transactions are imported.
--
-- Idempotent. Apply to dev (:5434) and prod (:5433) DBs manually, prod-before-code.

BEGIN;

ALTER TABLE account_source_mappings
  ADD COLUMN IF NOT EXISTS feed_negate_tx BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;

-- Rollback:
--   ALTER TABLE account_source_mappings DROP COLUMN IF EXISTS feed_negate_tx;
