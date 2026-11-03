'use strict';
/**
 * CR099 §4.2 — every table that hangs off forecast_modules is named in every hand-kept list.
 *
 * Module COLUMNS travel free (copy and variant sync read information_schema); a child TABLE has to
 * be named in each list, and a missed one fails silently: a copy without it builds a plan that
 * reads better, with no error (the CR078 / CR085 `disposal_cost_pct` class). Asking the catalog
 * which tables reference forecast_modules, rather than listing them here, is what makes this
 * catch the NEXT child table and not just the ones known today.
 *
 * DB-backed for the catalog read (skip with SKIP_DB_TESTS=1); the lists themselves are read from
 * source, because two of them are not exported.
 */

const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { SCHEDULE_TABLES } = require('../../services/forecastVariants');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
// Comments stripped: a comment that NAMES the table must not count as the code carrying it.
const src = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/ .*$/gm, '')
  .replace(/--.*$/gm, '');

dbDescribe('forecast_modules child tables are in every hand-kept list (DB)', () => {
  let children = [];

  beforeAll(async () => {
    const { rows } = await db.query(
      `SELECT DISTINCT tc.table_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'forecast_modules'
          AND tc.table_name <> 'forecast_modules'
        ORDER BY 1`
    );
    children = rows.map((r) => r.table_name);
  });
  afterAll(() => db.close());

  test('the catalog finds the known children (the query itself works)', () => {
    expect(children).toEqual(expect.arrayContaining([
      'forecast_module_investments', 'forecast_module_disposals', 'forecast_module_amortization',
      'forecast_module_returns', 'forecast_streams',
    ]));
  });

  test.each([
    ['scenario copy and its column derivation', 'v2/repositories/forecast.js'],
    ['the sensitivity fidelity digest', 'v2/services/forecastSensitivity.js'],
    ['the engine loader', 'services/forecast/index.js'],
  ])('%s names every child table', (_what, file) => {
    const code = src(file);
    for (const table of children) expect([table, code.includes(`'${table}'`) || code.includes(` ${table} `)]).toEqual([table, true]);
  });

  test('variant schedules cover every child table', () => {
    const tables = Object.values(SCHEDULE_TABLES).map((t) => t.table);
    for (const table of children) expect([table, tables.includes(table)]).toEqual([table, true]);
  });
});
