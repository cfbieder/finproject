-- 081 — one FDIC sweep deposit held under two feed symbols (roadmap Known Issue #29).
--
-- WHAT WAS MEASURED (prod, 2026-09-14). Fintable reports two Fidelity FDIC deposit sweeps
-- under a ticker OR a numeric FDIC identifier, and switches between them. `resolveSecurity`
-- (services/ingestHoldings.js) keys `security_source_mappings (source='fintable',
-- external_name)`, so each new label minted a NEW `securities` row — no name, no statement,
-- no rate:
--
--     account 30  QIBZQ (sec 21) to 2026-08-08 · FDIC91125 (sec 93) from 08-09
--                 $76,573.62 on both sides of the switch
--     account 30  QHYEQ (sec 87) to 09-03 · FDIC91075 (sec 94) 09-04..09-08 ·
--                 QHYEQ 09-09..09-10 · FDIC91075 from 09-12   ($6,696.37 → $5,842.37, continuous)
--
-- It FLIPS, so it is one deposit under two labels, not a change of bank — and no stable id
-- from bank-feed could fix it, because the upstream itself alternates. Checked before
-- writing: no snapshot ever holds both securities of a pair; the twins appear only in
-- account 30; they carry nothing but positions and one mapping each; the statement-derived
-- interest rate (migration 080) sits on the ticker row, which is why $83,270 read as paying
-- nothing.
--
-- THE FIX reuses the alias table that already exists. `security_source_mappings` is
-- UNIQUE(source, external_name) with many names allowed per security, so pointing the
-- numeric label at the ticker row makes every future flip resolve to one security. The
-- twin's positions move with it and the emptied twin is deleted. Owner decision 2026-09-14.
--
-- KEYED ON NAMES, NEVER IDS: the ids differ between prod (93→21, 94→87) and dev (28→91),
-- and a fresh CI database has none of these rows — there both pairs are skipped and this is
-- a no-op. Idempotent: once both names map to one security there is nothing left to merge.
--
-- REFUSES rather than guesses: a snapshot holding BOTH securities of a pair (the merge would
-- break UNIQUE(snapshot_id, security_id), and two rows would mean two real holdings), or a
-- twin with dependents beyond positions and mappings (ON DELETE CASCADE would drop them
-- silently).
--
-- ROLLBACK: restore from the pre-deploy backup. The merge rewrites which security historical
-- positions point at; the old ids are in the NOTICE output and this file's header.

DO $$
DECLARE
  pair      RECORD;
  canon_id  INTEGER;
  alias_id  INTEGER;
  n_collide INTEGER;
  n_other   INTEGER;
  n_moved   INTEGER;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES ('QIBZQ', 'FDIC91125'), ('QHYEQ', 'FDIC91075')) AS p(canonical, alias)
  LOOP
    canon_id := NULL;
    alias_id := NULL;
    SELECT security_id INTO canon_id FROM security_source_mappings
     WHERE source = 'fintable' AND external_name = pair.canonical;
    SELECT security_id INTO alias_id FROM security_source_mappings
     WHERE source = 'fintable' AND external_name = pair.alias;

    IF canon_id IS NULL OR alias_id IS NULL OR canon_id = alias_id THEN
      RAISE NOTICE '081: % / % — nothing to merge', pair.canonical, pair.alias;
      CONTINUE;
    END IF;

    SELECT COUNT(*) INTO n_collide
      FROM security_positions a
      JOIN security_positions b ON b.snapshot_id = a.snapshot_id
     WHERE a.security_id = canon_id AND b.security_id = alias_id;
    IF n_collide > 0 THEN
      RAISE EXCEPTION '081: % and % share % snapshot(s) — two real holdings, not one relabelled; refusing',
        pair.canonical, pair.alias, n_collide;
    END IF;

    SELECT (SELECT COUNT(*) FROM security_bond_terms     WHERE security_id = alias_id)
         + (SELECT COUNT(*) FROM security_cash_rates     WHERE security_id = alias_id)
         + (SELECT COUNT(*) FROM security_dividends      WHERE security_id = alias_id)
         + (SELECT COUNT(*) FROM security_lots           WHERE security_id = alias_id)
         + (SELECT COUNT(*) FROM security_prices         WHERE security_id = alias_id)
         + (SELECT COUNT(*) FROM security_quotes         WHERE security_id = alias_id)
         + (SELECT COUNT(*) FROM security_sector_weights WHERE security_id = alias_id)
         + (SELECT COUNT(*) FROM security_transactions   WHERE security_id = alias_id)
      INTO n_other;
    IF n_other > 0 THEN
      RAISE EXCEPTION '081: % (security %) carries % dependent row(s) beyond positions and mappings — deleting it would cascade them away; refusing',
        pair.alias, alias_id, n_other;
    END IF;

    UPDATE security_positions SET security_id = canon_id WHERE security_id = alias_id;
    GET DIAGNOSTICS n_moved = ROW_COUNT;
    UPDATE security_source_mappings SET security_id = canon_id WHERE security_id = alias_id;
    DELETE FROM securities WHERE id = alias_id;

    RAISE NOTICE '081: % → % (security % merged into %): % position(s) moved',
      pair.alias, pair.canonical, alias_id, canon_id, n_moved;
  END LOOP;
END $$;
