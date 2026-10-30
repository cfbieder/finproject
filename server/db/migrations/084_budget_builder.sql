-- 084 — CR098: the budget builder.
--
-- WHAT. Next year's budget is built from the current year's latest finalised Latest Estimate
-- (CR083): a per-category policy (Recurring / One-off / Fixed), the forecast's inflation and FX,
-- an account and month split from the last 12 actual months, then a previewed Publish that
-- replaces the target year's budget_entries and can be undone or restored.
--
-- WHY SIX TABLES.
--   budget_category_policy — what the owner decided per category; REMEMBERED between years, so
--     next year's build starts from it (CR098 decision 2).
--   budget_builds          — one row per build of a year, numbered (2027 v1, v2 …); at most one
--     draft per year (partial unique index) and its publish state.
--   budget_build_lines     — the build's annual figure per (category, currency): the LE's full
--     year, the policy applied, the result.
--   budget_build_publishes — one row per publish or restore, never deleted. Publishes STACK
--     (v1, then v2, then restore v1), so the snapshot belongs to the event, not the build: keyed
--     by build, a restore overwrote the only copy of the pre-builder budget. Un-publish undoes
--     the newest live event and hands "live" back to the build of the one before it.
--   budget_build_snapshot  — the budget_entries / budget_fx_rates rows a publish replaced,
--     verbatim, so un-publish restores them exactly (ids, versions, timestamps).
--   budget_build_cells     — what a publish wrote, so Restore re-publishes it exactly; recomputing
--     would not be, because the actuals window moves under a late recategorisation.
--
-- Statuses and policies are VARCHAR + CHECK, not Postgres enums (the migration-070 rule).
-- Additive: six new tables, nothing existing altered, no row written.
--
-- Rollback (manual — the runner is forward-only), only while no build has been published:
--   DROP TABLE IF EXISTS budget_build_cells, budget_build_snapshot, budget_build_publishes,
--     budget_build_lines, budget_builds, budget_category_policy;

CREATE TABLE IF NOT EXISTS budget_category_policy (
    category_id            INTEGER      PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    policy                 VARCHAR(12)  NOT NULL DEFAULT 'recurring'
                           CONSTRAINT bcp_policy_chk CHECK (policy IN ('recurring', 'one_off', 'fixed')),
    inflation_override_pct NUMERIC(7,3),
    split_override         VARCHAR(8)   NOT NULL DEFAULT 'auto'
                           CONSTRAINT bcp_split_chk CHECK (split_override IN ('auto', 'even', 'month')),
    split_month            SMALLINT
                           CONSTRAINT bcp_split_month_chk CHECK (split_month BETWEEN 1 AND 12),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT bcp_month_needs_month CHECK (split_override <> 'month' OR split_month IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS budget_builds (
    id                  SERIAL       PRIMARY KEY,
    target_year         INTEGER      NOT NULL,
    build_no            INTEGER      NOT NULL,
    source_le_id        INTEGER      NOT NULL REFERENCES budget_le(id),
    scenario_name       VARCHAR(200) NOT NULL,
    status              VARCHAR(12)  NOT NULL DEFAULT 'draft'
                        CONSTRAINT bb_status_chk CHECK (status IN ('draft', 'published', 'superseded', 'unpublished')),
    parent_build_id     INTEGER      REFERENCES budget_builds(id),
    note                TEXT,
    published_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT bb_year_no_uniq UNIQUE (target_year, build_no)
);
-- One open draft per year, and at most one live publish per year.
CREATE UNIQUE INDEX IF NOT EXISTS bb_one_draft_per_year
    ON budget_builds (target_year) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS bb_one_published_per_year
    ON budget_builds (target_year) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS budget_build_lines (
    id              SERIAL        PRIMARY KEY,
    build_id        INTEGER       NOT NULL REFERENCES budget_builds(id) ON DELETE CASCADE,
    category_id     INTEGER       NOT NULL REFERENCES accounts(id),
    currency        CHAR(3)       NOT NULL,
    le_fy           NUMERIC(15,2) NOT NULL DEFAULT 0,
    policy          VARCHAR(12)   NOT NULL
                    CONSTRAINT bbl_policy_chk CHECK (policy IN ('recurring', 'one_off', 'fixed')),
    fixed_amount    NUMERIC(15,2),
    inflation_pct   NUMERIC(7,3),
    annual_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
    split_method    VARCHAR(8)    NOT NULL DEFAULT 'auto'
                    CONSTRAINT bbl_split_chk CHECK (split_method IN ('auto', 'even', 'month')),
    split_month     SMALLINT      CONSTRAINT bbl_split_month_chk CHECK (split_month BETWEEN 1 AND 12),
    CONSTRAINT bbl_line_uniq UNIQUE (build_id, category_id, currency)
);

-- No ON DELETE CASCADE from builds: only drafts are deletable and a draft has no publish.
CREATE TABLE IF NOT EXISTS budget_build_publishes (
    id                  SERIAL       PRIMARY KEY,
    build_id            INTEGER      NOT NULL REFERENCES budget_builds(id),
    target_year         INTEGER      NOT NULL,
    created_version_id  INTEGER      REFERENCES budget_versions(id),  -- the "Built" version, if this publish made it
    checksum_after      TEXT,                                          -- the year as this publish left it
    published_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    undone_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bbp_year_live ON budget_build_publishes (target_year, id) WHERE undone_at IS NULL;

CREATE TABLE IF NOT EXISTS budget_build_snapshot (
    id          BIGSERIAL   PRIMARY KEY,
    publish_id  INTEGER     NOT NULL REFERENCES budget_build_publishes(id) ON DELETE CASCADE,
    kind        VARCHAR(8)  NOT NULL CONSTRAINT bbs_kind_chk CHECK (kind IN ('entry', 'fx_rate')),
    row_data    JSONB       NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bbs_publish ON budget_build_snapshot (publish_id);

CREATE TABLE IF NOT EXISTS budget_build_cells (
    id           BIGSERIAL     PRIMARY KEY,
    build_id     INTEGER       NOT NULL REFERENCES budget_builds(id) ON DELETE CASCADE,
    category_id  INTEGER       NOT NULL REFERENCES accounts(id),
    account_id   INTEGER       REFERENCES accounts(id),
    currency     CHAR(3)       NOT NULL,
    month        SMALLINT      NOT NULL CONSTRAINT bbc_month_chk CHECK (month BETWEEN 1 AND 12),
    amount       NUMERIC(15,2) NOT NULL,
    base_amount  NUMERIC(15,2) NOT NULL,
    fx_rate      NUMERIC(15,6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bbc_build ON budget_build_cells (build_id);
