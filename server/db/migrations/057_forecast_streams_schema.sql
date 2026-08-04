-- 057_forecast_streams_schema.sql
--
-- CR069 P1 — the stream schema, INERT.
--
-- Creates the two tables and the one column that CR069's model needs, and stops there.
-- Nothing in the application reads or writes any of them at this phase: no loader, no
-- builder, no route, no variant sync. A forecast generated the minute after this migration
-- is byte-identical to one generated the minute before, because the engine cannot see any
-- of it. That is the whole point of shipping the schema on its own — the risky phase (P2)
-- then carries only code and a backfill, with the schema already proven to apply cleanly on
-- both databases.
--
-- WHY THE BACKFILL IS NOT HERE. Nothing dual-writes these tables, so a backfill landing now
-- would go stale on the first module edit, the first `syncVariant`, the first auto-adjust
-- apply or the first `copyScenario` — and P2 would then cut the engine over to data that
-- stopped being true days earlier: wrong numbers, no error. The backfill rides P2's own
-- deploy, atomically with the cutover. (CR069 phase table; this was a blocker at technical
-- review.)
--
-- THE MODEL. A module becomes: identity + optional valuation + zero-or-more P&L STREAMS.
-- A stream is one money flow — direction, the FC line it posts to, how its amount is
-- generated, its schedule of changes, its window, its tax. Today the same concept exists
-- three times with three different feature sets (fcbuilder-incexp's items, a module's
-- income, a module's expense), which is why `forecast_module_income_steps` (migration 055)
-- is a re-implementation of the Fixed $ change `forecast_incexp_changes` has had since
-- migration 001. One table ends that.
--
-- ---------------------------------------------------------------------------
-- OBLIGATIONS THIS MIGRATION HANDS TO P2 (surfaced at migration review; recorded here
-- because this is the file P2's author will read, and it is append-only)
-- ---------------------------------------------------------------------------
--  a. `forecast_stream_changes` is this schema's first GRANDCHILD (module → stream →
--     change), and CR050 variant sync cannot express one. Every entry in
--     `SCHEDULE_TABLES` (forecastVariants.js:39-52) hangs one level off the parent's id,
--     and `replaceSchedule` (:665) DELETEs by that fk — so replacing a module's streams
--     cascades every change row away with no mechanism to recreate them. `forecast_streams`
--     also has neither `scenario_id` nor `origin_base_id`, so it cannot go through
--     `syncEntity` either. The one workable route is to nest the change rows inside each
--     stream object in the module's JSON patch and teach `replaceSchedule` to recurse.
--     This is the largest unbudgeted item in P2; the CR's §6.3 reads like a flat rename.
--  b. `copyScenario` (repositories/forecast.js:301-330) has a HAND-MAINTAINED column list
--     that does not include `has_valuation`. Harmless today — the copy takes DEFAULT TRUE,
--     which equals the source — and silently catastrophic the moment P2 writes FALSE: every
--     copied flow module would come back a balance-sheet module, tripping CR041's ownership
--     gate and zeroing all of its streams. P2 must add the column to that list AND run
--     `ALTER TABLE forecast_modules ALTER COLUMN has_valuation DROP DEFAULT;` so the next
--     omission fails loud instead of defaulting to a lie. (That comment block names CR045 §1
--     and CR048 as the two times this list already lost a column.)
--  c. `fc_line_id` here is ON DELETE RESTRICT, where `forecast_modules.expense_fc_line_id`
--     and `income_fc_line_id` are ON DELETE SET NULL. Deliberate — SET NULL is exactly how a
--     module becomes the line-less "charges cash, appears on no P&L row" case described at
--     the `fc_line_id` column below — but it is a behaviour CHANGE: after P2, deleting an
--     `fc_line` a stream references returns 23503 where it used to succeed silently. The
--     delete path (repositories/fcLines.js:150) needs a sentence, not a stack trace.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Streams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forecast_streams (
  id                SERIAL PRIMARY KEY,
  module_id         INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,

  -- The sign is carried by the DIRECTION, not by the amount: `amount` is a magnitude
  -- (CHECK below), which is the module convention. Note this does NOT extend to the change
  -- rows — see the table comment on forecast_stream_changes.
  direction         VARCHAR(10) NOT NULL CHECK (direction IN ('income', 'expense')),

  -- Nullable, deliberately and reluctantly. A stream with no line posts to no P&L row while
  -- its cash still moves — the hazard CR062 named for loans and guarded with
  -- `assertLoanHasInterestLine`. Five prod modules are in exactly that state today
  -- (all five named `Sarasota House`, expense_amount 45,000, expense_fc_line_id NULL), and
  -- one of them BUILDS: `2026 SRQ House Purchase` charges −1,203,432 to Bank Accounts over
  -- 21 years with no expense row anywhere. NOT NULL here would therefore refuse a backfill
  -- of live data, so the constraint cannot be imposed until P2 decides what those rows mean.
  -- Recorded in CR069 §6.1 as a P2 decision, not silently inherited.
  fc_line_id        INTEGER REFERENCES fc_lines(id) ON DELETE RESTRICT,

  -- How the amount is produced:
  --   amount        base-year `amount` × (growth_mult × inflation), plus the change schedule
  --   yield         (inflation + Spread %) on average market value   [needs a valuation]
  --   pct_of_value  a derived % of average market value             [needs a valuation]
  --   derived       engine-owned; today only a loan's interest, read off the balance path
  mode              VARCHAR(15) NOT NULL DEFAULT 'amount'
                      CHECK (mode IN ('amount', 'yield', 'pct_of_value', 'derived')),

  amount            NUMERIC(15,2),   -- base-year, in the MODULE's currency
  amount_usd        NUMERIC(15,2),   -- CR051 twin, derived server-side on write; NULL is legal
  growth_mult       NUMERIC(10,4),   -- × inflation. NULL = 1 = plain inflation (the old behaviour)
  start_date        DATE,            -- CR046 window; stored as July 1, half-year convention
  end_date          DATE,
  tax_rate_override NUMERIC(8,4),    -- CR047 chain. NULL = fall back; 0 is a real rate

  -- BOTH halves, not just the local one. CR069 §6.2 prescribes `amount_usd` as a copy of
  -- `base_value_usd` — and the two source populations use OPPOSITE sign conventions:
  -- `forecast_income_expense.base_value`/`base_value_usd` store an expense NEGATIVE (33 of 48
  -- rows), while `forecast_modules.expense_amount` stores it POSITIVE (30 of 30). Constraining
  -- only `amount` would force the backfill to abs() the local column loudly while a negative
  -- twin slipped into `amount_usd` beside it, unchecked, on every one of those 33 rows. A
  -- one-sided magnitude rule is worse than none: it makes the constrained half look verified.
  -- So P2 takes ABS() into both, and both are enforced here.
  CONSTRAINT fc_stream_amount_is_magnitude
    CHECK ((amount IS NULL OR amount >= 0) AND (amount_usd IS NULL OR amount_usd >= 0)),

  -- No path in the engine taxes an expense — both builders tax positive values only — so an
  -- expense-side tax field would be a control that does nothing, which is the stale-field
  -- class CR064 §5 exists to avoid.
  CONSTRAINT fc_stream_tax_is_income_only CHECK (direction = 'income' OR tax_rate_override IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_fc_streams_module ON forecast_streams(module_id);
CREATE INDEX IF NOT EXISTS idx_fc_streams_line   ON forecast_streams(fc_line_id);

-- CR069 Decision 3: "two streams" must always mean "two LINES", because the convergence loop
-- updates income by (module, account) key and would otherwise apply one delta to two rows.
--
-- This needs TWO indexes, not the one the CR drafted. A plain
-- UNIQUE (module_id, direction, fc_line_id) does not constrain rows whose fc_line_id is NULL:
-- NULLs are distinct in a Postgres unique index, so any number of line-less streams on one
-- module would be accepted. That is the identical trap CR069 P0 just finished paying for —
-- `forecast_entries`' UNIQUE ends in a never-written `entry_type`, so its ON CONFLICT has
-- never once fired and the engine spent years believing it deduplicated. Once is enough.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fc_streams_unique_line
  ON forecast_streams(module_id, direction, fc_line_id)
  WHERE fc_line_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fc_streams_unique_nullline
  ON forecast_streams(module_id, direction)
  WHERE fc_line_id IS NULL;

-- Decision 3 rule (2): AT MOST ONE YIELD STREAM PER MODULE. The CR left this one to the
-- route, and a route is not where this belongs: `copyScenario`, `syncVariant` and the
-- auto-adjust apply all write modules WITHOUT passing through the module route, so a
-- route-only invariant is not on every path. The convergence loop (index.js:739-1068)
-- resolves one yield context per module; a second yield stream would not error there, it
-- would quietly converge against the wrong one. Same lesson as rule (1) above, and as P0.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fc_streams_one_yield
  ON forecast_streams(module_id)
  WHERE mode = 'yield';

-- NOTE FOR P2: these are PARTIAL indexes, and a bare `ON CONFLICT (module_id, direction,
-- fc_line_id)` cannot infer one — the backfill would fail at runtime with "no unique or
-- exclusion constraint matching the ON CONFLICT specification". Either repeat the predicate
-- (`... ON CONFLICT (module_id, direction, fc_line_id) WHERE fc_line_id IS NOT NULL ...`,
-- plus a second statement for the NULL branch), or insert into a table you have just
-- cleared. The backfill is a one-shot conversion, so clearing is the simpler path.

COMMENT ON TABLE forecast_streams IS
  'CR069: one P&L flow belonging to a module. Replaces the module''s income_*/expense_* column pairs and the whole forecast_income_expense table; an Expenditure item is a module with has_valuation=FALSE and one stream.';
COMMENT ON COLUMN forecast_streams.amount IS
  'CR069: base-year magnitude in the module''s currency. Unsigned — forecast_streams.direction carries the sign.';
COMMENT ON COLUMN forecast_streams.growth_mult IS
  'CR069: multiplier of inflation, read like forecast_modules.growth_rate (1 = inflation, 0 = flat nominal, 2 = twice). NULL = 1.';

-- ---------------------------------------------------------------------------
-- 2. The change schedule
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forecast_stream_changes (
  id          SERIAL PRIMARY KEY,
  stream_id   INTEGER NOT NULL REFERENCES forecast_streams(id) ON DELETE CASCADE,
  change_date DATE NOT NULL,

  -- SIGNED. Deliberately no CHECK, and deliberately NOT a magnitude like forecast_streams.amount.
  --
  -- This is the single most dangerous column in CR069 and it has now been written wrongly
  -- twice, in two different ways. Both near-misses are recorded because the P2 author will
  -- read this comment and not the review threads.
  --
  --   FIRST DRAFT: "store magnitudes, let direction supply the sign." That would abs() the
  --   20 POSITIVE `Fixed $` rows sitting on NEGATIVE expense bases — which are REDUCTIONS,
  --   entered as such: `Children` −72,408.98 with +25,000 in 2027 (the kids leave), `Travel`
  --   −84,438.50 with +15,000/+20,000/+30,000 across 2036/2046/2056 (an ageing ramp-down).
  --   Every one would have flipped into an expense INCREASE.
  --
  --   SECOND DRAFT (this file, as first written): "negate expense-direction rows." Correct
  --   for the MONEY flags, and WRONG for `Percent %`, which is a RATE — its sign is a
  --   direction of CHANGE, not a direction of money. `Children` carries −100% in 2032,
  --   meaning "this expense goes to zero"; negated it reads +100% and the expense DOUBLES.
  --   That is 58 of prod's 113 change rows, and NEITHER guard would have caught it: CR069
  --   §6.4 asserts "|amount| preserved AND amount × direction-sign preserved", which a
  --   negated Percent % row satisfies on both counts, and the per-(account, year) sum gate
  --   compares two runs that would both be transformed.
  --
  -- THE RULE, therefore, keyed on the FLAG and not on the direction alone:
  --   Fixed $ / One-Off $  money  → NEGATE for an expense-direction stream. Never abs().
  --   Percent % / Spread % rate   → CARRY THROUGH UNMODIFIED, whatever the direction.
  -- P2 asserts the second half directly: no `Percent %`/`Spread %` row may differ from its
  -- source amount by so much as a sign.
  --
  -- Scale is 4, not 2, so `Spread %` arrives losslessly: it absorbs
  -- forecast_module_income_pct.value, which is NUMERIC(8,4). No live value uses more than
  -- 2dp today (verified: 0 rows), so nothing is gained by narrowing and a future 1.375%
  -- spread would silently become 1.38.
  amount      NUMERIC(15,4) NOT NULL,

  -- Percent %  — overrides the growth rate for THAT YEAR ONLY (amount mode)
  -- Fixed $    — permanent level shift, compounding from its own year (amount mode).
  --              Absorbs migration 055's forecast_module_income_steps: same math.
  -- One-Off $  — that year only; never enters the base (amount mode)
  -- Spread %   — yield spread over inflation, CARRIES FORWARD to later years (yield mode).
  --              Absorbs forecast_module_income_pct.
  --
  -- Percent % and Spread % are both "a percentage on a date" and mean different things —
  -- one applies to a single year, the other persists. They live in one table with one flag
  -- precisely so that difference is written down rather than implied by which table a row
  -- happens to sit in, which is how it is encoded today.
  flag        VARCHAR(20) NOT NULL
                CHECK (flag IN ('Percent %', 'Fixed $', 'One-Off $', 'Spread %'))
);

CREATE INDEX IF NOT EXISTS idx_fc_stream_changes_stream ON forecast_stream_changes(stream_id);

-- A stream cannot carry two changes of the same flag on the same date — that is not a
-- schedule, it is a double-apply. `forecast_incexp_changes` has no such constraint and the
-- source data does not need one (0 duplicate (incexp_id, change_date, flag) keys on prod,
-- verified), but P2's backfill is a single migration that may well be run twice — dev then
-- prod, a retry, a partial failure — and without this a second run silently DOUBLES every
-- schedule. Free to add while the table is empty; impossible to add cleanly once it is not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fc_stream_changes_unique
  ON forecast_stream_changes(stream_id, change_date, flag);

COMMENT ON TABLE forecast_stream_changes IS
  'CR069: dated changes to a stream. Union of forecast_incexp_changes (Percent/Fixed/One-Off) and forecast_module_income_pct (Spread %) and forecast_module_income_steps (= Fixed $).';
COMMENT ON COLUMN forecast_stream_changes.amount IS
  'CR069: SIGNED in the stream''s direction frame (positive = more of the stream). NOT a magnitude — 20 live rows are positive reductions of negative expense bases.';

-- ---------------------------------------------------------------------------
-- 3. "This module has no balance sheet"
-- ---------------------------------------------------------------------------
-- Explicit, never inferred from market_value = 0. That inference is precisely what makes a
-- pure-P&L module inexpressible today: CR041's ownership gate reads a market value that is
-- 0 for the whole horizon as "never owned" (`marketValues.findIndex(v => v !== 0)` → −1) and
-- zeroes every amount-based stream on it. A real asset currently worth nothing and a
-- container that never had a balance sheet are not the same thing, and one boolean is what
-- separates them.
--
-- DEFAULT TRUE is the correct value for every row that exists: all 110 modules today are
-- balance-sheet modules. The flow modules arrive in P2, from forecast_income_expense.
ALTER TABLE forecast_modules ADD COLUMN IF NOT EXISTS has_valuation BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN forecast_modules.has_valuation IS
  'CR069: FALSE = a pure P&L container (a converted Expenditure item) — no valuation, no invest/dispose, and the CR041 ownership gate does not apply. TRUE for every pre-CR069 module.';

-- ---------------------------------------------------------------------------
-- 4. Post-conditions — STRUCTURAL ONLY
-- ---------------------------------------------------------------------------
-- Asserting anything about ROW COUNTS here would abort the chain on a data-free database,
-- which is the defect shipped in 046, 050 and 052 and the reason CI was red on `main` for
-- days (roadmap Known Issue #12, three incidents). This migration creates empty tables, so
-- the only thing worth asserting is that the objects exist and carry the constraints that
-- give them their meaning — every check below is true of an empty database and of a
-- production one alike.
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema = current_schema() AND table_name IN ('forecast_streams', 'forecast_stream_changes');
  IF n <> 2 THEN
    RAISE EXCEPTION 'CR069 P1: expected both stream tables, found %', n;
  END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'forecast_modules' AND column_name = 'has_valuation';
  IF n <> 1 THEN
    RAISE EXCEPTION 'CR069 P1: forecast_modules.has_valuation missing';
  END IF;

  -- Both halves of the uniqueness rule, including the partial index that covers the NULL
  -- fc_line_id case. If a future edit drops that one, "two streams" silently stops meaning
  -- "two lines" and nothing else in the system would notice.
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname = current_schema()
     AND indexname IN ('idx_fc_streams_unique_line', 'idx_fc_streams_unique_nullline',
                       'idx_fc_streams_one_yield', 'idx_fc_stream_changes_unique');
  IF n <> 4 THEN
    RAISE EXCEPTION 'CR069 P1: expected all four stream uniqueness indexes, found %', n;
  END IF;

  -- The two CHECKs that encode decisions rather than types.
  --
  -- SCHEMA-QUALIFIED, like the three assertions above it. `pg_constraint.conname` is unique
  -- per (conrelid, conname), NOT per database — so an unqualified count sees every schema at
  -- once and reads 4 the moment this chain is applied to a second one. CR027 is
  -- schema-per-tenant and lives on `main`, so that day is coming; the failure would be an
  -- EXCEPTION inside this file's own BEGIN…COMMIT, rolling the whole migration back and
  -- blocking every later one. Same shape as the 046/050/052 incidents — an assertion whose
  -- hidden premise is "there is exactly one environment" — with schema count standing in for
  -- row count.
  SELECT count(*) INTO n FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relnamespace = current_schema()::regnamespace
     AND c.conname IN ('fc_stream_amount_is_magnitude', 'fc_stream_tax_is_income_only');
  IF n <> 2 THEN
    RAISE EXCEPTION 'CR069 P1: expected both stream CHECK constraints, found %', n;
  END IF;

  RAISE NOTICE 'CR069 P1: stream schema in place and inert (no reader, no writer, no rows).';
END $$;

COMMIT;
