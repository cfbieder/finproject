'use strict';
/**
 * cr063.coa-ordering.test.js — the Chart of Accounts order is the owner's, and
 * everything that reads the COA honours it.
 *
 * Four claims are pinned here:
 *
 *   1. getTree() sorts siblings by `display_order`. It used to sort `ORDER BY path`
 *      where path is ARRAY[id] — INSERTION order — which every tree, report and
 *      dropdown in the app inherited, because they all funnel through it.
 *   2. create() APPENDS to the end of its parent's group. It used to write
 *      `display_order = 0`, which under (1) files every new account at the TOP.
 *   3. reorderChildren() takes the whole sibling list, is idempotent, and REFUSES
 *      a caller whose view of the children is stale.
 *   4. Flat lists (findPLeaves) read in COA order, not alphabetically.
 *
 * Claims 1, 2 and 4 were FALSIFIED against the pre-CR063 code before being kept:
 * reverting `ORDER BY sort_path` → `ORDER BY path` and `?? null` → `|| 0` turns 3
 * of these 10 red, and reverting findPLeaves to `ORDER BY a.name` turns a 4th red.
 * Claim 3 is new behaviour with nothing to revert to — its tests are the spec.
 *
 * DB-backed and self-seeding: every row is created under a unique name and removed
 * again in afterAll.
 */

const db = require('../../db');
const repo = require('../../repositories').accounts;
const { makeApp, request } = require('./_httpApp');
const router = require('../util');

const app = makeApp('/util', router);
const req = (m, p, body) => request(app, m, `/util${p}`, body);

const SKIP = process.env.SKIP_DB_TESTS === '1';
const d = SKIP ? describe.skip : describe;

const TAG = `ZZOrderTest_${Date.now()}`;
const PARENT = `${TAG}_Parent`;
const A = `${TAG}_Alpha`;
const B = `${TAG}_Bravo`;
const C = `${TAG}_Charlie`;

let parentId;
let ids = {};

/** Sibling names under PARENT, in the order getTree renders them. */
async function treeOrder() {
  const rows = await repo.getTree({ section: 'profit_loss' });
  return rows.filter((r) => r.parent_id === parentId).map((r) => r.name);
}

/** display_order values straight from the table, keyed by name. */
async function ranks() {
  const r = await db.query(
    'SELECT name, display_order FROM accounts WHERE parent_id = $1 ORDER BY display_order',
    [parentId]
  );
  return r.rows.reduce((acc, row) => ({ ...acc, [row.name]: row.display_order }), {});
}

d('CR063 — Chart of Accounts ordering', () => {
  beforeAll(async () => {
    const p = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, is_active, display_order)
       VALUES ($1, 'expense', 'profit_loss', 'USD', TRUE, 999) RETURNING id`,
      [PARENT]
    );
    parentId = p.rows[0].id;

    // Created A, B, C in that order — so insertion order and intended order agree
    // at the start, and any later divergence is the code's doing, not the fixture's.
    for (const name of [A, B, C]) {
      const row = await repo.create({
        name,
        parent_id: parentId,
        account_type: 'expense',
        section: 'profit_loss',
        currency: 'USD',
      });
      ids[name] = row.id;
    }
  });

  afterAll(async () => {
    await db.query('DELETE FROM accounts WHERE name LIKE $1', [`${TAG}%`]);
  });

  describe('create() appends instead of prepending', () => {
    test('each new sibling lands at MAX(display_order) + 1', async () => {
      // FALSIFIED FIRST: with the old `data.display_order || 0`, all three rows come
      // back 0 and this reads {A:0, B:0, C:0}. Which is the whole defect — 22
      // accounts on dev shared rank 0, and under an order-honouring getTree they
      // would all have jumped above the seeded ones.
      const r = await ranks();
      expect(r[A]).toBe(1);
      expect(r[B]).toBe(2);
      expect(r[C]).toBe(3);
    });

    test('an explicit display_order still wins over the append default', async () => {
      // `?? null` not `|| null`: a caller asking for 0 gets 0. Only *absent* means append.
      const name = `${TAG}_Explicit`;
      const row = await repo.create({
        name,
        parent_id: parentId,
        account_type: 'expense',
        section: 'profit_loss',
        currency: 'USD',
        display_order: 0,
      });
      expect(row.display_order).toBe(0);
      await db.query('DELETE FROM accounts WHERE id = $1', [row.id]);
    });
  });

  describe('getTree() renders siblings in display_order', () => {
    test('reordering the rows reorders the tree', async () => {
      // FALSIFIED FIRST: against `ORDER BY path` (ARRAY[id]) this returns
      // [A, B, C] no matter what display_order says — id order is insertion order —
      // so the assertion below fails with the reversed array.
      expect(await treeOrder()).toEqual([A, B, C]);

      await repo.reorderChildren(parentId, [ids[C], ids[B], ids[A]]);
      expect(await treeOrder()).toEqual([C, B, A]);

      await repo.reorderChildren(parentId, [ids[A], ids[B], ids[C]]);
      expect(await treeOrder()).toEqual([A, B, C]);
    });

    test('siblings sharing a display_order fall back to id, not to a random order', async () => {
      // The tiebreak matters: it bounds a duplicate rank (which migration 049's DO
      // block refuses, but nothing stops a hand-written UPDATE from creating) to
      // "the old behaviour" rather than to whatever the planner feels like.
      await db.query('UPDATE accounts SET display_order = 7 WHERE parent_id = $1', [parentId]);
      expect(await treeOrder()).toEqual([A, B, C]); // = id order
      await repo.reorderChildren(parentId, [ids[A], ids[B], ids[C]]);
    });
  });

  describe('POST /coa/reorder', () => {
    test('rewrites the whole sibling list and is idempotent on replay', async () => {
      const body = { parentId, orderedIds: [ids[B], ids[C], ids[A]] };

      const first = await req('POST', '/coa/reorder', body);
      expect(first.status).toBe(200);
      expect(first.body.reordered).toBe(3);
      expect(await treeOrder()).toEqual([B, C, A]);

      const second = await req('POST', '/coa/reorder', body);
      expect(second.status).toBe(200);
      expect(await treeOrder()).toEqual([B, C, A]);

      // Ranks stay 1..n after a replay — a staging pass that leaked would show as
      // negative values here, and everything downstream would still "work" while
      // MAX+1 on the next create silently collided.
      expect(Object.values(await ranks()).sort()).toEqual([1, 2, 3]);

      await req('POST', '/coa/reorder', { parentId, orderedIds: [ids[A], ids[B], ids[C]] });
    });

    test('409s when the caller omits a child (a stale tree), and writes nothing', async () => {
      const before = await treeOrder();
      const r = await req('POST', '/coa/reorder', { parentId, orderedIds: [ids[C], ids[A]] });
      expect(r.status).toBe(409);
      expect(r.body.missing).toEqual([ids[B]]);
      expect(await treeOrder()).toEqual(before);
    });

    test('409s on an id belonging to another parent', async () => {
      const outsider = await db.query(
        `INSERT INTO accounts (name, account_type, section, currency, is_active)
         VALUES ($1, 'expense', 'profit_loss', 'USD', TRUE) RETURNING id`,
        [`${TAG}_Outsider`]
      );
      const r = await req('POST', '/coa/reorder', {
        parentId,
        orderedIds: [ids[A], ids[B], ids[C], outsider.rows[0].id],
      });
      expect(r.status).toBe(409);
      expect(r.body.unknown).toEqual([outsider.rows[0].id]);
      await db.query('DELETE FROM accounts WHERE id = $1', [outsider.rows[0].id]);
    });

    test('409s on a duplicated id rather than writing a short order', async () => {
      const r = await req('POST', '/coa/reorder', {
        parentId,
        orderedIds: [ids[A], ids[A], ids[B]],
      });
      expect(r.status).toBe(409);
      expect(r.body.error).toMatch(/duplicate/i);
    });

    test('400s on a malformed body, 404 on an unknown parent', async () => {
      expect((await req('POST', '/coa/reorder', { parentId, orderedIds: 'nope' })).status).toBe(400);
      expect(
        (await req('POST', '/coa/reorder', { parentId: 99999999, orderedIds: [ids[A]] })).status
      ).toBe(404);
    });
  });

  describe('flat lists read in COA order, not alphabetically', () => {
    test('findPLeaves groups a parent\'s leaves together in their set order', async () => {
      // The point of ordering a flat dropdown by tree position: the leaves of one
      // category arrive contiguously. Alphabetically they scatter across the list —
      // which is what `ORDER BY a.name` did, and why a category filter felt random.
      await repo.reorderChildren(parentId, [ids[C], ids[A], ids[B]]);

      const leaves = await repo.findPLeaves({ includeTransfers: true });
      const mine = leaves.map((l) => l.name).filter((n) => n.startsWith(TAG));
      expect(mine).toEqual([C, A, B]);

      // Contiguous, not merely in the right relative order.
      const positions = mine.map((n) => leaves.findIndex((l) => l.name === n));
      expect(positions[1]).toBe(positions[0] + 1);
      expect(positions[2]).toBe(positions[1] + 1);

      await repo.reorderChildren(parentId, [ids[A], ids[B], ids[C]]);
    });
  });
});
