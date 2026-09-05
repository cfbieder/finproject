-- 078_bond_terms.sql — CR093 P1, the fixed-income half of the X-ray.
--
-- Rating, coupon, maturity and payment frequency for every bond and CD we hold,
-- as printed by the custodian on its own statements.
--
-- WHY THIS NEEDS NO VENDOR: the statements already state all of it, per bond,
-- every quarter — 27 Moody's and 22 S&P ratings in a single 2026 statement — in
-- text `parse-fidelity-holdings.js` already reads and used to throw away. CR093
-- §1 decision 4 makes the custodian authoritative here: a vendor's coupon
-- disagreeing with the custodian's would be a second wrong number standing
-- beside the right one, and the statement is what the section subtotals
-- reconcile against.
--
-- ⚠️ ONE ROW PER SECURITY, NOT A HISTORY, and `as_of` is why that is safe.
-- Terms do change — a rating is downgraded, a call date passes — but the X-ray
-- asks "what do I hold NOW", so the current row is the answer and the date says
-- how old it is. A statement can be up to a quarter stale, so the page prints
-- `as_of` rather than implying today. Keeping a full history would be a
-- different feature (rating migration over time) and is deliberately not this
-- one. The corpus is retained, so history is recoverable by re-parsing.
--
-- ⚠️ LATEST STATEMENT WINS. The ingest writes only when the incoming `as_of` is
-- not older than the stored one. First-seen-wins is the exact bug that named
-- FLDR after a collateral line: six of seven statements had it right and the
-- one that did not was simply read first.
--
-- ⚠️ ABSENCE IS NOT ZERO, again. A NULL rating means the statement printed none
-- — true of every CD, which is FDIC-insured rather than rated — and must never
-- render as "unrated" beside a genuinely unrated corporate bond. `fdic_insured`
-- is stored so the credit view can give those their own bucket. Measured
-- 2026-09-05: brokered CDs are $993,260 of the live portfolio across 8
-- positions, of which $694,010 (6) have terms read from a statement and
-- $299,250 (2) were bought since the last quarter-end and have none yet. So the
-- FDIC bucket shows $694,010, the rest sits in "no statement yet", and the two
-- figures are DIFFERENT MEASUREMENTS rather than a disagreement — which is
-- exactly why the bucket a holding lands in is decided by what we read, never by
-- what we assume about its kind.
--
-- Additive and reversible. Nothing reads it until the X-ray's credit panels
-- ship.
--   Reversal:  DROP TABLE security_bond_terms;

CREATE TABLE IF NOT EXISTS security_bond_terms (
  -- PRIMARY KEY, not merely a foreign key: one current answer per instrument.
  security_id       INTEGER PRIMARY KEY REFERENCES securities(id) ON DELETE CASCADE,
  -- The statement period end these terms were printed on. Displayed, not hidden.
  as_of             DATE NOT NULL,
  maturity_date     DATE,
  next_call_date    DATE,
  -- A PERCENT as printed (4.15000 = 4.15%), not a fraction — it is copied from
  -- the statement and compared against it by eye, so it is stored in the units
  -- the statement uses. Five decimals because CDs print `3.80000%`.
  coupon_rate       NUMERIC(8,5),
  coupon_type       VARCHAR(12),
  payment_frequency VARCHAR(16),
  -- The two scales are kept SEPARATE and verbatim. Mapping them to one internal
  -- grade at write time would destroy the split-rating information that decides
  -- which grade is correct, and this project's rule is that the custodian's
  -- record is not overwritten by our interpretation of it.
  moodys_rating     VARCHAR(8),
  sp_rating         VARCHAR(8),
  -- Not a rating and not the absence of one. See above.
  fdic_insured      BOOLEAN NOT NULL DEFAULT false,
  source            VARCHAR(16) NOT NULL DEFAULT 'statement',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sbt_coupon_range_chk CHECK (coupon_rate IS NULL OR (coupon_rate >= 0 AND coupon_rate < 100)),
  CONSTRAINT sbt_coupon_type_chk CHECK (coupon_type IS NULL OR coupon_type IN
    ('fixed', 'step', 'variable', 'zero', 'floating')),
  CONSTRAINT sbt_frequency_chk CHECK (payment_frequency IS NULL OR payment_frequency IN
    ('monthly', 'quarterly', 'semiannually', 'annually', 'at_maturity'))
);

CREATE INDEX IF NOT EXISTS idx_sbt_maturity ON security_bond_terms(maturity_date)
  WHERE maturity_date IS NOT NULL;
