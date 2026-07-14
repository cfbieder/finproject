-- 039 — CR050: forecast scenario variants (inherit-unless-overridden).
--
-- A scenario copy is a severed island: 30 entities duplicated to change one field, nothing
-- recording WHICH field made it a downside, and the copies then rot (fix a cost basis in Base
-- and "2026 Upside" keeps the wrong one). The hand-enumerated copy has also silently dropped
-- columns twice — CR045 §1 (cash_sweep_priority ⇒ −$3.35M of unfunded shortfall) and CR048
-- (the whole assumptions slice ⇒ 0% inflation).
--
-- A VARIANT stores only its overrides. `syncVariant()` materializes base ⊕ overrides into real
-- rows on the variant, so the engine, Review, Compare, AI review and the audit CSVs keep
-- reading an ordinary, fully-populated scenario and do not change.
--
-- Everything here is nullable/empty: a scenario with no parent behaves EXACTLY as it does
-- today. No backfill, no data change.

-- ---------------------------------------------------------------------------
-- 1. Lineage
-- ---------------------------------------------------------------------------
ALTER TABLE forecast_scenarios
  ADD COLUMN parent_scenario_id INTEGER REFERENCES forecast_scenarios(id) ON DELETE RESTRICT,
  ADD COLUMN synced_at TIMESTAMPTZ;

COMMENT ON COLUMN forecast_scenarios.parent_scenario_id IS
  'CR050: the base this scenario is a variant of. NULL = a standalone scenario (today''s behavior). RESTRICT: a base with variants cannot be deleted until they are detached.';
COMMENT ON COLUMN forecast_scenarios.synced_at IS
  'CR050: when this variant was last materialized from base ⊕ overrides. Staleness stamp for the lazy sync.';

-- One level only. A variant may not itself be a base.
CREATE OR REPLACE FUNCTION fc_reject_nested_variant() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_scenario_id IS NOT NULL THEN
    IF NEW.parent_scenario_id = NEW.id THEN
      RAISE EXCEPTION 'A scenario cannot be a variant of itself (id %)', NEW.id;
    END IF;
    IF EXISTS (SELECT 1 FROM forecast_scenarios p
                WHERE p.id = NEW.parent_scenario_id AND p.parent_scenario_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Variant of a variant is not supported: scenario % is itself a variant', NEW.parent_scenario_id;
    END IF;
    IF EXISTS (SELECT 1 FROM forecast_scenarios c
                WHERE c.parent_scenario_id = NEW.id) THEN
      RAISE EXCEPTION 'Scenario % is a base for other variants and cannot become a variant itself', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fc_reject_nested_variant
  BEFORE INSERT OR UPDATE OF parent_scenario_id ON forecast_scenarios
  FOR EACH ROW EXECUTE FUNCTION fc_reject_nested_variant();

-- ---------------------------------------------------------------------------
-- 2. Provenance on the materialized rows
--    origin_base_id = the BASE row this variant row was materialized from.
--    NULL = variant-local (added in the variant; sync never touches it).
--    ON DELETE SET NULL: deleting a base module leaves the variant's row behind as a local
--    row rather than vanishing it — the base-delete route warns which variants are affected.
-- ---------------------------------------------------------------------------
ALTER TABLE forecast_modules
  ADD COLUMN origin_base_id INTEGER REFERENCES forecast_modules(id) ON DELETE SET NULL;
ALTER TABLE forecast_income_expense
  ADD COLUMN origin_base_id INTEGER REFERENCES forecast_income_expense(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_fc_modules_origin ON forecast_modules(scenario_id, origin_base_id)
  WHERE origin_base_id IS NOT NULL;
CREATE UNIQUE INDEX idx_fc_incexp_origin ON forecast_income_expense(scenario_id, origin_base_id)
  WHERE origin_base_id IS NOT NULL;

COMMENT ON COLUMN forecast_modules.origin_base_id IS
  'CR050: the base scenario''s module this row was materialized from. NULL = variant-local (or a plain non-variant scenario).';
COMMENT ON COLUMN forecast_income_expense.origin_base_id IS
  'CR050: the base scenario''s item this row was materialized from. NULL = variant-local (or a plain non-variant scenario).';

-- ---------------------------------------------------------------------------
-- 3. The overrides — a JSONB patch keyed to the BASE row's id.
--
--    Field-level, not row-level: overriding Fidelity's growth_rate must still let a later fix
--    to its income yield in Base flow through. It has to be a patch rather than a nullable
--    mirror column, because NULL is already load-bearing in these columns (NULL
--    tax_rate_override = fall back to the scenario rate; NULL cash_sweep_priority = never
--    liquidate; NULL window = unbounded), so "NULL means inherit" was never available.
--
--    Keyed by id, not name: PUT /modules/:id allows renames, one live module has an EMPTY
--    name, and name-keying is what makes the assumptions document fragile today.
--
--    Schedules (investments / disposals / income_pct) are lists with no unique constraint, so
--    they have no key to merge on: a patch key of 'investments' / 'disposals' / 'income_pct'
--    replaces that schedule wholesale. This is also what the module PUT already does.
-- ---------------------------------------------------------------------------
CREATE TABLE forecast_scenario_overrides (
  id              SERIAL PRIMARY KEY,
  scenario_id     INTEGER NOT NULL REFERENCES forecast_scenarios(id) ON DELETE CASCADE,
  entity_type     VARCHAR(20) NOT NULL
                    CHECK (entity_type IN ('module', 'incexp', 'assumption')),
  base_entity_id  INTEGER,
  entity_key      VARCHAR(40)
                    CHECK (entity_key IS NULL OR entity_key IN
                      ('inflation', 'FX', 'Tax Rate', 'PeriodStart', 'PeriodEnd',
                       'cash_sweep_low', 'cash_sweep_high')),
  patch           JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  -- module/incexp overrides key on a base row; assumption overrides key on a name.
  CONSTRAINT fc_override_key_shape CHECK (
    (entity_type IN ('module', 'incexp') AND base_entity_id IS NOT NULL AND entity_key IS NULL)
    OR
    (entity_type = 'assumption' AND base_entity_id IS NULL AND entity_key IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_fc_override_entity
  ON forecast_scenario_overrides(scenario_id, entity_type, base_entity_id)
  WHERE base_entity_id IS NOT NULL;
CREATE UNIQUE INDEX idx_fc_override_key
  ON forecast_scenario_overrides(scenario_id, entity_key)
  WHERE entity_key IS NOT NULL;
CREATE INDEX idx_fc_override_scenario ON forecast_scenario_overrides(scenario_id);

COMMENT ON TABLE forecast_scenario_overrides IS
  'CR050: what makes a variant a variant. One row per overridden base entity; `patch` carries only the keys that differ. The override set IS the scenario''s definition.';
