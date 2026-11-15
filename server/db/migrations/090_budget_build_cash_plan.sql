-- 090 — CR104: the budget builder's cash plan (Cash Flow by currency).
--
-- WHAT. `budget_build_cash_plan` holds, per build, the owner's inputs to the Cash Flow modal:
--   * kind 'opening'  — an override of one currency × block's Jan 1 opening balance (local currency);
--   * kind 'transfer' — a what-if move of money in a month: from (currency, block) to (to_currency,
--     to_block), `amount` on the from side, `rate` to-per-from, `to_amount` stored rounded to cents.
-- Nothing here is published: transfers never reach `budget_entries` (CR104 D1).
--
-- Additive: one new table. Safe on prod before the code.
--
-- Rollback (manual — the runner is forward-only):
--   DROP TABLE IF EXISTS budget_build_cash_plan;

CREATE TABLE IF NOT EXISTS budget_build_cash_plan (
    id           SERIAL        PRIMARY KEY,
    build_id     INTEGER       NOT NULL REFERENCES budget_builds(id) ON DELETE CASCADE,
    kind         VARCHAR(8)    NOT NULL CONSTRAINT bbcp_kind_chk CHECK (kind IN ('opening', 'transfer')),
    currency     CHAR(3)       NOT NULL,
    block        VARCHAR(12)   NOT NULL CONSTRAINT bbcp_block_chk CHECK (block IN ('cash', 'investments')),
    month        SMALLINT,
    to_currency  CHAR(3),
    to_block     VARCHAR(12)   CONSTRAINT bbcp_to_block_chk CHECK (to_block IS NULL OR to_block IN ('cash', 'investments')),
    amount       NUMERIC(15,2) NOT NULL,
    rate         NUMERIC(15,6),
    to_amount    NUMERIC(15,2),
    note         TEXT,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT bbcp_opening_shape_chk CHECK (kind <> 'opening' OR
      (month IS NULL AND to_currency IS NULL AND to_block IS NULL AND rate IS NULL AND to_amount IS NULL)),
    CONSTRAINT bbcp_transfer_shape_chk CHECK (kind <> 'transfer' OR
      (month BETWEEN 1 AND 12 AND to_currency IS NOT NULL AND to_block IS NOT NULL
       AND rate > 0 AND to_amount IS NOT NULL AND amount > 0
       AND NOT (to_currency = currency AND to_block = block)))
);

CREATE UNIQUE INDEX IF NOT EXISTS bbcp_one_opening_uq
    ON budget_build_cash_plan (build_id, currency, block) WHERE kind = 'opening';

CREATE INDEX IF NOT EXISTS bbcp_build_idx ON budget_build_cash_plan (build_id);
