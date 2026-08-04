-- 060_forecast_drop_retired_incexp.sql
--
-- CR069 P3 — the contract step of expand → migrate → contract. Everything the stream model
-- replaced is dropped here, and only here, after two deploys in which nothing read it.
--
-- WHY THIS IS SAFE TO RUN NOW, stated as the evidence rather than as reassurance:
--
--   * `forecast_income_expense` and `forecast_incexp_changes` stopped being read by the
--     ENGINE in P2 (v3.14.0, migration 058) and by every other reader in the same deploy —
--     `getBaseYearValues`, `copyScenario`, auto-adjust, AI review and the fc-line delete guard
--     were all cut over together, and the four `/incomeexpense` routes have answered 410 since.
--   * `forecast_module_income_pct` and `forecast_module_income_steps` became `Spread %` and
--     `Fixed $` rows on a stream in the same migration.
--   * The eleven `income_*` / `expense_*` columns stopped being WRITTEN in P2 (the routes route
--     those fields to `crud.replaceModuleStreams`) and stopped being READ by the last
--     consumer — `equity.js` — in the same pass. P3 removes the legacy field names from the
--     write contract entirely, so nothing can even send them.
--
-- The gate that licenses it: per-(scenario, account, forecast_year) summed `forecast_entries`,
-- all five scenarios, regenerated before and after — identical to the cent, as for every phase
-- of this CR. If a reader had survived, the numbers would have moved before this file ran.
--
-- IRREVERSIBLE. `deploy-to-production.sh` takes a `pg_dump` first, which is the restore path.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Refuse to drop anything if the replacement is not actually populated.
--
--    A data-bearing database with items but no streams means the P2 backfill never ran (or
--    ran and rolled back), and dropping the source would destroy the only copy. A data-FREE
--    database satisfies this trivially at 0 = 0, which is what keeps CI's chain green — the
--    046/050/052 defect class this project has hit three times.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n_items INTEGER; n_flow INTEGER;
BEGIN
  IF to_regclass('forecast_income_expense') IS NULL THEN
    RAISE NOTICE 'CR069 P3: forecast_income_expense already dropped — nothing to contract.';
    RETURN;
  END IF;

  SELECT count(*) INTO n_items FROM forecast_income_expense;
  SELECT count(*) INTO n_flow  FROM forecast_modules WHERE NOT has_valuation;

  IF n_items > 0 AND n_flow < n_items THEN
    RAISE EXCEPTION
      'CR069 P3: % income/expense items but only % flow modules — the P2 backfill has not run. '
      'Refusing to drop the source of data that has no replacement.', n_items, n_flow;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The retired tables. Child first, though CASCADE would handle it — being explicit means
--    a future reader can see exactly what went, in dependency order.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS forecast_incexp_changes;
DROP TABLE IF EXISTS forecast_income_expense;
DROP TABLE IF EXISTS forecast_module_income_pct;
DROP TABLE IF EXISTS forecast_module_income_steps;

-- ---------------------------------------------------------------------------
-- 3. The eleven retired columns.
--
--    `expense_pct` goes too: migration 008 dropped it from the write path and the loader
--    hard-coded `ExpensePct = 0`, so the legacy branch reading it was unreachable in
--    production for the whole of its life. CR069 P2 deleted that branch; this removes the
--    column it read. (IF EXISTS because 008's own drop may already have taken it.)
-- ---------------------------------------------------------------------------
ALTER TABLE forecast_modules
  DROP COLUMN IF EXISTS income_amount,
  DROP COLUMN IF EXISTS income_fc_line_id,
  DROP COLUMN IF EXISTS income_growth_rate,
  DROP COLUMN IF EXISTS income_start_date,
  DROP COLUMN IF EXISTS income_end_date,
  DROP COLUMN IF EXISTS income_tax_rate_override,
  DROP COLUMN IF EXISTS income_category,
  DROP COLUMN IF EXISTS expense_amount,
  DROP COLUMN IF EXISTS expense_fc_line_id,
  DROP COLUMN IF EXISTS expense_growth_method,
  DROP COLUMN IF EXISTS expense_start_date,
  DROP COLUMN IF EXISTS expense_end_date,
  DROP COLUMN IF EXISTS expense_category,
  DROP COLUMN IF EXISTS expense_pct;

-- ---------------------------------------------------------------------------
-- 4. `has_valuation` loses its DEFAULT — migration 057's own stated obligation (b).
--
--    Deferred from P2 deliberately and recorded as deferred: nine INSERT sites omitted the
--    column, and the specific hazard 057 named (a scenario copy silently defaulting a flow
--    module back into a balance-sheet module, where CR041's gate would zero all its streams)
--    was already closed by making `copyScenario`'s column list derive from
--    `information_schema`. What the DROP DEFAULT adds is that the NEXT hand-written insert
--    fails loud instead of quietly picking TRUE.
--
--    Every insert path now names it: `MODULE_COLUMN_DEFAULTS` (so `createModule` does),
--    `copyScenario`'s derived list, variant sync's information_schema list, migration 058, and
--    the seeds and fixtures updated in P3.
-- ---------------------------------------------------------------------------
ALTER TABLE forecast_modules ALTER COLUMN has_valuation DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 5. Post-conditions — structural, and true of an empty database.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema = current_schema()
     AND table_name IN ('forecast_income_expense', 'forecast_incexp_changes',
                        'forecast_module_income_pct', 'forecast_module_income_steps');
  IF n <> 0 THEN
    RAISE EXCEPTION 'CR069 P3: % retired table(s) still present', n;
  END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'forecast_modules'
     AND column_name IN ('income_amount','income_fc_line_id','income_growth_rate',
                         'income_start_date','income_end_date','income_tax_rate_override',
                         'expense_amount','expense_fc_line_id','expense_growth_method',
                         'expense_start_date','expense_end_date');
  IF n <> 0 THEN
    RAISE EXCEPTION 'CR069 P3: % retired column(s) still present on forecast_modules', n;
  END IF;

  -- The replacement must still be there. Dropping the old model while the new one is missing
  -- is the one outcome this file must never produce.
  IF to_regclass('forecast_streams') IS NULL
     OR to_regclass('forecast_stream_changes') IS NULL THEN
    RAISE EXCEPTION 'CR069 P3: the stream tables are missing — refusing to leave no model at all';
  END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'forecast_modules'
     AND column_name = 'has_valuation' AND column_default IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'CR069 P3: has_valuation still carries a DEFAULT';
  END IF;

  RAISE NOTICE 'CR069 P3: four tables and the retired columns dropped; has_valuation has no default.';
END $$;

COMMIT;
