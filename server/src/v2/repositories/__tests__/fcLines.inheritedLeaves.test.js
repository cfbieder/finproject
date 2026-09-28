'use strict';
/**
 * CR066 — a line mapped at a PARENT category reaches that parent's leaves on the Review page.
 *
 * The Review matches ledger leaves to lines by exact name; `review-structure` used to return only
 * the directly mapped names, so the `Patrick - *` leaves (mapped through `Children - Patrick`)
 * matched nothing and ~39,000 of 2025 spend fell out of every FC-line row.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const repo = require('../fcLines');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const P = 'CR066T';

dbDescribe('fcLines.findInheritedLeafNames (DB)', () => {
  const ids = {};

  async function cleanup() {
    await db.query('DELETE FROM fc_lines WHERE name LIKE $1', [`${P} %`]);
    await db.query('DELETE FROM accounts WHERE name LIKE $1 AND parent_id IS NOT NULL', [`${P} %`]);
    await db.query('DELETE FROM accounts WHERE name LIKE $1', [`${P} %`]);
  }
  const account = async (name, parentId = null) => (await db.query(
    `INSERT INTO accounts (name, account_type, section, currency, opening_balance, parent_id)
     VALUES ($1, 'expense', 'profit_loss', 'USD', 0, $2) RETURNING id`, [name, parentId]
  )).rows[0].id;
  const line = async (name) => (await db.query(
    `INSERT INTO fc_lines (name, line_type) VALUES ($1, 'forecast_expense') RETURNING id`, [name]
  )).rows[0].id;
  const map = (lineId, catId) => db.query(
    'INSERT INTO fc_line_categories (fc_line_id, category_id) VALUES ($1, $2)', [lineId, catId]
  );

  beforeAll(async () => {
    await cleanup();
    ids.parent = await account(`${P} Parent`);
    ids.leafA = await account(`${P} Leaf A`, ids.parent);
    ids.leafB = await account(`${P} Leaf B`, ids.parent);
    ids.leafOwn = await account(`${P} Leaf Own`, ids.parent);
    ids.lineParent = await line(`${P} Line Parent`);
    ids.lineOwn = await line(`${P} Line Own`);
    await map(ids.lineParent, ids.parent);
    await map(ids.lineOwn, ids.leafOwn);
  });
  afterAll(cleanup);

  test('a parent-mapped line reaches its leaves; a directly mapped leaf keeps its own line', async () => {
    const byLine = await repo.findInheritedLeafNames();
    expect(byLine.get(ids.lineParent)).toEqual([`${P} Leaf A`, `${P} Leaf B`]);
    // Mapped in its own right: listed nowhere as inherited, so the parent cannot re-route it.
    expect(byLine.get(ids.lineOwn)).toBeUndefined();
  });
});
