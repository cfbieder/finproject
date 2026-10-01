'use strict';
/**
 * cr083.leSeed.test.js — a new LE must carry EVERY estimate cell the prior LE
 * answered, not only the ones the budget also has a row for.
 *
 * The regression (2026-10-01): seeding looked the prior LE up from the budget's
 * own (category, month, CURRENCY) cells, so LE-10-26 silently lost ~26,000 of
 * typed estimates — a Taxes US month with no budget behind it, and typed USD
 * figures sitting over PLN budget rows (the budget came back in their place).
 *
 * Self-seeding in 1972, which no database holds data for.
 */

const repo = require('../budgetLe');
const service = require('../../../services/budgetLe');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

const TAG = 'CR083SEED';
const YEAR = 1972;

dbDescribe('LE seeding from the prior LE (DB)', () => {
  const ids = {};

  async function cleanup() {
    await db.query(`DELETE FROM budget_le WHERE budget_year = $1`, [YEAR]);
    await db.query(`DELETE FROM budget_entries WHERE description LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
  }

  const budget = (month, amount, base, currency, categoryId) => db.query(
    `INSERT INTO budget_entries
       (entry_date, description, amount, currency, base_amount, base_currency, category_id, budget_year)
     VALUES (make_date($1, $2, 1), $3, $4, $5, $6, 'USD', $7, $1)`,
    [YEAR, month, `${TAG} b`, amount, currency, base, categoryId]
  );

  const cells = async (leId, categoryId) => (await db.query(
    `SELECT to_char(period_month, 'MM') AS m, currency, source, base_amount::float AS b
       FROM budget_le_lines
      WHERE le_id = $1 AND category_id = $2 AND source <> 'actual'
      ORDER BY 1, 2`,
    [leId, categoryId]
  )).rows;

  beforeAll(async () => {
    await cleanup();
    for (const k of ['taxes', 'gas', 'food']) {
      const { rows } = await db.query(
        `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
         VALUES ($1, 'expense', 'profit_loss', FALSE, 'USD', TRUE) RETURNING id`,
        [`${TAG} ${k}`]
      );
      ids[k] = rows[0].id;
    }
    // taxes: no budget at all. gas: budgeted in PLN. food: budgeted in USD.
    await budget(10, -400, -100, 'PLN', ids.gas);
    await budget(11, -400, -100, 'PLN', ids.gas);
    await budget(10, -70, -70, 'USD', ids.food);
    await budget(11, -70, -70, 'USD', ids.food);

    const first = await repo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-08-31` });
    ids.first = first.id;
    await service.saveCategoryEstimates(first.id, ids.taxes, { [`${YEAR}-10`]: -21425 });
    await service.saveCategoryEstimates(first.id, ids.gas, { [`${YEAR}-10`]: -500 });
    await service.saveCategoryEstimates(first.id, ids.food, { [`${YEAR}-11`]: -90 });

    const next = await repo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-09-30` });
    ids.next = next.id;
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('🔴 a typed month with NO budget behind it is carried, not dropped', async () => {
    expect(await cells(ids.next, ids.taxes)).toEqual([
      { m: '10', currency: 'USD', source: 'manual', b: -21425 },
    ]);
  });

  test('🔴 a typed USD figure over a PLN budget wins — the PLN budget does not come back', async () => {
    expect(await cells(ids.next, ids.gas)).toEqual([
      { m: '10', currency: 'USD', source: 'manual', b: -500 },
      { m: '11', currency: 'PLN', source: 'budget_carry', b: -100 }, // untouched month keeps its budget
    ]);
  });

  test('same-currency cells behave as before: typed wins, untyped carries the budget', async () => {
    expect(await cells(ids.next, ids.food)).toEqual([
      { m: '10', currency: 'USD', source: 'budget_carry', b: -70 },
      { m: '11', currency: 'USD', source: 'manual', b: -90 },
    ]);
  });

  test('the two LEs agree on every estimate month after the new cut', async () => {
    const sum = async (leId) => Number((await db.query(
      `SELECT COALESCE(SUM(base_amount), 0) AS s FROM budget_le_lines
        WHERE le_id = $1 AND source <> 'actual' AND period_month > make_date($2, 9, 30)`,
      [leId, YEAR]
    )).rows[0].s);
    expect(await sum(ids.next)).toBeCloseTo(await sum(ids.first), 2);
  });

  describe('the walk between them', () => {
    test('defaults to the prior LE, and its pieces add up to the change', async () => {
      const w = await service.getWalk(ids.next);
      expect(w.from.id).toBe(ids.first);
      const t = w.totals;
      expect(t.priorFy + t.restated + t.closed + t.reestimated).toBeCloseTo(t.newFy, 2);
      // Faithful seeding: September closed (budget-free here, so 0 → 0) and
      // nothing re-estimated — an unchanged forecast walks to zero.
      expect(t.reestimated).toBe(0);
      expect(t.change).toBe(0);
    });

    test('a re-typed month shows as re-estimated, with the basis that changed', async () => {
      await service.saveCategoryEstimates(ids.next, ids.food, { [`${YEAR}-10`]: -120 });
      const w = await service.getWalk(ids.next);
      const food = w.rows.find((r) => r.categoryId === ids.food);
      expect(food).toMatchObject({
        reestimated: -50, change: -50, priorBasis: 'Mixed', newBasis: 'Typed', basisChanged: true,
      });
      expect(w.rows.find((r) => r.categoryId === ids.taxes)).toBeUndefined(); // did not move
    });

    test('refuses to walk backwards', async () => {
      await expect(service.getWalk(ids.first, ids.next)).rejects.toThrow(/cut later/);
    });
  });
});
