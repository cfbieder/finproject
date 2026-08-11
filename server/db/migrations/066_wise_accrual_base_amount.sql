-- ---------------------------------------------------------------------------
-- 066_wise_accrual_base_amount.sql — repair NULL base_amount on 065's USD rows
--
-- Migration 065 computed each row's USD `base_amount` with a scalar subquery
-- against `exchange_rates`:
--
--     SELECT rate FROM exchange_rates
--      WHERE from_currency = a.currency AND to_currency = 'USD' ...
--
-- `exchange_rates` holds no USD→USD row (a 1:1 identity nobody stores), so for
-- the three `Wise - USD` accrual rows and its restatement row that subquery
-- returned NULL and the multiply produced NULL. `usdBaseAmount` in
-- `server/src/v2/services/fx.js` special-cases USD as rate 1 for exactly this
-- reason; the migration's inline copy of the rule dropped that case.
--
-- The EUR rows are unaffected (their rates exist and resolved correctly).
--
-- Severity: those four rows were the ONLY USD transactions in the database with
-- a NULL `base_amount` — 409 of 413 USD rows on these accounts carry one, and
-- every other source (pocketsmith, quicken-import, mtm, auto-offset) is at 100%.
-- Any USD-base reporting that sums `base_amount` would silently omit them.
--
-- 065 is already applied and migrations are append-only, so this is a forward
-- repair rather than an edit. It is written as a general rule, not four literal
-- ids: any `accrual`/`restatement` row on a USD-denominated account with a NULL
-- `base_amount` gets `base_amount = amount`, which is the identity 065 should
-- have applied. On a fresh DB where 065 already produced correct values this
-- matches nothing and is a clean no-op.
--
-- Idempotent (`WHERE base_amount IS NULL`; a re-run gives UPDATE 0).
-- ---------------------------------------------------------------------------

BEGIN;

UPDATE transactions t
   SET base_amount = t.amount
  FROM accounts a
 WHERE a.id = t.account_id
   AND t.source IN ('accrual', 'restatement')
   AND t.currency = 'USD'
   AND t.base_amount IS NULL;

DO $$
DECLARE
    n_null INTEGER;
BEGIN
    SELECT COUNT(*) INTO n_null
      FROM transactions
     WHERE source IN ('accrual', 'restatement')
       AND base_amount IS NULL;

    IF n_null > 0 THEN
        RAISE EXCEPTION
          '066: % accrual/restatement row(s) still carry a NULL base_amount — '
          'a non-USD currency with no exchange_rates coverage?', n_null;
    END IF;

    RAISE NOTICE '066 OK: every accrual/restatement row carries a base_amount';
END $$;

COMMIT;

-- Rollback: none meaningful — restoring a NULL would re-create the defect.
