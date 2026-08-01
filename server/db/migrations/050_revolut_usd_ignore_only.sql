-- 050 — stop promoting from fintable's legacy Revolut wallet (CR059 P4 prerequisite).
--
-- WHAT WAS MEASURED (2026-08-01, against the CR059 shadow store on :55432).
-- fintable's API serves four Revolut EUR transactions TWICE:
--
--   current EUR wallet  acc_01KYS5BECVFH89QPSRQSFN4M99   4 rows, all EUR, bal  98.13 EUR
--   legacy wallet       4044604745776048193              4 rows, all EUR, bal   1.46 USD
--
-- Same dates, same amounts, same descriptions — but DIFFERENT transaction ids
-- (tx_01KYS5PV… vs tx_01KYFYT7…), so these are two genuine upstream records, not
-- our converter mis-filing one row. The legacy wallet is the pre-rebuild EUR
-- wallet, which fintable labels "(USD)"; its transaction currency is EUR on
-- every row it has ever carried, while its balance is 1.46 USD.
--
-- WHY THIS IS NOT ALREADY A PROBLEM. On the Sheet path it was: fintable labelled
-- those rows with the USD wallet's display name and the name join believed the
-- label, so fin promoted two of them onto Revolut-USD as duplicates of
-- Revolut-EUR. bank-feed commit 6d108ec fixed that converter to read GoCardless's
-- ext_nordigen_acc_id, and the live store now carries 0 transactions on that
-- wallet. fin is clean today — all three Revolut accounts tie exactly:
-- Revolut-EUR 98.13, Revolut-PLN 72.14, Revolut-USD 1.46.
--
-- WHY IT BECOMES A PROBLEM AT CUTOVER. The API converter joins on the account id
-- fintable gives it, which for the duplicate copies IS the legacy wallet. The
-- cutover date floor (FINTABLE_API_MIN_DATE) keeps all four known duplicates out
-- of staging because they are dated <= 2026-07-26. What it does NOT cover is a
-- NEW row fintable files onto that wallet after cutover: mapping 531 is live with
-- promote_from_date 2026-07-26, so such a row would promote onto Revolut-USD —
-- a EUR amount booked into a USD account, with no balance check able to see it
-- (the same invisibility that made the Black Card incident survive review).
--
-- THE CHANGE. Mapping 531 becomes ignore-only: account_id NULL, ignored true,
-- and promote_from_date NULL to match the convention 043 established (a cutoff on
-- a row that promotes nothing only goes stale; setBankFeedMapping re-pins it if
-- the row is ever mapped again).
--
-- WHAT THIS COSTS: nothing real. Revolut-USD (account 9) holds 1.46 USD across 4
-- transactions, the most recent dated 2025-01-19. It keeps its balance and its
-- history; it simply stops receiving feed rows from a wallet whose only feed rows
-- have ever been mis-attributed EUR. OWNER DECISION 2026-08-01, chosen over
-- leaving it mapped behind the date floor (accepts the forward risk) and over
-- adding a currency guard to the promote path (closes the class generally, but is
-- new code plus tests and would delay cutover).
--
-- NOT CLAIMED: this does not stop fintable double-serving, and it does not close
-- the currency-mismatch class in general. It removes the one live promote path by
-- which today's known duplication could reach the ledger. The general guard stays
-- a roadmap item.
--
-- Idempotent: the WHERE clause only matches while the row is still mapped.

-- ORDER-INDEPENDENT vs MIGRATION 044, deliberately. 044 (CR059 P3a) rewrites this
-- mapping's external_name from the Sheet UUID to the API id. Keyed on the UUID
-- alone, this migration would match NOTHING if 044 ran first — and its guard would
-- still pass, because zero rows match a name that no longer exists. The mapping
-- would quietly stay live, which is the entire thing being prevented here. So both
-- ids are named, and the guard below checks both. (Applied to dev before 044
-- existed; prod may take them in either order.)

BEGIN;

UPDATE account_source_mappings
   SET account_id         = NULL,
       ignored            = TRUE,
       promote_from_date  = NULL
 WHERE source = 'bank-feed'
   AND external_name IN ('4de06156-3a5c-4a12-8701-e28a5ff18d2f',  -- Sheet UUID (pre-044)
                         '4044604745776048193')                    -- fintable API id (post-044)
   AND account_id IS NOT NULL;

-- Guard. Two things must hold afterwards, and neither is re-derived arithmetic:
--   1. the legacy wallet's mapping exists and promotes nothing;
--   2. no OTHER bank-feed mapping was touched — 043's invariant (every mapped
--      bank-feed row carries a cutoff) must still hold, so a mistake here fails
--      the migration rather than silently re-opening a back-fill window.
DO $$
DECLARE still_mapped INT; found INT; uncut INT;
BEGIN
  -- "Nothing matched" is not success. If neither id is present the mapping has
  -- been renamed by something this migration does not know about, and staying
  -- silent would be indistinguishable from having done the job.
  SELECT COUNT(*) INTO found
    FROM account_source_mappings
   WHERE source = 'bank-feed'
     AND external_name IN ('4de06156-3a5c-4a12-8701-e28a5ff18d2f', '4044604745776048193');
  IF found <> 1 THEN
    RAISE EXCEPTION 'migration 050: expected exactly 1 legacy Revolut wallet mapping, found %', found;
  END IF;

  SELECT COUNT(*) INTO still_mapped
    FROM account_source_mappings
   WHERE source = 'bank-feed'
     AND external_name IN ('4de06156-3a5c-4a12-8701-e28a5ff18d2f', '4044604745776048193')
     AND (account_id IS NOT NULL OR ignored IS NOT TRUE);
  IF still_mapped > 0 THEN
    RAISE EXCEPTION 'migration 050: the legacy Revolut wallet mapping is still live';
  END IF;

  SELECT COUNT(*) INTO uncut
    FROM account_source_mappings
   WHERE source = 'bank-feed' AND account_id IS NOT NULL AND promote_from_date IS NULL;
  IF uncut > 0 THEN
    RAISE EXCEPTION 'migration 050: % mapped bank-feed row(s) lost their cutoff', uncut;
  END IF;
END $$;

COMMIT;
