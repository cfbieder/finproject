-- Migration 021: Collapse `categories` table into `accounts`
--
-- Eliminates the parallel categories table by repointing every FK that
-- referenced categories(id) to accounts(id), copying is_transfer and
-- ps_category_id forward, then dropping categories and category_source_mappings.
--
-- Resolution rule: categories.mapped_account_id when set, otherwise the
-- accounts row with a matching name in section='profit_loss'. Verified
-- pre-migration that every active category resolves under this rule.

BEGIN;

-- ============================================================================
-- 1. Extend accounts with the columns we are inheriting from categories
-- ============================================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_transfer BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ps_category_id BIGINT;

-- ============================================================================
-- 2. Build the cat_id -> account_id resolution map
-- ============================================================================

CREATE TEMP TABLE _cat_to_acct ON COMMIT DROP AS
SELECT
  c.id   AS cat_id,
  c.name AS cat_name,
  c.is_transfer,
  c.ps_category_id,
  COALESCE(
    c.mapped_account_id,
    (SELECT a.id FROM accounts a
      WHERE a.section = 'profit_loss'
        AND a.is_active
        AND LOWER(a.name) = LOWER(c.name)
      LIMIT 1)
  ) AS account_id
FROM categories c
WHERE c.is_active;

-- Sanity guard: every active category must resolve. Abort migration if not.
DO $$
DECLARE
  unresolved INTEGER;
BEGIN
  SELECT COUNT(*) INTO unresolved FROM _cat_to_acct WHERE account_id IS NULL;
  IF unresolved > 0 THEN
    RAISE EXCEPTION 'Migration aborted: % active categories cannot be mapped to an account', unresolved;
  END IF;
END $$;

-- ============================================================================
-- 3. Copy is_transfer and ps_category_id from categories into accounts
-- ============================================================================

UPDATE accounts a
SET is_transfer = m.is_transfer,
    ps_category_id = m.ps_category_id
FROM _cat_to_acct m
WHERE a.id = m.account_id;

-- Also flag descendants of any account named "Transfers" as is_transfer=TRUE.
-- This catches accounts added directly to the COA without a categories row
-- (e.g., "Transfer - Business" added via COA management without dual-write).
-- The "Transfers" parent group itself is excluded — only descendants are flagged.
WITH RECURSIVE transfer_subtree AS (
  SELECT id, 0 AS depth FROM accounts WHERE name = 'Transfers'
  UNION ALL
  SELECT c.id, t.depth + 1 FROM accounts c JOIN transfer_subtree t ON c.parent_id = t.id
)
UPDATE accounts a
SET is_transfer = TRUE
FROM transfer_subtree t
WHERE a.id = t.id AND t.depth > 0 AND a.is_transfer = FALSE;

-- ============================================================================
-- 4. Backfill account_source_mappings from category_source_mappings
--    (handles the FX -> Transfer - FX rename: csm has 'FX' but asm doesn't)
-- ============================================================================

INSERT INTO account_source_mappings (account_id, source, external_name)
SELECT m.account_id, csm.source, csm.external_name
FROM category_source_mappings csm
JOIN _cat_to_acct m ON m.cat_id = csm.category_id
ON CONFLICT (source, external_name) DO NOTHING;

-- ============================================================================
-- 5. Drop the views that JOIN categories — they will be recreated on accounts
-- ============================================================================

DROP VIEW IF EXISTS v_balance_sheet;
DROP VIEW IF EXISTS v_budget_vs_actual;

-- ============================================================================
-- 6. Repoint FK columns from categories.id to accounts.id
-- ============================================================================

-- transactions.category_id
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_category_id_fkey;
UPDATE transactions t
SET category_id = m.account_id
FROM _cat_to_acct m
WHERE t.category_id = m.cat_id;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES accounts(id);

-- budget_entries.category_id
ALTER TABLE budget_entries DROP CONSTRAINT IF EXISTS budget_entries_category_id_fkey;
UPDATE budget_entries b
SET category_id = m.account_id
FROM _cat_to_acct m
WHERE b.category_id = m.cat_id;
ALTER TABLE budget_entries
  ADD CONSTRAINT budget_entries_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES accounts(id);

-- pending_transactions.posted_category_id
ALTER TABLE pending_transactions DROP CONSTRAINT IF EXISTS pending_transactions_posted_category_id_fkey;
UPDATE pending_transactions p
SET posted_category_id = m.account_id
FROM _cat_to_acct m
WHERE p.posted_category_id = m.cat_id;
ALTER TABLE pending_transactions
  ADD CONSTRAINT pending_transactions_posted_category_id_fkey
  FOREIGN KEY (posted_category_id) REFERENCES accounts(id);

-- fc_line_categories.category_id
-- Note: UNIQUE constraint on category_id collides during in-place remap because
-- account IDs and category IDs share the integer space. Drop, update, recreate.
ALTER TABLE fc_line_categories DROP CONSTRAINT IF EXISTS fc_line_categories_category_id_fkey;
ALTER TABLE fc_line_categories DROP CONSTRAINT IF EXISTS fc_line_categories_category_id_key;
UPDATE fc_line_categories flc
SET category_id = m.account_id
FROM _cat_to_acct m
WHERE flc.category_id = m.cat_id;
ALTER TABLE fc_line_categories
  ADD CONSTRAINT fc_line_categories_category_id_key UNIQUE (category_id);
ALTER TABLE fc_line_categories
  ADD CONSTRAINT fc_line_categories_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES accounts(id) ON DELETE CASCADE;

-- ============================================================================
-- 7. Recreate the views directly against accounts
-- ============================================================================

CREATE VIEW v_balance_sheet AS
SELECT
    a.id AS account_id,
    a.name AS account_name,
    a.account_type,
    a.parent_id,
    pa.name AS parent_name,
    t.transaction_date,
    SUM(t.base_amount) AS balance
FROM accounts a
LEFT JOIN accounts pa ON a.parent_id = pa.id
LEFT JOIN transactions t ON t.account_id = a.id
WHERE a.section = 'balance_sheet'
GROUP BY a.id, a.name, a.account_type, a.parent_id, pa.name, t.transaction_date;

CREATE VIEW v_budget_vs_actual AS
SELECT
    DATE_TRUNC('month', t.transaction_date) AS month,
    c.name AS category,
    a.name AS account,
    SUM(t.base_amount) AS actual_amount,
    COALESCE(b.budget_amount, 0) AS budget_amount,
    SUM(t.base_amount) - COALESCE(b.budget_amount, 0) AS variance
FROM transactions t
JOIN accounts c ON t.category_id = c.id
LEFT JOIN accounts a ON t.account_id = a.id
LEFT JOIN (
    SELECT
        DATE_TRUNC('month', entry_date) AS month,
        category_id,
        SUM(base_amount) AS budget_amount
    FROM budget_entries
    GROUP BY DATE_TRUNC('month', entry_date), category_id
) b ON DATE_TRUNC('month', t.transaction_date) = b.month
   AND t.category_id = b.category_id
GROUP BY DATE_TRUNC('month', t.transaction_date), c.name, a.name, b.budget_amount;

-- ============================================================================
-- 8. Drop category_source_mappings and categories
-- ============================================================================

DROP TABLE IF EXISTS category_source_mappings;
DROP TABLE IF EXISTS categories;

-- ============================================================================
-- 9. Final verification
-- ============================================================================

DO $$
DECLARE
  orphan_txn INTEGER;
  orphan_budg INTEGER;
  orphan_flc INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_txn FROM transactions t
   WHERE t.category_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = t.category_id);
  SELECT COUNT(*) INTO orphan_budg FROM budget_entries b
   WHERE b.category_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = b.category_id);
  SELECT COUNT(*) INTO orphan_flc FROM fc_line_categories flc
   WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = flc.category_id);
  IF orphan_txn + orphan_budg + orphan_flc > 0 THEN
    RAISE EXCEPTION 'Post-migration orphans found: txn=%, budget=%, fc_line=%',
      orphan_txn, orphan_budg, orphan_flc;
  END IF;
END $$;

-- Index is_transfer for the transfer-analysis hot path
CREATE INDEX IF NOT EXISTS idx_accounts_is_transfer ON accounts(is_transfer) WHERE is_transfer = TRUE;

COMMIT;
