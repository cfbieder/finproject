-- 088 — CR100: itemised budget-builder lines.
--
-- WHAT. A builder line can take the policy 'itemised': its annual figure and its months come from
-- described rows (one per trip, say), each in its own currency, twelve months each. The rows are
-- stored SIGNED (the sign is decided once, at save, never re-derived on read or copy), one sign per
-- row. The line's total is derived on read at the build's rates and is never stored, except as a
-- publish's annual_amount, as for every policy.
--
-- budget_category_policy.items_line_id points at the itemised line of the PUBLISHED build, so next
-- year's draft can copy its rows without storing them twice. Published and superseded builds are
-- never deleted (only drafts are), so the pointer stays readable; SET NULL covers the rest.
--
-- Additive (a new table, a nullable column) and CHECK-widening only; safe on prod before the code.
--
-- Rollback (manual — the runner is forward-only). Narrowing the CHECKs fails while any line or policy
-- is 'itemised': first set those to 'fixed' at their itemised annual.
--   DROP TABLE IF EXISTS budget_build_line_items;
--   ALTER TABLE budget_category_policy DROP COLUMN IF EXISTS items_line_id;
--   ALTER TABLE budget_build_lines DROP CONSTRAINT IF EXISTS bbl_policy_chk;
--   ALTER TABLE budget_build_lines ADD CONSTRAINT bbl_policy_chk CHECK (policy IN ('recurring', 'one_off', 'fixed'));
--   ALTER TABLE budget_category_policy DROP CONSTRAINT IF EXISTS bcp_policy_chk;
--   ALTER TABLE budget_category_policy ADD CONSTRAINT bcp_policy_chk CHECK (policy IN ('recurring', 'one_off', 'fixed'));

CREATE TABLE IF NOT EXISTS budget_build_line_items (
    id          SERIAL PRIMARY KEY,
    line_id     INTEGER NOT NULL REFERENCES budget_build_lines(id) ON DELETE CASCADE,
    position    SMALLINT NOT NULL,
    description VARCHAR(200) NOT NULL CHECK (btrim(description) <> ''),
    currency    CHAR(3) NOT NULL CHECK (currency IN ('USD', 'PLN', 'EUR')),
    months      NUMERIC(15,2)[] NOT NULL CHECK (
                    cardinality(months) = 12
                    AND array_position(months, NULL) IS NULL
                    AND (0 <= ALL(months) OR 0 >= ALL(months))),
    CONSTRAINT bbli_pos_uniq UNIQUE (line_id, position)
);

ALTER TABLE budget_build_lines DROP CONSTRAINT IF EXISTS bbl_policy_chk;
ALTER TABLE budget_build_lines ADD CONSTRAINT bbl_policy_chk
    CHECK (policy IN ('recurring', 'one_off', 'fixed', 'itemised'));

ALTER TABLE budget_category_policy DROP CONSTRAINT IF EXISTS bcp_policy_chk;
ALTER TABLE budget_category_policy ADD CONSTRAINT bcp_policy_chk
    CHECK (policy IN ('recurring', 'one_off', 'fixed', 'itemised'));

ALTER TABLE budget_category_policy
    ADD COLUMN IF NOT EXISTS items_line_id INTEGER REFERENCES budget_build_lines(id) ON DELETE SET NULL;
