'use strict';
/**
 * unpair.test.js — undoing a neutralize or a transfer (2026-10-01).
 *
 * A mis-clicked Neutralize on Refresh Feeds could only be repaired by hand: the
 * pairing overwrote the row's category and accepted flag and recorded neither.
 * Now each pairing writes an audit row and `unpair` puts things back — except on
 * a row the owner has edited since, whose correction must survive.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1). Seeds throwaway accounts, cleans up by name.
 */

const repo = require('../transactions');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('transactions.unpair (DB)', () => {
  const ACCT = 'TestUnpairAcct';
  let acctId;
  let targetId;
  let transferCat;
  let foodCat;

  async function cleanup() {
    await db.query(
      `DELETE FROM audit_log WHERE table_name = 'transactions' AND user_info = 'pairing'
         AND record_id IN (SELECT t.id FROM transactions t JOIN accounts a ON a.id = t.account_id
                            WHERE a.name LIKE $1)`,
      [`${ACCT}%`]
    );
    await db.query(
      `DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE $1)`,
      [`${ACCT}%`]
    );
    await db.query(`DELETE FROM accounts WHERE name LIKE $1 AND section = 'balance_sheet'`, [`${ACCT}%`]);
  }

  async function fresh() {
    await cleanup();
    const mk = async (name) => (await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 0) RETURNING id`, [name]
    )).rows[0].id;
    acctId = await mk(ACCT);
    targetId = await mk(`${ACCT}Target`);
  }

  async function addTx(amount, category = null, accountId = acctId) {
    return (await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, category_id, source, accepted)
       VALUES ('2026-09-21', 't', $1, 'USD', $1, 'USD', $2, $3, 'bank-feed', FALSE) RETURNING id`,
      [amount, accountId, category]
    )).rows[0].id;
  }

  const row = async (id) => (await db.query(
    `SELECT id, category_id, accepted, paired_with_id FROM transactions WHERE id = $1`, [id]
  )).rows[0] || null;
  const count = async (accountId) => (await db.query(
    `SELECT COUNT(*)::int AS n FROM transactions WHERE account_id = $1`, [accountId]
  )).rows[0].n;

  beforeAll(async () => {
    transferCat = (await db.query(
      `SELECT id FROM accounts WHERE name = 'Transfer - Securities Trades' LIMIT 1`
    )).rows[0].id;
    // Own spending category — never borrow one from ambient data (Known Issue #12).
    await db.query(`DELETE FROM accounts WHERE name = $1`, [`${ACCT}Food`]);
    foodCat = (await db.query(
      `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
       VALUES ($1, 'expense', 'profit_loss', FALSE, 'USD', TRUE) RETURNING id`, [`${ACCT}Food`]
    )).rows[0].id;
  });
  afterAll(async () => {
    await cleanup();
    await db.query(`DELETE FROM accounts WHERE name = $1`, [`${ACCT}Food`]);
    await db.close();
  });

  test('🔴 a mis-clicked MIRROR neutralize is fully undone: mirror gone, category and accepted back', async () => {
    await fresh();
    const id = await addTx(-54.1, foodCat);
    await repo.neutralize(id, transferCat);
    expect(await count(acctId)).toBe(2);

    const out = await repo.unpair(id);
    expect(out.deletedOffsetId).not.toBeNull();
    expect(await count(acctId)).toBe(1);
    expect(await row(id)).toMatchObject({ category_id: foodCat, accepted: false, paired_with_id: null });
    expect(out.keptEdits).toEqual([]);
  });

  test('a PAIR neutralize releases the claimed leg and restores BOTH rows; nothing is deleted', async () => {
    await fresh();
    const a = await addTx(-700, foodCat);
    const b = await addTx(700);                       // uncategorised candidate
    const n = await repo.neutralize(a, transferCat);
    expect(n.action).toBe('pair');

    const out = await repo.unpair(a);
    expect(out.deletedOffsetId).toBeNull();
    expect(await count(acctId)).toBe(2);
    expect(await row(a)).toMatchObject({ category_id: foodCat, accepted: false, paired_with_id: null });
    expect(await row(b)).toMatchObject({ category_id: null, accepted: false, paired_with_id: null });
  });

  test('works from the OTHER leg too', async () => {
    await fresh();
    const id = await addTx(-12, foodCat);
    const n = await repo.neutralize(id, transferCat);
    await repo.unpair(n.offset.id);
    expect(await row(n.offset.id)).toBeNull();
    expect(await row(id)).toMatchObject({ category_id: foodCat, accepted: false, paired_with_id: null });
  });

  test('🔴 a row the owner corrected since is NOT overwritten — only unlinked', async () => {
    await fresh();
    const id = await addTx(-30, foodCat);
    await repo.neutralize(id, transferCat);
    // The owner's own fix, in a later transaction (so a later updated_at).
    await db.query(`UPDATE transactions SET category_id = NULL, updated_at = NOW() + interval '1 second' WHERE id = $1`, [id]);

    const out = await repo.unpair(id);
    expect(out.keptEdits).toEqual([id]);
    expect(await row(id)).toMatchObject({ category_id: null, accepted: true, paired_with_id: null });
    expect(await count(acctId)).toBe(1);              // the mirror still goes
  });

  test('a TRANSFER is undone: target offset deleted, original back to unaccepted, category untouched', async () => {
    await fresh();
    const id = await addTx(-1200, foodCat);
    await repo.transferToAccount(id, targetId);
    expect(await count(targetId)).toBe(1);

    await repo.unpair(id);
    expect(await count(targetId)).toBe(0);
    expect(await row(id)).toMatchObject({ category_id: foodCat, accepted: false, paired_with_id: null });
  });

  test('transferring an already-paired row is refused, not double-offset', async () => {
    await fresh();
    const id = await addTx(-80, foodCat);
    await repo.neutralize(id, transferCat);
    await expect(repo.transferToAccount(id, targetId)).rejects.toThrow(/already paired/);
    expect(await count(targetId)).toBe(0);
  });

  test('🔴 an UNRECORDED pair (a feed sweep mirror, or pre-undo) is REFUSED — unless forced', async () => {
    await fresh();
    const id = await addTx(-5, transferCat);
    const mirror = (await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, category_id, source, accepted, paired_with_id)
       VALUES ('2026-09-21', 't', 5, 'USD', 5, 'USD', $1, $2, 'auto-offset', TRUE, $3) RETURNING id`,
      [acctId, transferCat, id]
    )).rows[0].id;
    await db.query(`UPDATE transactions SET paired_with_id = $1 WHERE id = $2`, [mirror, id]);

    await expect(repo.unpair(id)).rejects.toThrow(/No record of this pairing/);
    expect(await row(mirror)).not.toBeNull();

    const out = await repo.unpair(id, { force: true });
    expect(out).toMatchObject({ deletedOffsetId: mirror, restored: [], undid: 'unrecorded' });
    expect(await row(id)).toMatchObject({ category_id: transferCat, paired_with_id: null });
  });

  test('🔴 an offset with a booking built on it is refused, not cascaded away', async () => {
    await fresh();
    const id = await addTx(-300, foodCat);
    const { offset } = await repo.transferToAccount(id, targetId);
    // Book-at-source run on the offset (it carries the original's category).
    const leg = await addTx(300, foodCat, targetId);
    await db.query(
      `INSERT INTO income_restatements (source_transaction_id, holding_account_id, original_category_id,
                                        income_leg_id, transfer_leg_id, leg_snapshot)
       VALUES ($1, $2, $3, $4, $4, '{}')`,
      [offset.id, targetId, foodCat, leg]
    );
    try {
      await expect(repo.unpair(id)).rejects.toThrow(/booking built on it/);
      expect(await row(offset.id)).not.toBeNull();
    } finally {
      await db.query(`DELETE FROM income_restatements WHERE source_transaction_id = $1`, [offset.id]);
    }
  });

  test('an unpaired row is refused', async () => {
    await fresh();
    const id = await addTx(-1);
    await expect(repo.unpair(id)).rejects.toThrow(/not paired/);
  });
});
