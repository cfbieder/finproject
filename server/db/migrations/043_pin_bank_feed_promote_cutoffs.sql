-- 043 — pin the two live bank-feed mappings that still have no promote cutoff.
--
-- A NULL promote_from_date means "promote every staged row, whatever its date".
-- That is the mechanism behind the 2026-07-14 Black Card incident: mapping an
-- account back-filled its whole staged history on top of a period a manual
-- statement upload already covered — 31 duplicate transactions, $8.4K gross but
-- net only +$267, so no balance check could see it.
--
-- Five bank-feed mappings still carry NULL. Three (366, 369, 440) are ignore-only
-- rows with account_id IS NULL: a cutoff on them is meaningless because nothing
-- promotes, and setting one now would bake in a stale date for whenever they do
-- get mapped. They stay NULL deliberately.
--
-- The two that matter are mapped and live. Each is pinned to the earliest row we
-- have already staged for it, so TODAY'S BEHAVIOR IS UNCHANGED — everything
-- currently staged still promotes — while any *later*-arriving row dated before
-- that point is blocked instead of silently promoted.
--
--   531  Revolut-USD  → 2026-07-26  (its earliest staged row)
--   530  Revolut-PLN  → 2026-07-30  (nothing staged; pin to today)
--
-- Idempotent: the WHERE clause only touches rows that are still NULL.
--
-- NOT claimed: this does not close the Black Card class. Those duplicates were
-- already staged at the moment of mapping, so a pin derived from staged rows
-- would have included them. Closing it needs a deliberate cutoff CHOICE at
-- mapping time, which needs a UI write path that does not exist yet
-- (promote_from_date is currently read-only everywhere in the frontend).
-- Tracked as a roadmap item.

BEGIN;

UPDATE account_source_mappings m
   SET promote_from_date = COALESCE(
         (SELECT MIN(s.transaction_date)
            FROM bankfeed_staging s
           WHERE s.feed_account_external_id = m.external_name),
         CURRENT_DATE
       )
 WHERE m.source = 'bank-feed'
   AND m.promote_from_date IS NULL
   AND m.account_id IS NOT NULL;

-- Guard: every mapped bank-feed row must now carry a cutoff. If this fails the
-- migration rolls back rather than leaving the fix half-applied.
DO $$
DECLARE remaining INT;
BEGIN
  SELECT COUNT(*) INTO remaining
    FROM account_source_mappings
   WHERE source = 'bank-feed' AND account_id IS NOT NULL AND promote_from_date IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'migration 043: % mapped bank-feed row(s) still have no promote cutoff', remaining;
  END IF;
END $$;

COMMIT;
