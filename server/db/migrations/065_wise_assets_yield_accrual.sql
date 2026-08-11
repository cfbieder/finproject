-- ---------------------------------------------------------------------------
-- 065_wise_assets_yield_accrual.sql — the yield Wise never posts as a transaction
--
-- `Wise - USD` (8) and `WISE - EUR` (13) are **Wise Assets** balances: the money
-- is held in a money-market fund, not as plain cash. The feed proves it — it
-- delivers the monthly service fee
--
--     ACCRUAL_CHECKOUT-invoice-30010473 -- USD Assets service fee   -0.53
--     ACCRUAL_CHECKOUT-invoice-30010350 -- EUR Assets service fee   -0.22
--
-- but never the yield those fees are charged against. The fund's value accrues
-- daily and the balance climbs with no transaction behind it, so fin drifts
-- below the feed a little every day and neither existing reconcile mode fixes it:
--
--   `calibrate` folds a RECURRING flow into a single constant at opening —
--     today becomes right and every prior date becomes wrong by the movement it
--     swallowed (the failure migration 046 documents), and the drift is back
--     tomorrow.
--   `mtm` books the right SHAPE (a dated plug row) but to `Unrealized G/L` (88),
--     an expense category. Money-market yield is income. Booked there it never
--     appears in income, budget, or anything tax-facing, and it is on the wrong
--     side of the P&L.
--
-- Both accounts are currently set to `mtm` and have never had a single `mtm` row
-- written, so nothing has been booked either way. This migration books the
-- history; CR080 adds the `accrue` mode so it stops recurring.
--
-- ── How the amounts were measured ──────────────────────────────────────────────
--
-- Accrual over a period = the CHANGE in (feed − fin) across it. That needs no
-- rate model, but it does need endpoints the feed has settled: this feed syncs in
-- the small hours and its lag jitters by a day, so a row dated D may hold the
-- close of D−1 (CR065 §11). Endpoints were therefore taken only on dates sitting
-- inside a transaction-free run, where comparing the feed against fin same-day
-- and against fin lagged one day give the SAME gap. On any other date the
-- comparison is contaminated by rows one side has and the other has not.
--
-- Wise - USD (8), gap = feed − fin:
--     2026-06-05  -23.83   (first feed observation)
--     2026-06-30  -13.64   → +10.19 over 25 days = 0.408/day
--     2026-07-30   -1.61   → +12.03 over 30 days = 0.401/day
--     2026-08-07   +1.60   →  +3.21 over  8 days = 0.401/day
--
-- WISE - EUR (13):
--     2026-06-05   -7.50
--     2026-06-30   -3.91   → +3.59 over 25 days  ≈ 2.2%/yr
--     2026-07-31   -0.30   → +3.61 over 31 days  ≈ 2.1%/yr
--     2026-08-09   +0.39   → +0.69 over  9 days  ≈ 1.8%/yr
--
-- Three independent intervals per account, each implying the same annualised
-- yield (~3.6% USD, ~2.1% EUR). A missing transaction does not accrue linearly.
--
-- ── Why there is also a restatement row ───────────────────────────────────────
--
-- Both gaps START NEGATIVE: at 2026-06-05 fin was ABOVE the feed by 23.83 / 7.50.
-- Unbooked yield pushes fin BELOW the feed, so that offset is a different error,
-- and it predates every feed observation fin holds (the feed history begins
-- 2026-06-05) — there is no evidence left to attribute it. Booking the CURRENT
-- gap as one interest row would have hidden it: today's +2.79 on the USD account
-- is 26.62 of yield NET of a 23.83 error, so a single plug would have understated
-- 2026 interest by ~24 and retired the old error into income silently.
--
-- It is therefore booked separately, dated 2026-06-04 (the day before the
-- evidence starts), to `Unrealized G/L` (88) — an unexplained valuation shortfall
-- on a fund-held balance — with `source = 'restatement'`. NOT folded into
-- `opening_balance`: these accounts carry rows back to 2022 and an opening-balance
-- tweak would silently move four years of history by an amount that demonstrably
-- did not exist for most of it.
--
-- ── Also fixed here ──────────────────────────────────────────────────────────
--
-- `WISE - EUR` 2026-08-02 `BALANCE-5794451815 -- Converted 34.99 CHF to 37.52 EUR`
-- (+37.52) is categorised `Interest Income` (74). It is an FX conversion, not
-- income, and it inflates the category by 37.52 — which is 4.75x the entire real
-- 2026 yield on that account. There is no CHF account in fin, so the correct
-- category is `Transfer - FX` (208). Balance-neutral; the tie-outs below are
-- unaffected either way.
--
-- ── Safety ───────────────────────────────────────────────────────────────────
--
-- Idempotent: every insert is guarded on (account_id, source, transaction_date)
-- so a re-run is UPDATE/INSERT 0. Skips cleanly on a database that does not hold
-- these accounts (CI applies the whole chain to an empty Postgres — see
-- migration 046's amendment note on why an unconditional check must not abort).
-- Asserts the reconciliation invariant at the end: each account's computed
-- balance must equal the feed observation it was measured against, to the cent,
-- or the migration aborts.
--
-- Apply to dev (:5434) first, then prod (:5433), before deploying CR080's code.
-- ---------------------------------------------------------------------------

BEGIN;

-- Yield accruals (source 'accrual' — the tag CR080's `accrue` mode owns, so a
-- later re-mark of the same date supersedes rather than duplicates).
INSERT INTO transactions
  (transaction_date, description1, amount, currency, base_amount, base_currency,
   account_id, category_id, source, accepted)
SELECT v.d::date,
       'Wise Assets yield accrual (feed-derived)',
       v.amt,
       a.currency,
       ROUND(v.amt * (
         SELECT r.rate FROM exchange_rates r
          WHERE r.from_currency = a.currency AND r.to_currency = 'USD'
          ORDER BY (r.rate_date <= v.d::date) DESC, ABS(r.rate_date - v.d::date) ASC
          LIMIT 1
       ), 2),
       'USD',
       a.id,
       74,          -- Interest Income
       'accrual',
       TRUE
  FROM (VALUES
          (8,  '2026-06-30', 10.19),
          (8,  '2026-07-30', 12.03),
          (8,  '2026-08-07',  3.21),
          (13, '2026-06-30',  3.59),
          (13, '2026-07-31',  3.61),
          (13, '2026-08-09',  0.69)
       ) AS v(acct, d, amt)
  JOIN accounts a ON a.id = v.acct
 WHERE NOT EXISTS (
         SELECT 1 FROM transactions t
          WHERE t.account_id = v.acct
            AND t.source = 'accrual'
            AND t.transaction_date = v.d::date
       );

-- The pre-feed-history reconciling difference (see header).
INSERT INTO transactions
  (transaction_date, description1, amount, currency, base_amount, base_currency,
   account_id, category_id, source, accepted)
SELECT v.d::date,
       'Pre-feed reconciling difference (Wise Assets, origin predates feed history)',
       v.amt,
       a.currency,
       ROUND(v.amt * (
         SELECT r.rate FROM exchange_rates r
          WHERE r.from_currency = a.currency AND r.to_currency = 'USD'
          ORDER BY (r.rate_date <= v.d::date) DESC, ABS(r.rate_date - v.d::date) ASC
          LIMIT 1
       ), 2),
       'USD',
       a.id,
       88,          -- Unrealized G/L
       'restatement',
       TRUE
  FROM (VALUES
          (8,  '2026-06-04', -23.83),
          (13, '2026-06-04',  -7.50)
       ) AS v(acct, d, amt)
  JOIN accounts a ON a.id = v.acct
 WHERE NOT EXISTS (
         SELECT 1 FROM transactions t
          WHERE t.account_id = v.acct
            AND t.source = 'restatement'
            AND t.transaction_date = v.d::date
       );

-- The CHF→EUR conversion miscategorised as Interest Income.
UPDATE transactions
   SET category_id = 208            -- Transfer - FX
 WHERE account_id = 13
   AND transaction_date = '2026-08-02'
   AND category_id = 74
   AND description1 LIKE 'BALANCE-5794451815%';

-- ── Reconciliation invariant ─────────────────────────────────────────────────
-- Each account's computed balance, over exactly the window every read uses
-- (>= opening_balance_date), must now equal the settled feed observation the
-- accrual was measured against.
DO $$
DECLARE
    r          RECORD;
    n_checked  INTEGER := 0;
    computed   NUMERIC;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            (8,  DATE '2026-08-07', 4102.05),
            (13, DATE '2026-08-09', 1459.25)
        ) AS v(acct, as_of, expected)
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

        IF computed IS NULL THEN
            RAISE NOTICE '065 SKIP: account % not present — data-free database', r.acct;
            CONTINUE;
        END IF;

        IF ROUND(computed, 2) <> r.expected THEN
            RAISE EXCEPTION
              '065: account % computes % at %, expected % (feed observation). '
              'The ledger is not what these amounts were measured against — '
              'do not force; re-derive the accrual from the current feed history.',
              r.acct, ROUND(computed, 2), r.as_of, r.expected;
        END IF;

        n_checked := n_checked + 1;
    END LOOP;

    IF n_checked = 0 THEN
        RAISE NOTICE '065 SKIP: neither Wise Assets account present — nothing to book';
    ELSE
        RAISE NOTICE '065 OK: % Wise Assets account(s) tie to the feed to the cent', n_checked;
    END IF;
END $$;

COMMIT;

-- Rollback:
--   DELETE FROM transactions WHERE account_id IN (8,13)
--     AND source = 'accrual' AND transaction_date IN
--       ('2026-06-30','2026-07-30','2026-08-07','2026-07-31','2026-08-09');
--   DELETE FROM transactions WHERE account_id IN (8,13)
--     AND source = 'restatement' AND transaction_date = '2026-06-04';
--   UPDATE transactions SET category_id = 74 WHERE account_id = 13
--     AND transaction_date = '2026-08-02' AND description1 LIKE 'BALANCE-5794451815%';
