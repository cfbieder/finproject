'use strict';
/**
 * cr083.baseYearLe.test.js — CR083 §8.1: the forecast Review's read-only LE reference column.
 *
 * The LE must NOT feed the base year (§8.1: it would move opening cash by tens of thousands,
 * compounding to 2062). What is built instead is a column beside it — displayed, never summed.
 * These tests pin:
 *   - which LE: the latest FINALISED one for the year, never a draft or a superseded one;
 *   - the aggregation: the base year's own FC-line mapping (FC_LINE_LEAVES_CTE), so a line
 *     mapped at a PARENT picks up its leaves in both columns alike;
 *   - the LE's own exclusion snapshot is honoured, and what no FC line covers is reported;
 *   - the base year itself does not move, and the generation engine does not read any of it.
 *
 * Self-seeding in 1979, which no database holds data for (the sibling LE suites use
 * 1972–1978 and 2190); every category and line is resolved by the id its INSERT returned.
 */

const fs = require('fs');
const path = require('path');
const repo = require('../budgetLe');
const svc = require('../../../services/budgetLe');
const crud = require('../../../services/forecast/crud');
const db = require('../../db');
const { makeApp, request } = require('../../routes/__tests__/_httpApp');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

const TAG = 'CR083BYLE';
const YEAR = 1979;
const LINE_A = `${TAG} Line A`;
const LINE_B = `${TAG} Line B`;

dbDescribe('CR083 §8.1 — base-year LE reference column (DB)', () => {
  const ids = {};
  let budgetBefore;

  async function cleanup() {
    await db.query(`DELETE FROM budget_le WHERE budget_year = $1`, [YEAR]);
    await db.query(`DELETE FROM transactions WHERE description1 LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM budget_entries WHERE description LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM fc_lines WHERE name LIKE $1`, [`${TAG}%`]);
    // Children before parents (parent_id FK).
    await db.query(`DELETE FROM accounts WHERE name LIKE $1 AND parent_id IS NOT NULL`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
  }

  const account = async (name, { parentId = null, isTransfer = false, type = 'expense' } = {}) => {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active, parent_id)
       VALUES ($1, $2, 'profit_loss', $3, 'USD', TRUE, $4) RETURNING id`,
      [`${TAG} ${name}`, type, isTransfer, parentId]
    );
    return rows[0].id;
  };
  const line = async (name, categoryId) => {
    const { rows } = await db.query(
      `INSERT INTO fc_lines (name) VALUES ($1) RETURNING id`, [name]
    );
    await db.query(
      `INSERT INTO fc_line_categories (fc_line_id, category_id) VALUES ($1, $2)`, [rows[0].id, categoryId]
    );
  };
  const txn = (month, amount, categoryId) => db.query(
    `INSERT INTO transactions
       (transaction_date, description1, amount, currency, base_amount, base_currency, category_id)
     VALUES (make_date($1, $2, 15), $3, $4, 'USD', $4, 'USD', $5)`,
    [YEAR, month, `${TAG} t`, amount, categoryId]
  );
  const budget = (month, amount, categoryId) => db.query(
    `INSERT INTO budget_entries
       (entry_date, description, amount, currency, base_amount, base_currency, category_id, budget_year)
     VALUES (make_date($1, $2, 1), $3, $4, 'USD', $4, 'USD', $5, $1)`,
    [YEAR, month, `${TAG} b`, amount, categoryId]
  );

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
    ids.alpha = await account('Alpha');
    ids.parent = await account('Parent', { type: 'income' });
    ids.beta = await account('Beta', { parentId: ids.parent, type: 'income' });
    ids.unmapped = await account('Unmapped', { type: 'income' });
    ids.xfer = await account('Xfer', { isTransfer: true });

    await line(LINE_A, ids.alpha);
    await line(LINE_B, ids.parent);      // mapped at the PARENT — the CTE must reach Beta

    await budget(2, -1000, ids.alpha);
    await budget(10, -500, ids.alpha);
    await budget(11, 2000, ids.beta);
    await txn(3, -1200, ids.alpha);
    await txn(4, 100, ids.beta);
    await txn(3, 50, ids.unmapped);
    await txn(5, -9999, ids.xfer);       // a transfer: out of LE scope

    budgetBefore = await crud.getBaseYearValues(null, YEAR);
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('no LE for the year ⇒ null (no column, no note)', async () => {
    expect(await svc.getForecastBaseYearReference(YEAR)).toBeNull();
    expect(await svc.getForecastBaseYearReference(null)).toBeNull();
  });

  test('a DRAFT alone is never shown', async () => {
    const draft = await repo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-06-30` });
    expect(await svc.getForecastBaseYearReference(YEAR)).toBeNull();
    await repo.finalize(draft.id);
    ids.first = draft.id;
  });

  test('picks the latest FINAL LE, not a later draft, and aggregates per FC line through the base-year mapping', async () => {
    const second = await repo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-08-31` });
    await repo.finalize(second.id);
    ids.second = second.id;
    // A later draft with a wild typed estimate — must not be chosen.
    const draft = await repo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-09-30` });
    await svc.saveCategoryEstimates(draft.id, ids.alpha, { [`${YEAR}-10`]: -77777 });

    const ref = await svc.getForecastBaseYearReference(YEAR);
    expect(ref.le.id).toBe(ids.second);
    expect(ref.le.name).toBe('LE-09-79');
    expect(ref.le.status).toBe('final');

    // Actual through Aug + budget carried for Oct/Nov.
    expect(ref.values[LINE_A]).toBeCloseTo(-1200 + -500, 2);
    expect(ref.values[LINE_B]).toBeCloseTo(100 + 2000, 2); // reached through the parent mapping
    expect(Object.keys(ref.values).filter((k) => k.startsWith(TAG)).sort()).toEqual([LINE_A, LINE_B]);

    // The per-line figures ARE the total; the budget side is the base year's own figure.
    expect(ref.total).toBeCloseTo(-1700 + 2100, 2);
    expect(ref.total).toBeCloseTo(Object.values(ref.values).reduce((s, v) => s + v, 0), 2);
    const budgetNow = await crud.getBaseYearValues(null, YEAR);
    expect(ref.budgetTotal).toBeCloseTo(Object.values(budgetNow).reduce((s, v) => s + v, 0), 2);
    expect(ref.gap).toBeCloseTo(ref.total - ref.budgetTotal, 2);

    // `Unmapped` is in the LE's NET but on no FC line: reported, not dropped.
    expect(ref.leNet).toBeCloseTo(ref.total + 50, 2);
    expect(ref.outsideLines).toBeCloseTo(50, 2);
  });

  test("honours the LE's OWN exclusion snapshot, not just the live scope", async () => {
    // Write a line onto an excluded category directly (the API would refuse it): the
    // reference must still ignore it, because the LE's header says it is out of scope.
    const le = await repo.findById(ids.second);
    expect(le.excluded_category_ids).toContain(ids.xfer);
    await db.query(`DELETE FROM fc_line_categories WHERE category_id = $1`, [ids.xfer]);
    const { rows } = await db.query(`SELECT id FROM fc_lines WHERE name = $1`, [LINE_A]);
    await db.query(
      `INSERT INTO fc_line_categories (fc_line_id, category_id) VALUES ($1, $2)`, [rows[0].id, ids.xfer]
    );
    await db.query(
      `INSERT INTO budget_le_lines (le_id, category_id, period_month, currency, source, method, amount, base_amount, fx_rate, fx_basis)
       VALUES ($1, $2, make_date($3, 11, 1), 'USD', 'manual', 'MANUAL', 5000, 5000, 1, 'manual')`,
      [ids.second, ids.xfer, YEAR]
    );
    const ref = await svc.getForecastBaseYearReference(YEAR);
    expect(ref.values[LINE_A]).toBeCloseTo(-1700, 2);
    expect(ref.leNet).toBeCloseTo(450, 2);
    await db.query(`DELETE FROM fc_line_categories WHERE category_id = $1`, [ids.xfer]);
  });

  test('display-only: the base year (budget) is unchanged by any of the LEs', async () => {
    const after = await crud.getBaseYearValues(null, YEAR);
    expect(after).toEqual(budgetBefore);
    expect(after[LINE_A]).toBeCloseTo(-1500, 2);
    expect(after[LINE_B]).toBeCloseTo(2000, 2);
  });

  test('display-only: the generation engine reads neither the LE tables nor the reference', () => {
    // The sweep's opening cash is `startingCash += budgetNCF + transfers` in index.js; if this
    // ever reaches the LE, the base year moves every month (§8.1 reason 3).
    // crud.js DEFINES the reader and is excluded; every other engine module must not mention it.
    const dir = path.join(__dirname, '../../../services/forecast');
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.js') && n !== 'crud.js');
    expect(files).toContain('index.js');
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect({ f, hit: /budget_le|getBaseYearLeValues|getForecastBaseYearReference/.test(src) })
        .toEqual({ f, hit: false });
    }
  });

  test('GET /forecast/base-year-le: 400 without a scenario, 404 for an unknown one', async () => {
    const app = makeApp('/forecast', require('../../routes/forecast'));
    expect((await request(app, 'GET', '/forecast/base-year-le')).status).toBe(400);
    const r = await request(app, 'GET', `/forecast/base-year-le?scenario=${TAG}-no-such-scenario`);
    expect(r.status).toBe(404);
  });
});
