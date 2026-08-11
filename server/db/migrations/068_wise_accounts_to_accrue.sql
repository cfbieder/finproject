-- ---------------------------------------------------------------------------
-- 068_wise_accounts_to_accrue.sql — CR080 Part B, the mode flip
--
-- ⚠️ APPLY **AFTER** THE CODE DEPLOY, not before. This is the one migration in
-- the chain whose order is inverted, and the inversion is deliberate.
--
-- The standing rule is migrations-before-code, because code must not reference
-- objects the database lacks. Here the dependency runs the other way: this
-- migration writes a `reconcile_mode` VALUE that only the new code understands.
-- Applied ahead of the deploy against a build without CR080's engine, the old
-- dispatch — `if mode === 'mtm' … else calibrate` — would route both accounts to
-- `calibrate` on the next Reconcile click, re-anchoring `opening_balance` and
-- destroying exactly the history migration 065 booked.
--
-- The same deploy also removes the trap: `reconcileToFeed` now THROWS on a mode
-- it does not implement instead of falling through to calibrate, so this hazard
-- cannot be re-set by whatever the fourth mode turns out to be. That guard is
-- what makes an out-of-order application of this file merely useless rather than
-- destructive — but it only exists once the code is live, which is why the order
-- still matters for THIS migration.
--
-- Sets `Wise - USD` (8) and `WISE - EUR` (13) to book their money-market yield to
-- `Interest Income` (74) — the category migration 065 already used for the
-- history, so the first `accrue` run continues the same series rather than
-- starting a second one under a different label.
--
-- `WISE - PLN` (20) is deliberately untouched: zero balance, zero gap, no Assets
-- holding — nothing to accrue.
--
-- Idempotent (guarded on the current mode; a re-run gives UPDATE 0). Skips
-- cleanly on a database without these accounts.
-- ---------------------------------------------------------------------------

BEGIN;

UPDATE account_source_mappings m
   SET reconcile_mode = 'accrue',
       accrual_category_id = 74          -- Interest Income
  FROM accounts a
 WHERE a.id = m.account_id
   AND m.source = 'bank-feed'
   AND a.name IN ('Wise - USD', 'WISE - EUR')
   AND m.reconcile_mode <> 'accrue';

DO $$
DECLARE
    n_accrue  INTEGER;
    n_nocat   INTEGER;
BEGIN
    SELECT COUNT(*) FILTER (WHERE m.reconcile_mode = 'accrue'),
           COUNT(*) FILTER (WHERE m.reconcile_mode = 'accrue' AND m.accrual_category_id IS NULL)
      INTO n_accrue, n_nocat
      FROM account_source_mappings m
      JOIN accounts a ON a.id = m.account_id
     WHERE m.source = 'bank-feed' AND a.name IN ('Wise - USD', 'WISE - EUR');

    IF n_accrue = 0 THEN
        RAISE NOTICE '068 SKIP: neither Wise Assets account has a bank-feed mapping — data-free database';

    -- An accrue mapping with no category is a mapping whose own reconcile action
    -- will refuse. Better to fail here than to leave a button that cannot work.
    ELSIF n_nocat > 0 THEN
        RAISE EXCEPTION '068: % accrue mapping(s) have no accrual_category_id', n_nocat;

    ELSIF n_accrue <> 2 THEN
        RAISE EXCEPTION
          '068: expected 2 accrue mappings for the Wise Assets accounts, found % — '
          'account renamed or mapping missing?', n_accrue;

    ELSE
        RAISE NOTICE '068 OK: both Wise Assets accounts now accrue to Interest Income';
    END IF;
END $$;

COMMIT;

-- Rollback:
--   UPDATE account_source_mappings m SET reconcile_mode = 'mtm', accrual_category_id = NULL
--     FROM accounts a WHERE a.id = m.account_id AND m.source = 'bank-feed'
--       AND a.name IN ('Wise - USD', 'WISE - EUR');
