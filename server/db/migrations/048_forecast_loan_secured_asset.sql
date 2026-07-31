-- ---------------------------------------------------------------------------
-- 048_forecast_loan_secured_asset.sql — CR062 P2: a loan can be secured against
-- an asset, so the plan can show EQUITY rather than only gross value.
--
-- One nullable column on the LOAN row pointing at the asset it finances. The
-- direction matters: many loans → one asset (a mortgage and a HELOC on the same
-- house), never the reverse. And ANY module qualifies as the asset, not just
-- Real Estate — a margin loan against a brokerage account and a shareholder loan
-- against a business are the same shape.
--
-- ── The trap this migration exists to make visible ──────────────────────────
--
-- `copyScenario` inserts modules ONE AT A TIME, so a naive copy carries the
-- SOURCE scenario's module id into the copy. The copied scenario's Equity report
-- would then read the SOURCE scenario's asset — cross-scenario contamination
-- that no balance check can see, because both numbers are real and both look
-- plausible. The same applies to CR050 variant materialization, where the
-- override patch stores a BASE-scenario module id that must be translated on
-- sync.
--
-- Both are fixed in code (an oldId → newId map plus a second UPDATE pass in
-- copyScenario; `origin_base_id` resolution in the variant sync), and the DO
-- block below is the backstop: it RAISES if any link crosses a scenario
-- boundary, so a future edit that reintroduces the bug fails loudly at deploy
-- rather than silently reporting another scenario's house.
--
-- ON DELETE SET NULL, not CASCADE: deleting the house must not delete the
-- mortgage. The loan is still real, it is simply no longer attributed.
--
-- DORMANT: one nullable column, no backfill. Every existing scenario is
-- unchanged, and the Equity report simply has nothing to show until a link is set.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE forecast_modules
  ADD COLUMN IF NOT EXISTS secured_asset_module_id INTEGER
    REFERENCES forecast_modules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fc_modules_secured_asset
  ON forecast_modules(secured_asset_module_id)
  WHERE secured_asset_module_id IS NOT NULL;

COMMENT ON COLUMN forecast_modules.secured_asset_module_id IS
  'CR062 P2: the asset module this LOAN is secured against (many loans → one asset). Same scenario only — enforced in the route and asserted by migration 048. NULL = unsecured.';

DO $$
DECLARE
  crossing INT;
  self_ref INT;
BEGIN
  -- A link that crosses scenarios would make the Equity report read another
  -- scenario's asset, with both figures real. Nothing downstream could detect it.
  SELECT count(*) INTO crossing
    FROM forecast_modules loan
    JOIN forecast_modules asset ON asset.id = loan.secured_asset_module_id
   WHERE loan.scenario_id <> asset.scenario_id;

  SELECT count(*) INTO self_ref
    FROM forecast_modules
   WHERE secured_asset_module_id = id;

  IF crossing <> 0 THEN
    RAISE EXCEPTION 'CR062 migration 048: % loan(s) secured against an asset in ANOTHER scenario', crossing;
  END IF;
  IF self_ref <> 0 THEN
    RAISE EXCEPTION 'CR062 migration 048: % module(s) secured against themselves', self_ref;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'forecast_modules' AND column_name = 'secured_asset_module_id'
  ) THEN
    RAISE EXCEPTION 'CR062 migration 048: secured_asset_module_id was not created';
  END IF;
END $$;

COMMIT;
