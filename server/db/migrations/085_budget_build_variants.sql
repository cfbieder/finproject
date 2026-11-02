-- 085 — CR098 rev 3: budget variants (§10).
--
-- WHAT. A year can hold several open drafts, deleting a draft no longer fails when another build
-- was started from it, and a published build keeps the rates it was published at.
--
-- WHY EACH.
--   bb_one_draft_per_year — variants are drafts side by side (V1). bb_one_published_per_year stays:
--     one build is live.
--   parent_build_id ON DELETE SET NULL — a copy holds its own line settings, so it loses only the
--     link to the draft it came from (V2).
--   published_rates — what a stored build displays (inflation and FX with provenance), written at a
--     draft's first publish and never on a restore, so a later rename, delete or rate change cannot
--     stop it opening or move its USD (V7). NULL means published before this migration; the service
--     then derives FX from budget_build_cells.fx_rate.
--   split_weights + 'custom' — a line can be spread by month weights, proportions rather than typed
--     amounts, so no total can disagree with the annual figure (V8). 12 values when set; a custom
--     split must have them. On budget_category_policy too, because they are remembered like the rest.
--
-- Safe before the code deploys: v3.77's own 409 check still allows one draft, and it never reads
-- the new column.
--
-- Rollback (manual — the runner is forward-only). The index cannot return while a year has more
-- than one draft, and v3.77 code breaks on a custom line, so reset those before running it again:
--   ALTER TABLE budget_build_lines DROP CONSTRAINT IF EXISTS bbl_custom_weights_chk;
--   ALTER TABLE budget_category_policy DROP CONSTRAINT IF EXISTS bcp_custom_weights_chk;
--   (and restore bbl_split_chk / bcp_split_chk without 'custom', which fails while a custom row exists)
--   ALTER TABLE budget_build_lines DROP COLUMN IF EXISTS split_weights;
--   ALTER TABLE budget_category_policy DROP COLUMN IF EXISTS split_weights;
--   ALTER TABLE budget_builds DROP COLUMN IF EXISTS published_rates;
--   ALTER TABLE budget_builds DROP CONSTRAINT IF EXISTS budget_builds_parent_build_id_fkey;
--   ALTER TABLE budget_builds ADD CONSTRAINT budget_builds_parent_build_id_fkey
--     FOREIGN KEY (parent_build_id) REFERENCES budget_builds(id);
--   CREATE UNIQUE INDEX IF NOT EXISTS bb_one_draft_per_year
--     ON budget_builds (target_year) WHERE status = 'draft';

DROP INDEX IF EXISTS bb_one_draft_per_year;

ALTER TABLE budget_builds DROP CONSTRAINT IF EXISTS budget_builds_parent_build_id_fkey;
ALTER TABLE budget_builds ADD CONSTRAINT budget_builds_parent_build_id_fkey
    FOREIGN KEY (parent_build_id) REFERENCES budget_builds(id) ON DELETE SET NULL;

ALTER TABLE budget_builds ADD COLUMN IF NOT EXISTS published_rates JSONB;

ALTER TABLE budget_build_lines ADD COLUMN IF NOT EXISTS split_weights NUMERIC(15,2)[];
ALTER TABLE budget_build_lines DROP CONSTRAINT IF EXISTS bbl_split_chk;
ALTER TABLE budget_build_lines ADD CONSTRAINT bbl_split_chk
    CHECK (split_method IN ('auto', 'even', 'month', 'custom'));
ALTER TABLE budget_build_lines DROP CONSTRAINT IF EXISTS bbl_custom_weights_chk;
ALTER TABLE budget_build_lines ADD CONSTRAINT bbl_custom_weights_chk CHECK (
    (split_weights IS NULL OR (cardinality(split_weights) = 12
        AND array_position(split_weights, NULL) IS NULL
        AND 0 <= ALL(split_weights) AND 0 < ANY(split_weights)))
    AND (split_method <> 'custom' OR split_weights IS NOT NULL));

ALTER TABLE budget_category_policy ADD COLUMN IF NOT EXISTS split_weights NUMERIC(15,2)[];
ALTER TABLE budget_category_policy DROP CONSTRAINT IF EXISTS bcp_split_chk;
ALTER TABLE budget_category_policy ADD CONSTRAINT bcp_split_chk
    CHECK (split_override IN ('auto', 'even', 'month', 'custom'));
ALTER TABLE budget_category_policy DROP CONSTRAINT IF EXISTS bcp_custom_weights_chk;
ALTER TABLE budget_category_policy ADD CONSTRAINT bcp_custom_weights_chk CHECK (
    (split_weights IS NULL OR (cardinality(split_weights) = 12
        AND array_position(split_weights, NULL) IS NULL
        AND 0 <= ALL(split_weights) AND 0 < ANY(split_weights)))
    AND (split_override <> 'custom' OR split_weights IS NOT NULL));
