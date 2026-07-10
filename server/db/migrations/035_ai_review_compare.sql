-- 035_ai_review_compare.sql — CR040 P3 (AI commentary for scenario compare).
--
-- The /forecast-compare page's AI narrative reuses the fc_ai_reviews async
-- conversation infrastructure. A compare review is keyed to the baseline
-- scenario (scenario_id, as before) and records the comparison scenario here,
-- so follow-up messages can rebuild the two-scenario context. NULL = a plain
-- single-scenario review (all existing rows), preserving current behavior;
-- the /scenario/:name listing endpoint filters compare reviews out of the
-- Review page's drawer and lists them per-pair for the Compare page.
--
-- CASCADE: deleting either scenario deletes the compare conversations that
-- reference it (a compare against a vanished scenario is meaningless).

ALTER TABLE fc_ai_reviews
  ADD COLUMN compare_scenario_id INTEGER REFERENCES forecast_scenarios(id) ON DELETE CASCADE;

CREATE INDEX idx_fc_ai_reviews_compare ON fc_ai_reviews(compare_scenario_id);
