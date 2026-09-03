-- ---------------------------------------------------------------------------
-- 076_price_basis_per_100_face.sql — CR061 P1 correction.
--
-- Adds `per_100_face` to the `securities.price_basis` vocabulary. ADDITIVE:
-- it widens a CHECK constraint and changes no row. Reversal is restoring the
-- narrower CHECK (after re-classifying anything using the new value).
--
-- ── What it fixes, and how it was found ──
--
-- 075 assumed ONE bond convention. There are two, and they are not variants of
-- each other — measured on the live portfolio 2026-09-03:
--
--   Fidelity Bond      29 positions   price 77.92–103.07   quantity 100–1,000
--                      price is a PERCENT of par; quantity is $100-face units
--                      (1000 x 98.745 = 98,745)
--
--   Fidelity Cash Mgt   8 positions   price 0.9873–1.0002  quantity 100k–200k
--                      price is a FRACTION of par; quantity is face DOLLARS
--                      (100000 x 0.9989 = 99,890)
--
-- `value = quantity x price` holds for both, which is exactly why the conflation
-- survived ingest, every test, and a reconciliation that ties to the cent: no
-- arithmetic anywhere is wrong. Only the DISPLAY is, and only for one of the two
-- — the page rendered a bond priced at 98.745 as `9874.500`, because the
-- renderer applied the fraction convention's x100 to a price already expressed
-- as a percentage.
--
-- ⚠️ It was found by LOOKING AT THE RENDERED PAGE, not by a test — the fifth
-- time this project has recorded that (CR082, CR085, CR087 P0b, CR088 P5). A
-- test asserting `quantity x price = market_value` passes under both readings.
--
-- No data migration here: re-classification is a separate, inspectable step,
-- and it must touch only `classification_source = 'inferred'` rows so an owner's
-- manual decision is never overwritten.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'securities_price_basis_chk') THEN
    ALTER TABLE securities DROP CONSTRAINT securities_price_basis_chk;
  END IF;
  ALTER TABLE securities ADD CONSTRAINT securities_price_basis_chk
    CHECK (price_basis IS NULL OR price_basis IN ('per_share', 'per_1_face', 'per_100_face', 'par'));
END $$;

COMMENT ON COLUMN securities.price_basis IS
  'per_share (equities, funds) | per_1_face (price is a FRACTION of par, quantity is face dollars) | per_100_face (price is a PERCENT of par, quantity is $100-face units) | par (held at 1.00). value = quantity x price under all four; they differ only in how a human must read the price.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'securities_price_basis_chk') THEN
    RAISE EXCEPTION '076: securities_price_basis_chk missing';
  END IF;
  -- The point of the migration: the new value must be accepted and a bogus one
  -- must still be refused. Asserted structurally, without writing a row.
  IF NOT (
    SELECT pg_get_constraintdef(oid) LIKE '%per_100_face%'
      FROM pg_constraint WHERE conname = 'securities_price_basis_chk'
  ) THEN
    RAISE EXCEPTION '076: per_100_face not present in the price_basis CHECK';
  END IF;
END $$;
