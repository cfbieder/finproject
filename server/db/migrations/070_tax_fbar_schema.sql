-- ---------------------------------------------------------------------------
-- 070_tax_fbar_schema.sql — CR082 P1. The Taxes section's first form: FinCEN
-- Form 114 (FBAR). SCHEMA ONLY, and inert: zero readers, zero writers until the
-- P1 routes ship.
--
-- Four tables, each answering something the form asks that fin cannot currently
-- hold:
--
--   tax_foreign_accounts   the DESIGNATION — which accounts are foreign, their
--                          institution block, account number, Part II/III/IV.
--                          Edited once, then reviewed yearly.
--   tax_fx_rates           the Treasury Dec-31 rate, per year per currency.
--   tax_fbar_filings       one row per (tax_year, amendment_seq).
--   tax_fbar_filing_lines  the FROZEN snapshot of what was filed.
--
-- ── Why the filing is frozen rather than recomputed ──
--
-- A balance computed for 2025 today is not the balance computed for 2025 last
-- January. `calibrate()` rewrites `accounts.opening_balance` — ONE constant
-- applied to every historical date — through a bare UPDATE that writes no audit
-- row at all (the only `audit_log` writer in this repo is aiReview.js). Migration
-- 069 is the case study: months of owner calibrations dragged history, and 065
-- misread the residue as an unrealized loss. `mtm` and `accrue` compound it from
-- the other side with back-dated month-end plug rows.
--
-- All correct behaviour for a ledger. All fatal to a number that, once filed
-- with FinCEN, must never move again. So `tax_fbar_filing_lines` COPIES the
-- label, account number and institution name rather than joining to them: a
-- later rename cannot rewrite what was filed, and reopening a year shows filed
-- vs recomputed side by side instead of overwriting.
--
-- ── Notes on three choices that look wrong and are not ──
--
-- 1. `UNIQUE (account_id)` over a NULLABLE column is deliberate, and is the
--    OPPOSITE of migration 057's case. Postgres treats NULLs as distinct, which
--    is exactly what is wanted here: MANY report-only lines (account_id IS NULL
--    — a reportable account with no fin ledger behind it, e.g. a company account
--    the owner has signature authority over), but AT MOST ONE designation per
--    real account. 057 had to add a partial index because there the NULL branch
--    needed constraining; here it must not be. Do not "fix" this into a partial
--    index — that would forbid a second report-only line.
--
-- 2. `rate_to_usd` is USD per ONE unit of the foreign currency, the direction
--    `exchange_rates` already stores. TREASURY PUBLISHES THE RECIPROCAL. For EUR
--    and GBP both directions are plausible numbers of the same order (EUR
--    1.175005 vs ~0.85), so a rate pasted the wrong way round moves the reported
--    maximum ~38% toward under-reporting with nothing to flag it. The column
--    comment carries the direction; the UI must state it and gate on the prefill.
--
-- 3. NO DATA IS WRITTEN HERE. The FX prefill is an app action, not a migration
--    insert: a `SELECT ... FROM exchange_rates` inside a migration is
--    data-dependent, inserts nothing on a fresh database, and is configuration
--    in a migration — the reasoning that withdrew migration 068.
--
-- Idempotent. Post-conditions are STRUCTURAL ONLY — a row-count assertion here
-- would be vacuous on a data-free database (Known Issue #12, three incidents).
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS tax_foreign_accounts (
  id                    SERIAL PRIMARY KEY,
  account_id            INTEGER UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  label                 TEXT NOT NULL,
  review_state          VARCHAR(12) NOT NULL DEFAULT 'unreviewed'
                          CHECK (review_state IN ('unreviewed', 'reportable', 'excluded')),
  fbar_part             VARCHAR(3) CHECK (fbar_part IN ('II', 'III', 'IV')),
  account_kind          VARCHAR(12) CHECK (account_kind IN ('bank', 'securities', 'other')),
  account_kind_other    TEXT,
  own_account_number    TEXT,
  own_currency          CHAR(3),
  institution_name      TEXT,
  institution_street    TEXT,
  institution_city      TEXT,
  institution_region    TEXT,
  institution_postal    TEXT,
  institution_country   CHAR(2),
  joint_owner_name      TEXT,
  joint_owner_tin       TEXT,
  joint_owner_address   TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  -- A line is EITHER backed by a fin account, or stands alone with its own
  -- number and currency. Never both, never neither: without a currency a typed
  -- maximum has no tax_fx_rates key and cannot be converted.
  CONSTRAINT tax_foreign_accounts_source_ck
    CHECK ((account_id IS NULL) = (own_currency IS NOT NULL)),
  CONSTRAINT tax_foreign_accounts_number_ck
    CHECK (account_id IS NOT NULL OR own_account_number IS NOT NULL)
);

COMMENT ON COLUMN tax_foreign_accounts.account_id IS
  'CR082: NULL = report-only line (no fin ledger). UNIQUE is NULL-distinct ON PURPOSE — many report-only lines, at most one designation per real account.';
COMMENT ON COLUMN tax_foreign_accounts.review_state IS
  'CR082: tri-state, not a boolean — "excluded" and "not yet reviewed" must never be the same value (the CR066 defect one floor down).';

CREATE TABLE IF NOT EXISTS tax_fx_rates (
  tax_year     INTEGER NOT NULL CHECK (tax_year BETWEEN 1998 AND 2100),
  currency     CHAR(3) NOT NULL,
  rate_to_usd  NUMERIC(15,6) NOT NULL CHECK (rate_to_usd > 0),
  source       VARCHAR(24) NOT NULL
                 CHECK (source IN ('treasury', 'frankfurter-prefill', 'manual')),
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tax_year, currency)
);

COMMENT ON COLUMN tax_fx_rates.rate_to_usd IS
  'CR082: USD per ONE unit of currency (the exchange_rates direction). Treasury publishes the RECIPROCAL — EUR/GBP are plausible either way, so the UI must state the direction and gate against the prefill.';
COMMENT ON TABLE tax_fx_rates IS
  'CR082: separate from exchange_rates because that table''s UNIQUE (from,to,rate_date) would force a Treasury rate to REPLACE the ECB row for that date, corrupting a series the budget and balance sheet read.';

CREATE TABLE IF NOT EXISTS tax_fbar_filings (
  id             SERIAL PRIMARY KEY,
  tax_year       INTEGER NOT NULL CHECK (tax_year BETWEEN 1998 AND 2100),
  amendment_seq  INTEGER NOT NULL DEFAULT 0 CHECK (amendment_seq >= 0),
  status         VARCHAR(8) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'filed')),
  filed_on       DATE,
  filed_note     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  -- NOT `tax_year UNIQUE`: an amended FBAR is a second filing for the same year,
  -- and the freeze exists precisely so the original stays readable beside it.
  CONSTRAINT tax_fbar_filings_year_seq_uq UNIQUE (tax_year, amendment_seq)
);

CREATE TABLE IF NOT EXISTS tax_fbar_filing_lines (
  id                      SERIAL PRIMARY KEY,
  filing_id               INTEGER NOT NULL REFERENCES tax_fbar_filings(id) ON DELETE CASCADE,
  -- Soft reference. The line must stand alone if the designation is later
  -- deleted, because it is a record of what was FILED.
  tax_foreign_account_id  INTEGER REFERENCES tax_foreign_accounts(id) ON DELETE SET NULL,
  label                   TEXT NOT NULL,
  account_number          TEXT,
  institution_name        TEXT,
  institution_country     CHAR(2),
  fbar_part               VARCHAR(3),
  account_kind            VARCHAR(12),
  currency                CHAR(3),
  max_value_native        NUMERIC(15,2),
  year_end_native         NUMERIC(15,2),
  fx_rate_used            NUMERIC(15,6),
  fx_rate_source          VARCHAR(24),
  max_value_usd           NUMERIC(15,2),
  year_end_usd            NUMERIC(15,2),
  max_unknown             BOOLEAN NOT NULL DEFAULT FALSE,
  closed_during_year      BOOLEAN NOT NULL DEFAULT FALSE,
  manual_value_native     NUMERIC(15,2),
  manual_reason           TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_fbar_lines_filing ON tax_fbar_filing_lines(filing_id);
CREATE INDEX IF NOT EXISTS idx_tax_foreign_accounts_state ON tax_foreign_accounts(review_state);

COMMENT ON TABLE tax_fbar_filing_lines IS
  'CR082: the FROZEN snapshot. label/account_number/institution_name are COPIED, not joined — calibrate() rewrites opening_balance across all history with no audit row, so a filed figure must not be recomputable.';

-- Post-conditions: structural only.
DO $$
DECLARE
  n_tables INT;
  n_checks INT;
BEGIN
  SELECT count(*) INTO n_tables
    FROM information_schema.tables
   WHERE table_schema = current_schema()
     AND table_name IN ('tax_foreign_accounts', 'tax_fx_rates',
                        'tax_fbar_filings', 'tax_fbar_filing_lines');
  IF n_tables <> 4 THEN
    RAISE EXCEPTION 'CR082 070: expected 4 tax tables in %, found %', current_schema(), n_tables;
  END IF;

  -- Schema-qualified: conname is unique per table, not per database, and CR027
  -- is schema-per-tenant and on main. An unqualified count reads high the moment
  -- the chain reaches a second schema (migration 057's lesson).
  SELECT count(*) INTO n_checks
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
   WHERE ns.nspname = current_schema()
     AND c.conname IN ('tax_foreign_accounts_source_ck',
                       'tax_foreign_accounts_number_ck',
                       'tax_fbar_filings_year_seq_uq');
  IF n_checks <> 3 THEN
    RAISE EXCEPTION 'CR082 070: expected 3 named constraints in %, found %', current_schema(), n_checks;
  END IF;

  RAISE NOTICE 'CR082 070: 4 tables + 3 named constraints present in %', current_schema();
END $$;

COMMIT;

-- Rollback:
--   DROP TABLE IF EXISTS tax_fbar_filing_lines;
--   DROP TABLE IF EXISTS tax_fbar_filings;
--   DROP TABLE IF EXISTS tax_fx_rates;
--   DROP TABLE IF EXISTS tax_foreign_accounts;
