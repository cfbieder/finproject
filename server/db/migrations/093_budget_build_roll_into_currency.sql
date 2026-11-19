-- 093 — CR098 follow-up: roll a builder line into ANY other currency line of its category, not only USD.
--
-- WHY. 092 rolled a non-USD line into the category's USD line. A category paid in EUR and PLN, with
-- no USD at all, should be budgeted once in EUR (owner, 2026-11-19) — so the roll carries a target.
--   budget_build_lines.rolled_into   — the currency line this line's estimate joins (NULL: its own).
--                                      Replaces rolled_into_usd (TRUE ⇒ 'USD').
--   budget_category_policy.roll_into — {"PLN": "EUR", ...}: what the category rolled at its last
--                                      publish. Replaces roll_into_usd (['PLN'] ⇒ {"PLN": "USD"}).
--
-- NOT additive: the old columns are dropped. Between Step 2b and the new containers the running
-- v3.100 code fails on a builder WRITE that names them (create a build, roll, itemise, publish);
-- reads use SELECT * and keep working. Prod held 0 rolled lines on 2026-11-19.
--
-- Rollback (manual — the runner is forward-only):
--   ALTER TABLE budget_build_lines ADD COLUMN rolled_into_usd BOOLEAN NOT NULL DEFAULT FALSE;
--   UPDATE budget_build_lines SET rolled_into_usd = TRUE WHERE rolled_into = 'USD';
--   ALTER TABLE budget_build_lines DROP COLUMN rolled_into;
--   ALTER TABLE budget_category_policy ADD COLUMN roll_into_usd TEXT[] NOT NULL DEFAULT '{}';
--   UPDATE budget_category_policy SET roll_into_usd = ARRAY(SELECT k FROM jsonb_each_text(roll_into) WHERE value = 'USD' ORDER BY k);
--   ALTER TABLE budget_category_policy DROP COLUMN roll_into;

ALTER TABLE budget_build_lines ADD COLUMN IF NOT EXISTS rolled_into CHAR(3);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bbl_roll_target_chk') THEN
    ALTER TABLE budget_build_lines ADD CONSTRAINT bbl_roll_target_chk
      CHECK (rolled_into IS NULL OR (rolled_into IN ('USD', 'PLN', 'EUR') AND rolled_into <> currency));
  END IF;
END $$;

ALTER TABLE budget_category_policy ADD COLUMN IF NOT EXISTS roll_into JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'budget_build_lines' AND column_name = 'rolled_into_usd') THEN
    UPDATE budget_build_lines SET rolled_into = 'USD' WHERE rolled_into_usd;
    ALTER TABLE budget_build_lines DROP COLUMN rolled_into_usd; -- takes bbl_roll_not_usd_chk with it
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'budget_category_policy' AND column_name = 'roll_into_usd') THEN
    UPDATE budget_category_policy
       SET roll_into = (SELECT COALESCE(jsonb_object_agg(TRIM(c), 'USD'), '{}'::jsonb) FROM unnest(roll_into_usd) c);
    ALTER TABLE budget_category_policy DROP COLUMN roll_into_usd;
  END IF;
END $$;
