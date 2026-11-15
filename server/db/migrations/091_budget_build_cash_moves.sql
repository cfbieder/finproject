-- 091 — CR104 §10: the Cash Flow modal's item moves (what-if reclassification).
--
-- WHAT. `budget_build_cash_moves` records, per draft build, that one budget item — a category on an
-- account in a currency and month — lands in a different block than its account says: e.g. a
-- dividend the builder put on a holding under PL Investments that is really paid into a bank account.
-- It stores WHERE the item lands, never an amount, so the move follows the line when the budget
-- changes. Nothing here is published (CR104 D1): the budget keeps the account the builder gave it.
--
-- Additive: one new table. Safe on prod before the code.
--
-- Rollback (manual — the runner is forward-only):
--   DROP TABLE IF EXISTS budget_build_cash_moves;

CREATE TABLE IF NOT EXISTS budget_build_cash_moves (
    id           SERIAL        PRIMARY KEY,
    build_id     INTEGER       NOT NULL REFERENCES budget_builds(id) ON DELETE CASCADE,
    category_id  INTEGER       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    account_id   INTEGER       REFERENCES accounts(id) ON DELETE CASCADE,  -- NULL = the "No account" item
    currency     CHAR(3)       NOT NULL,
    month        SMALLINT      NOT NULL CONSTRAINT bbcm_month_chk CHECK (month BETWEEN 1 AND 12),
    to_block     VARCHAR(12)   NOT NULL CONSTRAINT bbcm_to_block_chk CHECK (to_block IN ('cash', 'investments')),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- One move per item; COALESCE so two "No account" moves of one item collide too.
CREATE UNIQUE INDEX IF NOT EXISTS bbcm_one_per_item_uq
    ON budget_build_cash_moves (build_id, category_id, COALESCE(account_id, 0), currency, month);
