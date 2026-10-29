'use strict';
/**
 * CR098 P0 — `findAll`'s per-category `budget_total` is ONE year's budget, or null with no year.
 * It used to sum every year's rows into one figure when no year was passed: noise while next year
 * held 12 rows, a wrong number once the budget builder writes a whole year.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const repo = require('../fcLines');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const P = 'FAYRT';

dbDescribe('fcLines.findAll budget year (DB)', () => {
  const ids = {};

  async function cleanup() {
    await db.query(
      'DELETE FROM budget_entries WHERE category_id IN (SELECT id FROM accounts WHERE name LIKE $1)', [`${P} %`]
    );
    await db.query('DELETE FROM fc_lines WHERE name LIKE $1', [`${P} %`]);
    await db.query('DELETE FROM accounts WHERE name LIKE $1', [`${P} %`]);
  }

  const budgetRow = (year, amount) => db.query(
    `INSERT INTO budget_entries (entry_date, amount, currency, base_amount, base_currency, category_id, budget_year)
     VALUES (make_date($1, 6, 1), $2, 'USD', $2, 'USD', $3, $1)`,
    [year, amount, ids.cat]
  );

  beforeAll(async () => {
    await cleanup();
    ids.cat = (await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'expense', 'profit_loss', 'USD', 0) RETURNING id`, [`${P} Cat`]
    )).rows[0].id;
    ids.line = (await db.query(
      `INSERT INTO fc_lines (name, line_type) VALUES ($1, 'forecast_expense') RETURNING id`, [`${P} Line`]
    )).rows[0].id;
    await db.query('INSERT INTO fc_line_categories (fc_line_id, category_id) VALUES ($1, $2)', [ids.line, ids.cat]);
    await budgetRow(2091, -100);
    await budgetRow(2092, -900);
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  const totalFor = async (year) => {
    const line = (await repo.findAll(year)).find((l) => l.id === ids.line);
    return line.categories[0].budget_total;
  };

  test('a year gives that year only', async () => {
    expect(Number(await totalFor(2091))).toBe(-100);
    expect(Number(await totalFor(2092))).toBe(-900);
  });

  test('no year gives no total — never the two years added together', async () => {
    expect(await totalFor(null)).toBeNull();
  });
});
