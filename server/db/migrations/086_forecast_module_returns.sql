-- ---------------------------------------------------------------------------
-- 086_forecast_module_returns.sql — CR099: a per-year return path on a forecast module.
--
-- A valuation module grows by `growth_rate × inflation` for the whole horizon, so a one-year
-- market crash and a slower recovery could not be expressed. A row here sets the module's
-- nominal price return for that calendar year, replacing `growth_rate × inflation` for that
-- year only; a module with no rows behaves exactly as before.
--
-- A CHILD TABLE, not a JSONB column on forecast_modules (CR099 §4.1): variant sync prunes a
-- patch key when `valuesEqual` says it matches the base, and for two arrays that function
-- compares `String(a) === String(b)` — any path as long as the base's would be pruned silently.
-- This mirrors forecast_module_amortization (CR062) instead.
--
-- `year` is an integer, because the engine is annual. A row stays pinned to its calendar year
-- across the annual close (owner decision 2026-11-03). `pct > -100` because the cash sweep
-- divides balances by the growth factor (cash-sweep.js), which must stay above zero; `<= 1000`
-- catches a fraction typed as a percent.
--
-- Additive and inert: a new empty table. Rollback (manual, the runner is forward-only):
--   DROP TABLE forecast_module_returns;
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS forecast_module_returns (
  id         SERIAL PRIMARY KEY,
  module_id  INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
  year       INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2200),
  pct        NUMERIC(8,4) NOT NULL CHECK (pct > -100 AND pct <= 1000),
  UNIQUE (module_id, year)
);

COMMENT ON TABLE  forecast_module_returns      IS 'CR099: per-year nominal price return for a valuation module; replaces growth_rate × inflation for that calendar year only.';
COMMENT ON COLUMN forecast_module_returns.pct  IS 'CR099: the year''s price return in percent (−50 halves the market value). Unrealized: no tax, no cash.';
