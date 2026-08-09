-- 062 — CR078: a selling cost on a disposal.
--
-- Every disposal in the model books GROSS proceeds. There is no agent commission, transfer tax,
-- legal or broker fee, no Spanish plusvalía — the whole sale price lands in cash and the whole
-- gain is taxed. On `2026 Base` that is 5,566,755 of property sales (3–6% all-in) and 5,445,368
-- of business sales (1–3%), none of it modelled.
--
-- The base year is the sharpest case: its 1,239,753 folds straight into the sweep's OPENING CASH
-- (CR075 §2), which the sweep pins to its band every year — so the error rides all 36 forecast
-- years instead of washing out. That is the CR049 §1 failure mode, and it is why a percentage
-- that looks small is worth a schema change.
--
-- PER ROW, not per module or per scenario, and the live data is the argument: a property sale
-- carries 3–6%, a business sale 1–3% negotiated, and `CVC Fund VIII`/`IX`'s 2,033,048 of capital
-- returns carry NOTHING AT ALL — they are distributions modelled as disposals. Any coarser rate
-- would silently charge a selling cost on those, on over two million of proceeds.
--
-- NULLABLE with NO DEFAULT, deliberately. Every existing row means "no cost modelled", so the
-- engine is byte-identical until a value is typed — the CR050/CR062 dormancy pattern. A DEFAULT 0
-- would read the same to the engine but would assert that the owner has considered and chosen
-- zero for 20 existing disposals, which is not true; NULL says "unanswered" and lets CR077's
-- advisory rule ask.
--
-- Scale 4 to match `forecast_stream_changes.amount` and `growth_rate`, so a rate like 5.7500%
-- survives a round-trip losslessly. The CHECK keeps it a percentage: a negative selling cost is
-- not a thing, and ≥ 100% would make proceeds zero or negative, which the disposal path does not
-- model and should not silently accept.
--
-- Inert on apply: 0 rows carry a value, and nothing reads the column until CR078's engine change
-- ships. Verified by regenerating all five scenarios before and after (see the registry row).

ALTER TABLE forecast_module_disposals
  ADD COLUMN IF NOT EXISTS disposal_cost_pct numeric(6,4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fc_disposal_cost_pct_range'
      AND conrelid = 'public.forecast_module_disposals'::regclass
  ) THEN
    ALTER TABLE forecast_module_disposals
      ADD CONSTRAINT fc_disposal_cost_pct_range
      CHECK (disposal_cost_pct IS NULL OR (disposal_cost_pct >= 0 AND disposal_cost_pct < 100));
  END IF;
END $$;

COMMENT ON COLUMN forecast_module_disposals.disposal_cost_pct IS
  'CR078 — selling cost as a PERCENT of this disposal''s gross proceeds (agent fee, transfer '
  'tax, legal). Reduces cash AND the taxable gain: a selling cost lowers the amount realized, it '
  'is not an operating expense. NULL = no cost modelled, which is not the same as 0%.';

-- Post-conditions — STRUCTURAL ONLY.
--
-- No row-count assertion here: that is the defect shipped in 046, 050 and 052 (roadmap Known
-- Issue #12, three incidents), because a count is vacuously true on an empty database and the
-- whole chain must apply to one.
DO $$
DECLARE
  col_count int;
  chk_count int;
BEGIN
  SELECT count(*) INTO col_count
    FROM information_schema.columns
   WHERE table_schema = current_schema()
     AND table_name = 'forecast_module_disposals'
     AND column_name = 'disposal_cost_pct';
  IF col_count <> 1 THEN
    RAISE EXCEPTION '062: disposal_cost_pct missing after apply';
  END IF;

  -- Schema-qualified, like 057's siblings: `conname` is unique per TABLE, not per database, and
  -- CR027 is schema-per-tenant on `main` — an unqualified count reads high the moment the chain
  -- reaches a second schema.
  SELECT count(*) INTO chk_count
    FROM pg_constraint
   WHERE conname = 'fc_disposal_cost_pct_range'
     AND conrelid = 'public.forecast_module_disposals'::regclass;
  IF chk_count <> 1 THEN
    RAISE EXCEPTION '062: fc_disposal_cost_pct_range constraint missing after apply';
  END IF;

  RAISE NOTICE '062: disposal_cost_pct added, inert until CR078 engine ships';
END $$;
