-- ---------------------------------------------------------------------------
-- 073_forecast_scenario_is_scratch.sql — CR085 P0. Mark a throwaway scenario
-- as throwaway, so nothing has to guess from its name.
--
-- ADDITIVE AND INERT for every existing row: the column defaults to FALSE, and
-- FALSE is exactly today's behaviour for every scenario in the database.
--
-- ── What it fixes ──
--
-- Two features build a deep-copy "scratch" scenario, run the engine against it
-- and delete it: CR053's auto-adjust solver and CR084's save-time consequence
-- preview. Both create it through `copyScenario`, which inserts `is_active =
-- TRUE`, and `findAllScenarios` filters on nothing else — so a scratch is
-- visible in every scenario picker in the app for as long as it exists, and a
-- process killed mid-run leaves one there permanently. Recorded as still open
-- in CR084 §9.2: "if that happens the copy is left is_active = TRUE and shows
-- up in every scenario picker. Nothing filters them today."
--
-- CR085 turns one preview into a whole sensitivity run — one copy held across
-- N engine builds — so the window stops being a fraction of a second.
--
-- ── Why a column and not a name prefix ──
--
-- Two prefixes are already in use (`__scratch_` from CR084, `__autoadjust_`
-- from CR053), so a name test has to know both and will not know the third.
-- More to the point, CR050 §3 rejected name-keying for overrides for the
-- reason that applies here: names are editable and the truth should not live
-- in one. A boolean is checkable, sweepable, and cannot be renamed away.
--
-- ── Why not reuse is_active ──
--
-- `is_active` is OWNER-facing. It is in SCENARIO_UPDATE_FIELDS and is exposed
-- as `IsActive` on the API, so the owner can flip it from the UI — which would
-- resurrect a scratch scenario into every picker. It also conflates "archived
-- by me" with "internal, delete me", and only one of those should be swept.
--
-- Partial index, not a plain one: the scratch rows are the rare ones and they
-- are the only ones the sweep ever looks for.
-- ---------------------------------------------------------------------------

ALTER TABLE forecast_scenarios
  ADD COLUMN IF NOT EXISTS is_scratch BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN forecast_scenarios.is_scratch IS
  'CR085: a throwaway deep copy used for an engine run (auto-adjust solve, save-time preview, '
  'sensitivity). Hidden from every scenario list and swept once stale. Never set on a real scenario.';

CREATE INDEX IF NOT EXISTS idx_fc_scenarios_scratch
  ON forecast_scenarios (created_at)
  WHERE is_scratch;

-- Back-fill: any scratch left behind by a killed process, under either prefix that has ever
-- been used. These are already garbage; naming them is what lets the sweep remove them.
UPDATE forecast_scenarios
   SET is_scratch = TRUE
 WHERE is_scratch = FALSE
   AND (name LIKE '\_\_scratch\_%' OR name LIKE '\_\_autoadjust\_%');

-- ── Post-conditions ────────────────────────────────────────────────────────
-- Assert what actually matters, not how many rows changed. Schema-qualified via
-- current_schema() rather than a bare `public`, per the lesson recorded on 070/071:
-- under CR027's schema-per-tenant search_path an unqualified catalog probe reads
-- whichever schema happens to be first and silently passes against the wrong one.
--
-- IDEMPOTENT: every statement above is IF NOT EXISTS or a WHERE-guarded UPDATE, so
-- re-applying this file is a no-op. Verified by applying it twice to dev, and by
-- Scripts/test-fresh-db.sh, which runs the whole chain against an empty database.
DO $$
DECLARE
  has_col  BOOLEAN;
  has_idx  BOOLEAN;
  leaked   INT;
  mislabel INT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'forecast_scenarios'
       AND column_name = 'is_scratch'
       AND is_nullable = 'NO'
  ) INTO has_col;
  IF NOT has_col THEN
    RAISE EXCEPTION '073 post-condition: forecast_scenarios.is_scratch missing or nullable';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename = 'forecast_scenarios'
       AND indexname = 'idx_fc_scenarios_scratch'
  ) INTO has_idx;
  IF NOT has_idx THEN
    RAISE EXCEPTION '073 post-condition: idx_fc_scenarios_scratch missing';
  END IF;

  -- No REAL scenario may have been flagged. This is the one that protects owner data: a
  -- back-fill predicate that was too broad would hide a live scenario from every picker
  -- in the app and then let the sweep delete it an hour later.
  SELECT COUNT(*) INTO mislabel
    FROM forecast_scenarios
   WHERE is_scratch
     AND name NOT LIKE '\_\_scratch\_%'
     AND name NOT LIKE '\_\_autoadjust\_%';
  IF mislabel > 0 THEN
    RAISE EXCEPTION '073 post-condition: % non-scratch scenario(s) were flagged is_scratch', mislabel;
  END IF;

  SELECT COUNT(*) INTO leaked FROM forecast_scenarios WHERE is_scratch;
  RAISE NOTICE '073: % leaked scratch scenario(s) marked for sweep', leaked;
END $$;
