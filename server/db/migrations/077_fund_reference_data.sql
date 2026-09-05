-- 077_fund_reference_data.sql — CR093 P1.
--
-- Caches what each FUND is and what it is made of, so the Portfolio X-ray can
-- group by sector without calling a vendor on page load.
--
-- WHY A TABLE AND NOT A JSONB COLUMN: the X-ray's central query is
--   SUM(position.market_value * weight) GROUP BY sector
-- across every account. Rows do that in SQL; a JSON blob would have to be
-- unpacked in the application for every position on every render.
--
-- ⚠️ THE HARD PART IS ABSENCE, NOT PRESENCE. A bond fund HAS no equity sector
-- weights — FLDR and AGG correctly return none — and that is a fact about the
-- instrument, not a gap in our data. But "no rows" cannot distinguish
--   (a) we asked, and this fund genuinely has no equity sectors
--   (b) we never asked
-- and those must not be confused: an X-ray that treats (b) as (a) silently drops
-- a holding out of its sector chart, and one that treats (a) as (b) shows a
-- permanent "unclassified" bucket that will never fill.
--
-- So `securities.sector_weights_as_of` records THAT WE LOOKED, and is set even
-- when zero weight rows result. It is the same distinction migration 075 drew
-- between `polled_on` (we asked) and `valued_on` (the values were true), and the
-- same one `security_position_snapshots.status` draws between "empty" and
-- "absent". This project has now needed it three times.
--
-- Additive and reversible: two nullable columns and one new table. No row is
-- migrated, nothing reads these until the X-ray ships.
--   Reversal:  DROP TABLE security_sector_weights;
--              ALTER TABLE securities DROP COLUMN fund_category,
--                                     DROP COLUMN sector_weights_as_of;

ALTER TABLE securities
  -- The vendor's own classification, stored verbatim rather than mapped:
  -- "Ultrashort Bond", "Trading--Leveraged Equity", "Derivative Income". It is
  -- what DERIVED asset_class (CR093, Scripts/classify-funds.js), and keeping the
  -- source string means a later disagreement can be traced instead of re-argued.
  ADD COLUMN IF NOT EXISTS fund_category VARCHAR(64),
  -- The date we last asked for sector weights. NOT NULL-able by design above.
  ADD COLUMN IF NOT EXISTS sector_weights_as_of DATE;

CREATE TABLE IF NOT EXISTS security_sector_weights (
  id          SERIAL PRIMARY KEY,
  security_id INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  -- Morningstar's eleven equity sectors, as the vendor names them. Constrained
  -- rather than free text: a typo'd sector would create a silent twelfth bucket
  -- holding real money, and nothing downstream would notice.
  sector      VARCHAR(32) NOT NULL,
  -- A FRACTION (0.58 = 58%), matching what the vendor returns. Stored as it
  -- arrives so no conversion sits between the source and the check that the
  -- weights sum to 1.
  weight      NUMERIC(9,6) NOT NULL,
  source      VARCHAR(32)  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ssw_security_sector_uniq UNIQUE (security_id, sector),
  CONSTRAINT ssw_weight_range_chk CHECK (weight > 0 AND weight <= 1),
  CONSTRAINT ssw_sector_chk CHECK (sector IN (
    'technology', 'financial_services', 'healthcare', 'consumer_cyclical',
    'consumer_defensive', 'industrials', 'energy', 'utilities',
    'realestate', 'basic_materials', 'communication_services'))
);

CREATE INDEX IF NOT EXISTS idx_ssw_security ON security_sector_weights(security_id);

-- ⚠️ NOT expressible as a constraint, and owned by the loader:
-- a security's weights must SUM TO 1 (within rounding). It is a cross-row
-- invariant, and this repo has exactly one non-internal trigger, so a trigger
-- would be against convention. Measured 2026-09-05: all 23 funds that returned
-- weights summed to 100.0000%, so the loader asserts it and refuses the set
-- otherwise — a partial set would under-count a fund's exposure while looking
-- perfectly well-formed.
--
-- `weight > 0` rather than `>= 0`: a zero-weight sector is not a holding of
-- nothing, it is a sector the fund is not in, and storing it as a row would put
-- eleven rows behind every fund and make "has weights" mean nothing.
