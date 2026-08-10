'use strict';
/**
 * A scenario COPY must carry every column of a module's child tables.
 *
 * Written after `copyScenario` was found dropping `disposal_cost_pct` (CR078, migration 062):
 * every scenario made by copy silently lost its selling costs and reported the FULL sale
 * proceeds. It surfaced only because a scratch copy of `2026 SRQ House Purchase` measured
 * ~890K better than the original for no modelled reason — i.e. it inflated a forecast, which
 * is the worst way for a copy bug to present. v3.25.2 had fixed the SAME column in the variant
 * SYNC path a day earlier; this was the other hand-maintained list.
 *
 * So this test does NOT enumerate columns — enumerating is the bug. It reads the table's real
 * columns from `information_schema` and asserts the copy round-trips each one, so a column
 * added tomorrow is covered without anybody remembering to come back here.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding and cleans up by unique name, per the
 * ambient-data rule (roadmap known issue #12).
 */

const db = require('../../db');
const repo = require('../forecast');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

/** Columns a copy cannot preserve by construction: the row's own id and its new parent. */
const NOT_COPIED = new Set(['id', 'module_id']);

const CHILD_TABLES = [
  'forecast_module_disposals',
  'forecast_module_investments',
  'forecast_module_amortization',
];

dbDescribe('copyScenario carries every child-table column (DB)', () => {
  const SRC = 'ZZCopyColumnsSource';
  const DST = 'ZZCopyColumnsCopy';
  let srcId;

  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = ANY($1)', [[SRC, DST]]);
  }

  beforeAll(async () => {
    await cleanup();

    const scenario = await db.query(
      'INSERT INTO forecast_scenarios (name, is_active) VALUES ($1, TRUE) RETURNING id',
      [SRC]
    );
    srcId = scenario.rows[0].id;

    const account = await db.query(
      "SELECT id FROM accounts WHERE account_type = 'asset' ORDER BY id LIMIT 1"
    );

    const module = await db.query(
      `INSERT INTO forecast_modules (scenario_id, account_id, name, module_type, currency,
                                     base_date, base_value, market_value, setup_status,
                                     has_valuation)
       VALUES ($1, $2, 'ZZ Copy Columns House', 'Real Estate', 'USD',
               '2026-12-31', 0, 0, 'complete', TRUE)
       RETURNING id`,
      [srcId, account.rows[0]?.id ?? null]
    );
    const moduleId = module.rows[0].id;

    // Every nullable column gets a DISTINCTIVE non-null value: a copy that drops a column
    // yields NULL, and NULL !== the value below. A column left null here would pass whether
    // or not it was copied, which is exactly how the original defect hid.
    await db.query(
      `INSERT INTO forecast_module_disposals
         (module_id, disposal_date, amount, flag, note, date_end, disposal_cost_pct)
       VALUES ($1, '2048-07-01', 1234.56, 'Full', 'zz-note', '2049-07-01', 7.0000)`,
      [moduleId]
    );
    await db.query(
      `INSERT INTO forecast_module_investments
         (module_id, investment_date, amount, flag, note, date_end)
       VALUES ($1, '2028-07-01', 1500000.00, 'OneTime', 'zz-inv-note', '2029-07-01')`,
      [moduleId]
    );
    await db.query(
      `INSERT INTO forecast_module_amortization (module_id, effective_date, pct)
       VALUES ($1, '2030-01-01', 3.5)`,
      [moduleId]
    );

    await repo.copyScenario(srcId, DST);
  });

  afterAll(async () => {
    await cleanup();
  });

  it.each(CHILD_TABLES)('%s round-trips every column through a copy', async (table) => {
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 ORDER BY ordinal_position`,
      [table]
    );
    const compared = cols.rows
      .map((r) => r.column_name)
      .filter((c) => !NOT_COPIED.has(c));

    // Guard the guard: if the schema query returns nothing the assertions below are vacuous.
    expect(compared.length).toBeGreaterThan(0);

    const rowsFor = async (scenarioName) => {
      const res = await db.query(
        `SELECT t.* FROM ${table} t
           JOIN forecast_modules m ON m.id = t.module_id
           JOIN forecast_scenarios s ON s.id = m.scenario_id
          WHERE s.name = $1`,
        [scenarioName]
      );
      return res.rows;
    };

    const src = await rowsFor(SRC);
    const dst = await rowsFor(DST);

    expect(src).toHaveLength(1);
    expect(dst).toHaveLength(1);

    for (const col of compared) {
      // String-compare so numeric/date driver representations do not create false failures;
      // the point is "did the value survive", not its JS type.
      expect(`${col}=${String(dst[0][col])}`).toBe(`${col}=${String(src[0][col])}`);
    }
  });
});
