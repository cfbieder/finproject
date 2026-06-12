-- CI / fresh-install baseline seed (NOT a migration — never auto-applied to
-- prod/dev). Applied by CI after the 001..N migration chain to satisfy the
-- handful of COA rows the engines reference by hardcoded id/name:
--
--   * accounts.id = 88 "Unrealized G/L"  — reconcileToFeed.js /
--     reconcileManual.js post month-end MTM entries against this id
--     (UNREALIZED_GL_CATEGORY_ID).
--   * accounts.name = 'Transfer - Securities Trades' — neutralize /
--     CR032 core-sweep mirroring categorize against this name.
--
-- Idempotent: safe to re-run.

INSERT INTO accounts (id, name, account_type, section, is_transfer, currency, is_active)
VALUES (88, 'Unrealized G/L', 'expense', 'profit_loss', FALSE, 'USD', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
SELECT 'Transfer - Securities Trades',
       (SELECT id FROM accounts WHERE name = 'Transfers' LIMIT 1),
       'expense', 'profit_loss', TRUE, 'USD', TRUE
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'Transfer - Securities Trades');

-- Income leaves the quicken investment promote (resolveIncomeLeaf) and the
-- CR032 neutralize guard look up by name.
INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
SELECT v.name, 'income', 'profit_loss', FALSE, 'USD', TRUE
FROM (VALUES ('Financial Income - Dividend'), ('Option Trade')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.name = v.name);

-- Keep the id sequence ahead of any explicit-id inserts above.
SELECT setval(pg_get_serial_sequence('accounts', 'id'),
              (SELECT MAX(id) FROM accounts));
