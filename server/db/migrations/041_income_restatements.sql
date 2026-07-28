-- 041 — CR057 "Book Income at Source": income_restatements + the
--       `Transfer - Distributions` COA row.
--
-- Investment income is recorded on the account where the CASH LANDED, not on the
-- holding that EARNED it (United Beverages' 5 dividends and Barkeria's 2 payments
-- all post to PKO). /investment-returns scopes strictly to "transactions on the
-- selected account", so it reports UB at a confident 0.00% on ~25M PLN of capital.
--
-- CR057 restates each one as a THREE-LEG booking:
--     leg 1 (new)  holding  +A / +B   original income category
--     leg 2 (new)  holding  -A / -B   Transfer - Distributions
--     leg 3 (edit) cash row  untouched amounts, category -> Transfer - Distributions
-- Legs 1+2 are same-account/same-date and equal-and-opposite, so the holding's book
-- value does not move and every existing `Unrealized G/L` mark stays valid (each was
-- written as `target - book`).
--
-- Two objects, both required BEFORE the code that references them is deployed
-- (see .claude/rules/git-concurrency.md §6).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The COA row.
--
-- Created HERE, not in seed-cr019-coa.js: that script is a manual admin CLI
-- (--apply), not a fresh-DB seed path, so relying on it would mean prod gets the
-- row via an unstated hand-step. And if the row were instead hand-created through
-- the generic COA create path, `is_transfer` DEFAULTs FALSE — which fails
-- SILENTLY and identically to the bug being fixed: investmentReturns.bucketOf
-- would classify leg 2 as `income` (profit_loss, not the mark category), income
-- would net to +A - A = 0, the report would still read 0.00%, and the
-- reconciliation identity would STILL close because `fxEffect` is a plug. The
-- endpoint re-asserts these flags at call time (CR057 invariant 5); this
-- statement is what makes them right in the first place.
--
-- Name-guarded ⇒ idempotent. Mirrors sibling `Transfer - Bank` exactly.
--
-- The parent is resolved BY NAME, not by the literal 200. On dev and prod
-- "Transfers" happens to be id 200, but on a migrations-only database — which
-- is what CI builds (`.github/workflows/ci.yml`, "Apply migrations + CI seed")
-- — it is created by 022_quicken_import.sql with a serial id, so a hard-coded
-- 200 violates accounts_parent_id_fkey and aborts the whole chain before any
-- later migration runs. This is the pattern 022 itself uses eleven lines away.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    transfers_parent_id INTEGER;
    t BOOLEAN; s TEXT; p INTEGER;
BEGIN
    SELECT id INTO transfers_parent_id FROM accounts WHERE name = 'Transfers' LIMIT 1;
    IF transfers_parent_id IS NULL THEN
        RAISE EXCEPTION
          'Migration aborted: required "Transfers" parent account not found in COA';
    END IF;

    INSERT INTO accounts (name, parent_id, account_type, section, currency,
                          is_transfer, skip_transfer_analysis, is_active, display_order)
    SELECT 'Transfer - Distributions', transfers_parent_id, 'expense', 'profit_loss', 'USD',
           TRUE, FALSE, TRUE, 0
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'Transfer - Distributions');

    -- Fail loud rather than proceed with a mis-flagged category (e.g. a row someone
    -- had already hand-created through the generic path before this migration ran).
    SELECT is_transfer, section::text, parent_id INTO t, s, p
      FROM accounts WHERE name = 'Transfer - Distributions';
    IF t IS NOT TRUE OR s <> 'profit_loss' OR p <> transfers_parent_id THEN
        RAISE EXCEPTION
          'Transfer - Distributions has wrong flags (is_transfer=%, section=%, parent=%) — expected (t, profit_loss, %)',
          t, s, p, transfers_parent_id;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. income_restatements — the undo record.
--
-- A dedicated table rather than reusing transfer_match_groups, which was the
-- rev-1 design and is unsafe on three counts, all reproduced:
--   (a) DELETE /api/v2/transfer-match-groups/:id is wired to the user-facing
--       "Unlink" button on Transfer Analysis — unlinking would delete the only
--       record of the restatement, orphaning both created legs;
--   (b) transferMatchGroups.create() runs its own BEGIN/COMMIT and accepts no
--       client, so "all three writes in one transaction" is unachievable;
--   (c) group members are EXCLUDED from auto-matching, so the group would
--       PREVENT the very match it was meant to record (legs 2+3 auto-match on
--       their own: same category, exact opposite base_amount, same date).
--
-- source_transaction_id UNIQUE makes the "already booked" 409 structural rather
-- than a lookup that can be skipped.
--
-- leg_snapshot stores {account_id, transaction_date, amount, base_amount,
-- category_id} for BOTH created legs as written. Undo compares field-by-field and
-- REFUSES on divergence: deleting a leg someone has since edited would move the
-- holding's book value via the undo path, silently invalidating every subsequent
-- mark. Without the snapshot that guard has no mechanism.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS income_restatements (
  id                    SERIAL PRIMARY KEY,
  source_transaction_id BIGINT      NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  holding_account_id    INTEGER     NOT NULL REFERENCES accounts(id),
  original_category_id  INTEGER     NOT NULL REFERENCES accounts(id),
  income_leg_id         BIGINT      NOT NULL REFERENCES transactions(id),
  transfer_leg_id       BIGINT      NOT NULL REFERENCES transactions(id),
  leg_snapshot          JSONB       NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_income_restatements_holding
  ON income_restatements (holding_account_id);

COMMIT;
