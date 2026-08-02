-- 054 — link the core-sweep mirror pairs that 053 could not see (CR065 follow-up).
--
-- WHAT 053 MISSED. It gave a neutralize pair an identity and taught neutralize()
-- to record it — but `neutralize()` is not the only thing that makes a pair.
-- refreshBankFeedV2 also makes one on every promote: a Fidelity core-cash sweep
-- ("PURCHASE INTO / REDEMPTION FROM CORE ACCOUNT …") is inserted together with an
-- `auto-offset` counter-leg so it self-nets (CR032). That path was not updated, so
-- it kept writing pairs with `paired_with_id` NULL on both sides.
--
-- HOW IT SURFACED, within the hour. The v3.11.4 deploy's boot-reconcile promoted a
-- backlog including three Fidelity Cash Mgt sweeps, and the unpaired-leg check
-- added by the same CR immediately read **6 unpaired legs** on that account — its
-- own false positives. Left alone it would have gained two more per sweep, every
-- day, until the check was worth nothing. The code is fixed alongside this file;
-- this repairs the rows already written.
--
-- WHAT IS MATCHED. A sweep mirror is inserted in the SAME transaction as its
-- original, so `mirror.created_at` equals the original's `created_at` — and, for
-- the neutralize shape, its `updated_at`. Both are accepted here, together with
-- account + date + description1 + negated amount. As in 053, the match must be
-- 1:1 in BOTH directions or the row is left NULL: a wrong link would make a
-- genuinely-unclaimed leg ineligible and mirror against it, double-counting in the
-- other direction. Unlinked is safe; mislinked is not.
--
-- BOUNDED to id > the 053 watermark. Below it, pairing was never recorded and the
-- category also carries genuine cross-account transfers; 053 deliberately does not
-- reach there, and neither does this. Roadmap Known Issue #13 owns that residue.
--
-- IDEMPOTENT. Fills only NULLs; a re-run finds nothing left to fill. On a
-- data-free database it matches nothing and passes straight through.

BEGIN;

WITH cand AS (
  SELECT o.id AS offset_id, t.id AS original_id
    FROM transactions o
    JOIN transactions t
      ON t.account_id = o.account_id
     AND t.id <> o.id
     AND t.source <> 'auto-offset'
     AND t.transaction_date = o.transaction_date
     AND t.amount = -o.amount
     AND t.description1 IS NOT DISTINCT FROM o.description1
     AND o.created_at IN (t.created_at, t.updated_at)
     AND t.paired_with_id IS NULL
   WHERE o.source = 'auto-offset'
     AND o.paired_with_id IS NULL
     AND o.id > (SELECT (value #>> '{}')::bigint FROM app_data WHERE key = 'cr065_pairing_since_tx_id')
), one_to_one AS (
  SELECT offset_id, original_id FROM cand
   WHERE offset_id   IN (SELECT offset_id   FROM cand GROUP BY offset_id   HAVING COUNT(*) = 1)
     AND original_id IN (SELECT original_id FROM cand GROUP BY original_id HAVING COUNT(*) = 1)
)
UPDATE transactions t
   SET paired_with_id = p.partner
  FROM (
    SELECT offset_id AS id, original_id AS partner FROM one_to_one
    UNION ALL
    SELECT original_id AS id, offset_id AS partner FROM one_to_one
  ) p
 WHERE t.id = p.id
   AND t.paired_with_id IS NULL;

DO $$
DECLARE one_sided INT; still_loose INT; linked INT;
BEGIN
  -- Symmetry, same as 053: a one-sided link is a half-claim, and the unclaimed
  -- side would still be pairable.
  SELECT COUNT(*) INTO one_sided
    FROM transactions a JOIN transactions b ON b.id = a.paired_with_id
   WHERE a.paired_with_id IS NOT NULL AND b.paired_with_id IS DISTINCT FROM a.id;
  IF one_sided > 0 THEN
    RAISE EXCEPTION 'migration 054: % one-sided pair link(s)', one_sided;
  END IF;

  SELECT COUNT(*) INTO linked FROM transactions
   WHERE paired_with_id IS NOT NULL
     AND id > COALESCE((SELECT (value #>> '{}')::bigint FROM app_data WHERE key = 'cr065_pairing_since_tx_id'), 0);

  -- What the reconcile page will now report. Not an assertion: a leg legitimately
  -- awaiting neutralize is unpaired and accepted=FALSE, and a real orphan SHOULD
  -- show up here rather than abort a migration.
  SELECT COUNT(*) INTO still_loose
    FROM transactions t
    JOIN accounts c ON c.id = t.category_id AND c.name = 'Transfer - Securities Trades'
   WHERE t.accepted = TRUE AND t.paired_with_id IS NULL
     AND t.id > COALESCE((SELECT (value #>> '{}')::bigint FROM app_data WHERE key = 'cr065_pairing_since_tx_id'), 0);
  RAISE NOTICE 'migration 054: % post-watermark row(s) now linked; % accepted securities-transfer leg(s) still unpaired', linked, still_loose;
END $$;

COMMIT;
