'use strict';
/**
 * CR078 — a variant's child-table columns must not drift from the table.
 *
 * `syncVariant` reads the MODULE's columns from `information_schema` — CR050's deliberate fix for
 * the dropped-column class, after `copyScenario`'s hand-maintained list omitted `has_valuation`.
 * A child TABLE's columns are still hand-listed in `SCHEDULE_TABLES`, and a missing one is
 * SILENT: the base moves, the variants keep the old value, nothing errors.
 *
 * It happened. `disposal_cost_pct` shipped in migration 062 and was not added to the disposals
 * list, so setting selling costs on `2026 Base` and regenerating all five moved **only Base** —
 * the other four silently kept GROSS proceeds on 5.5M of property sales.
 *
 * DB-backed on purpose: the assertion is against the live schema, so the next column added to any
 * of these tables fails here rather than in a scenario nobody re-reads.
 */
const db = require('../../db');
const { SCHEDULE_TABLES } = require('../forecastVariants');

const describeOrSkip = process.env.SKIP_DB_TESTS ? describe.skip : describe;

describeOrSkip('CR078 — variant schedule column lists match their tables', () => {
  /** Columns the sync never needs to copy: identity, the parent link, and audit stamps. */
  const IGNORED = new Set(['id', 'created_at', 'updated_at']);

  for (const [name, spec] of Object.entries(SCHEDULE_TABLES)) {
    test(`${name} (${spec.table}) lists every data column`, async () => {
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1`,
        [spec.table]
      );
      const actual = rows
        .map((r) => r.column_name)
        .filter((c) => !IGNORED.has(c) && c !== spec.fk);

      const missing = actual.filter((c) => !spec.cols.includes(c));
      const stale = spec.cols.filter((c) => !actual.includes(c));

      // Named explicitly so the failure says WHICH column, not just that a count differs.
      expect({ missing, stale }).toEqual({ missing: [], stale: [] });
    });
  }
});
