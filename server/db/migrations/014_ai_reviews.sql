-- Migration 014: AI Review conversations for forecast plan evaluation
-- Stores conversation threads where Claude AI reviews forecast scenarios

CREATE TABLE IF NOT EXISTS fc_ai_reviews (
    id SERIAL PRIMARY KEY,
    scenario_id INTEGER NOT NULL REFERENCES forecast_scenarios(id) ON DELETE CASCADE,
    title VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fc_ai_messages (
    id SERIAL PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES fc_ai_reviews(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    actions JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fc_ai_reviews_scenario ON fc_ai_reviews(scenario_id);
CREATE INDEX idx_fc_ai_messages_review ON fc_ai_messages(review_id);
