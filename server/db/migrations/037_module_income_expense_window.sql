-- 037 — CR046: start/end window for a module's amount-based income and expense streams.
--
-- Until now a module's income_amount / expense_amount ran for the whole horizon,
-- compounding at inflation from the base year. The only thing that could delay them was
-- CR041's ownership gate, which fires only when the asset is ACQUIRED mid-plan (base MV 0).
-- So "I own this flat today and start renting it in 2030" was inexpressible: the rent ran
-- from day one.
--
-- These four nullable columns bound each stream. NULL = unbounded, i.e. exactly today's
-- behavior — every existing scenario stays byte-identical. The amount itself is unchanged:
-- still a BASE-YEAR figure compounded at inflation, so only the window moves.
--
-- DATE (not year) to match base_date / disposal_date / investment_date; the engine reads
-- the calendar year off it, as it does everywhere else.

ALTER TABLE forecast_modules
  ADD COLUMN income_start_date  DATE,
  ADD COLUMN income_end_date    DATE,
  ADD COLUMN expense_start_date DATE,
  ADD COLUMN expense_end_date   DATE;

COMMENT ON COLUMN forecast_modules.income_start_date  IS 'CR046: first year the income stream pays (NULL = from base year / ownership)';
COMMENT ON COLUMN forecast_modules.income_end_date    IS 'CR046: last year the income stream pays (NULL = to end of horizon)';
COMMENT ON COLUMN forecast_modules.expense_start_date IS 'CR046: first year the expense stream is incurred (NULL = from base year / ownership)';
COMMENT ON COLUMN forecast_modules.expense_end_date   IS 'CR046: last year the expense stream is incurred (NULL = to end of horizon)';
