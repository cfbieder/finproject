'use strict';
/**
 * accountInactive.test.js — CR101 P0: accounts inactive from a date.
 *
 * DB-backed on self-seeded `CR101T` accounts: the inherited date (migration 089's view, parent wins),
 * the first-of-month rule, and D2 — a balance-sheet account or parent must read zero, in its own
 * currency, on the day before the date. Skip with SKIP_DB_TESTS=1.
 */

const svc = require('../accountInactive');
const accountsRepo = require('../../v2/repositories/accounts');
const db = require('../../v2/db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const P = 'CR101T';

dbDescribe('accounts inactive from a date (DB)', () => {
  const ids = {};
  const cleanup = async () => {
    await db.query('DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE $1)', [`${P} %`]);
    for (let i = 0; i < 3; i++) {
      await db.query(`DELETE FROM accounts WHERE name LIKE $1 AND id NOT IN (SELECT parent_id FROM accounts WHERE parent_id IS NOT NULL)`, [`${P} %`]);
    }
  };
  const account = async (name, { section = 'balance_sheet', type = 'asset', currency = 'EUR', parent = null } = {}) =>
    (await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance, opening_balance_date, parent_id)
       VALUES ($1, $2, $3, $4, 0, '2090-01-01', $5) RETURNING id`, [`${P} ${name}`, type, section, currency, parent]
    )).rows[0].id;
  const tx = (date, amount, accountId) => db.query(
    `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, source, accepted)
     VALUES ($1, 't', $2, 'EUR', $2, 'USD', $3, 'manual', TRUE)`, [date, amount, accountId]
  );
  const eff = async (id) => (await db.query(
    'SELECT inactive_from_eff::text AS d FROM account_inactive_effective WHERE id = $1', [id]
  )).rows[0].d;

  beforeAll(async () => {
    await cleanup();
    ids.prop = await account('Property');                       // a balance-sheet parent
    ids.flat = await account('Flat', { parent: ids.prop });
    ids.bank = await account('Bank', { parent: ids.prop });
    ids.cat = await account('Condo Fees', { section: 'profit_loss', type: 'expense' });
    ids.catParent = await account('Spain costs', { section: 'profit_loss', type: 'expense' });
    ids.catLeaf = await account('Spain water', { section: 'profit_loss', type: 'expense', parent: ids.catParent });
    await tx('2090-03-01', 1000, ids.flat);      // bought
    await tx('2090-09-15', -1000, ids.flat);     // sold: zero from 2090-09-15
    await tx('2090-10-10', 250.5, ids.bank);     // still holds 250.50 EUR
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('the inherited date: the earliest on the path wins (D6); none is NULL', async () => {
    expect(await eff(ids.catLeaf)).toBeNull();
    await accountsRepo.update(ids.catParent, { inactive_from: '2091-01-01' });
    await accountsRepo.update(ids.catLeaf, { inactive_from: '2092-01-01' });
    expect(await eff(ids.catLeaf)).toBe('2091-01-01');        // parent wins
    await accountsRepo.update(ids.catLeaf, { inactive_from: '2090-06-01' });
    expect(await eff(ids.catLeaf)).toBe('2090-06-01');        // earlier own date
    await accountsRepo.update(ids.catParent, { inactive_from: null });
    await accountsRepo.update(ids.catLeaf, { inactive_from: null });
  });

  test('the date must be the first of a month — in the service and in the database', async () => {
    await expect(svc.checkInactiveFrom(ids.cat, '2091-01-15')).rejects.toThrow(/first of a month/);
    await expect(svc.checkInactiveFrom(ids.cat, 'soon')).rejects.toThrow(/first of a month/);
    await expect(db.query('UPDATE accounts SET inactive_from = $2 WHERE id = $1', [ids.cat, '2091-01-15']))
      .rejects.toThrow(/accounts_inactive_from_first_chk/);
    expect(await svc.checkInactiveFrom(ids.cat, null)).toBeNull();
    expect(await svc.checkInactiveFrom(ids.cat, '2091-01-01')).toBe('2091-01-01'); // P&L: no balance
  });

  test('D2: a balance-sheet leaf must read zero the day before, in its own currency', async () => {
    await expect(svc.checkInactiveFrom(ids.flat, '2090-09-01')).rejects.toThrow(/Not zero on 2090-08-31: CR101T Flat holds 1,000.00 EUR/);
    expect(await svc.checkInactiveFrom(ids.flat, '2090-10-01')).toBe('2090-10-01');
  });

  test('D2 on a balance-sheet parent checks every leaf, and names the one that is not zero', async () => {
    await expect(svc.checkInactiveFrom(ids.prop, '2091-01-01')).rejects.toThrow(/CR101T Bank holds 250.50 EUR/);
    await tx('2090-12-20', -250.5, ids.bank);
    expect(await svc.checkInactiveFrom(ids.prop, '2091-01-01')).toBe('2091-01-01');
    // A posting dated after the date does not count: it is the day before that matters.
    await tx('2091-02-01', 99, ids.bank);
    expect(await svc.checkInactiveFrom(ids.prop, '2091-01-01')).toBe('2091-01-01');
  });

  test('listInactive gives own date, inherited date and last activity', async () => {
    await accountsRepo.update(ids.prop, { inactive_from: '2091-01-01' });
    const rows = await svc.listInactive();
    const flat = rows.find((r) => r.id === ids.flat);
    expect(flat).toEqual({ id: ids.flat, name: `${P} Flat`, inactiveFrom: null, inactiveFromEffective: '2091-01-01', lastActivity: '2090-09-15' });
    expect(rows.find((r) => r.id === ids.prop).inactiveFrom).toBe('2091-01-01');
    await accountsRepo.update(ids.prop, { inactive_from: null });
  });
});
