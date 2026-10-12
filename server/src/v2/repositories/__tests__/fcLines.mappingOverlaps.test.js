'use strict';
/**
 * A category and its parent/child on DIFFERENT FC lines double-count the child: every line total
 * walks a mapped category down to its leaves. Prod had `Car Expense` on Living Expenses beside its
 * leaves on Car Expenses — 31,648 of the 2026 budget on two rows.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const repo = require('../fcLines');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const P = 'OVLPT';

dbDescribe('fcLines.findMappingOverlaps (DB)', () => {
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
    ids.top = await account(`${P} Top`);
    ids.mid = await account(`${P} Mid`, ids.top);
    ids.leaf = await account(`${P} Leaf`, ids.mid);
    ids.other = await account(`${P} Other`, ids.top);
    ids.lineA = await line(`${P} Line A`);
    ids.lineB = await line(`${P} Line B`);
    await map(ids.lineB, ids.leaf);
  });
  afterAll(cleanup);

  test('a parent of a leaf mapped on another line overlaps, at any depth', async () => {
    expect(await repo.findMappingOverlaps(ids.lineA, [ids.top])).toEqual([
      { category_name: `${P} Top`, conflict_name: `${P} Leaf`, conflict_line: `${P} Line B` },
    ]);
    expect(await repo.findMappingOverlaps(ids.lineA, [ids.mid])).toHaveLength(1);
  });

  test('a child of a category mapped on another line overlaps', async () => {
    await map(ids.lineB, ids.top);
    try {
      const rows = await repo.findMappingOverlaps(ids.lineA, [ids.other]);
      expect(rows).toEqual([
        { category_name: `${P} Other`, conflict_name: `${P} Top`, conflict_line: `${P} Line B` },
      ]);
    } finally {
      await db.query('DELETE FROM fc_line_categories WHERE category_id = $1', [ids.top]);
    }
  });

  test('the same line, the same id (a move), and an unrelated branch are not overlaps', async () => {
    expect(await repo.findMappingOverlaps(ids.lineB, [ids.top])).toEqual([]);
    expect(await repo.findMappingOverlaps(ids.lineA, [ids.leaf])).toEqual([]);
    expect(await repo.findMappingOverlaps(ids.lineA, [ids.other])).toEqual([]);
  });
});
