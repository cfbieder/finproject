-- 059_forecast_stream_schedule_overrides.sql
--
-- CR069 P2 follow-up — translate the variant overrides that patch a SCHEDULE, not a column.
--
-- Migration 058 translated override patches naming the eleven income_*/expense_* COLUMNS onto
-- streams. It missed the two SCHEDULE keys that moved in the same change: `income_pct` and
-- `income_steps` are gone from `SCHEDULE_KEYS`, absorbed into a stream's own change rows as
-- `Spread %` and `Fixed $`.
--
-- HOW IT WAS FOUND, and why it is a separate file: prod carries no such override, so the
-- prod-copy gate passed clean. **Dev does** — `2026 Upside` overrides United Beverages'
-- yield with `{"income_pct": [{"value": 1, "effective_date": "2027-07-01"}]}` — and applying
-- 058 there moved 504 rows: the override was silently dropped, United Beverages reverted to
-- the base's yield, and the sweep and convergence loop carried the difference across every
-- year. That is the whole argument for dev-before-prod (Known Issue #15), and it is the only
-- reason this was caught before prod rather than after.
--
-- 058 is already applied on dev, so this is a forward migration rather than an edit
-- (`.claude/rules/migrations.md`, append-only).
--
-- The silent part is fixed in code as well: `syncEntity` dropped any patch key that was
-- neither a schedule key nor a column (`if (cols.includes(key))`), so an override naming a
-- retired field applied cleanly to nothing. It now THROWS. That guard is what makes this
-- class self-reporting instead of arithmetic.

BEGIN;

DO $$
DECLARE
  ov        RECORD;
  streams   JSONB;
  new_chgs  JSONB;
  n_fixed   INTEGER := 0;
BEGIN
  FOR ov IN
    SELECT id, scenario_id, base_entity_id, patch
      FROM forecast_scenario_overrides
     WHERE entity_type = 'module'
       AND patch ?| ARRAY['income_pct', 'income_steps']
  LOOP
    -- The stream set to patch: whatever 058 already put there, else the base module's own
    -- streams in the shape `baseSchedule` returns. Starting from the existing `streams` key
    -- matters — an override carrying BOTH a column key and a schedule key went through 058's
    -- column translation, and rebuilding from base here would throw that away.
    streams := COALESCE(
      ov.patch -> 'streams',
      (SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                  'direction',         s.direction,
                  'fc_line_id',        s.fc_line_id,
                  'mode',              s.mode,
                  'amount',            s.amount,
                  'amount_usd',        s.amount_usd,
                  'growth_mult',       s.growth_mult,
                  'start_date',        s.start_date,
                  'end_date',          s.end_date,
                  'tax_rate_override', s.tax_rate_override,
                  'changes',           COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                             'change_date', c.change_date, 'amount', c.amount, 'flag', c.flag
                           ) ORDER BY c.id)
                      FROM forecast_stream_changes c WHERE c.stream_id = s.id
                  ), '[]'::jsonb)
                ) ORDER BY s.id
              ), '[]'::jsonb)
         FROM forecast_streams s WHERE s.module_id = ov.base_entity_id)
    );

    -- income_pct → Spread % (a carry-forward yield), income_steps → Fixed $ (a permanent
    -- level shift). Both REPLACE the income stream's change rows, which is what a schedule
    -- override has always meant: these tables have no key to merge on.
    new_chgs := COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object(
                 'change_date', (e ->> 'effective_date')::date,
                 'amount',      (e ->> 'value')::numeric,
                 'flag',        'Spread %'
               ) AS x
          FROM jsonb_array_elements(COALESCE(ov.patch -> 'income_pct', '[]'::jsonb)) e
        UNION ALL
        SELECT jsonb_build_object(
                 'change_date', (e ->> 'effective_date')::date,
                 'amount',      (e ->> 'amount')::numeric,
                 'flag',        'Fixed $'
               )
          FROM jsonb_array_elements(COALESCE(ov.patch -> 'income_steps', '[]'::jsonb)) e
      ) t
    ), '[]'::jsonb);

    -- Apply to the INCOME stream only, and switch it to yield when a spread is present — the
    -- `hasIncomePct` precedence the engine used to derive at read time, now stored.
    streams := (
      SELECT jsonb_agg(
        CASE WHEN st ->> 'direction' = 'income'
             THEN st
                  || jsonb_build_object('changes', new_chgs)
                  || CASE WHEN ov.patch ? 'income_pct'
                          THEN jsonb_build_object('mode', 'yield')
                          ELSE '{}'::jsonb END
             ELSE st END
        ORDER BY ord
      )
      FROM jsonb_array_elements(streams) WITH ORDINALITY AS a(st, ord)
    );

    UPDATE forecast_scenario_overrides
       SET patch = (patch - 'income_pct' - 'income_steps')
                   || jsonb_build_object('streams', COALESCE(streams, '[]'::jsonb))
     WHERE id = ov.id;

    n_fixed := n_fixed + 1;
  END LOOP;

  IF n_fixed > 0 THEN
    RAISE NOTICE 'CR069 P2: translated % schedule override(s) onto streams.', n_fixed;
  ELSE
    RAISE NOTICE 'CR069 P2: no schedule overrides to translate.';
  END IF;
END $$;

-- Post-condition: no override may name a field the engine has stopped reading. Structural and
-- relative — true of a data-free database, where the loop above simply never ran.
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM forecast_scenario_overrides
   WHERE patch ?| ARRAY[
     'income_pct', 'income_steps',
     'income_amount','income_fc_line_id','income_growth_rate','income_start_date',
     'income_end_date','income_tax_rate_override','expense_amount','expense_fc_line_id',
     'expense_growth_method','expense_start_date','expense_end_date',
     'base_value','base_value_usd'
   ];
  IF n > 0 THEN
    RAISE EXCEPTION 'CR069 P2: % override(s) still name a retired field', n;
  END IF;
END $$;

COMMIT;
