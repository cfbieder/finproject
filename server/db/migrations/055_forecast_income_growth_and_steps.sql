-- 055 — income that a BUSINESS can express: a growth rate of its own, and
--       permanent step changes in a named year (CR064 P6).
--
-- THE GAP. A module's recurring income has exactly two modes today, and they are
-- mutually exclusive:
--
--   amount mode  (no IncomePct rows)  income_amount, compounded at EXACTLY inflation
--   yield  mode  (any IncomePct row)  avg(market value) × (inflation + spread)
--
-- The second one wins on a single row — `hasIncomePct` in fcbuilder-module.js — and
-- when it does, `income_amount` contributes NOTHING to the income series. CR003 built
-- IncomePct as a deposit interest rate ("income = avg(MV) × rate%"), which is exactly
-- right for Fidelity Fixed Income and exactly wrong for a business: a company's profit
-- is not a percentage of its own valuation, and the owner's typed figure is discarded.
--
-- MEASURED ON PROD (2026-08-02). All six income-bearing modules carry a yield row, so
-- all six have a dead Income Amount. United Beverages: 192,266 PLN typed, and the
-- engine books 77,163 USD for 2027 = avg(3,846,154 / 3,870,192) × (2.5% − 0.5%) —
-- matching to the dollar. The typed figure survives in exactly one place, the deferred
-- base-year income tax (2027 = 30% × 192,266 PLN = 14,790 USD, against 23,149 for
-- every later year), so the first projected year is taxed on a number the income series
-- never books. That inconsistency is fixed in the engine alongside this migration.
--
-- WHAT THIS ADDS. Amount mode gains the two controls a business needs:
--
--   income_growth_rate         multiplier of inflation, exactly like the module's
--                              existing `growth_rate` for VALUE (1 = inflation,
--                              0 = flat in nominal terms, 0.5 = half of inflation).
--                              NULL = 1 = today's behaviour.
--
--   forecast_module_income_steps   permanent level changes: "2027: +10,000 PLN",
--                              "2031: −25,000". Owner's decision (2026-08-02): the
--                              amount is typed in the money of the year it happens and
--                              KEEPS ITS REAL VALUE afterwards, so it compounds from
--                              its own year at the stream's growth rate rather than
--                              eroding across a 36-year horizon. A step applies in
--                              FULL in its year — it is a change to the annual
--                              run-rate, not an event with a date, so it deliberately
--                              does NOT take the July-1 half-year convention that
--                              CR046's window and CR062's draw year use.
--
-- Steps are STORED and the series is DERIVED on every generate. Materialising 36 rows
-- of computed income would rot the moment the growth rate changed — the CR049/CR050
-- lesson, and the same reason CR062 derives a loan's amortization instead of writing
-- it out.
--
-- DORMANT. The column is nullable and the table is empty, so `income_growth_rate IS
-- NULL` ⇒ multiplier 1 and no steps ⇒ every existing scenario regenerates
-- byte-for-byte. Verified on a copy of prod before this was kept.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS; re-run verified.

BEGIN;

ALTER TABLE forecast_modules
  ADD COLUMN IF NOT EXISTS income_growth_rate NUMERIC(10,4);

COMMENT ON COLUMN forecast_modules.income_growth_rate IS
  'CR064 — multiplier of inflation for amount-based income (1 = inflation, 0 = flat nominal). NULL = 1.';

-- Mirrors forecast_module_income_pct exactly: same key, same cascade, same
-- one-row-per-year uniqueness. `amount` is signed — a step down is how a business
-- losing a contract is expressed, and it is the same field.
CREATE TABLE IF NOT EXISTS forecast_module_income_steps (
  id             SERIAL PRIMARY KEY,
  module_id      INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  amount         NUMERIC(15,2) NOT NULL,
  UNIQUE (module_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_fc_module_income_steps_module
  ON forecast_module_income_steps (module_id);

-- ---------------------------------------------------------------------------
-- Post-conditions. A half-applied migration must roll back rather than leave the
-- engine reading a column that is not there.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM information_schema.columns
   WHERE table_name = 'forecast_modules' AND column_name = 'income_growth_rate';
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 055: forecast_modules.income_growth_rate is missing';
  END IF;

  SELECT COUNT(*) INTO n FROM information_schema.tables
   WHERE table_name = 'forecast_module_income_steps';
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 055: forecast_module_income_steps is missing';
  END IF;

  -- Dormancy is REPORTED, not asserted. On first apply both counts are zero, which is
  -- what makes "every scenario regenerates byte-for-byte" true. Raising on a non-zero
  -- count would be wrong on a RE-RUN, once the owner has legitimately set a growth rate
  -- — an idempotent migration must not start failing because the feature got used.
  SELECT COUNT(*) INTO n FROM forecast_modules WHERE income_growth_rate IS NOT NULL;
  RAISE NOTICE 'migration 055: % module(s) carry an income growth rate (0 on first apply)', n;

  SELECT COUNT(*) INTO n FROM forecast_module_income_steps;
  RAISE NOTICE 'migration 055: % income step row(s) (0 on first apply)', n;
END $$;

COMMIT;
