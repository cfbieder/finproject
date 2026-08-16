-- ---------------------------------------------------------------------------
-- 071_tax_foreign_account_year_states.sql — CR082 §7. Year-scope the FBAR
-- designation's `review_state`.
--
-- ── The defect this closes ──
--
-- `tax_foreign_accounts.review_state` is ONE value for all time. CR082 §7
-- specified a year-scoped designation screen and the P1 build did not deliver
-- one, which showed up immediately on the TY2025 pass: `PKO TFI` and
-- `Revolut-PLN` were both opened in 2026, both appeared on the TY2025 report
-- carrying a carry-in figure (see §12b.14 and the `carry_in_only` flag), and
-- excluding them removed them from EVERY year — including TY2026, where they
-- belong. The stopgap was a capitalised note on the row reading "set back to
-- reportable for TY2026", i.e. a correctness control that depends on somebody
-- reading a free-text field a year later.
--
-- The reverse case is the same seam: an account closed during 2025 is reportable
-- for the year it was open and irrelevant afterwards, and a present-tense
-- `excluded` on it would silently drop it from the year it is actually needed.
--
-- ── Why an OVERRIDE table and not a per-year row for every designation ──
--
-- Three shapes were available:
--
--   (a) replace the column with (designation, year) rows for every year;
--   (b) add `reportable_from_year` / `_to_year` bounds to the designation;
--   (c) THIS — keep the column as the standing answer, add a sparse per-year
--       override, resolve with COALESCE(override, standing).
--
-- (a) needs a copy-forward rule, and every year would open `unreviewed` for all
-- 36 designations — turning a review that should be a DIFF back into a re-read,
-- which is the exact thing §7's tri-state exists to prevent. (b) models only a
-- contiguous open/closed life and cannot express "excluded this year, no
-- position on next" — and a year outside the bounds would be `excluded` by
-- arithmetic rather than by a recorded decision, losing the unreviewed/excluded
-- distinction that CR066 exists one floor down to fix. (c) leaves the 36 rows of
-- existing decisions in place as the default, costs one row per genuine
-- exception (two, today), and a year with no override behaves exactly as it does
-- now.
--
-- The standing column is deliberately NOT deprecated: for the 34 designations
-- whose answer does not change, "reportable, every year" is the truth, and
-- writing it out per year would be duplication with a drift risk.
--
-- Additive DDL only; no data is written. The two live exceptions are entered
-- through the UI, because they are the owner's tax position and not schema —
-- the reasoning that withdrew migration 068.
--
-- Idempotent. Post-conditions are STRUCTURAL ONLY — a row-count assertion here
-- would be vacuous on a data-free database (Known Issue #12, three incidents).
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS tax_foreign_account_year_states (
  id                      SERIAL PRIMARY KEY,
  tax_foreign_account_id  INTEGER NOT NULL
                            REFERENCES tax_foreign_accounts(id) ON DELETE CASCADE,
  tax_year                INTEGER NOT NULL
                            CHECK (tax_year BETWEEN 1998 AND 2100),
  -- Same three values as the standing column, same CHECK rather than an enum:
  -- `accounts.account_type` is a real Postgres enum and altering one is the
  -- migration this repo least wants to repeat (070's note).
  review_state            VARCHAR(12) NOT NULL
                            CHECK (review_state IN ('unreviewed', 'reportable', 'excluded')),
  -- Why THIS year differs from the standing answer. The field the capitalised
  -- note in `tax_foreign_accounts.notes` was standing in for — except here it is
  -- attached to the year it describes and cannot be missed a year later.
  note                    TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  -- ON DELETE CASCADE above, and a hard unique key here: one answer per
  -- designation per year, so the report cannot pick a winner by arbitrary
  -- tie-break. That is the §12.1 shape, and it has already bitten this CR twice
  -- — once on filing lines (two override rows, arbitrary winner) and once on the
  -- seeder.
  CONSTRAINT tax_foreign_account_year_uq UNIQUE (tax_foreign_account_id, tax_year)
);

CREATE INDEX IF NOT EXISTS idx_tax_foreign_account_year_year
  ON tax_foreign_account_year_states(tax_year);

COMMENT ON TABLE tax_foreign_account_year_states IS
  'CR082 §7: per-YEAR override of tax_foreign_accounts.review_state. Sparse — a designation with no row for a year uses its standing review_state. Exists because an account opened in 2026 must be excluded from TY2025 without vanishing from TY2026.';

COMMENT ON COLUMN tax_foreign_account_year_states.review_state IS
  'Resolved as COALESCE(this, tax_foreign_accounts.review_state). Never read alone.';

-- Post-conditions: structural only.
DO $$
DECLARE
  n_tables INT;
  n_cons   INT;
BEGIN
  SELECT count(*) INTO n_tables
    FROM information_schema.tables
   WHERE table_schema = current_schema()
     AND table_name = 'tax_foreign_account_year_states';
  IF n_tables <> 1 THEN
    RAISE EXCEPTION 'CR082 071: tax_foreign_account_year_states missing in %', current_schema();
  END IF;

  -- Schema-qualified: `conname` is unique per table, not per database, and
  -- CR027 is schema-per-tenant and on main. An unqualified count reads high the
  -- moment the chain reaches a second schema (migration 057's lesson).
  SELECT count(*) INTO n_cons
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
   WHERE ns.nspname = current_schema()
     AND c.conname = 'tax_foreign_account_year_uq';
  IF n_cons <> 1 THEN
    RAISE EXCEPTION 'CR082 071: the (designation, year) unique key is missing in %', current_schema();
  END IF;

  RAISE NOTICE 'CR082 071: year-state override table present in %', current_schema();
END $$;

COMMIT;

-- Rollback:
--   DROP TABLE IF EXISTS tax_foreign_account_year_states;
