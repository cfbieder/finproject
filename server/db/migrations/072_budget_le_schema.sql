-- ---------------------------------------------------------------------------
-- 072_budget_le_schema.sql — CR083 P0b. The budget Latest Estimate.
-- SCHEMA ONLY, and inert: zero readers, zero writers until the P0b routes ship.
--
-- Two tables:
--
--   budget_le        one Latest Estimate — a full calendar year, actual months
--                    to a cut plus estimate months for the rest, named LE-MM-YY.
--   budget_le_lines  one row per (LE, category, month, currency).
--
-- ── Why its OWN tables, and not another budget_versions row ──
--
-- `budget_versions` exists and `POST /budget/versions/:id/copy` already accepts
-- an arbitrary budget_year INCLUDING THE SAME ONE, unguarded. So "an LE is just
-- another budget version" is the obvious move, and it silently doubles every
-- budget figure in the app: ELEVEN live functions plus a view read
-- `budget_entries` filtered on budget_year with NO version_id predicate —
-- services/forecast/crud.js:494 (the CR075 forecast base year), four in
-- v2/repositories/fcLines.js, v2/repositories/budget.js findAllExtended /
-- sumByCategory / sumByMonth, services/budget.js:320 and :634, plus
-- v_budget_vs_actual. Only budget.js:327 compareToActual filters by version.
--
-- A doubled base year does not wash out: index.js folds it into startingCash and
-- the sweep pins cash to its band every year, so it rides all 36 years. Nothing
-- outside these two tables changes, so nothing can double-count.
--
-- ── Notes on five choices that look wrong and are not ──
--
-- 1. `currency` is part of the GRAIN, not a label. Measured on 2026 inside the
--    LE scope: 38 budget and 81 actual category-months hold more than one
--    currency, and `Bank Fees` holds three (EUR, PLN, USD) in both 2026-06 and
--    2026-09 — the second of which is in an August cut's ESTIMATE window. One
--    amount/currency/fx_rate per category-month would be right for one slice and
--    silently wrong for the rest. `base_amount` is what the grid sums;
--    amount/currency/fx_rate describe a single slice.
--
-- 2. Both uniques on budget_le_lines are PARTIAL, and that is the opposite of
--    migration 070's case. `category_id` is nullable (an account-level line is a
--    future possibility, see note 3), and Postgres treats every NULL as
--    distinct — so a plain UNIQUE over the nullable column would enforce
--    NOTHING on the other branch and accept unlimited duplicates. 070 needed
--    NULLs distinct; here they must not be. Do not "simplify" these into one
--    table constraint.
--
-- 3. `account_id` exists but P0b never writes it. The CR's open question — are
--    the 72 uncategorised budget rows (−86,796/yr) real incremental spend or a
--    leftover plug? — was answered "plug, excluded" on the evidence that all 72
--    date from the 2026-01-29 import with none added since, while 131 itemised
--    categorised rows were added on top of them. If that is ever revisited, the
--    LE needs account-level lines. Shipping the column now makes that a
--    classifier branch instead of a migration.
--
-- 4. `method` lists TRAIL_3, which is a P1 method with no P0b writer. Listing it
--    now costs nothing; omitting it would make P1 spend a whole migration
--    widening a CHECK this one could have got right.
--
-- 5. The (budget_year, name) unique is PARTIAL on status <> 'superseded'.
--    `name` is LE-MM-YY derived from actual_through, so two LEs cut in the same
--    month necessarily share it. A total unique makes the supersede path
--    unreachable — the second INSERT raises before the first can be marked. The
--    partial index means supersede + insert must run in ONE transaction, which
--    is what POST /budget/le/:id/recut is for.
--
-- ── What this migration deliberately does NOT do ──
--
-- It adds no column to `accounts` and seeds nothing. An earlier draft proposed
-- `accounts.exclude_from_le DEFAULT false` — which, with no writer and no
-- screen, would have meant the LE included `Unrealized G/L` (+213,595 YTD 2026)
-- on day one and landed the year at +44,259 instead of −102,999. The exclusion
-- uses the EXISTING `accounts.is_transfer` (already TRUE on exactly the 13
-- descendants of the Transfers subtree) plus `Unrealized G/L` resolved BY NAME.
-- Configuration inside a migration is what CR080's 065 got wrong and what
-- withdrew 068.
--
-- Fresh-DB safe, order-independent, asserts no production data fact.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS budget_le (
  id                    SERIAL PRIMARY KEY,
  budget_year           INTEGER NOT NULL,
  -- The last day of the last month treated as ACTUAL. The first ESTIMATE month
  -- is actual_through + 1 day, and `name` is LE-<that month>-<YY>.
  actual_through        DATE NOT NULL,
  name                  TEXT NOT NULL,
  label                 TEXT,
  status                TEXT NOT NULL DEFAULT 'draft',
  -- ON DELETE SET NULL: deleting the NEWEST LE of a recut chain (the picker's
  -- Delete action) would otherwise raise a raw FK error the route surfaces as a
  -- 500. budget_le_lines cascades; this self-reference needs its own answer.
  superseded_by         INTEGER REFERENCES budget_le(id) ON DELETE SET NULL,
  -- The resolved scope, snapshotted. `is_transfer` is a live flag with no
  -- history, so an LE that did not record which categories it excluded would
  -- stop describing its own total the moment the flag moved.
  excluded_category_ids INTEGER[] NOT NULL DEFAULT '{}',
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT budget_le_status_chk
    CHECK (status IN ('draft', 'final', 'superseded')),

  -- No January LE: with zero closed months an LE IS the budget, byte for byte,
  -- and creating one manufactures a second copy for every later reader.
  CONSTRAINT budget_le_not_january_chk
    CHECK (actual_through >= make_date(budget_year, 1, 31)),

  -- No MM=13. NOT `< make_date(budget_year + 1, 1, 1)`, which accepts
  -- 2026-12-31 — whose first estimate month is January of the NEXT year, i.e.
  -- exactly the case this constraint is named for.
  CONSTRAINT budget_le_not_month_13_chk
    CHECK (actual_through < make_date(budget_year, 12, 1)),

  -- actual_through must be a month END, or "the first estimate month" is
  -- undefined and so is the name. Without this, 2026-08-15 is accepted.
  CONSTRAINT budget_le_month_end_chk
    -- ::timestamp, NOT the timestamptz overload -- Postgres does not enforce
    -- immutability inside a CHECK, so the STABLE version binds silently and the
    -- expression then cannot be reused in an index or generated column. (It is
    -- hygiene, not a live bug: across 216 month-ends x 10 timezones including
    -- the midnight-DST cases the two forms never disagree.)
    CHECK (actual_through =
      (date_trunc('month', actual_through::timestamp) + INTERVAL '1 month - 1 day')::date),

  CONSTRAINT budget_le_not_self_superseded_chk
    CHECK (superseded_by IS NULL OR superseded_by <> id),

  -- status and superseded_by are two records of one fact -- the picker filters on
  -- status, the audit chain follows superseded_by -- so keep them agreeing. The
  -- loose direction only: a row may be 'superseded' before its replacement id is
  -- known (the recut transaction sets status first), but a pointer without the
  -- status would strand a live LE inside a chain.
  CONSTRAINT budget_le_superseded_agree_chk
    CHECK (superseded_by IS NULL OR status = 'superseded')
);

CREATE TABLE IF NOT EXISTS budget_le_lines (
  id                 BIGSERIAL PRIMARY KEY,
  le_id              INTEGER NOT NULL REFERENCES budget_le(id) ON DELETE CASCADE,
  period_month       DATE NOT NULL,

  -- Exactly one dimension is set. P0b writes category rows only.
  category_id        INTEGER REFERENCES accounts(id),
  account_id         INTEGER REFERENCES accounts(id),

  currency           CHAR(3) NOT NULL,
  source             TEXT NOT NULL,
  method             TEXT NOT NULL,
  -- The advisory's own operands, e.g. {"r":1.466875,"budget_ytd":25999.86,
  -- "actual_ytd":38138.55}. Kept so a row can be re-derived rather than
  -- paraphrased — a restatement asserted as the engine's behaviour is this
  -- project's most-repeated failure.
  method_input       JSONB,

  amount             NUMERIC(15,2) NOT NULL,
  base_amount        NUMERIC(15,2) NOT NULL,
  fx_rate            NUMERIC,
  fx_basis           TEXT,

  -- Actual months only; NULL on estimate rows. These are what drift is measured
  -- against: a finalised LE freezes its actuals, and July gained 85 rows /
  -- +$663.82 in the first 16 days of August, so a pure freeze would be quietly
  -- wrong and a live re-read would not be a Latest Estimate at all.
  snapshot_row_count INTEGER,
  snapshot_sum       NUMERIC(15,2),

  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT budget_le_lines_one_dimension_chk
    CHECK ((category_id IS NULL) <> (account_id IS NULL)),

  CONSTRAINT budget_le_lines_month_start_chk
    CHECK (EXTRACT(DAY FROM period_month) = 1),

  CONSTRAINT budget_le_lines_source_chk
    CHECK (source IN ('actual', 'budget_carry', 'manual')),

  CONSTRAINT budget_le_lines_method_chk
    CHECK (method IN ('ACTUAL', 'CARRY', 'PHASE_TO_YTD', 'TRAIL_3', 'ZERO', 'MANUAL')),

  CONSTRAINT budget_le_lines_fx_basis_chk
    CHECK (fx_basis IS NULL OR fx_basis IN ('budget', 'transaction', 'spot', 'manual')),

  -- Snapshot columns belong to actual rows and nowhere else.
  CONSTRAINT budget_le_lines_snapshot_only_on_actual_chk
    CHECK (source = 'actual'
           OR (snapshot_row_count IS NULL AND snapshot_sum IS NULL))
);

-- See note 2: PARTIAL, because category_id is nullable and Postgres treats
-- every NULL as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS budget_le_lines_category_grain_uniq
  ON budget_le_lines (le_id, category_id, period_month, currency)
  WHERE category_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS budget_le_lines_account_grain_uniq
  ON budget_le_lines (le_id, account_id, period_month, currency)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS budget_le_lines_le_month_idx
  ON budget_le_lines (le_id, period_month);

-- ⚠️ THE ONE THAT MEANS SOMETHING. §6: "the name is a LABEL; the identity is
-- (budget_year, actual_through, created_at). Never key anything on the string."
-- An earlier draft of this migration enforced uniqueness ONLY on `name`, which is
-- keying on the label — and review demonstrated the hole: 'LE-08-26 ' (trailing
-- space), 'le-08-26' (case), and an LE named 'LE-08-26' whose actual_through is
-- 2026-02-28 were all accepted, leaving TWO live LEs on one cut. The §6 supersede
-- rule then held only for as long as the name generator stayed byte-deterministic.
-- actual_through is already pinned to a month end above, so within a month it is
-- uniquely determined: this index enforces the same rule without trusting a string.
CREATE UNIQUE INDEX IF NOT EXISTS budget_le_year_cut_uniq
  ON budget_le (budget_year, actual_through)
  WHERE status <> 'superseded';

-- Kept as well, so the label a human reads is also unique. See note 5: partial,
-- or the supersede path is unreachable.
CREATE UNIQUE INDEX IF NOT EXISTS budget_le_year_name_uniq
  ON budget_le (budget_year, name)
  WHERE status <> 'superseded';

-- The picker: newest live LE per year. created_at is the tie-breaker §6's identity
-- tuple names and the first draft omitted -- a recut shares its predecessor's
-- actual_through exactly, so the cut alone does not order a chain.
CREATE INDEX IF NOT EXISTS budget_le_picker_idx
  ON budget_le (budget_year, actual_through DESC, created_at DESC)
  WHERE status <> 'superseded';

COMMIT;

-- ── One invariant this schema CANNOT express, so P0b's routes must ──
--
-- Nothing ties budget_le_lines.period_month to its LE's budget_year: a 2031 line
-- on a 2026 LE inserts happily, because a CHECK cannot reach across tables and
-- this repo has exactly one non-internal trigger in the whole database. An LE is
-- "a full calendar year" by definition, so POST /budget/le and
-- PATCH /budget/le/:id/lines own that gate. Same for the two other cross-table
-- rules: a finalised LE is immutable, and a finalised LE's actual rows must carry
-- their snapshot. All three rest on route discipline -- which is worth saying out
-- loud in a CR whose own §4.2 is about calibrate() rewriting history unaudited.

-- Rollback (manual — the runner is forward-only):
--   DROP TABLE IF EXISTS budget_le_lines;
--   DROP TABLE IF EXISTS budget_le;
