-- ---------------------------------------------------------------------------
-- 046_cashmgt_mtm_mode.sql — stop Fidelity Cash Mgt calibrating its history away
--
-- `reconcileToFeed.calibrate()` sets
--
--     opening_balance = expected − Σtx
--
-- so the whole gap between fin and the custodian is absorbed into a SINGLE
-- CONSTANT at the account's opening. That makes TODAY right and every other
-- date wrong by exactly the movement it swallowed. `mtm()` books the same gap
-- as a dated `Unrealized G/L` row instead, which is where it belongs.
--
-- Cash Mgt was the only Fidelity account still on `calibrate` for its feed
-- mapping, and the only one with ZERO mtm rows ever written — Stocks, IRA,
-- Bond and Options all carry `mtm` on their feed-external-id mapping. Its plug
-- had reached a constant −14,436.32.
--
-- `mtm` is the right mode here on the evidence, not by analogy: the account
-- holds BROKERED CDs, whose market value genuinely moves, its cash flows match
-- the custodian exactly, and its gap FLIPS SIGN between quarters
-- (+4,863.51 at 2026-03-31, −5,161.51 over Q2). An accumulating bookkeeping
-- error does not change direction; unbooked price movement does.
--
-- Data half already applied: CR058 §12 restated the 2026 quarter-ends from the
-- custodian's statements (2026-03-31 → 589,320.11, 2026-06-30 → 804,030.47),
-- so the movement this mode change stops absorbing now lives in dated rows.
-- ORDER MATTERS and is the reason the plug is NOT reset here: reducing
-- opening_balance by 14,436.32 while the history is still unbooked would move
-- today's balance by that amount and break a figure that is currently correct.
--
-- Idempotent (`WHERE reconcile_mode = 'calibrate'`; a re-run gives UPDATE 0).
-- ---------------------------------------------------------------------------

BEGIN;

UPDATE account_source_mappings
   SET reconcile_mode = 'mtm'
 WHERE source = 'bank-feed'
   AND account_id = (SELECT id FROM accounts WHERE name = 'Fidelity Cash Mgt')
   AND external_name = 'e5a23070-13bb-49af-8f2d-e552e159b570'
   AND reconcile_mode = 'calibrate';

DO $$
DECLARE
    n_mtm       INTEGER;
    n_calibrate INTEGER;
BEGIN
    SELECT COUNT(*) FILTER (WHERE reconcile_mode = 'mtm'),
           COUNT(*) FILTER (WHERE reconcile_mode = 'calibrate')
      INTO n_mtm, n_calibrate
      FROM account_source_mappings
     WHERE source = 'bank-feed'
       AND external_name = 'e5a23070-13bb-49af-8f2d-e552e159b570';

    -- No mapping row at all = a data-free database (CI applies the whole chain
    -- to an empty Postgres, and the seed runs only afterwards). There is
    -- nothing to leave calibrating, so there is nothing to guard. Amended
    -- 2026-08-01: the original unconditional check aborted the chain in CI, and
    -- an aborted migration cannot be repaired by a later one — see
    -- .claude/rules/migrations.md on editing an applied migration.
    IF n_mtm + n_calibrate = 0 THEN
        RAISE NOTICE '046 SKIP: no bank-feed mapping for the Cash Mgt feed id — data-free database';

    -- Fail loud rather than leave the account silently still calibrating. A
    -- renamed account or a re-keyed feed id would otherwise make this a no-op
    -- that reports success. Both still fail here: the mapping is keyed by
    -- external_name, so it survives a rename and reports as calibrate.
    ELSIF n_mtm <> 1 THEN
        RAISE EXCEPTION
          '046: expected exactly 1 mtm feed mapping for Fidelity Cash Mgt, found % (calibrate: %) — '
          'account renamed or feed id re-keyed?', n_mtm, n_calibrate;

    ELSE
        RAISE NOTICE '046 OK: Fidelity Cash Mgt feed mapping now marks to market';
    END IF;
END $$;

COMMIT;
