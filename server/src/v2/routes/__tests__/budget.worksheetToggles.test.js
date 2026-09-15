'use strict';
/**
 * The Budget Worksheet's "Unrealized" and "Transfers" toggles (owner, 2026-09-15).
 *
 * With both off the Actual column counts ordinary income and expense only, like the
 * budget: July 2026 read (94,869.82) on the Worksheet against (63,301.04) on Budget
 * Analysis, the gap being exactly July's Unrealized G/L. The drill-down must apply the
 * same rule, so a cell and its entries agree. Absent parameters keep the old
 * include-everything behaviour. DB-backed; self-seeding in 1980, cleaned up by tag.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../budget');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/budget', router);
const req = (m, p, b) => request(app, m, `/budget${p}`, b);

const TAG = 'WSTOG';
const YEAR = 1980;

dbDescribe('Budget Worksheet toggles (DB)', () => {
  const ids = {};
  let createdUnrealized = false;

  async function cleanup() {
    await db.query(`DELETE FROM transactions WHERE description1 LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
  }

  const txn = (categoryId, amount) => db.query(
    `INSERT INTO transactions
       (transaction_date, description1, amount, currency, base_amount, base_currency, category_id)
     VALUES (make_date($1, 3, 15), $2, $3, 'USD', $3, 'USD', $4)`,
    [YEAR, `${TAG} t`, amount, categoryId]
  );

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
    const account = async (name, isTransfer) => (await db.query(
      `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
       VALUES ($1, 'expense', 'profit_loss', $2, 'USD', TRUE) RETURNING id`,
      [name, isTransfer]
    )).rows[0].id;
    ids.alpha = await account(`${TAG} Alpha`, false);
    ids.transfer = await account(`${TAG} Transfer`, true);
    // The rule keys on the category NAME `Unrealized G/L`: use the real one if the
    // database has it, create it (and remove it afterwards) if it does not.
    const found = await db.query(`SELECT id FROM accounts WHERE name = 'Unrealized G/L'`);
    if (found.rows.length) {
      ids.unrealized = found.rows[0].id;
    } else {
      ids.unrealized = await account('Unrealized G/L', false);
      createdUnrealized = true;
    }
    await txn(ids.alpha, -100);
    await txn(ids.unrealized, -30);
    await txn(ids.transfer, -50);
  });

  afterAll(async () => {
    await cleanup();
    if (createdUnrealized) await db.query(`DELETE FROM accounts WHERE id = $1`, [ids.unrealized]);
    await db.close();
  });

  const names = `&category=${encodeURIComponent(`${TAG} Alpha`)}`
    + `&category=${encodeURIComponent('Unrealized G/L')}`
    + `&category=${encodeURIComponent(`${TAG} Transfer`)}`;

  const marchActual = async (query) => {
    const r = await req('GET', `/summary?budgetYear=${YEAR}&actualYear=${YEAR}${names}${query}`);
    expect(r.status).toBe(200);
    return r.body.actualByMonth['3'];
  };

  const marchEntries = async (query) => {
    const r = await req('GET', `/actual-entries?actualYear=${YEAR}&month=3${names}${query}`);
    expect(r.status).toBe(200);
    return r.body.entries.reduce((s, e) => s + Number(e.BaseAmount), 0);
  };

  test('without the parameters, every category still counts — the old behaviour', async () => {
    expect(await marchActual('')).toBeCloseTo(-180, 2);
    expect(await marchEntries('')).toBeCloseTo(-180, 2);
  });

  test('🔴 both toggles off: ordinary expense only, on the summary AND its drill-down', async () => {
    const off = '&transfers=exclude&includeUnrealizedGL=false';
    expect(await marchActual(off)).toBeCloseTo(-100, 2);
    expect(await marchEntries(off)).toBeCloseTo(-100, 2);
  });

  test('each toggle adds back only its own rows', async () => {
    expect(await marchActual('&transfers=exclude&includeUnrealizedGL=true')).toBeCloseTo(-130, 2);
    expect(await marchActual('&transfers=include&includeUnrealizedGL=false')).toBeCloseTo(-150, 2);
    expect(await marchEntries('&transfers=include&includeUnrealizedGL=false')).toBeCloseTo(-150, 2);
  });
});
