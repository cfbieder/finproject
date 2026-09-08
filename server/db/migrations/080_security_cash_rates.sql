-- 080_security_cash_rates.sql — CR093 P3, the piece §4a named as still missing.
--
-- What cash, money-market and FDIC-swept deposits PAY.
--
-- P3 shipped an income total that stated its own gap in words: **$201,597 of
-- cash-like holdings do pay interest, and the figure did not include it**. The
-- rate was never a vendor question — the custodian prints it on every statement,
-- between the ticker and the figures, and `parse-fidelity-holdings.js` had to
-- step over the clause to reach the numbers and discarded it on the way past.
--
--   FIDELITY GOVERNMENT MONEY MARKET (SPAXX) -- 7-day yield: 3.29%
--   FDIC INSURED DEPOSIT AT JP MORGAN BK q (QIMHQ) -- Interest rate: 1.82%
--
-- ⚠️ TWO KINDS, STORED APART. A money-market fund's **7-day yield** is an
-- annualised figure derived from the last week's income; an FDIC sweep's
-- **interest rate** is what the bank is paying. Collapsing them to one "rate"
-- would let the income page describe a derived, backward-looking annualisation
-- and a stated bank rate in the same words.
--
-- ⚠️ NEITHER IS CONTRACTUAL, AND THAT DECIDES WHERE THE MONEY GOES. A coupon is
-- owed on a date; these float and can move the week after the statement was
-- printed. So this income is ESTIMATED, never scheduled — the same split
-- `services/income.js` already draws between a bond coupon and a distribution.
--
-- ⚠️ AND IT IS AS OF A STATEMENT, which can be a quarter old. Money-market rates
-- track policy: 7-day yields in this corpus run from **0.06% (2016) to 5.30%
-- (2023)**, so a stale one is not a rounding error and `as_of` is displayed
-- rather than implied. One row per security, latest statement wins — the same
-- shape migration 078 uses for bond terms, and for the same reason.
--
-- Additive and reversible. Nothing reads it until the income page's cash rows.
--   Reversal:  DROP TABLE security_cash_rates;

CREATE TABLE IF NOT EXISTS security_cash_rates (
  -- PRIMARY KEY, not merely a foreign key: one current rate per instrument.
  security_id INTEGER PRIMARY KEY REFERENCES securities(id) ON DELETE CASCADE,
  -- The statement period end this rate was printed on. Displayed, not hidden.
  as_of       DATE NOT NULL,
  -- A PERCENT as printed (3.29 = 3.29%), matching migration 078's coupon_rate,
  -- so the two rates a portfolio earns are stored in the same units.
  rate        NUMERIC(8,5) NOT NULL,
  rate_kind   VARCHAR(16) NOT NULL,
  source      VARCHAR(16) NOT NULL DEFAULT 'statement',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 0% is a real answer: FDRXX printed 0.06% in 2016 and the sweeps printed
  -- 0.01% for years. Negative is not.
  CONSTRAINT scr_rate_range_chk CHECK (rate >= 0 AND rate < 100),
  CONSTRAINT scr_kind_chk CHECK (rate_kind IN ('seven_day_yield', 'interest_rate'))
);
