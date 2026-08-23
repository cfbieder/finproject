-- ---------------------------------------------------------------------------
-- 074_accounts_opening_balance_audit.sql — CR087 P0a. Record every change to
-- accounts.opening_balance, so a re-anchor stops being invisible.
--
-- ADDITIVE AND INERT for every existing row: it creates a function, a trigger
-- and one COMMENT. It changes no data, blocks no write, and alters no existing
-- behaviour. `DROP TRIGGER trg_audit_account_opening_balance ON accounts`
-- reverses it completely.
--
-- ── What it fixes ──
--
-- `calibrate()` re-anchors `opening_balance = expected − Σtx`, which shifts
-- EVERY historical date on that account by one constant. It leaves no record.
-- Measured on prod 2026-08-23: 20 live `calibrate` mappings, re-anchored
-- monthly by month-end reconcile step 5, 10 of them non-USD.
--
-- The cost is already on the record. CR080: months of owner calibrations
-- dragged history, migration 065 misread the residue as a fabricated −32.56
-- `Unrealized G/L` loss, and moving it back took three migrations (065 → 069)
-- and a multi-day reconstruction — precisely because no writer left a trace.
-- CR082 then had to design freeze-on-file around the same property, recording
-- that calibrate "writes one constant across every historical date and for
-- years with no audit row at all".
--
-- ── Why a TRIGGER, and not an insert in the service ──
--
-- ⚠️ This reverses a convention written down eight weeks ago. Migration 072
-- says: "this repo has exactly one non-internal trigger in the whole database",
-- and declined to add a second. That argument was about ENFORCING AN INVARIANT
-- on LE rows. This is OBSERVATION: it changes no behaviour, refuses no write,
-- and is reversible with one DROP. Owner decision, 2026-08-23.
--
-- The deciding fact is that `opening_balance` has more writers than anyone
-- remembers. Measured at HEAD:
--   server/src/v2/services/reconcileToFeed.js:600   the feed calibrate
--   server/src/v2/services/reconcileManual.js:317   the MANUAL calibrate
--   server/src/v2/services/reconcileManual.js:291   `SET opening_balance = 0`
--   server/src/v2/repositories/accounts.js:360      the generic COA whitelist
--   + five more in server/src/v2/scripts/
-- The third of those — a one-click unaudited destructive write — was found by
-- a reviewer, not by the CR that set out to audit this column. An insert in
-- "the service" is an insert in whichever service someone remembers; a trigger
-- also covers the scripts and a human at `psql`, which is where the CR080-class
-- damage actually happened.
--
-- ── Why audit_log and not a new table ──
--
-- `audit_log` already exists with exactly the right shape (table_name,
-- record_id, action, old_values jsonb, new_values jsonb, user_info), is indexed
-- on (table_name, record_id), and has a live writer in
-- server/src/v2/services/aiReview.js. A third audit shape would be a second
-- source of truth for the same class of fact.
--
-- ── UPDATE only, deliberately ──
--
-- The problem is history being REWRITTEN, which is UPDATE. An INSERT is an
-- account being created and its opening balance being stated for the first
-- time — a fact, not a revision. Covering INSERT would add a row for every new
-- account and dilute the signal this exists to carry.
--
-- ── user_info: designed for an actor it does not yet have ──
--
-- The trigger sees the COLUMN CHANGE, not the button. It reads `app.actor` if a
-- caller has set it and records NULL otherwise, so the three services can add
-- `SET LOCAL app.actor = 'calibrate'` later and start recording WHICH PATH
-- wrote — with no second migration. Old/new/when is enough for CR080-class
-- forensics; "which action" is what tells you whether it was intentional.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_audit_account_opening_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actor TEXT;
BEGIN
  -- `true` = missing_ok, so this is NULL rather than an error when unset.
  actor := NULLIF(current_setting('app.actor', true), '');

  INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_info)
  VALUES (
    'accounts',
    NEW.id,
    'opening_balance',
    jsonb_build_object(
      'opening_balance',      OLD.opening_balance,
      'opening_balance_date', OLD.opening_balance_date
    ),
    jsonb_build_object(
      'opening_balance',      NEW.opening_balance,
      'opening_balance_date', NEW.opening_balance_date,
      -- Stored, not derived at read time: `opening_balance` is NUMERIC and the
      -- delta is the number a reader actually wants ("how much did this move").
      'delta',                NEW.opening_balance - OLD.opening_balance,
      'account_name',         NEW.name,
      'currency',             NEW.currency
    ),
    actor
  );
  RETURN NULL;  -- AFTER trigger: return value is ignored.
END;
$$;

COMMENT ON FUNCTION fn_audit_account_opening_balance() IS
  'CR087 P0a — records every UPDATE of accounts.opening_balance into audit_log. '
  'Observation only: changes no behaviour and refuses no write.';

DROP TRIGGER IF EXISTS trg_audit_account_opening_balance ON accounts;

CREATE TRIGGER trg_audit_account_opening_balance
  AFTER UPDATE OF opening_balance, opening_balance_date ON accounts
  FOR EACH ROW
  -- Only a real move. `IS DISTINCT FROM` so NULL → value and value → NULL both
  -- count, and a no-op UPDATE writes nothing.
  WHEN (OLD.opening_balance      IS DISTINCT FROM NEW.opening_balance
     OR OLD.opening_balance_date IS DISTINCT FROM NEW.opening_balance_date)
  EXECUTE FUNCTION fn_audit_account_opening_balance();

-- ---------------------------------------------------------------------------
-- accounts.last_calibrated_at — superseded, deliberately NOT dropped.
--
-- It exists, is populated on 67 of 230 accounts, and has been stale since
-- 2026-06-03: nothing writes it except the generic COA update whitelist. The
-- `Last calibrated` reader sources from audit_log, which carries old, new,
-- delta and when — this column carries only "when", unreliably.
--
-- Not dropped, because those 67 dates are evidence about past calibrations, and
-- destroying that in the migration whose purpose is to stop losing exactly that
-- would be self-defeating. Commented rather than left silent, because a stale
-- column someone later wires into a UI is CR085's named defect class: state
-- that renders and lies. Owner decision, 2026-08-23.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN accounts.last_calibrated_at IS
  'SUPERSEDED by audit_log (CR087 P0a, migration 074). Stale since 2026-06-03; '
  'nothing writes it. Do NOT read this for "last calibrated" — query audit_log '
  'WHERE table_name = ''accounts'' AND action = ''opening_balance''. Retained '
  'only because its 67 populated rows are historical evidence.';

-- ---------------------------------------------------------------------------
-- Post-conditions. Structural only — behaviour is verified on dev by a real
-- UPDATE after this runs, where the probe row can be inspected deliberately
-- rather than written and swallowed inside a migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_audit_account_opening_balance'
                    AND tgrelid = 'accounts'::regclass) THEN
    RAISE EXCEPTION '074 post-condition: trigger trg_audit_account_opening_balance was not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_account_opening_balance') THEN
    RAISE EXCEPTION '074 post-condition: function fn_audit_account_opening_balance was not created';
  END IF;

  -- The trigger writes six audit_log columns. If any is missing or renamed the
  -- first calibration fails at runtime, on a write nobody is watching.
  SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['table_name','record_id','action','old_values','new_values','user_info']) AS c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'audit_log' AND column_name = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '074 post-condition: audit_log is missing column(s): %', missing;
  END IF;

  RAISE NOTICE '074: opening_balance audit trigger installed. The trail starts EMPTY and fills forward — 20 live calibrate accounts, re-anchored monthly.';
END $$;
