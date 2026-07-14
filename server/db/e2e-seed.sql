-- e2e-seed.sql — a small, DETERMINISTIC world for the Playwright money-path smoke tests.
--
-- NOT a migration. Never auto-applied to dev/prod. Applied after 001..N + ci-seed.sql.
--
-- Why it exists: after migrations + ci-seed, the database has 9 accounts, no COA tree, and
-- zero transactions/budget/forecast data. Every money-path page renders EMPTY — which is
-- indistinguishable from the bug class these tests exist to catch. An e2e suite whose pages
-- are legitimately blank can never detect a page that is WRONGLY blank.
--
-- So this builds the smallest world in which every money path produces a NUMBER we can
-- assert on. The numbers are chosen to be exact and hand-checkable:
--
--   Checking    10,000.00 USD   (2 transactions: +12,000 salary, −2,000 rent)
--   Brokerage  100,000.00 USD   (1 transaction)
--   Credit Card −1,500.00 USD   (1 transaction)
--   ------------------------------------------------------------------
--   NET WORTH  108,500.00 USD   ← asserted by the balance-sheet smoke test
--
-- The forecast scenario deliberately reproduces the shape of the bug that survived two
-- years undetected (v3.0.98): a module with a **Periodic** invest transfer spanning
-- 2026→2030. Modify Transfer showed "no transfers for this year" for every year but the
-- first, while the Review behind it rendered the transfer. A test that only ever seeds
-- OneTime transfers would never have caught it.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Chart of Accounts — the tree the reports and the engine walk.
--    The engine looks up several of these BY NAME (services/forecast/constants.js:
--    'Bank Accounts', 'Transfer - Bank', 'Taxes', 'Inflation', 'FX - PLN'), so the names
--    here are load-bearing, not decorative (CR043 N9).
-- ---------------------------------------------------------------------------

INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
SELECT v.name, NULL, v.atype::account_type, v.sec::account_section, FALSE, 'USD', TRUE
FROM (VALUES
  ('Balance Sheet Accounts', 'asset',   'balance_sheet'),
  ('Profit & Loss Accounts', 'expense', 'profit_loss')
) AS v(name, atype, sec)
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.name = v.name);

-- Balance-sheet branches
INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
SELECT v.name, (SELECT id FROM accounts WHERE name = 'Balance Sheet Accounts'),
       v.atype::account_type, 'balance_sheet'::account_section, FALSE, 'USD', TRUE
FROM (VALUES
  ('Assets',      'asset'),
  ('Liabilities', 'liability')
) AS v(name, atype)
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.name = v.name);

INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
SELECT 'Bank Accounts', (SELECT id FROM accounts WHERE name = 'Assets'),
       'asset', 'balance_sheet', FALSE, 'USD', TRUE
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'Bank Accounts');

INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
SELECT 'Investments', (SELECT id FROM accounts WHERE name = 'Assets'),
       'asset', 'balance_sheet', FALSE, 'USD', TRUE
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'Investments');

-- The three leaf accounts that carry the money.
INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
SELECT v.name, (SELECT id FROM accounts WHERE name = v.parent),
       v.atype::account_type, 'balance_sheet'::account_section, FALSE, 'USD', TRUE
FROM (VALUES
  ('Checking',    'Bank Accounts', 'asset'),
  ('Brokerage',   'Investments',   'asset'),
  ('Credit Card', 'Liabilities',   'liability')
) AS v(name, parent, atype)
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.name = v.name);

-- P&L branches + the engine's magic accounts.
INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
SELECT v.name, (SELECT id FROM accounts WHERE name = 'Profit & Loss Accounts'),
       v.atype::account_type, 'profit_loss'::account_section, v.xfer, 'USD', TRUE
FROM (VALUES
  ('Income',          'income',  FALSE),
  ('Living Expenses', 'expense', FALSE),
  ('Taxes',           'expense', FALSE),
  ('Inflation',       'expense', FALSE),
  ('FX - PLN',        'expense', FALSE),
  ('FX - EUR',        'expense', FALSE)
) AS v(name, atype, xfer)
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.name = v.name);

INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
SELECT v.name, (SELECT id FROM accounts WHERE name = v.parent),
       v.atype::account_type, 'profit_loss'::account_section, FALSE, 'USD', TRUE
FROM (VALUES
  ('Salary', 'Income',          'income'),
  ('Rent',   'Living Expenses', 'expense')
) AS v(name, parent, atype)
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.name = v.name);

-- A throwaway account that ONLY the account-type write spec touches. The type test must not
-- use Checking or Brokerage: changing their type moves them between the balance sheet and the
-- P&L, which would silently break the net-worth assertion in the read specs. A test that
-- corrupts another test's fixture is worse than no test.
INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
SELECT 'E2E Type Probe', (SELECT id FROM accounts WHERE name = 'Living Expenses'),
       'expense', 'profit_loss', FALSE, 'USD', TRUE
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'E2E Type Probe');

-- 'Transfer - Bank' is what the engine books swept cash against.
INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
SELECT 'Transfer - Bank', (SELECT id FROM accounts WHERE name = 'Transfers'),
       'expense', 'profit_loss', TRUE, 'USD', TRUE
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'Transfer - Bank');

-- ---------------------------------------------------------------------------
-- 2. Transactions — the balance sheet must produce a NUMBER, not an empty tree.
--    Net worth = 10,000 + 100,000 − 1,500 = 108,500.00
-- ---------------------------------------------------------------------------

-- base_amount is the USD-normalized column the reports actually SUM (the budget/actual
-- queries sum base_amount, not amount). Seeding only `amount` left every report at zero —
-- and a seed that produces zeros makes every assertion vacuous, which is the one thing an
-- e2e suite must never do. USD world ⇒ base_amount = amount.
INSERT INTO transactions (transaction_date, amount, base_amount, currency, account_id, category_id, description1)
SELECT v.d::date, v.amt::numeric, v.amt::numeric, 'USD',
       (SELECT id FROM accounts WHERE name = v.acct),
       (SELECT id FROM accounts WHERE name = v.cat),
       v.descr
FROM (VALUES
  ('2026-01-15',  12000.00, 'Checking',    'Salary', 'E2E salary'),
  ('2026-02-15',  -2000.00, 'Checking',    'Rent',   'E2E rent'),
  ('2026-01-20', 100000.00, 'Brokerage',   'Salary', 'E2E brokerage funding'),
  ('2026-02-01',  -1500.00, 'Credit Card', 'Rent',   'E2E card spend')
) AS v(d, amt, acct, cat, descr)
WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.description1 = v.descr);

-- ---------------------------------------------------------------------------
-- 3. Budget — one year, so Budget vs Actual has something to compare.
-- ---------------------------------------------------------------------------

-- category_id is what the budget report groups by (LEFT JOIN accounts c ON e.category_id),
-- and base_amount is what it sums. Both are required, or the page renders zeros.
INSERT INTO budget_entries (entry_date, amount, base_amount, currency, budget_year, account_id, category_id)
SELECT v.d::date, v.amt::numeric, v.amt::numeric, 'USD', 2026,
       (SELECT id FROM accounts WHERE name = 'Checking'),
       (SELECT id FROM accounts WHERE name = v.cat)
FROM (VALUES
  ('2026-01-01', 12000.00, 'Salary'),
  ('2026-01-01', -2500.00, 'Rent')
) AS v(d, amt, cat)
WHERE NOT EXISTS (
  SELECT 1 FROM budget_entries b
  WHERE b.budget_year = 2026 AND b.category_id = (SELECT id FROM accounts WHERE name = v.cat)
);

-- ---------------------------------------------------------------------------
-- 4. FX — the engine reads rates by name; USD-only world still needs the rows.
-- ---------------------------------------------------------------------------

INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_date)
SELECT v.f, v.t, v.r::numeric, '2026-01-01'::date
FROM (VALUES ('PLN','USD',0.25), ('EUR','USD',1.10)) AS v(f,t,r)
WHERE NOT EXISTS (
  SELECT 1 FROM exchange_rates e
  WHERE e.from_currency = v.f AND e.to_currency = v.t AND e.rate_date = '2026-01-01'
);

-- ---------------------------------------------------------------------------
-- 5. Forecast — a scenario the engine can actually build, containing the bug shape.
-- ---------------------------------------------------------------------------

INSERT INTO forecast_scenarios (name, description, is_active, cash_sweep_low, cash_sweep_high)
SELECT 'E2E Scenario', 'Deterministic world for the Playwright smoke tests', TRUE, 5000, 20000
WHERE NOT EXISTS (SELECT 1 FROM forecast_scenarios WHERE name = 'E2E Scenario');

-- Assumptions are a key/value DOCUMENT, and the engine's loader is strict about its shape:
-- it needs a `scenarios` ARRAY carrying PeriodStart/PeriodEnd (it fails loud with
-- "FCAssump.scenarios must be a non-empty array" otherwise), plus per-scenario inflation,
-- FX and tax-rate rows keyed BY SCENARIO NAME. Flat keys are not enough — this shape is
-- copied from the live document, not invented.
INSERT INTO forecast_assumptions (key, value, ord)
SELECT v.k, v.val::jsonb, v.o
FROM (VALUES
  ('scenarios', '[{"Name":"E2E Scenario","Description":"e2e","IsActive":true,"PeriodStart":2026,"PeriodEnd":2030}]', 1),
  ('category',  '["Year","Inflation","PLN","EUR","Bank Accounts"]', 2),
  ('inflation', '[{"Scenario":"E2E Scenario","Year":2026,"Rate":2}]', 3),
  ('FX',        '[{"Scenario":"E2E Scenario","Year":2026,"Rates":{"EUR":0.9,"PLN":4}}]', 4),
  ('Tax Rate',  '[{"Scenario":"E2E Scenario","Rate":20}]', 5),
  ('data',      '{}', 6)
) AS v(k, val, o)
WHERE NOT EXISTS (SELECT 1 FROM forecast_assumptions f WHERE f.key = v.k);

-- The sweep primary (priority 1) — without one the engine runs in degraded mode (CR045 §1).
-- setup_status MUST be 'complete': the engine loads modules
--   WHERE COALESCE(setup_status,'new') NOT IN ('new','exclude')
-- and the column DEFAULTS to 'new' — so a seeded module without it is silently skipped
-- (modulesProcessed: 0, forecast builds "successfully" with nothing in it). Caught only
-- because the seed asserts on numbers rather than on a 200.
INSERT INTO forecast_modules
  (scenario_id, account_id, name, module_type, currency, base_date, base_value, base_value_usd,
   market_value, market_value_usd, growth_rate, is_matched, setup_status,
   cash_sweep_target, cash_sweep_priority)
SELECT (SELECT id FROM forecast_scenarios WHERE name = 'E2E Scenario'),
       (SELECT id FROM accounts WHERE name = 'Brokerage'),
       'E2E Brokerage', 'Equity', 'USD', '2025-12-31', 100000, 100000, 100000, 100000, 5,
       TRUE, 'complete', TRUE, 1
WHERE NOT EXISTS (SELECT 1 FROM forecast_modules WHERE name = 'E2E Brokerage');

-- THE BUG SHAPE (v3.0.98). A module carrying a **Periodic** invest transfer that spans
-- 2026→2030. Modify Transfer matched only the year STORED on the row, so this transfer was
-- invisible in 2027, 2028, 2029 and 2030 — while the Review rendered it. Any e2e test that
-- clicks a MIDDLE year of this range fails on the pre-fix code.
INSERT INTO forecast_modules
  (scenario_id, account_id, name, module_type, currency, base_date, base_value, base_value_usd,
   market_value, market_value_usd, growth_rate, is_matched, setup_status)
SELECT (SELECT id FROM forecast_scenarios WHERE name = 'E2E Scenario'),
       (SELECT id FROM accounts WHERE name = 'Checking'),
       'E2E Periodic', 'Equity', 'USD', '2025-12-31', 10000, 10000, 10000, 10000, 0, TRUE,
       'complete'
WHERE NOT EXISTS (SELECT 1 FROM forecast_modules WHERE name = 'E2E Periodic');

INSERT INTO forecast_module_investments (module_id, investment_date, amount, flag, date_end)
SELECT (SELECT id FROM forecast_modules WHERE name = 'E2E Periodic'),
       '2026-07-01', 1000, 'Periodic', '2030-07-01'
WHERE NOT EXISTS (
  SELECT 1 FROM forecast_module_investments
  WHERE module_id = (SELECT id FROM forecast_modules WHERE name = 'E2E Periodic')
);

-- A OneTime transfer to EDIT. The write specs need one: Modify Transfer only renders an
-- editable input for OneTime rows (a Periodic row drives many years from one row, so it is
-- deliberately read-only there). This path had never once run in production before v3.0.98 —
-- the modal fetched an endpoint that carries no transfers, so it had never displayed one.
INSERT INTO forecast_module_disposals (module_id, disposal_date, amount, flag)
SELECT (SELECT id FROM forecast_modules WHERE name = 'E2E Brokerage'),
       '2028-12-31', 5000, 'OneTime'
WHERE NOT EXISTS (
  SELECT 1 FROM forecast_module_disposals
  WHERE module_id = (SELECT id FROM forecast_modules WHERE name = 'E2E Brokerage')
);

SELECT setval(pg_get_serial_sequence('accounts', 'id'), (SELECT MAX(id) FROM accounts));
