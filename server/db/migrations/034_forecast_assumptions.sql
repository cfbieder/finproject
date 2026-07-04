-- 034_forecast_assumptions.sql (CR039)
-- Moves forecast assumptions (inflation / FX / tax / category list / scenario
-- periods) from the on-disk components/data/FCAssump.json into Postgres,
-- retiring the file+DB dual source of truth.
--
-- The name was already taken: migration 001 created a per-scenario
-- (scenario_id, section, key, value) forecast_assumptions table that no code
-- ever wrote to or read (0 rows on dev AND prod, verified 2026-07-04). It is
-- dropped and the name reused for the CR039 document store: one row per
-- top-level key of the old JSON document; `ord` preserves the document's key
-- order so the /forecast/assumptions API response stays byte-identical.
--
-- Data import is NOT done here (migrations must not depend on host files):
-- run `node server/src/v2/scripts/import-fc-assumptions.js` after applying.

DROP TABLE IF EXISTS forecast_assumptions;

-- `json` (not jsonb) on purpose: jsonb normalizes object key order, which
-- breaks the byte-identical API guarantee; json preserves the stored text and
-- we only ever read whole values (no jsonb operators needed).
CREATE TABLE forecast_assumptions (
  key        TEXT PRIMARY KEY,
  value      JSON NOT NULL,
  ord        INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE forecast_assumptions IS
  'CR039: forecast assumption document (formerly FCAssump.json), one row per top-level key; ord = original key order for API parity';
