'use strict';
/**
 * cr088.le-cash-flow.test.js — CR088 P2.
 *
 * Pins `GET /budget/le/:id/cash-flow`: the tree shape, the transfer convention,
 * the period window, and the one property the whole feature turns on —
 * **before the LE's cut, the LE IS the actual.**
 *
 * DB-backed (skip with SKIP_DB_TESTS=1) and **self-seeding**: it creates its own
 * COA rows, its own LE and its own `budget_le_lines`, and cleans up by name. It
 * reads no ambient data and hardcodes no id — Known Issues #20/#21 are five
 * separate instances of a suite that borrowed something only dev's database
 * has, passed locally, and reddened `main`.
 *
 * The year is **2190**, in which no real database holds a single transaction,
 * budget entry or LE line — so every figure asserted below is exactly what this
 * file seeded.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../budget');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/budget', router);
const req = (m, p) => request(app, m, `/budget${p}`);

const TAG = 'CR088LECF';
const YEAR = 2190;
const CUT = `${YEAR}-07-31`;

dbDescribe('GET /budget/le/:id/cash-flow (DB)', () => {
  const ids = {};
  let leId;

  async function cleanup() {
    await db.query(
      `DELETE FROM budget_le_lines WHERE le_id IN
         (SELECT id FROM budget_le WHERE budget_year = $1)`, [YEAR]
    );
    await db.query(`DELETE FROM budget_le WHERE budget_year = $1`, [YEAR]);
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

  // `method` is CHECK-constrained by migration 072 to the real method enum, so
  // the seed carries the method that actually pairs with each source rather
  // than a placeholder.
  const METHOD = { actual: 'ACTUAL', budget_carry: 'CARRY', manual: 'MANUAL' };

  async function addLine(categoryId, month, amount, source) {
    await db.query(
      `INSERT INTO budget_le_lines
         (le_id, category_id, period_month, currency, source, method, amount, base_amount)
       VALUES ($1, $2, make_date($3, $4, 1), 'USD', $5, $6, $7, $7)`,
      [leId, categoryId, YEAR, month, source, METHOD[source], amount]
    );
  }

  /** Flatten the returned tree to { leafName: { total, hasLe } }. */
  function leaves(nodes, out = {}) {
    for (const n of nodes) {
      if (n.children && n.children.length) leaves(n.children, out);
      else out[n.name] = { total: Number(n.total), hasLe: n.hasLe };
    }
    return out;
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();

    ids.plain = await addAccount(`${TAG} Plain`);
    ids.parent = await addAccount(`${TAG} Parent`);
    ids.child = await addAccount(`${TAG} Child`, { parentId: ids.parent });
    // A category the LE carries NO line for, so absent-vs-zero can be told apart.
    ids.silent = await addAccount(`${TAG} Silent`);
    ids.transfer = await addAccount(`${TAG} Transfer Thing`, { isTransfer: true });

    const { rows } = await db.query(
      `INSERT INTO budget_le (budget_year, actual_through, name, status)
       VALUES ($1, $2::date, $3, 'draft') RETURNING id`,
      [YEAR, CUT, `${TAG}-LE`]
    );
    leId = rows[0].id;

    // Pre-cut months carry the ACTUAL, exactly as materialisation writes them.
    await addLine(ids.plain, 3, -250, 'actual');
    await addLine(ids.child, 3, -22, 'actual');
    await addLine(ids.parent, 3, -11, 'actual');

    // Post-cut months carry the estimate.
    await addLine(ids.plain, 9, -400, 'budget_carry');
    await addLine(ids.plain, 10, -600, 'manual');

    // Noise on the transfer category, large enough that a failed exclusion
    // could never be mistaken for a rounding difference.
    await addLine(ids.transfer, 3, -900000, 'actual');
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('rejects a missing or malformed period', async () => {
    expect((await req('GET', `/le/${leId}/cash-flow`)).status).toBe(400);
    const bad = await req('GET', `/le/${leId}/cash-flow?fromDate=nope&toDate=${YEAR}-12-31`);
    expect(bad.status).toBe(400);
  });

  test('404s an LE that does not exist', async () => {
    const r = await req('GET', `/le/0/cash-flow?fromDate=${YEAR}-01-01&toDate=${YEAR}-12-31`);
    expect(r.status).toBe(404);
  });

  // The TREE shape matches /budget/cash-flow; the ENVELOPE deliberately does
  // not — see the note on the route.
  test('returns the same tree shape as /budget/cash-flow, under { data }', async () => {
    const r = await req('GET', `/le/${leId}/cash-flow?fromDate=${YEAR}-01-01&toDate=${YEAR}-12-31`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data['Profit & Loss Accounts'])).toBe(true);
    expect(r.body.data.le).toMatchObject({ id: leId, budgetYear: YEAR, actualThrough: CUT });
  });

  test('sums only the months inside the window', async () => {
    const pre = leaves(
      (await req('GET', `/le/${leId}/cash-flow?fromDate=${YEAR}-01-01&toDate=${YEAR}-07-31`))
        .body.data['Profit & Loss Accounts']
    );
    expect(pre[`${TAG} Plain`].total).toBe(-250);

    const post = leaves(
      (await req('GET', `/le/${leId}/cash-flow?fromDate=${YEAR}-08-01&toDate=${YEAR}-12-31`))
        .body.data['Profit & Loss Accounts']
    );
    expect(post[`${TAG} Plain`].total).toBe(-1000); // -400 carry + -600 manual

    const all = leaves(
      (await req('GET', `/le/${leId}/cash-flow?fromDate=${YEAR}-01-01&toDate=${YEAR}-12-31`))
        .body.data['Profit & Loss Accounts']
    );
    expect(all[`${TAG} Plain`].total).toBe(-1250);
  });

  test('a month OUTSIDE the window contributes nothing, and absence is not zero', async () => {
    // February holds no line at all: the category is present in the tree, with
    // total 0 and hasLe FALSE. Rendering that as $0.00 would claim the owner
    // estimated nothing rather than that the LE has no view — CR087 P0b.
    const feb = leaves(
      (await req('GET', `/le/${leId}/cash-flow?fromDate=${YEAR}-02-01&toDate=${YEAR}-02-28`))
        .body.data['Profit & Loss Accounts']
    );
    expect(feb[`${TAG} Plain`]).toEqual({ total: 0, hasLe: false });
  });

  test('a category the LE never carries is absent, not zero', async () => {
    const all = leaves(
      (await req('GET', `/le/${leId}/cash-flow?fromDate=${YEAR}-01-01&toDate=${YEAR}-12-31`))
        .body.data['Profit & Loss Accounts']
    );
    expect(all[`${TAG} Silent`]).toEqual({ total: 0, hasLe: false });
    expect(all[`${TAG} Plain`].hasLe).toBe(true);
  });

  test('applies the page transfer convention, both ways', async () => {
    const excluded = leaves(
      (await req('GET', `/le/${leId}/cash-flow?fromDate=${YEAR}-01-01&toDate=${YEAR}-12-31&transfers=exclude`))
        .body.data['Profit & Loss Accounts']
    );
    expect(excluded[`${TAG} Transfer Thing`]).toBeUndefined();

    const included = leaves(
      (await req('GET', `/le/${leId}/cash-flow?fromDate=${YEAR}-01-01&toDate=${YEAR}-12-31&transfers=include`))
        .body.data['Profit & Loss Accounts']
    );
    expect(included[`${TAG} Transfer Thing`].total).toBe(-900000);
  });

  test('a parent rolls up its subtree AND its own directly-posted lines', async () => {
    const r = await req('GET', `/le/${leId}/cash-flow?fromDate=${YEAR}-01-01&toDate=${YEAR}-12-31`);
    const find = (nodes, name) => {
      for (const n of nodes) {
        if (n.name === name) return n;
        if (n.children) { const hit = find(n.children, name); if (hit) return hit; }
      }
      return null;
    };
    const parent = find(r.body.data['Profit & Loss Accounts'], `${TAG} Parent`);
    expect(parent).toBeTruthy();
    // ⚠️ -22 only. The parent's OWN -11 is invisible here BY CONSTRUCTION: the
    // tree builder sums children and a non-leaf node is never looked up in the
    // totals map — the same limitation `/budget/cash-flow` has, deliberately
    // shared so the LE column cannot disagree with the two beside it. The LE
    // GRID does count it (CR083 §2.1a); that is why the two surfaces differ,
    // and why this is pinned rather than left to be rediscovered.
    expect(Number(parent.total)).toBe(-22);
    expect(parent.hasLe).toBe(true);
  });
});
