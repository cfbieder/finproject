-- 056 — a forecast module labelled USD whose values are PLN (CR064 P13).
--
-- WHAT WAS MEASURED (2026-08-03, prod and dev). Five `PLN Credit Cards` modules —
-- one per scenario, the same row copied by CR050's variant materialization — carry:
--
--   currency          'USD'
--   market_value      -24542.66      base_value      -24542.66
--   market_value_usd   -6832.01      base_value_usd   -6832.01
--   implied rate       3.5923
--
-- The local column is PLN. Proof, not inference: account 65's own ledger
-- (opening_balance + SUM(amount) over its four PKO children, all currency PLN) stood
-- at -24,129.55 PLN on 2025-12-31, the modules' base_date — within 413 PLN of the
-- stored figure, where the USD reading would be off by 3.6x. The label came from
-- account 65 itself, a PARENT ROLLUP holding no transactions of its own and
-- mislabelled 'USD' in the accounts table; the module inherited it.
--
-- WHY IT WAS INVISIBLE. `fcbuilder-module.js` consults the FX assumptions only when
-- `Currency !== 'USD'`. With the wrong label the branch never ran, `fxrates` kept its
-- `fill(1)`, and `marketValues[i] / 1` posted the PLN amount straight onto a USD
-- balance sheet. The `MarketValueUSD` override repairs index 0 only — the base_date
-- year, 2025, which is not even an output column when PeriodStart is 2027 — so the
-- one correct year was never displayed and all the wrong ones were.
--
-- WHAT IT COST. `2026 Base` and `2026 Downside` (the two scenarios where the module
-- is setup_status='complete') posted -24,542.66 USD in every forecast year against a
-- correct -6,293 at the scenario's PLN 3.9. Verified in forecast_entries before this
-- ran: 2026..2030 all -24542.66. That is 18,250 USD of liability that does not exist,
-- carried in Net Assets, in the Compare deltas, and in the cash sweep's view of the
-- balance sheet.
--
-- THE CHANGE. Relabel those rows PLN. The VALUES are correct and are not touched:
-- market_value stays the PLN figure, market_value_usd stays the USD one, and the
-- engine now divides the first by the FX series as it does for every other PLN
-- module. Nothing is recomputed here, so nothing can be recomputed wrongly.
--
-- WHY THE ROWS ARE NAMED RATHER THAN DERIVED. The implied rate 3.5923 is a plausible
-- PLN rate, so a generic "infer the currency from market_value/market_value_usd"
-- would work on these five and silently invent a currency the next time two columns
-- disagree for some other reason. The companion engine guard THROWS on that state
-- rather than healing it, for the same reason. This migration repairs the one case
-- that was actually diagnosed.
--
-- ORDERING. The engine guard shipping alongside this refuses to compute a module in
-- the state above, so this migration must be applied BEFORE the code that contains
-- it — which is the order `deploy-to-production.sh` already uses (migrations at step
-- 2b, code after). Applied to dev first.
--
-- Idempotent: the WHERE clause stops matching once the rows are PLN.

BEGIN;

UPDATE forecast_modules
   SET currency = 'PLN'
 WHERE name = 'PLN Credit Cards'
   AND currency = 'USD'
   AND (ABS(COALESCE(market_value, 0) - COALESCE(market_value_usd, 0)) > 0.01
     OR ABS(COALESCE(base_value, 0)   - COALESCE(base_value_usd, 0))   > 0.01);

-- Guard. The post-condition is the INVARIANT the engine now enforces, not a count of
-- rows changed — deliberately, because a count-based check aborts the chain on a
-- data-free database (CI applies every migration to an empty Postgres and seeds
-- afterwards) and nothing later in the chain can repair an aborted migration. That
-- defect has now been shipped three times: migrations 046, 050 and 052. An empty
-- forecast_modules satisfies the invariant trivially and passes, which is correct —
-- there is no contradiction to repair.
--
-- Stated positively: after this migration NO module may claim USD while its local and
-- USD columns disagree. If one does, the engine would throw on the next generate, so
-- failing here — where the transaction still rolls back — is strictly better.
DO $$
DECLARE contradictory INT; relabelled INT;
BEGIN
  SELECT COUNT(*) INTO contradictory
    FROM forecast_modules
   WHERE COALESCE(currency, 'USD') = 'USD'
     AND (ABS(COALESCE(market_value, 0) - COALESCE(market_value_usd, 0)) > 0.01
       OR ABS(COALESCE(base_value, 0)   - COALESCE(base_value_usd, 0))   > 0.01);

  IF contradictory > 0 THEN
    RAISE EXCEPTION
      'migration 056: % module(s) still claim USD while their local and USD values disagree — '
      'the engine guard will refuse to generate. Inspect: SELECT id, name, currency, '
      'market_value, market_value_usd FROM forecast_modules WHERE currency = ''USD'' '
      'AND market_value <> market_value_usd;', contradictory;
  END IF;

  SELECT COUNT(*) INTO relabelled
    FROM forecast_modules WHERE name = 'PLN Credit Cards' AND currency = 'PLN';
  RAISE NOTICE '056: % PLN Credit Cards module(s) now labelled PLN; 0 contradictory modules remain', relabelled;
END $$;

COMMIT;
