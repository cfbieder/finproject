-- 053 — give a neutralize pair an IDENTITY, so a counter-leg can be claimed once (CR065).
--
-- WHAT WENT WRONG (prod, 2026-07-30). fintable delivered two genuine $150,000 CD
-- purchases into Fidelity Cash Mgt on the same day, same amount:
--
--   2709774  -150000  UNITED BANKERS BK BLOOMINGTON CD 4.15% 01/31/2028
--   2709773  -150000  TEXAS EXCHANGE BK CROWLEY     CD 4.30% 07/31/2030
--
-- Neutralizing the first found no counter-leg and INSERTed a +150000 mirror
-- (2709785, source='auto-offset'). Neutralizing the second, four seconds later,
-- found that mirror — same account, negated amount, same date, and carrying
-- exactly the category being passed in — and PAIRED with it instead of inserting
-- its own. Both -150000 legs now claim the same +150000 counter-leg. The account
-- ran $150,000 light, which is most of the -107,830.71 drift on the reconcile page.
--
-- WHY IT HAPPENED. neutralize() decided "does this row already have a counter-leg?"
-- by re-running a VALUE match (account + negated amount + ±3 days + compatible
-- category) over the whole ledger. Value-matching is not identity: two rows of the
-- same value are indistinguishable, so the same counter-leg matches any number of
-- originals, and nothing in the schema recorded that a claim had been made — so
-- nothing could refuse the second one.
--
-- WHAT THIS MIGRATION ADDS. `paired_with_id` — a symmetric self-reference written
-- on BOTH rows of a pair (A.paired_with_id = B.id and B.paired_with_id = A.id).
-- The partial UNIQUE index is the point of the exercise: no two rows may name the
-- same counter-leg, so the double-claim is refused by the database even if the
-- application logic regresses. Correctness stops depending on a WHERE clause.
--
-- NOT NULL is impossible here and never will be: most transactions are not part of
-- a neutralize pair at all. NULL means "unpaired", which is the common case.
--
-- IDEMPOTENT. IF NOT EXISTS throughout; the backfill only ever fills NULLs and a
-- re-run finds none left to fill.

BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS paired_with_id BIGINT REFERENCES transactions(id) ON DELETE SET NULL;

COMMENT ON COLUMN transactions.paired_with_id IS
  'CR065: the transaction this one was neutralized against (symmetric; NULL = unpaired). '
  'The partial unique index makes a counter-leg claimable exactly once.';

-- The invariant, enforced rather than asserted: one row, one claimant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_paired_with
  ON transactions (paired_with_id) WHERE paired_with_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- BACKFILL — the mirror path only, and only where the match is exact.
--
-- A mirror and its original are written in ONE db.transaction: the original's
-- UPDATE sets `updated_at = NOW()` and the mirror's INSERT defaults `created_at`
-- to now(). Postgres' now() is transaction-start time, so the two timestamps are
-- IDENTICAL to the microsecond — and that is what disambiguates the incident
-- above, where date + amount + description alone cannot. The mirror also copies
-- the original's description1 verbatim and negates its amount.
--
-- Both directions must be 1:1. A mirror with two possible originals, or an
-- original with two possible mirrors, is left NULL rather than guessed at: a
-- WRONG link would make a genuinely-unclaimed leg ineligible, and the next
-- neutralize would insert a mirror it does not need — an orphan double-count, the
-- failure this migration exists to prevent. Unlinked is safe; mislinked is not.
--
-- KNOWN RESIDUAL, stated rather than papered over: pairs made by the PAIR path
-- (two real feed legs matched to each other) left no record at all and are NOT
-- backfilled — there is nothing durable to reconstruct them from. They stay NULL.
-- What protects them is the `source <> 'auto-offset'` guard plus the fact that a
-- re-claim needs a third row of the same magnitude within 3 days in the same
-- account; the per-account transfer-imbalance check added with this CR is what
-- would surface one if it ever happened. From 053 forward every pair is recorded.
-- ---------------------------------------------------------------------------
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
     AND t.updated_at = o.created_at
     AND t.paired_with_id IS NULL
   WHERE o.source = 'auto-offset'
     AND o.paired_with_id IS NULL
), one_to_one AS (
  SELECT offset_id, original_id FROM cand
   WHERE offset_id  IN (SELECT offset_id   FROM cand GROUP BY offset_id   HAVING COUNT(*) = 1)
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

-- ---------------------------------------------------------------------------
-- WATERMARK — where the "every leg is paired" check may start looking.
--
-- Pairing has only been RECORDED from this migration forward. Everything the
-- backfill above could not reach carries no link and never will: pair-path
-- neutralizes left no durable trace, and this category has also been used for
-- genuine CROSS-account securities transfers, whose counter-leg is legitimately
-- in a different account. On the production database that is ~1,800 legs across
-- five accounts, and Fidelity Stocks (+134,772.19) against Fidelity Cash Mgt
-- (-138,113.41) is mostly the cross-account pairs, not error.
--
-- So the check is bounded to transactions created after this point. A watermark
-- that reported five accounts as permanently broken would be a warning everybody
-- learns to scroll past — the same failure as the drift it is meant to sharpen.
--
-- MAX(id), not a timestamp: it is a hard boundary immune to clock skew and to
-- the UTC-vs-local parsing this codebase has been bitten by three times
-- (roadmap Known Issue #3). On a fresh database MAX(id) is NULL → 0 → every row
-- is checked, which is right: a database with no legacy has nothing to exempt.
-- ---------------------------------------------------------------------------
INSERT INTO app_data (key, value)
SELECT 'cr065_pairing_since_tx_id', to_jsonb(COALESCE(MAX(id), 0)) FROM transactions
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Post-conditions. These assert the INVARIANT, not a row count — a count would
-- pass just as happily if the backfill had linked the wrong rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  one_sided   INT;   -- NB: not `asymmetric` — that is a reserved word in plpgsql
  self_linked INT;
  linked      INT;
  orphans     INT;
BEGIN
  -- 1. Every link is symmetric. A one-sided link is a half-claim: the unclaimed
  --    side would still be pairable and the bug would survive the migration.
  SELECT COUNT(*) INTO one_sided
    FROM transactions a
    JOIN transactions b ON b.id = a.paired_with_id
   WHERE a.paired_with_id IS NOT NULL
     AND b.paired_with_id IS DISTINCT FROM a.id;
  IF one_sided > 0 THEN
    RAISE EXCEPTION 'migration 053: % one-sided pair link(s) — a counter-leg is claimed one-way', one_sided;
  END IF;

  -- 2. Nothing pairs with itself.
  SELECT COUNT(*) INTO self_linked FROM transactions WHERE paired_with_id = id;
  IF self_linked > 0 THEN
    RAISE EXCEPTION 'migration 053: % transaction(s) paired with themselves', self_linked;
  END IF;

  -- 3. Report the shape of what was linked and what was left. On CI's data-free
  --    database this is 0/0 and the chain passes straight through — the whole
  --    migration must survive an empty `transactions` table (migration 046's
  --    lesson: never assert a production data fact unconditionally).
  SELECT COUNT(*) INTO linked  FROM transactions WHERE paired_with_id IS NOT NULL;
  SELECT COUNT(*) INTO orphans FROM transactions
   WHERE source = 'auto-offset' AND paired_with_id IS NULL;
  RAISE NOTICE 'migration 053: % row(s) linked into pairs; % auto-offset row(s) left unlinked '
               '(pre-053 history — ineligible as pair candidates either way)', linked, orphans;
END $$;

COMMIT;
