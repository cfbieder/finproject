-- ---------------------------------------------------------------------------
-- 069_wise_calibration_plug_not_a_loss.sql — CR080 Part A, corrected
--
-- Migration 065 booked two rows it labelled "Pre-feed reconciling difference
-- (origin predates feed history)" — −23.83 on `Wise - USD` (8) and −7.50 on
-- `WISE - EUR` (13), dated 2026-06-04, to `Unrealized G/L` (88). They were
-- neither unexplained nor a loss. This moves them into `opening_balance`, where
-- they belong, and removes a $32.56 investment loss that never happened.
--
-- ── The reasoning 065 got wrong ──────────────────────────────────────────────
--
-- 065 argued: at 2026-06-05 fin sat ABOVE the feed by 23.83 / 7.50; unbooked
-- yield pushes fin BELOW the feed; therefore that offset cannot be yield and must
-- be a separate, older, unattributable error.
--
-- The premise holds only for a ledger nobody has re-anchored. The owner reports
-- (2026-08-11) having CALIBRATED these accounts for months — and `calibrate()`
-- rewrites `opening_balance`, which shifts EVERY historical date by one constant.
-- A calibration in August therefore drags June's balance up with it, and fin
-- sitting above the feed in June is precisely what a later calibration looks
-- like. The sign test was answering a question about a static ledger that these
-- accounts had not been for months.
--
-- The data says the same thing without needing the owner's account of it. If a
-- calibration happened on date T, the gap must be a straight line through zero
-- at T — and it is: account 8 runs −23.83 (06-05) → 0.00 (08-01/08-02) → +2.79
-- (08-10), account 13 −7.50 → ≈0 (08-03/08-04) → +0.39. Both cross zero in the
-- first days of August. Nothing was logged, because `calibrate()` overwrites
-- `opening_balance` with no audit row at all — which is why 065 could not see it
-- and reached for "unexplained" instead.
--
-- ── Why opening_balance is the right home, having argued the opposite ────────
--
-- 065 refused `opening_balance` on the grounds that it would "move four years of
-- history by an amount that demonstrably did not exist for most of it". That is
-- backwards here: the calibration plug is ALREADY IN `opening_balance`. This does
-- not introduce a smear, it moves 23.83 / 7.50 OUT of the existing one and onto
-- the dated rows 065 already booked. History gets more correct, not less.
--
-- The proof is that every anchor now ties, not just today's balance. With the
-- restatement rows dropped and `opening_balance` reduced, fin equals the feed TO
-- THE CENT at all four measured dates on each account:
--
--   Wise - USD  06-05 4227.04 · 06-30 4225.23 · 07-30 4133.37 · 08-07 4102.05
--   WISE - EUR  06-05 5292.05 · 06-30 2175.23 · 07-31 1721.26 · 08-09 1459.25
--
-- Eight dates, two accounts, zero difference. A wrong split cannot do that; it
-- would tie at the plug's own date and drift everywhere else.
--
-- ── What this does and does not change ──────────────────────────────────────
--
-- Balances: NOTHING moves. The rows being deleted are dated 2026-06-04, before
-- every anchor, so removing them and reducing `opening_balance` by the same
-- amount is balance-neutral on every date. This is a P&L correction only.
--
-- P&L: `Unrealized G/L` loses a fabricated −32.56 (USD equivalent) in 2026-06.
-- `Interest Income` is UNCHANGED at 25.43 USD / 7.89 EUR — the dated yield rows
-- 065 booked were right and are not touched.
--
-- Still not recoverable: yield earned BEFORE 2026-06-05. The feed holds no
-- observation before that date, so there is nothing to measure it against, and
-- it stays lumped in `opening_balance` along with every other pre-history
-- effect. Reconstructing it would need Wise's own statements, which is a
-- separate exercise and not attempted here.
--
-- Idempotent: guarded on the restatement rows still existing, so the
-- `opening_balance` reduction can never be applied twice. Skips cleanly on a
-- database that does not hold these rows.
-- ---------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
    r          RECORD;
    n_moved    INTEGER := 0;
    plug       NUMERIC;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES (8, 23.83), (13, 7.50)) AS v(acct, amt)
    LOOP
        -- Only act while the row is still there. This is what makes the
        -- opening_balance arithmetic safe to re-run: no row, no adjustment.
        SELECT ROUND(SUM(t.amount), 2) INTO plug
          FROM transactions t
         WHERE t.account_id = r.acct
           AND t.source = 'restatement'
           AND t.transaction_date = DATE '2026-06-04';

        IF plug IS NULL THEN
            RAISE NOTICE '069 SKIP: account % has no 2026-06-04 restatement row', r.acct;
            CONTINUE;
        END IF;

        -- Refuse on anything but the exact expected plug: a different amount
        -- means the ledger is not the one this correction was derived against,
        -- and moving an unknown number into opening_balance is unrecoverable.
        IF plug <> -r.amt THEN
            RAISE EXCEPTION
              '069: account % restatement is % , expected % — not the ledger this was measured against',
              r.acct, plug, -r.amt;
        END IF;

        DELETE FROM transactions
         WHERE account_id = r.acct
           AND source = 'restatement'
           AND transaction_date = DATE '2026-06-04';

        UPDATE accounts
           SET opening_balance = opening_balance - r.amt
         WHERE id = r.acct;

        n_moved := n_moved + 1;
    END LOOP;

    IF n_moved = 0 THEN
        RAISE NOTICE '069 SKIP: nothing to move — already applied, or a data-free database';
    ELSE
        RAISE NOTICE '069 OK: % account(s) — calibration plug moved out of Unrealized G/L into opening_balance', n_moved;
    END IF;
END $$;

-- ── Post-condition: every measured anchor ties to the feed, to the cent ──────
DO $$
DECLARE
    r        RECORD;
    computed NUMERIC;
    n_ok     INTEGER := 0;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            (8,  DATE '2026-06-05', 4227.04), (8,  DATE '2026-06-30', 4225.23),
            (8,  DATE '2026-07-30', 4133.37), (8,  DATE '2026-08-07', 4102.05),
            (13, DATE '2026-06-05', 5292.05), (13, DATE '2026-06-30', 2175.23),
            (13, DATE '2026-07-31', 1721.26), (13, DATE '2026-08-09', 1459.25)
        ) AS v(acct, as_of, feed)
    LOOP
        SELECT a.opening_balance + COALESCE(SUM(t.amount), 0)
          INTO computed
          FROM accounts a
          LEFT JOIN transactions t
            ON t.account_id = a.id
           AND t.transaction_date >= a.opening_balance_date
           AND t.transaction_date <= r.as_of
         WHERE a.id = r.acct
         GROUP BY a.opening_balance;

        IF computed IS NULL THEN CONTINUE; END IF;

        IF ROUND(computed, 2) <> r.feed THEN
            RAISE EXCEPTION
              '069: account % computes % at %, feed reported % — the split is wrong',
              r.acct, ROUND(computed, 2), r.as_of, r.feed;
        END IF;
        n_ok := n_ok + 1;
    END LOOP;

    IF n_ok = 0 THEN
        RAISE NOTICE '069: no anchors checked — data-free database';
    ELSE
        RAISE NOTICE '069 OK: % anchor(s) tie to the feed to the cent', n_ok;
    END IF;
END $$;

COMMIT;

-- Rollback (restores the fabricated loss — only to undo a mistaken apply):
--   UPDATE accounts SET opening_balance = opening_balance + 23.83 WHERE id = 8;
--   UPDATE accounts SET opening_balance = opening_balance + 7.50  WHERE id = 13;
--   …then re-insert the two 2026-06-04 rows from migration 065.
