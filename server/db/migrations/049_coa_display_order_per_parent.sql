-- ---------------------------------------------------------------------------
-- 049_coa_display_order_per_parent.sql — CR063 P1: make `accounts.display_order`
-- the authoritative Chart of Accounts order, as a rank WITHIN THE PARENT.
--
-- ── Why this is a backfill and not a feature ───────────────────────────────
--
-- `display_order` has been in the schema since the seed, and `findAll`,
-- `getChildren` and `getBalances` all order by it. But `getTree()` — the ONE
-- path every tree, report and dropdown actually goes through — selects it and
-- then sorts `ORDER BY path`, where `path` is `ARRAY[id]`. So the COA page, the
-- Balance Sheet, the Cash Flow report, the budget worksheet and the forecast
-- account list have all been rendering in INSERTION order. It reads as
-- deliberate only because the original seed inserted rows in a sensible order.
--
-- The sort cannot simply be flipped. The column was seeded as one FLAT sequence
-- across the whole COA (dev: values 0–207 over 229 rows), not a rank within each
-- parent, and `accounts.create()` hard-coded `display_order = 0`, so every
-- account added since the seed carries 0 — 22 of them on dev. Measured before
-- writing this file:
--
--     rows whose position changes if getTree honours display_order as-is
--     ------------------------------------------------------------------
--                     68  of  229
--
-- and those rows are not confined to the COA page: `getNestedTree` feeds
-- services/reports.js (Balance Sheet, Cash Flow), services/budget.js and
-- routes/forecast.js. Flipping the sort without this backfill would silently
-- reshuffle three reports.
--
-- ── The one decision that matters here ─────────────────────────────────────
--
-- The rank is computed `ORDER BY id` — the CURRENTLY VISIBLE order — and
-- deliberately NOT `ORDER BY display_order, id`. Ranking by the existing value
-- would BAKE IN the 68-row reshuffle instead of preventing it. The success
-- criterion for this migration is that NOTHING MOVES: it ships in the same
-- release as the `getTree` change, and the acceptance test is that the Balance
-- Sheet, the Cash Flow report and the budget worksheet render byte-identically
-- before and after.
--
-- Inactive rows are ranked too (no `is_active` filter): an account reactivated
-- later must land in a defined position rather than collide at 0.
--
-- Idempotent: re-running recomputes the same ranks and updates 0 rows
-- (the `IS DISTINCT FROM` guard).
-- ---------------------------------------------------------------------------

BEGIN;

-- Snapshot the sibling order as getTree renders it TODAY — `ARRAY[id]`, i.e.
-- `ORDER BY id` within each parent. Check 3 then asserts that the order getTree
-- will render AFTER the change — `ARRAY[display_order, id]` — is the same
-- sequence. That is a check on the UPDATE having reached every row (a partial
-- apply, a join that drops rows), not on the arithmetic; the real evidence that
-- nothing moved is the external before/after diff of the Balance Sheet, the Cash
-- Flow report and the budget worksheet. Temp table, dropped at COMMIT.
CREATE TEMP TABLE coa_order_before ON COMMIT DROP AS
SELECT id,
       parent_id,
       row_number() OVER (PARTITION BY parent_id ORDER BY id) AS visible_rank
  FROM accounts;

UPDATE accounts a
   SET display_order = r.rank
  FROM (
        SELECT id,
               row_number() OVER (PARTITION BY parent_id ORDER BY id) AS rank
          FROM accounts
       ) r
 WHERE r.id = a.id
   AND a.display_order IS DISTINCT FROM r.rank;

COMMENT ON COLUMN accounts.display_order IS
  'CR063: rank of this account WITHIN ITS PARENT (1-based, gap-free). Set by the COA page''s reorder action; new accounts append at MAX(sibling)+1. getTree sorts on ARRAY[display_order, id].';

DO $$
DECLARE
  dup INT;
  gaps INT;
  moved INT;
BEGIN
  -- 1. A duplicate rank is the one state that makes sibling order
  --    non-deterministic again — exactly the disease being cured.
  SELECT count(*) INTO dup FROM (
    SELECT parent_id, display_order
      FROM accounts
     GROUP BY parent_id, display_order
    HAVING count(*) > 1
  ) d;
  IF dup <> 0 THEN
    RAISE EXCEPTION 'CR063 migration 049: % duplicate (parent_id, display_order) pair(s)', dup;
  END IF;

  -- 2. Ranks must be 1..n per parent with no gaps, or "append at MAX+1" and
  --    "swap with the neighbour" stop agreeing about what a position is.
  SELECT count(*) INTO gaps FROM (
    SELECT parent_id
      FROM accounts
     GROUP BY parent_id
    HAVING max(display_order) <> count(*) OR min(display_order) <> 1
  ) g;
  IF gaps <> 0 THEN
    RAISE EXCEPTION 'CR063 migration 049: % parent group(s) with a gapped or non-1-based rank', gaps;
  END IF;

  -- 3. THE ONE THAT MATTERS: the sequence getTree will render after the change
  --    must be the sequence it renders now. If this raises, the Balance Sheet /
  --    Cash Flow / budget worksheet were about to be reshuffled.
  SELECT count(*) INTO moved
    FROM coa_order_before b
    JOIN (
          SELECT id,
                 row_number() OVER (PARTITION BY parent_id ORDER BY display_order, id) AS new_rank
            FROM accounts
         ) a ON a.id = b.id
   WHERE a.new_rank <> b.visible_rank;
  IF moved <> 0 THEN
    RAISE EXCEPTION 'CR063 migration 049: % account(s) would change sibling position — the backfill must be order-preserving', moved;
  END IF;
END $$;

COMMIT;
