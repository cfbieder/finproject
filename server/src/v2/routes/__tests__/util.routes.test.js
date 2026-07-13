'use strict';
/**
 * util.routes.test.js — contract tests for routes/util.js (CR043, 2.2 tail).
 *
 * util.js held 13 endpoints across four unrelated concerns (FX, appdata, Chart of Accounts,
 * backup) and had **no tests at all** — including the COA add/update/delete WRITES that the
 * Chart of Accounts page depends on. The CR called for splitting the file; splitting
 * untested code is how you find out later. So the tests come first.
 *
 * Writing them immediately found a real bug (pinned below): POST /coa/update destructured
 * `type` and never used it, so changing an account's type returned 200 and changed nothing.
 *
 * DB-backed and self-seeding: every row is created under a unique name and removed again.
 */

const db = require('../../db');
const { makeApp, request } = require('./_httpApp');
const router = require('../util');

const app = makeApp('/util', router);
const req = (m, p, body) => request(app, m, `/util${p}`, body);

const SKIP = process.env.SKIP_DB_TESTS === '1';
const d = SKIP ? describe.skip : describe;

// Unique names so parallel/repeat runs cannot collide.
const TAG = `ZZUtilTest_${Date.now()}`;
const PARENT = `${TAG}_Parent`;
const CHILD = `${TAG}_Child`;

let parentId;

d('routes/util.js', () => {
  beforeAll(async () => {
    // A parent to hang the COA test account off. 'expense' so a type CHANGE is observable.
    const r = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, is_active)
       VALUES ($1, 'expense', 'profit_loss', 'USD', TRUE) RETURNING id`,
      [PARENT]
    );
    parentId = r.rows[0].id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
  });

  describe('reads', () => {
    test('GET /currencies → 200, a list', async () => {
      const r = await req('GET', '/currencies');
      expect(r.status).toBe(200);
      expect(r.body).toBeDefined();
    });

    test('GET /coa-traits → 200, name → { Currency, Type, AccountNumber }', async () => {
      const r = await req('GET', '/coa-traits');
      expect(r.status).toBe(200);
      const traits = r.body[PARENT];
      expect(traits).toBeDefined();
      // `Type` here IS accounts.account_type — the thing /coa/update was dropping.
      expect(traits.Type).toBe('expense');
      expect(traits.Currency).toBe('USD');
    });

    test('GET /coa/BalanceSheet and /coa/CashFlow → 200, trees', async () => {
      for (const path of ['/coa/BalanceSheet', '/coa/CashFlow']) {
        const r = await req('GET', path);
        expect(r.status).toBe(200);
        expect(Array.isArray(r.body)).toBe(true);
      }
    });

    test('GET /attention-summary → 200', async () => {
      const r = await req('GET', '/attention-summary');
      expect(r.status).toBe(200);
    });
  });

  describe('POST /coa/update — the type it used to throw away', () => {
    test('applies a type change (REGRESSION: it was destructured and never used)', async () => {
      // The bug, exactly: the editor sends `type` on every save, the repo's update() has
      // always accepted account_type, but the route never passed it — so this returned 200,
      // echoed the OLD type back, and changed nothing. Proven on dev before the fix:
      // currency went USD→EUR in the SAME request while type stayed 'expense'.
      const r = await req('POST', '/coa/update', {
        oldName: PARENT,
        name: PARENT,
        type: 'income',
        currency: 'EUR',
      });

      expect(r.status).toBe(200);
      expect(r.body.updated.type).toBe('income'); // was 'expense' — the whole bug
      expect(r.body.updated.currency).toBe('EUR');

      // …and it is actually in the database, not just in the response.
      const row = await db.query('SELECT account_type, currency FROM accounts WHERE id = $1', [
        parentId,
      ]);
      expect(row.rows[0].account_type).toBe('income');
      expect(row.rows[0].currency).toBe('EUR');

      // put it back for the tests below
      await req('POST', '/coa/update', { oldName: PARENT, name: PARENT, type: 'expense', currency: 'USD' });
    });

    test("treats 'Category' as 'no type change', not as a bad value", async () => {
      // The UI shows "Category" for a tree node with no traits row and sends it back
      // verbatim. Rejecting it would break editing every category.
      const r = await req('POST', '/coa/update', {
        oldName: PARENT,
        name: PARENT,
        type: 'Category',
      });
      expect(r.status).toBe(200);
      const row = await db.query('SELECT account_type FROM accounts WHERE id = $1', [parentId]);
      expect(row.rows[0].account_type).toBe('expense'); // unchanged
    });

    test('400s on a type that is neither blank nor real — loud, not silently dropped', async () => {
      const r = await req('POST', '/coa/update', {
        oldName: PARENT,
        name: PARENT,
        type: 'liabilty', // typo
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Invalid type/i);
    });

    test('404s for an account that does not exist', async () => {
      const r = await req('POST', '/coa/update', { oldName: `${TAG}_nope`, name: 'x' });
      expect(r.status).toBe(404);
    });

    test('400s when a name is missing', async () => {
      const r = await req('POST', '/coa/update', { oldName: PARENT });
      expect(r.status).toBe(400);
    });
  });

  describe('POST /coa/add → /coa/delete round trip', () => {
    test('adds a child under a parent, inheriting the parent type, then deletes it', async () => {
      const add = await req('POST', '/coa/add', {
        path: [PARENT],
        name: CHILD,
        currency: 'USD',
      });
      expect(add.status).toBe(200);

      // A child inherits its parent's account_type by design (a child of an expense parent
      // IS an expense) — the body's `type` is deliberately not honored here.
      const row = await db.query(
        'SELECT account_type, parent_id FROM accounts WHERE name = $1',
        [CHILD]
      );
      expect(row.rows[0].account_type).toBe('expense');
      expect(row.rows[0].parent_id).toBe(parentId);

      const del = await req('POST', '/coa/delete', { name: CHILD });
      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);
    });

    test('400s with no path, 404s for an unknown parent', async () => {
      expect((await req('POST', '/coa/add', { name: 'x' })).status).toBe(400);
      expect(
        (await req('POST', '/coa/add', { path: [`${TAG}_nope`], name: 'x' })).status
      ).toBe(404);
    });

    test('404s deleting an account that does not exist', async () => {
      const r = await req('POST', '/coa/delete', { name: `${TAG}_nope` });
      expect(r.status).toBe(404);
    });
  });
});
