-- 064 — parent rollup accounts labelled USD over non-USD children (roadmap Known Issue #19).
--
-- WHAT WAS MEASURED (2026-08-10, prod and dev). Nine parent accounts carry
-- `currency = 'USD'` while every non-USD child hangs beneath them:
--
--     id   name                  children  child ccy   fc modules
--     11   EUR Bank Accounts        5       EUR            0
--     17   PLN Bank Accounts        7       PLN            0
--     23   Other Bank Accounts      1       GBP            0
--     32   CVC Investments          2       EUR            0
--     38   SP - Properties          3       EUR            0
--     42   PL Investments           4       PLN            0
--     46   PL - Properties          2       PLN            0
--     65   PLN Credit Cards         4       PLN            5   (fixed by 056)
--    215   Tax Liabilities          2       PLN,USD        5   (correctly USD)
--
-- Every one holds ZERO transactions of its own — they are pure aggregation nodes — so no
-- balance moves here. The balance sheet converts each account by its own currency
-- (`reports.js`), and converting a zero balance at any rate is still zero.
--
-- WHY IT IS WORTH A MIGRATION. `forecast_modules.currency` is seeded from the LINKED
-- ACCOUNT, and `fcbuilder-module.js` consults the FX assumptions only when
-- `Currency !== 'USD'`. A module that inherits a wrong USD label keeps `fxrates`'
-- `fill(1)` and posts its LOCAL amount onto a USD balance sheet for every year of the
-- horizon. That is not hypothetical — it is exactly what account 65 produced: 18,250 USD
-- of liability that did not exist in `2026 Base` and `2026 Downside` until migration 056.
--
-- EIGHT rows are relabelled, not seven. 056 fixed the five MODULES on account 65 and left
-- the ACCOUNT itself saying USD — so the source of that defect was still in place, and the
-- next module linked to it would have inherited the same label again. Measured on dev:
-- `UPDATE 8`. The other seven carry no modules today, so for them this closes the path
-- before it is taken rather than after.
--
-- THE RULE, and why it is DERIVED here when 056 named its rows explicitly. 056 could not
-- derive anything: it had two numeric columns whose ratio merely LOOKED like a PLN rate,
-- and inferring a currency from that would have invented one the next time two columns
-- disagreed. Here the children's currency is a stored fact, not an inference — so the
-- predicate is safe to state generally:
--
--     relabel a parent whose children are UNANIMOUS and non-USD, to that currency.
--
-- A MIXED parent is deliberately left alone. `Tax Liabilities` (215) aggregates a USD and
-- a PLN reserve and has no single correct currency; its module is correctly `USD` and its
-- PLN child stands at 0. Picking either currency for it would be a guess, and the whole
-- point of #19 is that a guessed currency is invisible once stored.
--
-- WHAT WAS AUDITED BEFORE RUNNING (every reader of `accounts.currency`):
--   reports.js:113/174     converts each account's OWN balance — 0 on a rollup, so 0 either way.
--   crud.js getOpeningBankCash  recursive over Bank Accounts, converts per node — same, 0.
--   crud.js refreshModulesFromActuals  keys on `t.account_id`; a rollup produces no row,
--                          so the UPDATE never matches it.
--   manualReconciliation.js  EXCLUDES any account with children ("an aggregation node, not
--                          something you calibrate directly") — all nine have children.
--   reconcileManual / reconcileToFeed  operate on the reconcile set above.
--   restate-mtm.js:122     refuses non-USD, but is invoked deliberately per account and
--                          never on a parent.
-- The nine `account_source_mappings` rows on these accounts are all `source='pocketsmith'`
-- — a retired source, name-keyed, and they do not read currency. No `bank-feed` mapping,
-- no budget entry, no manual balance, `opening_balance = 0` on all seven.
--
-- Idempotent: the predicate stops matching once the parent already holds its children's
-- currency.

BEGIN;

UPDATE accounts p
   SET currency = child.ccy
  FROM (
    SELECT c.parent_id,
           MIN(c.currency) AS ccy,
           COUNT(DISTINCT c.currency) AS distinct_ccy
      FROM accounts c
     WHERE c.parent_id IS NOT NULL
     GROUP BY c.parent_id
  ) child
 WHERE p.id = child.parent_id
   AND child.distinct_ccy = 1          -- unanimous children only; a mixed parent is left alone
   AND child.ccy <> 'USD'              -- nothing to fix when the children ARE dollars
   AND p.currency = 'USD'
   AND NOT EXISTS (                    -- a parent that holds its own transactions is not a
     SELECT 1 FROM transactions t WHERE t.account_id = p.id   -- pure rollup; do not touch it
   );

-- Guard. Asserts the INVARIANT, not a count of rows changed — a count-based check aborts
-- the chain on a data-free database, the defect shipped in 046, 050 and 052. An empty
-- `accounts` satisfies this trivially and passes, which is correct: there is nothing to
-- repair.
--
-- Stated positively: no transaction-free parent may claim USD while its children unanimously
-- say otherwise.
DO $$
DECLARE still_wrong INT; relabelled INT; mixed INT;
BEGIN
  SELECT COUNT(*) INTO still_wrong
    FROM accounts p
    JOIN (
      SELECT c.parent_id, MIN(c.currency) AS ccy, COUNT(DISTINCT c.currency) AS n
        FROM accounts c WHERE c.parent_id IS NOT NULL GROUP BY c.parent_id
    ) ch ON ch.parent_id = p.id
   WHERE ch.n = 1 AND ch.ccy <> 'USD' AND p.currency = 'USD'
     AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = p.id);

  IF still_wrong > 0 THEN
    RAISE EXCEPTION
      'migration 064: % transaction-free parent account(s) still claim USD over unanimous '
      'non-USD children — a forecast module linked to one inherits the wrong currency and '
      'posts its local amount onto a USD balance sheet.', still_wrong;
  END IF;

  SELECT COUNT(*) INTO relabelled FROM accounts WHERE id IN (11,17,23,32,38,42,46,65) AND currency <> 'USD';
  SELECT COUNT(*) INTO mixed
    FROM accounts p
    JOIN (SELECT parent_id, COUNT(DISTINCT currency) n FROM accounts
           WHERE parent_id IS NOT NULL GROUP BY parent_id) ch ON ch.parent_id = p.id
   WHERE ch.n > 1;
  RAISE NOTICE '064: % of the 8 known rollups now non-USD; % mixed-currency parent(s) left alone by design', relabelled, mixed;
END $$;

COMMIT;
