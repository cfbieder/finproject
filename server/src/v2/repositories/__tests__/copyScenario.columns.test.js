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
 * CR085 P0 — WIDENED. The first version covered three of the five child tables. `forecast_streams`
 * and `forecast_stream_changes` were left out, and they were also the two still hand-enumerated in
 * `copyScenario` — an unguarded hand-kept list in the exact part of the schema CR069-CR073 have
 * been changing. Both are covered here now, and `copyScenario` derives every list from the catalog.
 *
 * `forecast_stream_changes` hangs off a stream, not a module, so the join to the scenario is per
 * table rather than one shared query. Its identity column is `stream_id`, not `module_id`.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding and cleans up by unique name, per the
 * ambient-data rule (roadmap known issue #12).
 */

const db = require('../../db');
const repo = require('../forecast');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

/**
 * Per table: the columns a copy cannot preserve by construction (the row's own id and its new
 * parent), and how the table joins back to its scenario.
 */
const MODULE_CHILD_JOIN = 'JOIN forecast_modules m ON m.id = t.module_id';
const STREAM_CHILD_JOIN =
  'JOIN forecast_streams st ON st.id = t.stream_id JOIN forecast_modules m ON m.id = st.module_id';

const CHILD_TABLES = [
  ['forecast_module_disposals', ['id', 'module_id'], MODULE_CHILD_JOIN],
  ['forecast_module_investments', ['id', 'module_id'], MODULE_CHILD_JOIN],
  ['forecast_module_amortization', ['id', 'module_id'], MODULE_CHILD_JOIN],
  ['forecast_streams', ['id', 'module_id'], MODULE_CHILD_JOIN],
  ['forecast_stream_changes', ['id', 'stream_id'], STREAM_CHILD_JOIN],
];

dbDescribe('copyScenario carries every child-table column (DB)', () => {
  const SRC = 'ZZCopyColumnsSource';
  const DST = 'ZZCopyColumnsCopy';
  const FC_LINE = 'ZZ Copy Columns Line';
  let srcId;

  async function cleanup() {
    // Scenarios first: `forecast_streams.fc_line_id` is ON DELETE RESTRICT, so the line cannot
    // go until the streams referencing it have.
    await db.query('DELETE FROM forecast_scenarios WHERE name = ANY($1)', [[SRC, DST]]);
    await db.query('DELETE FROM fc_lines WHERE name = $1', [FC_LINE]);
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

    // CR085 P0 — a stream and one of its change rows. `fc_line_id` is SEEDED, not borrowed:
    // a NULL would pass whether or not it was copied (the hole this whole test exists to close),
    // and `SELECT id FROM fc_lines LIMIT 1` is the ambient-data mistake this suite keeps making —
    // dev has fc_lines, a from-scratch CI database has none, so that version passed against dev
    // and died in `test-fresh-db.sh` (roadmap Known Issues #12 / #21).
    //
    // `line_type` is given explicitly rather than left to its default: on a FRESH database 007's
    // CHECK is enforced while dev and prod have it auto-baselined away (Known Issue #18), so the
    // value has to be one 007 allows.
    const fcLine = await db.query(
      `INSERT INTO fc_lines (name, line_type) VALUES ($1, 'forecast_income')
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [FC_LINE]
    );

    const stream = await db.query(
      `INSERT INTO forecast_streams
         (module_id, direction, fc_line_id, mode, amount, amount_usd,
          growth_mult, start_date, end_date, tax_rate_override)
       VALUES ($1, 'income', $2, 'amount', 4242.42, 4141.41,
               1.5000, '2031-01-01', '2044-12-31', 0.1900)
       RETURNING id`,
      [moduleId, fcLine.rows[0].id]
    );
    await db.query(
      `INSERT INTO forecast_stream_changes (stream_id, change_date, amount, flag)
       VALUES ($1, '2035-01-01', -321.45, 'Fixed $')`,
      [stream.rows[0].id]
    );

    await repo.copyScenario(srcId, DST);
  });

  afterAll(async () => {
    await cleanup();
  });

  it.each(CHILD_TABLES)('%s round-trips every column through a copy', async (table, identity, join) => {
    const notCopied = new Set(identity);
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 ORDER BY ordinal_position`,
      [table]
    );
    const compared = cols.rows
      .map((r) => r.column_name)
      .filter((c) => !notCopied.has(c));

    // Guard the guard: if the schema query returns nothing the assertions below are vacuous.
    expect(compared.length).toBeGreaterThan(0);

    const rowsFor = async (scenarioName) => {
      const res = await db.query(
        `SELECT t.* FROM ${table} t
           ${join}
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
