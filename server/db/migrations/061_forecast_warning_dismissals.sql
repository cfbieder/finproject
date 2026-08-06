-- 061 — CR074: dismissing a cash-health warning, per scenario.
--
-- The Cash Health panel derives its warnings CLIENT-side from what the Review page already
-- loads (`fcWarnings.js`), so there is nothing server-side to mark as read. This table is the
-- only new state: which warnings the owner has looked at and accepted, in which scenario.
--
-- Scoped to the scenario because the warnings are: `disposal-no-gain-Barkeria Sp. z o.o.` is a
-- statement about Base's Barkeria, and accepting it there must not silence the same finding in
-- `2026 Upside`, where the module may carry different numbers entirely.
--
-- `fingerprint` is what stops a dismissal hiding a WORSE version of the same problem. It is a
-- hash of the warning's substance — its years, its amount, its detail sentence — taken at the
-- moment of dismissal. A dismissal suppresses a warning only while the fingerprint still
-- matches, so "Sweep source fully drained 2061" accepted today re-appears the moment the plan
-- makes it 2041. Without it, one click could permanently silence a rule, which is the failure
-- mode CR045 built this panel to prevent.
--
-- ON DELETE CASCADE: a deleted scenario's dismissals are meaningless, and forecast_scenarios is
-- already the cascade root for its modules and entries.

CREATE TABLE IF NOT EXISTS forecast_warning_dismissals (
    id            SERIAL PRIMARY KEY,
    scenario_id   INTEGER NOT NULL REFERENCES forecast_scenarios(id) ON DELETE CASCADE,
    warning_id    VARCHAR(300) NOT NULL,
    fingerprint   VARCHAR(64)  NOT NULL,
    dismissed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT forecast_warning_dismissals_unique UNIQUE (scenario_id, warning_id)
);

-- The read is always "every dismissal for this scenario", once per Review render.
CREATE INDEX IF NOT EXISTS idx_fc_warning_dismissals_scenario
    ON forecast_warning_dismissals (scenario_id);

DO $$
BEGIN
  RAISE NOTICE 'migration 061: forecast_warning_dismissals ready (0 rows on first apply — nothing is dismissed until the owner clicks).';
END $$;
