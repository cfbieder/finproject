-- 038 — CR047: income-only tax rate override on a forecast module.
--
-- `tax_rate_override` (migration 010) overrides the tax rate for BOTH realized capital
-- gains and income on a module. That conflates two different taxes. United Beverages'
-- dividend arrives already taxed in Poland, so the only incremental US tax on the INCOME
-- is ~3% — but a future sale of the business is still a normal capital gain at the
-- scenario rate. Today you cannot say that: setting tax_rate_override to 3 would also
-- under-tax the disposal.
--
-- NULL = fall back to tax_rate_override, and then to the scenario rate — i.e. exactly
-- today's behavior, so every existing module is byte-identical. 0 is a real value
-- (income taxed at nothing), not "unset".

ALTER TABLE forecast_modules
  ADD COLUMN income_tax_rate_override NUMERIC(6, 3);

COMMENT ON COLUMN forecast_modules.income_tax_rate_override IS
  'CR047: tax rate (%) applied to this module''s INCOME only; capital gains keep tax_rate_override / the scenario rate. NULL = fall back (no change).';
