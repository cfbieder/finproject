-- ---------------------------------------------------------------------------
-- 042_valuation_anchors.sql — CR058 Quicken-era valuation anchors
--
-- Two objects, both prerequisites of the anchor writer:
--
--   1. The `Valuation - Historical` COA leaf the anchors post to.
--   2. `quicken_import_batches.calibration_mode`, so a batch records HOW its
--      opening_balance was calibrated and a re-promote after rollback keeps
--      that choice instead of silently reverting to the default.
--
-- No new tables. Anchor rows are ordinary `transactions` carrying
-- source='quicken-valuation' and the CR019 batch's import_batch_id, so the
-- existing §6.5 rollback (DELETE ... WHERE import_batch_id = ...) removes them
-- with the batch at no extra cost.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. `Valuation - Historical` — where anchors post.
--
-- NOT `Unrealized G/L` (88), deliberately: each anchor mixes real market
-- movement with liquidation timing, money-market sweep churn and gaps in
-- Quicken's own share history, so routing them to CR056's unrealized numerator
-- would manufacture a confident, wrong pre-2020 return series. See CR058 §3.3.
--
-- is_transfer = TRUE keeps it out of the P&L reports; skip_transfer_analysis
-- = TRUE keeps it out of /transfer-analysis, where an anchor would otherwise
-- sit forever as unmatched (it has no counterparty) — the same treatment
-- CR019 §4.3 gave `Return of Capital`.
--
-- The parent is resolved BY NAME. A hard-coded id is correct on dev and prod
-- and wrong on the migrations-only database CI builds, where `Transfers` is
-- created by 022 with a serial id — that is exactly what broke 041 and turned
-- CI red for four consecutive runs (fixed in 10eb270).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    transfers_parent_id INTEGER;
    t BOOLEAN; sk BOOLEAN; s TEXT; p INTEGER;
BEGIN
    SELECT id INTO transfers_parent_id FROM accounts WHERE name = 'Transfers' LIMIT 1;
    IF transfers_parent_id IS NULL THEN
        RAISE EXCEPTION
          'Migration aborted: required "Transfers" parent account not found in COA';
    END IF;

    INSERT INTO accounts (name, parent_id, account_type, section, currency,
                          is_transfer, skip_transfer_analysis, is_active, display_order)
    SELECT 'Valuation - Historical', transfers_parent_id, 'expense', 'profit_loss', 'USD',
           TRUE, TRUE, TRUE, 0
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'Valuation - Historical');

    -- Fail loud rather than proceed with a mis-flagged category. Both flags
    -- default FALSE, so a row hand-created through the generic COA path would
    -- land in the P&L and in transfer analysis — silently wrong in two reports.
    SELECT is_transfer, skip_transfer_analysis, section::text, parent_id
      INTO t, sk, s, p
      FROM accounts WHERE name = 'Valuation - Historical';
    IF t IS NOT TRUE OR sk IS NOT TRUE OR s <> 'profit_loss' OR p <> transfers_parent_id THEN
        RAISE EXCEPTION
          'Valuation - Historical has wrong flags (is_transfer=%, skip_transfer_analysis=%, section=%, parent=%) — expected (t, t, profit_loss, %)',
          t, sk, s, p, transfers_parent_id;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. `quicken_import_batches.calibration_mode`
--
--   'ps-anchored'    (default, CR019 §22.1) — opening_balance := ps_close − Σ(all tx).
--                    Right for PS-only cash accounts, whose "today" is wrong
--                    before the import.
--   'preserve-today' (CR058 §3.4)           — opening_balance −= Σ(this batch's rows).
--                    Right for accounts whose current balance is ALREADY correct,
--                    i.e. feed-owned (CR024). PS-anchoring drags those back to a
--                    stale PocketSmith number.
--
-- Persisted on the batch rather than passed per-call, so a re-promote after
-- rollback (CR019 §6.5.6) keeps the mode. The DEFAULT makes every existing
-- batch explicitly 'ps-anchored' ⇒ no behaviour change for anything already
-- promoted.
-- ---------------------------------------------------------------------------

ALTER TABLE quicken_import_batches
  ADD COLUMN IF NOT EXISTS calibration_mode TEXT NOT NULL DEFAULT 'ps-anchored';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quicken_import_batches_calibration_mode_chk'
    ) THEN
        ALTER TABLE quicken_import_batches
          ADD CONSTRAINT quicken_import_batches_calibration_mode_chk
          CHECK (calibration_mode IN ('ps-anchored', 'preserve-today'));
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE n INTEGER;
BEGIN
    SELECT COUNT(*) INTO n FROM accounts WHERE name = 'Valuation - Historical';
    IF n <> 1 THEN
        RAISE EXCEPTION 'expected exactly 1 "Valuation - Historical" account, found %', n;
    END IF;
    SELECT COUNT(*) INTO n FROM information_schema.columns
     WHERE table_name = 'quicken_import_batches' AND column_name = 'calibration_mode';
    IF n <> 1 THEN
        RAISE EXCEPTION 'calibration_mode column missing after migration';
    END IF;
    RAISE NOTICE '042 OK: Valuation - Historical present, calibration_mode present';
END $$;

COMMIT;
