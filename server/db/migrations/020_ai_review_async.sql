-- Migration 020: AI Review async status tracking
-- Allows POST /ai-review to return immediately while the gateway call runs
-- in background; clients poll status via GET /:reviewId/status

ALTER TABLE fc_ai_reviews
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'failed')),
    ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_fc_ai_reviews_pending
    ON fc_ai_reviews(status, updated_at) WHERE status = 'pending';
