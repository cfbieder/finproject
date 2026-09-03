-- ---------------------------------------------------------------------------
-- 075_investment_positions.sql — CR061 P1. The tables that hold what we OWN,
-- and the classification that decides what an instrument IS before anything
-- tries to price it.
--
-- ADDITIVE for every existing row, and inert by construction: it creates three
-- tables and adds four nullable columns to `securities`, which is **0 rows on
-- dev and prod** (verified 2026-09-02 — the whole CR019 investment schema has
-- never held a row). Reversal is `DROP TABLE security_positions,
-- security_position_snapshots, security_quotes;` plus dropping the four columns.
--
-- ── What it fixes ──
--
-- `securities`, `security_lots`, `security_prices` and three more have been
-- empty since May 2026, which is why CR056 derives investment returns from
-- ledger postings, CR058 rebuilds brokerage history from Quicken, and CR020 is
-- still a skeleton. bank-feed now serves per-position daily snapshots
-- (`GET /v1/holdings`, its migration 008); this is where they land.
--
-- ── Five shapes that are deliberate ─────────────────────────────────────────
--
-- 1. A SNAPSHOT HEADER, not just position rows. The Investments page (CR090)
--    reconciles `custodian balance − Σ positions` per account, and both halves
--    must come from ONE capture. Measured: paired across two fetches the
--    residuals were $10.00 wide; captured together, $0.50. `status` then makes
--    "we looked and found nothing" ('empty'), "upstream has no such day"
--    ('absent' — anything before 2026-07-04), and "the fetch broke" ('partial')
--    three different answers instead of one indistinguishable absence of rows.
--
-- 2. TWO DATES, and the second one is usually NULL. `polled_on` is when the
--    custodian was asked. `valued_on` is when the values were TRUE — and
--    ⚠️ **nothing upstream states it**: the 2026-09-02 snapshot carries Monday
--    08-31's closing prices, and asking for the snapshot dated 08-31 returns
--    Friday 08-28's (CR089). So `valued_on` ships nullable and mostly null, to
--    be filled only by a detector that has been proven to separate. A consumer
--    must NEVER silently fall back to `polled_on` — CR090 renders "polled",
--    not "valued", when it is null. A nullable column read with a silent
--    fallback is the same defect wearing a schema.
--
-- 3. QUOTES ARE NOT CLOSES, so they get their own table. `security_prices`
--    (022) is UNIQUE(security_id, price_date) with a single `close`; an
--    intraday quote and a custodian snapshot price both dated today would
--    collide there and last-writer-wins with no timestamp to tell them apart,
--    making the price history unauditable. `security_prices` stays end-of-day.
--
-- 4. `asset_class` LOSES ITS DEFAULT. It was `NOT NULL DEFAULT 'stock'`, so an
--    unclassified CUSIP inserted without an explicit class silently became a
--    stock — and a stock is quote-eligible. That is the path by which a
--    100,000-face bond gets priced at an equity's $250 and books $25,000,000.
--    The vocabulary also gains `mutual_fund`: the live portfolio holds $147,988
--    of FCNTX, which the old set could not express at all.
--
-- 5. `price_basis` / `quantity_unit` live on the SECURITY, not the position,
--    because they are properties of the instrument. Three conventions share the
--    same two columns upstream: an equity is shares × dollars-per-share, a
--    CUSIP bond or brokered CD is FACE VALUE × a FRACTION OF PAR
--    (100000 × 0.9989 = 99,890), and a money-market fund is shares at par.
--    `value = quantity × price` is the only arithmetic true of all three.
--
-- ── Why no configuration here ──
--
-- No account is enrolled, no flag is flipped, no classification is seeded by
-- this file. Per-install values are set through the app, not SQL — the
-- reasoning that withdrew migration 068. The 95 live positions are classified
-- by a seeding script that a human runs and can inspect.

-- ---- securities: classification it can be trusted on -----------------------

ALTER TABLE securities ALTER COLUMN asset_class DROP DEFAULT;

ALTER TABLE securities ADD COLUMN IF NOT EXISTS price_basis          VARCHAR(12);
ALTER TABLE securities ADD COLUMN IF NOT EXISTS quantity_unit        VARCHAR(12);
ALTER TABLE securities ADD COLUMN IF NOT EXISTS classification_source VARCHAR(10);
-- The symbol the QUOTE feed knows, which is not always the custodian's.
-- Measured: the custodian says `BRKB`; the quote endpoint returns empty for
-- `BRKB` and 502.43 for `BRK.B` — $25,202 a naive lookup drops SILENTLY, and a
-- missing quote looks exactly like a market that did not move. NULL means "no
-- quote symbol established", which is the correct starting state for every row:
-- quotability is EARNED by an observed quote, never inferred from symbol shape.
ALTER TABLE securities ADD COLUMN IF NOT EXISTS quote_symbol         VARCHAR(32);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'securities_asset_class_chk') THEN
    ALTER TABLE securities ADD CONSTRAINT securities_asset_class_chk
      CHECK (asset_class IN ('equity','etf','mutual_fund','mmf','bond','cash','option','unknown','stock','mf','misc'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'securities_price_basis_chk') THEN
    ALTER TABLE securities ADD CONSTRAINT securities_price_basis_chk
      CHECK (price_basis IS NULL OR price_basis IN ('per_share','per_1_face','par'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'securities_quantity_unit_chk') THEN
    ALTER TABLE securities ADD CONSTRAINT securities_quantity_unit_chk
      CHECK (quantity_unit IS NULL OR quantity_unit IN ('shares','face','contracts'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'securities_classification_source_chk') THEN
    ALTER TABLE securities ADD CONSTRAINT securities_classification_source_chk
      CHECK (classification_source IS NULL OR classification_source IN ('inferred','manual'));
  END IF;
END $$;

-- ⚠️ The legacy values ('stock','mf','misc') stay in the CHECK deliberately.
-- CR019 owns this table, is IN-PROGRESS, and its Quicken promote maps
-- `quicken_type` onto them; removing them would break a CR this one has no
-- business breaking. New writers use the new vocabulary — see CR061 §6.4/§6.5.

COMMENT ON COLUMN securities.asset_class IS
  'equity|etf|mutual_fund|mmf|bond|cash|option|unknown (CR061); stock|mf|misc are CR019 legacy. NO DEFAULT: an unclassified row must not become a quote-eligible stock.';
COMMENT ON COLUMN securities.quote_symbol IS
  'Symbol the quote feed knows (custodian BRKB -> BRK.B). NULL until a quote has been observed: quotability is earned, not inferred.';

-- ---- security_position_snapshots -------------------------------------------

CREATE TABLE IF NOT EXISTS security_position_snapshots (
    id                 SERIAL PRIMARY KEY,
    account_id         INTEGER      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    feed_account_id    VARCHAR(200),            -- upstream account id; 200 to match bank-feed
    polled_on          DATE         NOT NULL,   -- when the custodian was asked. NOT a valuation date.
    valued_on          DATE,                    -- when the values were true. Usually NULL — see note 2.
    source             VARCHAR(20)  NOT NULL,   -- 'bank-feed' | 'statement' | 'manual'
    status             VARCHAR(10)  NOT NULL,   -- fetched | empty | absent | partial
    custodian_balance  DECIMAL(18,4),
    positions_count    INTEGER      NOT NULL DEFAULT 0,
    sum_market_value   DECIMAL(18,4),
    fetched_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    raw                JSONB,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, polled_on, source),
    CONSTRAINT sps_status_chk CHECK (status IN ('fetched','empty','absent','partial'))
);
CREATE INDEX IF NOT EXISTS idx_sps_account_polled ON security_position_snapshots(account_id, polled_on DESC);
CREATE INDEX IF NOT EXISTS idx_sps_valued ON security_position_snapshots(valued_on) WHERE valued_on IS NOT NULL;

-- ---- security_positions ----------------------------------------------------
--
-- ⚠️ Deliberately NOT `security_lots`. That table requires `acquired_date
-- NOT NULL` and `cost_per_share NOT NULL`; a daily snapshot has neither, and
-- writing snapshots there would fabricate an acquisition date and a per-share
-- cost in three different units — poisoning CR020's lot model permanently.
--
-- ⚠️ UNIQUE (snapshot_id, security_id) is a REJECTION, not a dedupe. Keeping one
-- of a duplicated pair would make Σ positions under-count, and CR090's residual
-- row would absorb the difference as "not reported by the feed" — the one number
-- that row exists to make legible.
CREATE TABLE IF NOT EXISTS security_positions (
    id             SERIAL PRIMARY KEY,
    snapshot_id    INTEGER       NOT NULL REFERENCES security_position_snapshots(id) ON DELETE CASCADE,
    account_id     INTEGER       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    security_id    INTEGER       NOT NULL REFERENCES securities(id),
    quantity       NUMERIC(24,8) NOT NULL,
    price          NUMERIC(20,8),
    price_basis    VARCHAR(12),              -- copied from the security AS AT this snapshot
    price_source   VARCHAR(12)   NOT NULL DEFAULT 'custodian',
    price_asof     TIMESTAMPTZ,
    market_value   DECIMAL(18,4),
    cost_basis     DECIMAL(18,4),            -- POSITION TOTAL, never per share
    currency       CHAR(3),
    raw            JSONB,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (snapshot_id, security_id),
    CONSTRAINT sp_price_source_chk
      CHECK (price_source IN ('custodian','close','quote','par','manual','none'))
);
CREATE INDEX IF NOT EXISTS idx_sp_account   ON security_positions(account_id);
CREATE INDEX IF NOT EXISTS idx_sp_security  ON security_positions(security_id);
CREATE INDEX IF NOT EXISTS idx_sp_snapshot  ON security_positions(snapshot_id);

-- ---- security_quotes -------------------------------------------------------
--
-- Intraday quotes, kept apart from `security_prices` (note 3). Retention is a
-- consumer concern, not a schema one: keep the latest per security plus a short
-- window. A per-render fetch with no retention rule is unbounded growth for data
-- with no audit value.
CREATE TABLE IF NOT EXISTS security_quotes (
    id           SERIAL PRIMARY KEY,
    security_id  INTEGER       NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
    quoted_at    TIMESTAMPTZ   NOT NULL,     -- when the price was TRUE (feed's as_of)
    price        NUMERIC(20,8) NOT NULL,
    currency     CHAR(3)       NOT NULL DEFAULT 'USD',
    source       VARCHAR(20)   NOT NULL,     -- 'fintable'
    venue        VARCHAR(20),                -- 'iex' — one exchange, not the consolidated tape
    fetched_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (security_id, quoted_at, source)
);
CREATE INDEX IF NOT EXISTS idx_sq_security_time ON security_quotes(security_id, quoted_at DESC);

-- Post-condition: structural only. Never a row count — these tables are empty by
-- definition here, and a row-count assertion is vacuous on a fresh CI database
-- (known issue #12, three incidents).
DO $$
BEGIN
  IF to_regclass('public.security_position_snapshots') IS NULL THEN
    RAISE EXCEPTION '075: security_position_snapshots missing';
  END IF;
  IF to_regclass('public.security_positions') IS NULL THEN
    RAISE EXCEPTION '075: security_positions missing';
  END IF;
  IF to_regclass('public.security_quotes') IS NULL THEN
    RAISE EXCEPTION '075: security_quotes missing';
  END IF;
  -- The whole point of the migration: an unclassified insert must FAIL rather
  -- than quietly become a quote-eligible stock.
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
      JOIN pg_class t ON t.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = 'public' AND t.relname = 'securities' AND a.attname = 'asset_class'
  ) THEN
    RAISE EXCEPTION '075: securities.asset_class still has a DEFAULT — an unclassified row would become a stock';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'securities_asset_class_chk') THEN
    RAISE EXCEPTION '075: securities_asset_class_chk missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sps_status_chk') THEN
    RAISE EXCEPTION '075: sps_status_chk missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sp_price_source_chk') THEN
    RAISE EXCEPTION '075: sp_price_source_chk missing';
  END IF;
END $$;
