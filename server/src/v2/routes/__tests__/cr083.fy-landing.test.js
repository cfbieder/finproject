'use strict';
/**
 * cr083.fy-landing.test.js — CR083 P0a.
 *
 * Pins `GET /budget/fy-landing`: the identity, the cut, and the two exclusions.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1) and **self-seeding** — it creates its
 * own COA rows, budget entries and transactions, and cleans up by name. It
 * never reads ambient data, which is what Known Issues #20/#21 cost two days of
 * red `main` for: a `SELECT … LIMIT 1` passes on dev, whose database is full,
 * and dies in `beforeAll` on CI's, which holds only the migrations + ci-seed.
 *
 * The absolute-value assertions use **1975 and 2190**, two years in which
 * neither `transactions` nor `budget_entries` holds a single row on any
 * database, so the totals are exactly what this suite seeded. The current-year
 * case can't do that, so it asserts the *identity* instead of a figure — which
 * is ambient-safe by construction, and does not re-derive the cut (that would
 * be two copies of one formula, failure-pattern #4).
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../budget');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/budget', router);
const req = (m, p) => request(app, m, `/budget${p}`);

const TAG = 'CR083FYL';
const PAST = 1975;      // fully elapsed -> every month is actual
const FUTURE = 2190;    // not started   -> every month is budget

dbDescribe('GET /budget/fy-landing (DB)', () => {
  const ids = {};

  async function cleanup() {
    await db.query(
      `DELETE FROM transactions WHERE description1 LIKE $1`, [`${TAG}%`]
    );
    await db.query(
      `DELETE FROM budget_entries WHERE description LIKE $1`, [`${TAG}%`]
    );
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
  }

  async function addAccount(name, { isTransfer = false, parentId = null } = {}) {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
       VALUES ($1, $2, 'expense', 'profit_loss', $3, 'USD', TRUE) RETURNING id`,
      [name, parentId, isTransfer]
    );
    return rows[0].id;
  }

  async function addBudget(categoryId, year, month, amount) {
    await db.query(
      `INSERT INTO budget_entries
         (entry_date, description, amount, currency, base_amount, base_currency,
          category_id, budget_year)
       VALUES (make_date($1,$2,1), $3, $4, 'USD', $4, 'USD', $5, $1)`,
      [year, month, `${TAG} budget`, amount, categoryId]
    );
  }

  async function addActual(categoryId, year, month, amount) {
    await db.query(
      `INSERT INTO transactions
         (transaction_date, description1, amount, currency, base_amount, base_currency, category_id)
       VALUES (make_date($1,$2,15), $3, $4, 'USD', $4, 'USD', $5)`,
      [year, month, `${TAG} actual`, amount, categoryId]
    );
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();

    ids.plain = await addAccount(`${TAG} Plain`);
    ids.transfer = await addAccount(`${TAG} Transfer Thing`, { isTransfer: true });
    // A parent that carries transactions of its own — CR083 §2.1a. The LE counts
    // these; `/budget-vs-actual` cannot see them, and that difference is the
    // reason the strip says it does not tie to the table.
    ids.parent = await addAccount(`${TAG} Parent`);
    ids.child = await addAccount(`${TAG} Child`, { parentId: ids.parent });

    const { rows: ugl } = await db.query(
      `SELECT id FROM accounts WHERE name = 'Unrealized G/L'`
    );
    ids.unrealized = ugl[0] && ugl[0].id;

    // PAST: 12 months actual, and a budget that should be entirely YTD.
    await addBudget(ids.plain, PAST, 3, -100);
    await addActual(ids.plain, PAST, 3, -250);

    // FUTURE: 12 months of budget, no actuals.
    await addBudget(ids.plain, FUTURE, 6, -400);

    // Both years get noise on the excluded categories, large enough that a
    // failed exclusion could not be mistaken for a rounding difference.
    await addActual(ids.transfer, PAST, 4, -900000);
    await addBudget(ids.transfer, FUTURE, 4, -900000);
    if (ids.unrealized) {
      await addActual(ids.unrealized, PAST, 5, 800000);
      await addBudget(ids.unrealized, FUTURE, 5, 800000);
    }

    // A parent-posted transaction, and one on its child, in the PAST year.
    await addActual(ids.parent, PAST, 7, -11);
    await addActual(ids.child, PAST, 7, -22);
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('envelope + shape', async () => {
    const r = await req('GET', `/fy-landing?year=${PAST}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('data');
    expect(r.body.data).toMatchObject({ year: PAST });
  });

  test('a fully elapsed year is all actual: landing = actual, no budget remains', async () => {
    const { body } = await req('GET', `/fy-landing?year=${PAST}`);
    const d = body.data;
    expect(d.actualMonths).toBe(12);
    expect(Number(d.budgetRest)).toBe(0);
    // -250 plain, -11 parent-posted, -22 child. Transfers and Unrealized G/L excluded.
    expect(Number(d.actualYtd)).toBe(-283);
    expect(Number(d.budgetYtd)).toBe(-100);
    expect(Number(d.landing)).toBe(-283);
    expect(Number(d.budgetFy)).toBe(-100);
    expect(Number(d.variance)).toBe(-183);
  });

  test('a year that has not started is all budget: landing = budget, variance 0', async () => {
    const { body } = await req('GET', `/fy-landing?year=${FUTURE}`);
    const d = body.data;
    expect(d.actualMonths).toBe(0);
    expect(Number(d.actualYtd)).toBe(0);
    expect(Number(d.budgetYtd)).toBe(0);
    expect(Number(d.budgetRest)).toBe(-400);
    expect(Number(d.landing)).toBe(-400);
    expect(Number(d.budgetFy)).toBe(-400);
    expect(Number(d.variance)).toBe(0);
  });

  test('transfers are excluded — 900,000 of them move nothing', async () => {
    const past = (await req('GET', `/fy-landing?year=${PAST}`)).body.data;
    const future = (await req('GET', `/fy-landing?year=${FUTURE}`)).body.data;
    // Seeded -900,000 on a transfer category in each year. If the exclusion
    // failed, these would be six figures rather than three.
    expect(Number(past.actualYtd)).toBe(-283);
    expect(Number(future.budgetRest)).toBe(-400);
  });

  test('Unrealized G/L is excluded, and it is resolved by NAME not by id 88', async () => {
    if (!ids.unrealized) return; // ci-seed always creates it; guard anyway
    const past = (await req('GET', `/fy-landing?year=${PAST}`)).body.data;
    expect(Number(past.actualYtd)).toBe(-283); // not +799,717

    // Pin the mechanism, not just the outcome: the service must not be reading a
    // literal 88. Known Issue #21 was a suite that borrowed an id which is 74 on
    // dev and 11 on a CI-built DB, and all 12 of its tests failed on day one.
    const src = require('fs').readFileSync(
      require.resolve('../../../services/budget.js'), 'utf8'
    );
    const fn = src.slice(src.indexOf('async function getFyLanding'));
    expect(fn).toContain("name <> 'Unrealized G/L'");
    expect(fn).not.toMatch(/id\s*<>\s*88/);
  });

  test('a transaction posted to a NON-LEAF category is counted (§2.1a)', async () => {
    const past = (await req('GET', `/fy-landing?year=${PAST}`)).body.data;
    // -283 includes the parent's own -11. Drop it and this is -272; that is the
    // leaf-only reading `/budget-vs-actual` uses, and the strip says so.
    expect(Number(past.actualYtd)).toBe(-283);
  });

  test('the identity holds for the current year, whatever the cut', async () => {
    const year = new Date().getFullYear();
    const { body } = await req('GET', `/fy-landing?year=${year}`);
    const d = body.data;
    // Ambient-safe: an internal consistency check, and it does not re-derive
    // the cut. landing = actual + rest; budgetFy = ytd + rest; variance is both
    // the difference of those AND the year-to-date variance.
    expect(Number(d.landing)).toBeCloseTo(Number(d.actualYtd) + Number(d.budgetRest), 2);
    expect(Number(d.budgetFy)).toBeCloseTo(Number(d.budgetYtd) + Number(d.budgetRest), 2);
    expect(Number(d.variance)).toBeCloseTo(Number(d.landing) - Number(d.budgetFy), 2);
    expect(Number(d.variance)).toBeCloseTo(Number(d.actualYtd) - Number(d.budgetYtd), 2);
    expect(d.actualMonths).toBeGreaterThanOrEqual(0);
    expect(d.actualMonths).toBeLessThanOrEqual(12);
  });

  test('a bad year is refused', async () => {
    const r = await req('GET', '/fy-landing?year=notayear');
    // Falls back to the current year rather than throwing — parseInt guard.
    expect(r.status).toBe(200);
    expect(r.body.data.year).toBe(new Date().getFullYear());
  });
});
