-- ---------------------------------------------------------------------------
-- 045_retire_2000_sentinel.sql — finish what migration 022 started
--
-- Every balance in fin is read as
--
--     opening_balance + SUM(amount) WHERE transaction_date >= opening_balance_date
--
-- so `opening_balance_date` is a FLOOR: any transaction dated before it is
-- invisible to the Balance Sheet, Balance Trends, and every report.
--
-- Migration 022 moved all accounts off the `2000-01-01` sentinel to
-- `1990-01-01` and set the column DEFAULT accordingly. But `accounts.create()`
-- hard-coded `'2000-01-01'`, so every account created afterwards RE-INTRODUCED
-- the sentinel 022 existed to remove — 11 of them by 2026-07-30. That code path
-- is fixed in the same commit as this migration; this cleans up the rows it
-- already made.
--
-- Only ONE of the 11 currently hides anything: `Chase Checking` holds a
-- 1999-12-31 row worth 1,950.61, invisible to every read. The other ten are
-- latent — harmless today, but any pre-2000 row added later (a Quicken
-- backfill, say) would silently vanish. Both are fixed the same way.
--
-- TODAY'S BALANCE IS PRESERVED EXACTLY. Lowering the floor would otherwise
-- pull previously-hidden rows into every balance, so `opening_balance` is
-- reduced by precisely the amount those rows contribute. That is the same
-- preserve-today reasoning as CR058's calibration mode: the current balance is
-- feed-owned and already correct, so the correction belongs in the plug.
-- ---------------------------------------------------------------------------

BEGIN;

-- Snapshot every affected account's displayed balance BEFORE the change, so the
-- verification below compares against something real rather than re-deriving
-- the same arithmetic and proving nothing.
CREATE TEMP TABLE _sentinel_before ON COMMIT DROP AS
SELECT a.id,
       a.name,
       (a.opening_balance + COALESCE((
          SELECT SUM(t.amount) FROM transactions t
           WHERE t.account_id = a.id
             AND t.transaction_date >= a.opening_balance_date
             AND t.transaction_date <= CURRENT_DATE), 0)) AS balance_before,
       COALESCE((
          SELECT SUM(t.amount) FROM transactions t
           WHERE t.account_id = a.id
             AND t.transaction_date >= DATE '1990-01-01'
             AND t.transaction_date <  DATE '2000-01-01'), 0) AS newly_visible
  FROM accounts a
 WHERE a.opening_balance_date = DATE '2000-01-01';

-- Re-plug by exactly what the lower floor makes visible, then lower the floor.
UPDATE accounts a
   SET opening_balance = a.opening_balance - b.newly_visible,
       opening_balance_date = DATE '1990-01-01'
  FROM _sentinel_before b
 WHERE a.id = b.id;

-- ---------------------------------------------------------------------------
-- Verification — fail loud rather than commit a moved balance.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    n_left     INTEGER;
    n_moved    INTEGER;
    worst      NUMERIC;
    detail     TEXT;
BEGIN
    SELECT COUNT(*) INTO n_left FROM accounts WHERE opening_balance_date = DATE '2000-01-01';
    IF n_left <> 0 THEN
        RAISE EXCEPTION '045: % account(s) still on the 2000-01-01 sentinel', n_left;
    END IF;

    SELECT COUNT(*), MAX(ABS(diff)), string_agg(name || ' ' || diff::text, '; ')
      INTO n_moved, worst, detail
      FROM (
        SELECT b.name,
               (a.opening_balance + COALESCE((
                  SELECT SUM(t.amount) FROM transactions t
                   WHERE t.account_id = a.id
                     AND t.transaction_date >= a.opening_balance_date
                     AND t.transaction_date <= CURRENT_DATE), 0)) - b.balance_before AS diff
          FROM accounts a JOIN _sentinel_before b ON b.id = a.id
      ) q
     WHERE ABS(diff) > 0.005;

    IF n_moved > 0 THEN
        RAISE EXCEPTION '045: today''s balance moved on % account(s) (worst %): %',
              n_moved, worst, detail;
    END IF;

    RAISE NOTICE '045 OK: sentinel retired on % account(s), every balance unchanged',
          (SELECT COUNT(*) FROM _sentinel_before);
END $$;

COMMIT;
