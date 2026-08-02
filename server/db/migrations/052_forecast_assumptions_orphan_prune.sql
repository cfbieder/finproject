-- 052 — prune assumption entries that name a scenario which no longer exists,
--       and delete the two blank forecast modules Cancel left behind (CR064 P1/P3).
--
-- WHAT forecast_assumptions IS. Four JSON documents in a key/value table (CR039).
-- Three of them — 'inflation', 'FX', 'Tax Rate' — identify a scenario by its NAME
-- string; the fourth, 'scenarios', which carries PeriodStart/PeriodEnd, by 'Name'.
-- The name is the only key. Nothing enforces that it resolves.
--
-- WHAT WAS MEASURED (prod, 2026-08-02). Five scenarios exist. 'inflation' carries
-- ten entries, 'FX' eleven, 'Tax Rate' ten, and 'scenarios' six — including five
-- names with no row in forecast_scenarios at all:
--
--   Test · ZZ Test Sandbox · 2026 with House Purchase ·
--   2026 Base - Market Returns · Base_Buy Business
--
-- WHY THEY MATTER. They are dead weight on their own. What makes them worth a
-- migration is what they are evidence OF: PUT /scenarios/:id renames the scenarios
-- row and leaves every document keyed to the old name. The next generate throws
-- (loadScenarioConfig cannot find the scenario), the owner saves Forecast Settings
-- to fix it, that write refreshes 'scenarios' from the DB names and leaves the
-- other three — and generate then SUCCEEDS with an empty inflation list, which
-- buildRates seeds as `currentRate = entries[0]?.Rate ?? 0`: 0% inflation for 36
-- years, silently. CR064 §2.4 makes rename atomic; this migration cleans up after
-- the renames that already happened and asserts the invariant from here on.
--
-- WHY THE REBUILD IS json AND NEVER jsonb. `value` is `json`, not `jsonb`, on
-- purpose (CR039: jsonb reorders object keys, which broke byte-parity against the
-- FCAssump.json the table replaced). So each array is rebuilt with
-- json_build_object listing the keys in their existing order and json_agg over
-- WITH ORDINALITY — the entries that survive come out byte-identical, and the only
-- difference in the document is the absence of the dropped ones.
--
-- IDEMPOTENT. A re-run finds nothing to drop and rewrites each document to itself.

BEGIN;

-- ---------------------------------------------------------------------------
-- Report what is about to go, before it goes. The deploy log is the only place
-- this is ever visible; a silent prune of an assumptions document would be
-- indistinguishable from a prune that took the wrong rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  doc  TEXT;
  name TEXT;
  fld  TEXT;
BEGIN
  FOREACH doc IN ARRAY ARRAY['scenarios', 'inflation', 'FX', 'Tax Rate'] LOOP
    fld := CASE WHEN doc = 'scenarios' THEN 'Name' ELSE 'Scenario' END;
    FOR name IN
      EXECUTE format(
        $q$ SELECT DISTINCT e.value->>%L
              FROM forecast_assumptions fa, json_array_elements(fa.value) AS e(value)
             WHERE fa.key = %L
               AND NOT EXISTS (
                 SELECT 1 FROM forecast_scenarios s WHERE s.name = e.value->>%L
               ) $q$, fld, doc, fld)
    LOOP
      RAISE NOTICE 'migration 052: dropping % entry for unknown scenario %', doc, COALESCE(name, '(null)');
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- PRE-CONDITION — refuse to prune what a rename could still recover.
--
-- An orphan entry has two possible histories, and they need opposite treatment:
--
--   deleted scenario — the entry is genuinely dead. Prune it.
--   RENAMED scenario — the entry is the live scenario's inflation path, sitting
--                      under its old name. Pruning it destroys the assumptions
--                      of a scenario still in use, and the next generate runs at
--                      0% inflation. It must be RENAMED across, not dropped.
--
-- They are told apart by what is left behind: a rename leaves a live scenario
-- with no entry of its own AND an orphan entry to spare. A deletion leaves
-- orphans while every live scenario keeps its own. So orphans alongside a
-- scenario that has none of its own = stop and let a human repair it with
-- renameScenario (CR064 §2.4). A data-free database has no orphans at all and
-- passes straight through, which is what keeps CI's chain building.
-- ---------------------------------------------------------------------------
DO $$
DECLARE orphan_n INT; starved_n INT; who TEXT;
BEGIN
  SELECT COUNT(*) INTO orphan_n FROM (
    SELECT e.value->>'Scenario' AS nm FROM forecast_assumptions fa,
           json_array_elements(fa.value) AS e(value)
     WHERE fa.key IN ('inflation', 'FX', 'Tax Rate')
  ) q WHERE NOT EXISTS (SELECT 1 FROM forecast_scenarios s WHERE s.name = q.nm);

  SELECT COUNT(*), string_agg(s.name, ', ') INTO starved_n, who
    FROM forecast_scenarios s
   WHERE NOT EXISTS (
     SELECT 1 FROM forecast_assumptions fa, json_array_elements(fa.value) AS e(value)
      WHERE fa.key = 'inflation' AND e.value->>'Scenario' = s.name);

  IF orphan_n > 0 AND starved_n > 0 THEN
    RAISE EXCEPTION
      'migration 052: % orphaned assumption entr(ies) alongside % scenario(s) with no inflation '
      'entry of their own (%). That is the shape of a RENAME, not a deletion — pruning would '
      'destroy a live scenario''s assumptions. Rename the entries across first '
      '(PUT /forecast/scenarios/:id, or by hand), then re-run.',
      orphan_n, starved_n, who;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Snapshot every (document, scenario) pair that RESOLVES to a live scenario,
-- so the post-condition can assert that the prune took only the orphans.
--
-- "Every scenario has an inflation entry" would be the wrong assertion: a
-- scenario created a moment ago legitimately has none yet, and asserting it
-- aborts the chain on CI's data-free database — the exact defect this CR is
-- amending migration 050 for. What must hold is narrower and stronger: nothing
-- that resolved before the prune is missing after it.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE cr052_before ON COMMIT DROP AS
SELECT fa.key AS doc, e.value->>'Name' AS scenario_name
  FROM forecast_assumptions fa, json_array_elements(fa.value) AS e(value)
 WHERE fa.key = 'scenarios'
   AND EXISTS (SELECT 1 FROM forecast_scenarios s WHERE s.name = e.value->>'Name')
UNION ALL
SELECT fa.key, e.value->>'Scenario'
  FROM forecast_assumptions fa, json_array_elements(fa.value) AS e(value)
 WHERE fa.key IN ('inflation', 'FX', 'Tax Rate')
   AND EXISTS (SELECT 1 FROM forecast_scenarios s WHERE s.name = e.value->>'Scenario');

-- ---------------------------------------------------------------------------
-- scenarios — {Name, Description, IsActive, id, PeriodStart, PeriodEnd}
-- ---------------------------------------------------------------------------
WITH src AS (
  SELECT e.value AS entry, e.ord AS pos
    FROM forecast_assumptions fa,
         json_array_elements(fa.value) WITH ORDINALITY AS e(value, ord)
   WHERE fa.key = 'scenarios'
), kept AS (
  SELECT s.pos,
         json_build_object(
           'Name',        s.entry->'Name',
           'Description', s.entry->'Description',
           'IsActive',    s.entry->'IsActive',
           'id',          to_json(sc.id),
           'PeriodStart', s.entry->'PeriodStart',
           'PeriodEnd',   s.entry->'PeriodEnd'
         ) AS entry
    FROM src s
    JOIN forecast_scenarios sc ON sc.name = s.entry->>'Name'
)
UPDATE forecast_assumptions fa
   SET value = COALESCE((SELECT json_agg(k.entry ORDER BY k.pos) FROM kept k), '[]'::json),
       updated_at = NOW()
 WHERE fa.key = 'scenarios';

-- ---------------------------------------------------------------------------
-- inflation — {Rate, Year, Scenario}
-- ---------------------------------------------------------------------------
WITH src AS (
  SELECT e.value AS entry, e.ord AS pos
    FROM forecast_assumptions fa,
         json_array_elements(fa.value) WITH ORDINALITY AS e(value, ord)
   WHERE fa.key = 'inflation'
), kept AS (
  SELECT s.pos,
         json_build_object(
           'Rate',     s.entry->'Rate',
           'Year',     s.entry->'Year',
           'Scenario', s.entry->'Scenario'
         ) AS entry
    FROM src s
    JOIN forecast_scenarios sc ON sc.name = s.entry->>'Scenario'
)
UPDATE forecast_assumptions fa
   SET value = COALESCE((SELECT json_agg(k.entry ORDER BY k.pos) FROM kept k), '[]'::json),
       updated_at = NOW()
 WHERE fa.key = 'inflation';

-- ---------------------------------------------------------------------------
-- FX — {Year, Rates, Scenario}. `Rates` is a nested object and is carried
-- through untouched, so both the live {PLN, EUR} and the legacy
-- {USDPLN, USDEUR} spellings survive exactly as stored (CR064 §1).
-- ---------------------------------------------------------------------------
WITH src AS (
  SELECT e.value AS entry, e.ord AS pos
    FROM forecast_assumptions fa,
         json_array_elements(fa.value) WITH ORDINALITY AS e(value, ord)
   WHERE fa.key = 'FX'
), kept AS (
  SELECT s.pos,
         json_build_object(
           'Year',     s.entry->'Year',
           'Rates',    s.entry->'Rates',
           'Scenario', s.entry->'Scenario'
         ) AS entry
    FROM src s
    JOIN forecast_scenarios sc ON sc.name = s.entry->>'Scenario'
)
UPDATE forecast_assumptions fa
   SET value = COALESCE((SELECT json_agg(k.entry ORDER BY k.pos) FROM kept k), '[]'::json),
       updated_at = NOW()
 WHERE fa.key = 'FX';

-- ---------------------------------------------------------------------------
-- Tax Rate — {Scenario, Rate}
-- ---------------------------------------------------------------------------
WITH src AS (
  SELECT e.value AS entry, e.ord AS pos
    FROM forecast_assumptions fa,
         json_array_elements(fa.value) WITH ORDINALITY AS e(value, ord)
   WHERE fa.key = 'Tax Rate'
), kept AS (
  SELECT s.pos,
         json_build_object(
           'Scenario', s.entry->'Scenario',
           'Rate',     s.entry->'Rate'
         ) AS entry
    FROM src s
    JOIN forecast_scenarios sc ON sc.name = s.entry->>'Scenario'
)
UPDATE forecast_assumptions fa
   SET value = COALESCE((SELECT json_agg(k.entry ORDER BY k.pos) FROM kept k), '[]'::json),
       updated_at = NOW()
 WHERE fa.key = 'Tax Rate';

-- ---------------------------------------------------------------------------
-- The two blank modules (CR064 §4.3).
--
-- Creating a module writes the row before the editor opens, so pressing Cancel
-- leaves a nameless row behind. Prod carries two — one in '2026 Upside', one in
-- '2026 Downside', both EUR, both zero. The predicate is deliberately narrow:
-- no name, no account, every value zero-or-null, no loan, no sweep rank, and no
-- schedule rows of any kind. A module that is merely half-filled is NOT this,
-- and must survive.
-- ---------------------------------------------------------------------------
DELETE FROM forecast_modules m
 WHERE COALESCE(NULLIF(TRIM(m.name), ''), NULL) IS NULL
   AND m.account_id IS NULL
   AND COALESCE(m.base_value, 0) = 0
   AND COALESCE(m.market_value, 0) = 0
   AND COALESCE(m.base_value_usd, 0) = 0
   AND COALESCE(m.market_value_usd, 0) = 0
   AND COALESCE(m.expense_amount, 0) = 0
   AND COALESCE(m.income_amount, 0) = 0
   AND COALESCE(m.growth_rate, 0) = 0
   AND m.loan_interest_rate IS NULL
   AND m.loan_principal IS NULL
   AND m.cash_sweep_priority IS NULL
   AND m.expense_fc_line_id IS NULL
   AND m.income_fc_line_id IS NULL
   AND m.secured_asset_module_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM forecast_module_investments  x WHERE x.module_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM forecast_module_disposals    x WHERE x.module_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM forecast_module_income_pct   x WHERE x.module_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM forecast_module_amortization x WHERE x.module_id = m.id)
   -- A variant row materialized from a base row is never "left behind by Cancel";
   -- it is inherited, and sync owns it.
   AND m.origin_base_id IS NULL
   -- Nothing may point at it as collateral.
   AND NOT EXISTS (SELECT 1 FROM forecast_modules o WHERE o.secured_asset_module_id = m.id);

-- ---------------------------------------------------------------------------
-- Post-conditions. These assert the INVARIANT, not the row counts — a count
-- comparison would pass just as happily if the prune had taken the wrong rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  orphans   INT;
  starved   INT;
  blanks    INT;
BEGIN
  -- 1. No assumption entry names a scenario that does not exist.
  SELECT COUNT(*) INTO orphans FROM (
    SELECT e.value->>'Name' AS nm FROM forecast_assumptions fa,
           json_array_elements(fa.value) AS e(value) WHERE fa.key = 'scenarios'
    UNION ALL
    SELECT e.value->>'Scenario' FROM forecast_assumptions fa,
           json_array_elements(fa.value) AS e(value) WHERE fa.key IN ('inflation', 'FX', 'Tax Rate')
  ) q WHERE NOT EXISTS (SELECT 1 FROM forecast_scenarios s WHERE s.name = q.nm);
  IF orphans > 0 THEN
    RAISE EXCEPTION 'migration 052: % assumption entr(ies) still name an unknown scenario', orphans;
  END IF;

  -- 2. The direction that actually costs money: nothing that resolved to a live
  --    scenario before the prune may be missing after it. A scenario stripped of
  --    its inflation entry would run at 0% and look fine doing it.
  WITH after_prune AS (
    SELECT fa.key AS doc, e.value->>'Name' AS scenario_name
      FROM forecast_assumptions fa, json_array_elements(fa.value) AS e(value)
     WHERE fa.key = 'scenarios'
    UNION ALL
    SELECT fa.key, e.value->>'Scenario'
      FROM forecast_assumptions fa, json_array_elements(fa.value) AS e(value)
     WHERE fa.key IN ('inflation', 'FX', 'Tax Rate')
  )
  SELECT COUNT(*) INTO starved FROM (
    SELECT doc, scenario_name, COUNT(*) AS n FROM cr052_before GROUP BY 1, 2
  ) b WHERE b.n > (
    SELECT COUNT(*) FROM after_prune a
     WHERE a.doc = b.doc AND a.scenario_name IS NOT DISTINCT FROM b.scenario_name
  );
  IF starved > 0 THEN
    RAISE EXCEPTION 'migration 052: the prune removed % live (document, scenario) entr(ies)', starved;
  END IF;

  -- 3. Every document is still a JSON array (a rebuild that produced NULL would
  --    have been coalesced to '[]', never to a scalar).
  IF EXISTS (
    SELECT 1 FROM forecast_assumptions
     WHERE key IN ('scenarios', 'inflation', 'FX', 'Tax Rate')
       AND json_typeof(value) <> 'array'
  ) THEN
    RAISE EXCEPTION 'migration 052: an assumptions document is no longer an array';
  END IF;

  -- 4. No blank module survives, and none was created by this migration.
  SELECT COUNT(*) INTO blanks FROM forecast_modules m
   WHERE NULLIF(TRIM(COALESCE(m.name, '')), '') IS NULL AND m.account_id IS NULL;
  IF blanks > 0 THEN
    RAISE NOTICE 'migration 052: % nameless module(s) remain — they carry data and were kept', blanks;
  END IF;
END $$;

COMMIT;
