-- 058_forecast_streams_backfill.sql
--
-- CR069 P2 — convert every module column-pair and every Expenditure item into streams.
--
-- SHIPS WITH THE ENGINE CUTOVER, IN ONE DEPLOY, and that is not a preference. Nothing
-- dual-writes `forecast_streams`, so a backfill landing before the cutover goes stale on the
-- first module save, `syncVariant`, auto-adjust apply or `copyScenario` — and the engine
-- would then switch over to data that stopped being true days earlier. Wrong numbers, no
-- error. (Blocker at CR069's technical review; migration 057 created the schema alone for
-- exactly this reason.)
--
-- THE GATE THIS MUST SATISFY: per (scenario, account, forecast_year), the summed
-- `forecast_entries` of all five scenarios are identical TO THE CENT before and after. Row
-- labels may move; no number a report can display may.
--
-- ── THE SIGN RULE, which is the whole risk of this file ──────────────────────────────
--
-- `forecast_streams.amount` is a MAGNITUDE (CHECKed >= 0 on both it and `amount_usd`);
-- `direction` carries the sign. `forecast_stream_changes.amount` is SIGNED in the stream's
-- direction frame: positive = MORE of the stream.
--
-- Converting into that frame keys on the FLAG, never on the direction alone:
--
--   Fixed $ / One-Off $   MONEY  → negate for an expense-direction stream
--   Percent % / Spread %  RATE   → carry through UNTOUCHED
--
-- Both halves have already been got wrong once in review, and each would have been silent:
--
--   * Taking magnitudes of the money rows inverts the 20 POSITIVE `Fixed $` rows that sit on
--     NEGATIVE expense bases — they are REDUCTIONS (`Children` +25,000 in 2027 when the kids
--     leave; `Travel` +15/20/30K ramping down with age). Every one would become an increase.
--   * Negating the RATE rows inverts 58 more. `Children` carries −100% in 2032, meaning "this
--     expense ends"; negated it reads +100% and the expense DOUBLES. Neither CR069 §6.4's
--     assertion (|amount| preserved AND amount × direction-sign preserved — a negated
--     Percent % satisfies both) nor the sums gate (both sides carry the transform) would
--     catch it. §4 below asserts rate rows are byte-identical to their source, which does.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: this migration is not re-runnable against already-converted data, so make
--    re-running it a no-op rather than a doubling. (057's tables carry no rows on arrival;
--    if any exist, the conversion has already happened.)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM forecast_streams) > 0 THEN
    RAISE NOTICE 'CR069 P2: forecast_streams already populated — backfill already applied, skipping.';
  END IF;
END $$;

CREATE TEMP TABLE cr069_skip ON COMMIT DROP AS
  SELECT (SELECT count(*) FROM forecast_streams) > 0 AS already_done;

-- ---------------------------------------------------------------------------
-- 1. Every Expenditure item becomes a module with NO valuation.
--
--    `has_valuation = FALSE` is what lets a pure-P&L row exist at all: CR041's ownership
--    gate reads a market value of 0 across the horizon as "never owned" and zeroes every
--    amount stream on it, which is precisely why these had to be a separate table until now.
--
--    Identity, currency, status and provenance carry over verbatim. `base_date` is copied
--    even though the inc/exp engine never read it — the unified loader anchors a flow
--    module's streams at PeriodStart, exactly as fcbuilder-incexp did, so the column is
--    inert here and stays as data rather than becoming a lie.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE cr069_item_map (
  incexp_id  INTEGER PRIMARY KEY,
  module_id  INTEGER NOT NULL,
  direction  VARCHAR(10) NOT NULL
) ON COMMIT DROP;

WITH inserted AS (
  INSERT INTO forecast_modules (
    scenario_id, account_id, name, module_type, currency,
    base_date, base_value, market_value, base_value_usd, market_value_usd,
    growth_rate, comment, is_matched, setup_status, has_valuation
  )
  SELECT
    ie.scenario_id, ie.account_id, ie.name,
    -- A free-text label only; the engine has never read module_type and still does not.
    CASE WHEN ie.item_type = 'Income' THEN 'Income' ELSE 'Expense' END,
    COALESCE(ie.currency, 'USD'),
    ie.base_date,
    0, 0, 0, 0,          -- no valuation: every value column is zero and stays zero
    0,                   -- growth belongs to the STREAM (growth_mult), not to a value
    ie.comment, ie.is_matched, COALESCE(ie.setup_status, 'new'),
    FALSE
  FROM forecast_income_expense ie
  WHERE NOT (SELECT already_done FROM cr069_skip)
  RETURNING id, scenario_id, name
)
INSERT INTO cr069_item_map (incexp_id, module_id, direction)
SELECT ie.id, i.id,
       CASE WHEN ie.item_type = 'Income' THEN 'income' ELSE 'expense' END
FROM inserted i
JOIN forecast_income_expense ie ON ie.scenario_id = i.scenario_id AND ie.name = i.name;

-- ---------------------------------------------------------------------------
-- 2. One amount-mode stream per converted item.
--
--    `fc_line_id` is carried across AS IS, including NULL. Three live items post through a
--    NULL line (`Retirement Home`, `Car Purchase Chris`, `Social Security`) and land on their
--    COA account's name instead — fcbuilder-incexp resolved
--    `fc_line name || account name || item name`, and the unified loader reproduces that
--    fallback for flow modules specifically. Inventing a line here would change which row
--    they post to and break the gate.
-- ---------------------------------------------------------------------------
INSERT INTO forecast_streams (
  module_id, direction, fc_line_id, mode, amount, amount_usd, growth_mult
)
SELECT
  m.module_id, m.direction, ie.fc_line_id, 'amount',
  ABS(COALESCE(ie.base_value, 0)),
  -- ABS on the twin as well. The two source populations disagree on sign — inc/exp stores an
  -- expense NEGATIVE (33 of 48 rows), a module stores it POSITIVE (30 of 30) — so a straight
  -- copy of base_value_usd would put a negative twin beside a positive magnitude. 057's
  -- CHECK now refuses that outright.
  ABS(COALESCE(ie.base_value_usd, 0)),
  ie.growth_rate
FROM cr069_item_map m
JOIN forecast_income_expense ie ON ie.id = m.incexp_id;

INSERT INTO forecast_stream_changes (stream_id, change_date, amount, flag)
SELECT
  s.id, c.change_date,
  CASE
    WHEN c.flag IN ('Fixed $', 'One-Off $') AND m.direction = 'expense' THEN -c.amount
    ELSE c.amount                                    -- Percent %: a RATE. Never touched.
  END,
  c.flag
FROM forecast_incexp_changes c
JOIN cr069_item_map m ON m.incexp_id = c.incexp_id
JOIN forecast_streams s ON s.module_id = m.module_id;

-- ---------------------------------------------------------------------------
-- 3. Every existing module's income/expense column pairs become streams.
-- ---------------------------------------------------------------------------

-- 3a. EXPENSE. A loan's interest is `derived` (engine-owned, read off the balance path);
--     everything else is `amount`, or `pct_of_value` when that growth method is set.
INSERT INTO forecast_streams (
  module_id, direction, fc_line_id, mode, amount, growth_mult, start_date, end_date
)
SELECT
  m.id, 'expense', m.expense_fc_line_id,
  CASE
    WHEN m.loan_interest_rate IS NOT NULL THEN 'derived'
    WHEN m.expense_growth_method = 'pct_of_value' THEN 'pct_of_value'
    ELSE 'amount'
  END,
  CASE WHEN m.loan_interest_rate IS NOT NULL THEN 0 ELSE ABS(COALESCE(m.expense_amount, 0)) END,
  -- NULL = 1 = plain inflation, which is all a module expense could ever do: there was no
  -- expense-side multiplier before this CR (income got one in CR064 P6; expense did not).
  NULL,
  -- CR062: a loan's window is its own start/end dates expressed through the balance path, and
  -- a CR046 window on top can only corrupt it. The engine already refuses to apply one.
  CASE WHEN m.loan_interest_rate IS NOT NULL THEN NULL ELSE m.expense_start_date END,
  CASE WHEN m.loan_interest_rate IS NOT NULL THEN NULL ELSE m.expense_end_date END
FROM forecast_modules m
WHERE m.has_valuation
  AND NOT (SELECT already_done FROM cr069_skip)
  AND (COALESCE(m.expense_amount, 0) <> 0 OR m.expense_fc_line_id IS NOT NULL);

-- 3b. INCOME. Yield wins over the typed amount on a SINGLE income_pct row — that precedence
--     was `hasIncomePct` in the builder and is now structural in `mode`.
--
--     The typed amount RIDES ALONG on a yield stream rather than being dropped, and that is
--     deliberate: the base-year deferred income tax (fcbuilder-module.js:670-689) has no
--     yield guard, so it books Period-1 tax on those dead amounts today. Three prod modules
--     are in that state (CVC Fund VIII 25,800 · Fidelity Stocks 40,000 · Fidelity Fixed
--     Income 46,000). Dropping the amount would silently delete that tax and fail the gate.
--     Whether the quirk should survive long-term is an owner decision recorded in CR069 §6.1.
INSERT INTO forecast_streams (
  module_id, direction, fc_line_id, mode, amount, growth_mult,
  start_date, end_date, tax_rate_override
)
SELECT
  m.id, 'income', m.income_fc_line_id,
  CASE WHEN EXISTS (SELECT 1 FROM forecast_module_income_pct p WHERE p.module_id = m.id)
       THEN 'yield' ELSE 'amount' END,
  ABS(COALESCE(m.income_amount, 0)),
  m.income_growth_rate,
  m.income_start_date, m.income_end_date,
  -- CR047's chain is stream ?? module ?? scenario. Only the INCOME half moves onto the
  -- stream; `tax_rate_override` stays on the module because a capital gain belongs to the
  -- valuation, not to a flow.
  m.income_tax_rate_override
FROM forecast_modules m
WHERE m.has_valuation
  AND NOT (SELECT already_done FROM cr069_skip)
  AND (COALESCE(m.income_amount, 0) <> 0
       OR m.income_fc_line_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM forecast_module_income_pct p WHERE p.module_id = m.id));

-- 3c. The yield schedule becomes Spread % rows (carry-forward, as income_pct always was).
INSERT INTO forecast_stream_changes (stream_id, change_date, amount, flag)
SELECT s.id, p.effective_date, p.value, 'Spread %'
FROM forecast_module_income_pct p
JOIN forecast_streams s ON s.module_id = p.module_id AND s.direction = 'income';

-- 3d. CR064 P6's steps become Fixed $ rows. Same math — a step compounds from its own year at
--     the stream's growth rate, which is exactly what the recursion `base[i] = base[i-1] ×
--     (1+g[i]) + D[i]` does. Signed already, and income-direction, so no sign transform.
INSERT INTO forecast_stream_changes (stream_id, change_date, amount, flag)
SELECT s.id, st.effective_date, st.amount, 'Fixed $'
FROM forecast_module_income_steps st
JOIN forecast_streams s ON s.module_id = st.module_id AND s.direction = 'income';

-- ---------------------------------------------------------------------------
-- 4. Variant lineage and overrides follow the rows they describe.
-- ---------------------------------------------------------------------------

-- 4a. A materialized variant item pointed at its BASE item; the converted module must point
--     at the converted BASE module, or CR050 sync would treat all 48 as variant-local rows
--     and stop inheriting from base entirely.
UPDATE forecast_modules v
   SET origin_base_id = bm.module_id
  FROM cr069_item_map vm
  JOIN forecast_income_expense vie ON vie.id = vm.incexp_id
  JOIN cr069_item_map bm ON bm.incexp_id = vie.origin_base_id
 WHERE v.id = vm.module_id
   AND vie.origin_base_id IS NOT NULL;

-- 4b. The `incexp` override rows become `module` overrides against the new base ids — and
--     their PATCH KEYS have to be translated, not just re-pointed.
--
--     Every live override names `base_value` / `base_value_usd`, which on a converted module
--     are 0: the money moved to the stream. Re-pointing alone would leave three variant rows
--     inheriting the BASE amount and silently losing the owner's override — `2026 Downside`
--     would go back to the base's Living Expenses (−127,372.43 instead of −115,908.91),
--     Travel and Purchases likewise. Caught by the sums gate, which is what it is for.
--
--     The patch becomes a `streams` SCHEDULE patch, which replaces the stream set wholesale
--     (CR069 Decision 9's accepted coarsening) — so it must carry the WHOLE subtree: every
--     column of every stream, plus each stream's change rows, in the shape `baseSchedule`
--     returns. Amounts are magnitudes here, like the column they land in.
UPDATE forecast_scenario_overrides o
   SET entity_type = 'module',
       base_entity_id = im.module_id,
       patch = jsonb_build_object('streams', (
         SELECT COALESCE(json_agg(
           json_build_object(
             'direction',         s.direction,
             'fc_line_id',        s.fc_line_id,
             'mode',              s.mode,
             'amount',            CASE WHEN o.patch ? 'base_value'
                                       THEN ABS((o.patch->>'base_value')::numeric)
                                       ELSE s.amount END,
             'amount_usd',        CASE WHEN o.patch ? 'base_value_usd'
                                       THEN ABS((o.patch->>'base_value_usd')::numeric)
                                       ELSE s.amount_usd END,
             'growth_mult',       CASE WHEN o.patch ? 'growth_rate'
                                       THEN (o.patch->>'growth_rate')::numeric
                                       ELSE s.growth_mult END,
             'start_date',        s.start_date,
             'end_date',          s.end_date,
             'tax_rate_override', s.tax_rate_override,
             'changes',           COALESCE((
               SELECT json_agg(json_build_object(
                        'change_date', c.change_date, 'amount', c.amount, 'flag', c.flag
                      ) ORDER BY c.id)
                 FROM forecast_stream_changes c WHERE c.stream_id = s.id
             ), '[]'::json)
           ) ORDER BY s.id
         ), '[]'::json)
         FROM forecast_streams s WHERE s.module_id = im.module_id
       ))::jsonb
  FROM cr069_item_map im
 WHERE o.entity_type = 'incexp'
   AND o.base_entity_id = im.incexp_id;

-- 4c. MODULE overrides that name a column this migration MOVES must be translated too.
--
--     A variant's override is a patch of column names, and eleven of those columns stop being
--     read today: the income_* and expense_* pairs now live on streams. The column itself
--     survives until P3, and `syncEntity` derives its column list from information_schema, so
--     the patch would keep applying cleanly to a column NOTHING READS — an override that
--     silently stops working, which is the CR045 §1 / CR048 class exactly.
--
--     Live on prod: one row — `2026 Upside` sets United Beverages' `income_amount` to 750,000
--     (the whole point of the Upside scenario). Without this it reverts to the base's income
--     for 36 years. The sums gate caught it; nothing else would have.
UPDATE forecast_scenario_overrides o
   SET patch = (o.patch - ARRAY[
         'income_amount','income_fc_line_id','income_growth_rate','income_start_date',
         'income_end_date','income_tax_rate_override','expense_amount','expense_fc_line_id',
         'expense_growth_method','expense_start_date','expense_end_date'
       ]) || jsonb_build_object('streams', (
         SELECT COALESCE(json_agg(
           json_build_object(
             'direction', s.direction,
             'fc_line_id', CASE
               WHEN s.direction = 'income' AND o.patch ? 'income_fc_line_id'
                 THEN (o.patch->>'income_fc_line_id')::integer
               WHEN s.direction = 'expense' AND o.patch ? 'expense_fc_line_id'
                 THEN (o.patch->>'expense_fc_line_id')::integer
               ELSE s.fc_line_id END,
             'mode', CASE
               WHEN s.mode = 'derived' THEN s.mode          -- a loan's interest stays derived
               WHEN s.direction = 'expense' AND o.patch ? 'expense_growth_method'
                 THEN CASE WHEN o.patch->>'expense_growth_method' = 'pct_of_value'
                           THEN 'pct_of_value' ELSE 'amount' END
               ELSE s.mode END,
             'amount', CASE
               WHEN s.direction = 'income' AND o.patch ? 'income_amount'
                 THEN ABS((o.patch->>'income_amount')::numeric)
               WHEN s.direction = 'expense' AND o.patch ? 'expense_amount'
                 THEN ABS((o.patch->>'expense_amount')::numeric)
               ELSE s.amount END,
             'amount_usd', s.amount_usd,
             'growth_mult', CASE
               WHEN s.direction = 'income' AND o.patch ? 'income_growth_rate'
                 THEN (o.patch->>'income_growth_rate')::numeric
               ELSE s.growth_mult END,
             'start_date', CASE
               WHEN s.direction = 'income' AND o.patch ? 'income_start_date'
                 THEN (o.patch->>'income_start_date')::date
               WHEN s.direction = 'expense' AND o.patch ? 'expense_start_date'
                 THEN (o.patch->>'expense_start_date')::date
               ELSE s.start_date END,
             'end_date', CASE
               WHEN s.direction = 'income' AND o.patch ? 'income_end_date'
                 THEN (o.patch->>'income_end_date')::date
               WHEN s.direction = 'expense' AND o.patch ? 'expense_end_date'
                 THEN (o.patch->>'expense_end_date')::date
               ELSE s.end_date END,
             'tax_rate_override', CASE
               WHEN s.direction = 'income' AND o.patch ? 'income_tax_rate_override'
                 THEN (o.patch->>'income_tax_rate_override')::numeric
               ELSE s.tax_rate_override END,
             'changes', COALESCE((
               SELECT json_agg(json_build_object(
                        'change_date', c.change_date, 'amount', c.amount, 'flag', c.flag
                      ) ORDER BY c.id)
                 FROM forecast_stream_changes c WHERE c.stream_id = s.id
             ), '[]'::json)
           ) ORDER BY s.id
         ), '[]'::json)
         FROM forecast_streams s WHERE s.module_id = o.base_entity_id
       ))
 WHERE o.entity_type = 'module'
   AND o.patch ?| ARRAY[
     'income_amount','income_fc_line_id','income_growth_rate','income_start_date',
     'income_end_date','income_tax_rate_override','expense_amount','expense_fc_line_id',
     'expense_growth_method','expense_start_date','expense_end_date'
   ];

-- ---------------------------------------------------------------------------
-- 5. Post-conditions.
--
--    Structural and RELATIVE only — every one is "converted = source", which holds vacuously
--    at 0 = 0 on a data-free database. An absolute row count here would abort CI's chain, the
--    defect shipped in 046, 050 and 052 (Known Issue #12, three incidents).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n_items INTEGER; n_flow INTEGER;
  n_src_changes INTEGER; n_new_changes INTEGER;
  n_pct INTEGER; n_spread INTEGER;
  n_steps INTEGER; n_bad INTEGER;
BEGIN
  IF (SELECT already_done FROM cr069_skip) THEN
    RAISE NOTICE 'CR069 P2: backfill skipped (already applied); post-conditions not re-checked.';
    RETURN;
  END IF;

  SELECT count(*) INTO n_items FROM forecast_income_expense;
  SELECT count(*) INTO n_flow  FROM forecast_modules WHERE NOT has_valuation;
  IF n_flow <> n_items THEN
    RAISE EXCEPTION 'CR069 P2: % items converted to % flow modules', n_items, n_flow;
  END IF;

  -- Every item's change rows arrived, and the RATE rows are byte-identical to their source.
  -- That second half is the assertion that catches the negation defect: |amount| preserved
  -- and sign × direction preserved would BOTH pass on an inverted Percent %.
  SELECT count(*) INTO n_src_changes FROM forecast_incexp_changes;
  SELECT count(*) INTO n_new_changes
    FROM forecast_stream_changes c
    JOIN forecast_streams s ON s.id = c.stream_id
    JOIN forecast_modules m ON m.id = s.module_id
   WHERE NOT m.has_valuation;
  IF n_new_changes <> n_src_changes THEN
    RAISE EXCEPTION 'CR069 P2: % source changes became % stream changes', n_src_changes, n_new_changes;
  END IF;

  SELECT count(*) INTO n_bad
    FROM forecast_incexp_changes src
    JOIN cr069_item_map im ON im.incexp_id = src.incexp_id
    JOIN forecast_streams s ON s.module_id = im.module_id
    JOIN forecast_stream_changes c
      ON c.stream_id = s.id AND c.change_date = src.change_date AND c.flag = src.flag
   WHERE src.flag IN ('Percent %', 'Spread %')
     AND c.amount <> src.amount;
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'CR069 P2: % rate rows (Percent %%/Spread %%) were altered — they must carry through untouched', n_bad;
  END IF;

  -- ...and the MONEY rows preserved their magnitude while taking the direction's sign.
  SELECT count(*) INTO n_bad
    FROM forecast_incexp_changes src
    JOIN cr069_item_map im ON im.incexp_id = src.incexp_id
    JOIN forecast_streams s ON s.module_id = im.module_id
    JOIN forecast_stream_changes c
      ON c.stream_id = s.id AND c.change_date = src.change_date AND c.flag = src.flag
   WHERE src.flag IN ('Fixed $', 'One-Off $')
     AND (ABS(c.amount) <> ABS(src.amount)
          OR c.amount <> (CASE WHEN im.direction = 'expense' THEN -src.amount ELSE src.amount END));
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'CR069 P2: % money rows did not convert to the direction frame correctly', n_bad;
  END IF;

  SELECT count(*) INTO n_pct    FROM forecast_module_income_pct;
  SELECT count(*) INTO n_spread FROM forecast_stream_changes WHERE flag = 'Spread %';
  IF n_spread <> n_pct THEN
    RAISE EXCEPTION 'CR069 P2: % income_pct rows became % Spread %% rows', n_pct, n_spread;
  END IF;

  SELECT count(*) INTO n_steps FROM forecast_module_income_steps;
  SELECT count(*) INTO n_bad
    FROM forecast_stream_changes c
    JOIN forecast_streams s ON s.id = c.stream_id
    JOIN forecast_modules m ON m.id = s.module_id
   WHERE c.flag = 'Fixed $' AND m.has_valuation;
  IF n_bad <> n_steps THEN
    RAISE EXCEPTION 'CR069 P2: % income steps became % Fixed $ rows on valuation modules', n_steps, n_bad;
  END IF;

  -- No variant row lost its lineage, and no override was left pointing at a retired table.
  SELECT count(*) INTO n_bad FROM forecast_scenario_overrides WHERE entity_type = 'incexp';
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'CR069 P2: % overrides still name the retired incexp entity type', n_bad;
  END IF;

  -- No override may still patch a column the engine has stopped reading. An override that
  -- applies cleanly to a dead column is worse than one that fails: it looks live in the UI
  -- and changes nothing in the numbers.
  SELECT count(*) INTO n_bad FROM forecast_scenario_overrides
   WHERE patch ?| ARRAY[
     'income_amount','income_fc_line_id','income_growth_rate','income_start_date',
     'income_end_date','income_tax_rate_override','expense_amount','expense_fc_line_id',
     'expense_growth_method','expense_start_date','expense_end_date','base_value','base_value_usd'
   ];
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'CR069 P2: % overrides still patch a column the engine no longer reads', n_bad;
  END IF;

  SELECT count(*) INTO n_bad
    FROM forecast_income_expense ie
    JOIN cr069_item_map im ON im.incexp_id = ie.id
    JOIN forecast_modules m ON m.id = im.module_id
   WHERE ie.origin_base_id IS NOT NULL AND m.origin_base_id IS NULL;
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'CR069 P2: % converted variant rows lost their origin link', n_bad;
  END IF;

  -- A loan must still post its interest somewhere (CR062): a derived stream with no line
  -- would take cash out of the plan and appear on no P&L row at all.
  SELECT count(*) INTO n_bad
    FROM forecast_modules m
   WHERE m.loan_interest_rate IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM forecast_streams s
                      WHERE s.module_id = m.id AND s.mode = 'derived' AND s.fc_line_id IS NOT NULL);
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'CR069 P2: % loans have no derived interest stream with a line', n_bad;
  END IF;

  RAISE NOTICE 'CR069 P2: % items converted, % change rows, % spread rows — all post-conditions passed.',
    n_items, n_new_changes, n_spread;
END $$;

COMMIT;
