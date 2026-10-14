-- 083 — CR097 P1a: a holdings register for manually valued accounts.
--
-- WHAT. A non-fed balance-sheet account (specimen: Misc Investments, $4,875 of crowdfunded
-- private holdings, mostly GBP) can carry a list of holdings. Each dated valuation writes a
-- CR061 position snapshot (source = 'manual'), sets the account's manual_balances row, and
-- CR033's mtm books the difference to Unrealized G/L on the valuation date.
--
-- WHY A TABLE AND NOT JUST SNAPSHOTS. A snapshot records what something was WORTH on a day;
-- the register records what it IS between valuations — platform, kind, status, and above all
-- COST, in both the holding's currency and the account's (the dollars actually sent, fees
-- included, can differ from cost_local × the rate that day). Cost lives on no snapshot row.
--
-- WHY THREE COLUMNS ON security_positions. Every existing row stores price / market_value in
-- the ACCOUNT currency with quantity × price = market_value (075 note 5), and every reader sums
-- market_value as such. A GBP holding in a USD account keeps that meaning intact and carries
-- its own currency's figures beside it: price_local, market_value_local, fx_rate (local →
-- account). NULL on every feed and statement row.
--
-- WHY 'private'. Private-company shares and unconverted subscriptions are a display bucket of
-- their own. asset_class drives labels and exposure buckets only — quote eligibility is gated
-- on price_basis = 'per_share' (marketPrices.js), and register securities carry price_basis
-- NULL. The CHECK is dropped and re-added with the FULL current list, legacy values included.
--
-- Additive: one table, three nullable columns, one boolean defaulting FALSE, a widened CHECK.
-- No row is written; no account is enrolled (that is done in the app).
--
-- Rollback (manual — the runner is forward-only):
--   DROP TABLE IF EXISTS manual_holdings;
--   ALTER TABLE accounts DROP COLUMN IF EXISTS manual_holdings_enabled;
--   ALTER TABLE security_positions DROP CONSTRAINT IF EXISTS sp_fx_rate_pos_chk;
--   ALTER TABLE security_positions DROP COLUMN IF EXISTS price_local,
--     DROP COLUMN IF EXISTS market_value_local, DROP COLUMN IF EXISTS fx_rate;
--   (and re-add securities_asset_class_chk without 'private', once no row uses it)

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS manual_holdings_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS manual_holdings (
    id                SERIAL PRIMARY KEY,
    account_id        INTEGER       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    security_id       INTEGER       NOT NULL REFERENCES securities(id),
    platform          VARCHAR(100),
    kind              VARCHAR(10)   NOT NULL,
    status            VARCHAR(10)   NOT NULL DEFAULT 'active',
    acquired_on       DATE          NOT NULL,
    quantity          NUMERIC(24,8),
    cost_local        DECIMAL(18,4) NOT NULL,
    cost_acct         DECIMAL(18,4) NOT NULL,
    cost_acct_source  VARCHAR(12)   NOT NULL DEFAULT 'fx_default',
    proceeds_acct     DECIMAL(18,4),
    note              TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, security_id),
    CONSTRAINT mh_kind_chk   CHECK (kind IN ('units','amount')),
    CONSTRAINT mh_status_chk CHECK (status IN ('active','exited','failed')),
    CONSTRAINT mh_cost_src_chk CHECK (cost_acct_source IN ('fx_default','entered')),
    -- units carry a quantity; amount-only holdings never do.
    CONSTRAINT mh_quantity_chk CHECK ((kind = 'units') = (quantity IS NOT NULL)),
    -- proceeds only describe an exit.
    CONSTRAINT mh_proceeds_chk CHECK (proceeds_acct IS NULL OR status = 'exited'),
    -- A wrong-signed cost would flow into the purchase rate (cost_acct / cost_local) and
    -- every Unrealized G/L after it. Zero is allowed (bonus shares, a gifted stake).
    CONSTRAINT mh_cost_sign_chk CHECK (cost_local >= 0 AND cost_acct >= 0
                                       AND (proceeds_acct IS NULL OR proceeds_acct >= 0)
                                       AND (quantity IS NULL OR quantity > 0))
);
CREATE INDEX IF NOT EXISTS idx_mh_account ON manual_holdings(account_id);

ALTER TABLE security_positions ADD COLUMN IF NOT EXISTS price_local        NUMERIC(20,8);
ALTER TABLE security_positions ADD COLUMN IF NOT EXISTS market_value_local DECIMAL(18,4);
ALTER TABLE security_positions ADD COLUMN IF NOT EXISTS fx_rate            NUMERIC(20,10);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sp_fx_rate_pos_chk') THEN
    ALTER TABLE security_positions ADD CONSTRAINT sp_fx_rate_pos_chk CHECK (fx_rate IS NULL OR fx_rate > 0);
  END IF;
END $$;

ALTER TABLE securities DROP CONSTRAINT IF EXISTS securities_asset_class_chk;
ALTER TABLE securities ADD CONSTRAINT securities_asset_class_chk
  CHECK (asset_class IN ('equity','etf','mutual_fund','mmf','bond','cash','option','unknown',
                         'private','stock','mf','misc'));

COMMENT ON TABLE manual_holdings IS
  'CR097 holdings register: what a manually valued account holds between valuations, and its cost.';
COMMENT ON COLUMN manual_holdings.cost_acct IS
  'Total cost in the ACCOUNT currency: cost_local × rate(acquired_on) (fx_default) or the amount actually sent (entered).';

-- Post-condition: structural only (known issue #12 — never a row count).
DO $$
BEGIN
  IF to_regclass('public.manual_holdings') IS NULL THEN
    RAISE EXCEPTION '083: manual_holdings missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'accounts'
                    AND column_name = 'manual_holdings_enabled') THEN
    RAISE EXCEPTION '083: accounts.manual_holdings_enabled missing';
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'security_positions'
         AND column_name IN ('price_local', 'market_value_local', 'fx_rate')) <> 3 THEN
    RAISE EXCEPTION '083: security_positions local-currency columns missing';
  END IF;
  -- EXISTS, not a comparison on pg_get_constraintdef: a missing constraint would make
  -- that NULL, and NULL NOT LIKE … is not true — the check would pass on exactly the
  -- failure it exists to catch.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                   JOIN pg_class t ON t.oid = c.conrelid
                   JOIN pg_namespace n ON n.oid = t.relnamespace
                  WHERE n.nspname = 'public' AND t.relname = 'securities'
                    AND c.conname = 'securities_asset_class_chk'
                    AND pg_get_constraintdef(c.oid) LIKE '%''private''%') THEN
    RAISE EXCEPTION '083: securities_asset_class_chk missing or does not admit private';
  END IF;
END $$;
