-- ---------------------------------------------------------------------------
-- 047_forecast_loan_module.sql — CR062 P1: the forecast can model a loan.
--
-- Until now it could not, at all. Liabilities exist as modules (credit cards,
-- tax reserves) but nothing could express a loan's shape: an amount drawn in a
-- year, interest on the declining balance, and principal repaid on a schedule.
-- The only mechanism that worked on a negative balance was a hand-entered
-- `Invest` row per year, and there was no way to charge interest at all —
-- migration 008 dropped `expense_pct`, and the loader hard-codes ExpensePct to
-- 0, so the engine's "liability interest model" has been unreachable from real
-- data ever since.
--
-- FIVE assumptions, stored; the schedule is DERIVED on every generate and never
-- materialized. Writing thirty Invest rows from a wizard is the CR049/CR050 rot
-- pattern: change the rate and the rows keep the old answer while looking
-- authoritative.
--
-- The engine activates on `loan_interest_rate IS NOT NULL`, NOT on
-- `module_type = 'Loan'`. module_type is a user-editable free-text list in
-- Forecast Settings (prod already carries a lowercase 'asset' from a
-- since-fixed code path) and the engine has never read it. Keying behaviour on
-- a string the owner can rename would make a scenario stop computing interest
-- because someone tidied a settings list.
--
-- TWO ROLES, DELIBERATELY SEPARATE:
--   loan_principal  = the % base — the original amount, fixed for the loan's life
--   market_value    = today's outstanding (negative), where the projection starts
-- An existing mortgage carries both (original 400,000 taken 2015, outstanding
-- -250,000 today). A future loan carries the principal, market_value 0, and the
-- draw arrives in loan_start_date's year. No history is reconstructed.
--
-- DORMANT: every column is nullable and the new table starts empty, so a module
-- with no loan_interest_rate behaves exactly as it does today and every existing
-- scenario regenerates byte-for-byte. No backfill. Same pattern as 037/038/039.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE forecast_modules
  ADD COLUMN IF NOT EXISTS loan_principal     NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS loan_start_date    DATE,
  ADD COLUMN IF NOT EXISTS loan_end_date      DATE,
  ADD COLUMN IF NOT EXISTS loan_interest_rate NUMERIC(8,4);

COMMENT ON COLUMN forecast_modules.loan_principal     IS 'CR062: original loan amount in the module currency — the base every amortization % is a percentage OF. NULL = not a loan.';
COMMENT ON COLUMN forecast_modules.loan_start_date    IS 'CR062: year the loan is taken, stored YYYY-07-01 (only the year is read). A draw after the base year injects the principal as cash.';
COMMENT ON COLUMN forecast_modules.loan_end_date      IS 'CR062: final year, stored YYYY-07-01. Its year ALWAYS repays the remaining balance and carries no schedule row.';
COMMENT ON COLUMN forecast_modules.loan_interest_rate IS 'CR062: annual interest %, charged on the AVERAGE outstanding balance. Non-NULL is what makes the engine treat the module as a loan.';

-- The per-year principal schedule. Percentages of loan_principal (owner decision
-- 1: % of the ORIGINAL amount, so Sigma% = 100 is a checkable invariant and it is
-- how amortization plans are actually written — not % of the outstanding, which
-- is declining-balance and never repays).
--
-- Rows cover drawYear+1 .. endYear-1 ONLY. The end year is the remainder year by
-- construction (owner decision 4), which is what makes "the loan ends at zero"
-- true structurally rather than by rounding luck: a straight-line 100/9 stored at
-- 4dp sums to 99.9999% and would otherwise leave a 40-cent residual that trips
-- the balloon warning on the one-click happy path.
--
-- CHECK (pct >= 0) because a negative percentage is a silent re-draw — the
-- balance would grow and nothing downstream would call it out.
CREATE TABLE IF NOT EXISTS forecast_module_amortization (
  id             SERIAL PRIMARY KEY,
  module_id      INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  pct            NUMERIC(8,4) NOT NULL CHECK (pct >= 0),

  UNIQUE(module_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_fc_amortization_module ON forecast_module_amortization(module_id);

COMMENT ON TABLE  forecast_module_amortization       IS 'CR062: per-year principal repayment schedule for a loan module, as a % of forecast_modules.loan_principal. The loan_end_date year is the remainder and has no row here.';
COMMENT ON COLUMN forecast_module_amortization.pct   IS 'CR062: % of the ORIGINAL principal repaid in this year (not % of the outstanding balance).';

-- Fail loud rather than half-apply: on a fresh CI database this proves the whole
-- object set landed, and on a re-run it is a no-op that still asserts.
DO $$
DECLARE
  missing_cols INT;
BEGIN
  SELECT 4 - count(*) INTO missing_cols
    FROM information_schema.columns
   WHERE table_name = 'forecast_modules'
     AND column_name IN ('loan_principal', 'loan_start_date', 'loan_end_date', 'loan_interest_rate');

  IF missing_cols <> 0 THEN
    RAISE EXCEPTION 'CR062 migration 047: % loan column(s) missing from forecast_modules', missing_cols;
  END IF;

  IF to_regclass('public.forecast_module_amortization') IS NULL THEN
    RAISE EXCEPTION 'CR062 migration 047: forecast_module_amortization was not created';
  END IF;
END $$;

COMMIT;
