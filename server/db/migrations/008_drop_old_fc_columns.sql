-- Phase 2B-7: Drop old forecast module columns replaced by FC Line system
-- expense_category → replaced by expense_fc_line_id (FK to fc_lines)
-- income_category → replaced by income_fc_line_id (FK to fc_lines)
-- expense_pct → replaced by expense_growth_method + expense_amount

ALTER TABLE forecast_modules DROP COLUMN IF EXISTS expense_category;
ALTER TABLE forecast_modules DROP COLUMN IF EXISTS income_category;
ALTER TABLE forecast_modules DROP COLUMN IF EXISTS expense_pct;
