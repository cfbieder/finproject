-- 079_security_dividends.sql — CR093 §5b. What a holding PAYS.
--
-- The detail panel showed a bond's coupon and an equity's nothing. The owner
-- asked for the yield on both — "div or coupon, and for fixed income both coupon
-- and current yield" — and only one of the three needs stored data:
--
--   coupon         already here (migration 078), read off the statements
--   current yield  ARITHMETIC, no new data: coupon x par / price. It is a
--                  property of the instrument at today's price, not of the
--                  position, so it is computed at read time and is never stale
--   dividend yield needs a distribution history, which fin had NOWHERE —
--                  `security_transactions` holds 0 rows — hence this table
--
-- ⚠️ A CAPITAL-GAINS DISTRIBUTION IS NOT YIELD, and this is the reason the raw
-- rows are stored rather than one computed number. Measured 2026-09-05 across
-- the 47 live quotable holdings, Tradier returns five distribution types:
--   CD  cash dividend        → income. This is the yield.
--   SC  special cash         → real cash, but non-recurring
--   LT  long-term cap gain   → the fund realised gains; NOT income
--   ST  short-term cap gain  → likewise
--   NP  non-periodic         → likewise
-- DGRW carries CD, SC, LT and ST together. Summing them all would let one
-- year-end turnover distribution present itself as a permanent income rate —
-- and it would look entirely plausible. The yield counts CD; the rest is
-- reported separately rather than dropped, so the money is visible either way.
--
-- ⚠️ "PAYS NO DIVIDEND" AND "WE HAVE NO DATA" ARE DIFFERENT, for the fourth time
-- in this project (075 polled_on/valued_on, 077 sector_weights_as_of, 078's
-- fdic_insured, now this). Measured: 43 of 47 holdings return distributions.
-- Of the four that do not, BRK/B and KD genuinely pay none — a fact about the
-- company — while FCNTX is an open-end mutual fund Tradier does not cover at
-- all. `securities.dividends_as_of` records THAT WE ASKED, and is set even when
-- zero rows come back, so a 0.00% yield can be told apart from a blank one.
--
-- Additive and reversible. Nothing reads it until the detail panel's yield row.
--   Reversal:  DROP TABLE security_dividends;
--              ALTER TABLE securities DROP COLUMN dividends_as_of;

ALTER TABLE securities
  -- The date we last asked a provider for this security's distributions.
  ADD COLUMN IF NOT EXISTS dividends_as_of DATE;

CREATE TABLE IF NOT EXISTS security_dividends (
  id            SERIAL PRIMARY KEY,
  security_id   INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  -- The EX-date, not the pay date: it is the one that decides whether a holder
  -- on a given day was entitled to the distribution, and it is what a trailing
  -- twelve-month window must be measured on.
  ex_date       DATE NOT NULL,
  pay_date      DATE,
  -- Per SHARE, as the provider reports it. Never multiplied by a position here:
  -- this table describes the instrument, and the same row serves every account
  -- that holds it.
  cash_amount   NUMERIC(18,8) NOT NULL,
  -- Stored VERBATIM and constrained, for the same reason 077 constrains sectors:
  -- an unrecognised type must fail loudly rather than quietly join the yield.
  dividend_type VARCHAR(4) NOT NULL,
  -- The provider's declared payments-per-year. Recorded but NOT used to
  -- annualise: several holdings report more than one value across their history
  -- (UTF reports 12, 0 and 4), so `latest x frequency` would be a forward
  -- estimate resting on a field that is not stable. The trailing twelve months
  -- is measured instead.
  frequency     SMALLINT,
  source        VARCHAR(16) NOT NULL DEFAULT 'tradier',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sd_security_exdate_type_uniq UNIQUE (security_id, ex_date, dividend_type),
  CONSTRAINT sd_amount_positive_chk CHECK (cash_amount > 0),
  CONSTRAINT sd_type_chk CHECK (dividend_type IN ('CD', 'SC', 'LT', 'ST', 'NP'))
);

CREATE INDEX IF NOT EXISTS idx_sd_security_exdate
  ON security_dividends(security_id, ex_date DESC);
