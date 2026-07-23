-- 040 — Data fix: correct five accounts whose account_type sits on the wrong side.
--
-- The Chart-of-Accounts Type filter (COAManagement) surfaced long-standing bad data:
-- three balance-sheet containers and two leaves are typed on the wrong side of their
-- (correct) `section`, and the top-level Income container is typed `expense`. The
-- current seed (server/src/scripts/seedAccounts.js — Liabilities→liability,
-- Income→income, children inherit) does NOT produce this; the rows predate it (the
-- original PocketSmith import / an older seed), so this is a one-time data correction,
-- not a seed bug.
--
--   Income            expense   → income      (top-level P&L container)
--   Liabilities       asset     → liability   (top-level balance-sheet container)
--   Tax Liabilities   asset     → liability   (container; also backs a forecast module)
--   Tax Reserve - PL  asset     → liability   (leaf under Tax Liabilities)
--   Tax Reserve - US  asset     → liability   (leaf under Tax Liabilities)
--
-- Blast radius (verified before writing): NONE on any report number.
--   • Balance Sheet is built from getNestedTree({section}) — asset/liability sides come
--     from the tree/section, not account_type — so nothing moves sides.
--   • Forecast: only "Tax Liabilities" backs a module. The engine's sole account_type
--     branch is `isLiability` (fcbuilder-module.js), which flips the sign of ExpensePct
--     — but index.js hardcodes mod.ExpensePct = 0 (legacy field), so the branch operates
--     on zero and the output is byte-identical.
--   • Budget/Transaction reports use account_type only in GROUP BY / ORDER BY — the two
--     Tax Reserve rows re-sort into the liability group (more correct), no value change.
--
-- Guarded by name + current (wrong) type + section, so it is idempotent and cannot
-- touch a correctly-typed row.

BEGIN;

UPDATE accounts SET account_type = 'income'
 WHERE name = 'Income' AND account_type = 'expense' AND section = 'profit_loss';

UPDATE accounts SET account_type = 'liability'
 WHERE name IN ('Liabilities', 'Tax Liabilities', 'Tax Reserve - PL', 'Tax Reserve - US')
   AND account_type = 'asset' AND section = 'balance_sheet';

COMMIT;
