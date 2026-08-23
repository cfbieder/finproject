/**
 * CR087 P0a — the opening_balance audit trail (DB).
 *
 * Migration 074 puts a trigger on `accounts` that records every change to
 * `opening_balance` / `opening_balance_date` into `audit_log`. This suite
 * asserts the trigger's behaviour, because the whole point of P0a is that a
 * re-anchor stops being invisible — and a trigger nobody tests is exactly the
 * "state that renders and produces no visible effect" class CR085 named.
 *
 * ⚠️ Why a trigger is tested here and not the service: `opening_balance` has
 * three live app writers plus five scripts plus the generic COA whitelist, and
 * the point of doing this in the database is that it covers all of them. A test
 * that went through one service would prove the least interesting case.
 *
 * Fixtures are self-managed: one throwaway account, tagged, removed afterwards
 * along with its audit rows. It never touches a real account.
 */
const db = require('../../db');

const TAG = '__test_ob_audit__';

async function auditRowsFor(accountId) {
  const { rows } = await db.query(
    `SELECT action, old_values, new_values, user_info, created_at
       FROM audit_log
      WHERE table_name = 'accounts' AND record_id = $1 AND action = 'opening_balance'
      ORDER BY id ASC`,
    [accountId]
  );
  return rows;
}

describe('opening_balance audit trigger (DB, migration 074)', () => {
  let accountId;

  beforeAll(async () => {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance, is_active)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 1000.00, FALSE)
       RETURNING id`,
      [TAG]
    );
    accountId = rows[0].id;
  });

  afterAll(async () => {
    if (accountId) {
      await db.query(`DELETE FROM audit_log WHERE table_name = 'accounts' AND record_id = $1`, [accountId]);
      await db.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    }
    await db.close();
  });

  beforeEach(async () => {
    await db.query(`DELETE FROM audit_log WHERE table_name = 'accounts' AND record_id = $1`, [accountId]);
    await db.query(`UPDATE accounts SET opening_balance = 1000.00 WHERE id = $1`, [accountId]);
    await db.query(`DELETE FROM audit_log WHERE table_name = 'accounts' AND record_id = $1`, [accountId]);
  });

  test('the migration is applied — trigger and function both exist', async () => {
    const { rows: trg } = await db.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_account_opening_balance' AND tgrelid = 'accounts'::regclass`
    );
    expect(trg).toHaveLength(1);
    const { rows: fn } = await db.query(`SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_account_opening_balance'`);
    expect(fn.length).toBeGreaterThan(0);
  });

  test('a real move writes one row carrying old, new and the delta', async () => {
    await db.query(`UPDATE accounts SET opening_balance = 1250.50 WHERE id = $1`, [accountId]);
    const rows = await auditRowsFor(accountId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].old_values.opening_balance)).toBe(1000);
    expect(Number(rows[0].new_values.opening_balance)).toBe(1250.5);
    // The delta is STORED, not derived at read time — it is the number a reader
    // actually wants, and deriving it later means re-deriving it everywhere.
    expect(Number(rows[0].new_values.delta)).toBeCloseTo(250.5, 2);
    expect(rows[0].new_values.currency).toBe('USD');
  });

  test('a negative re-anchor records a negative delta', async () => {
    await db.query(`UPDATE accounts SET opening_balance = 750.00 WHERE id = $1`, [accountId]);
    const rows = await auditRowsFor(accountId);
    expect(Number(rows[0].new_values.delta)).toBeCloseTo(-250, 2);
  });

  test('a no-op UPDATE writes NOTHING — the trail is moves, not touches', async () => {
    await db.query(`UPDATE accounts SET opening_balance = opening_balance WHERE id = $1`, [accountId]);
    expect(await auditRowsFor(accountId)).toHaveLength(0);
  });

  test('an UPDATE of an unrelated column writes nothing', async () => {
    await db.query(`UPDATE accounts SET name = $2 WHERE id = $1`, [accountId, `${TAG}_renamed`]);
    expect(await auditRowsFor(accountId)).toHaveLength(0);
    await db.query(`UPDATE accounts SET name = $2 WHERE id = $1`, [accountId, TAG]);
  });

  test('an opening_balance_date change fires too — it moves history just as surely', async () => {
    await db.query(`UPDATE accounts SET opening_balance_date = DATE '2001-02-03' WHERE id = $1`, [accountId]);
    const rows = await auditRowsFor(accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0].new_values.opening_balance_date).toBe('2001-02-03');
  });

  test('successive re-anchors accumulate — this is what "3x in 90d" counts', async () => {
    await db.query(`UPDATE accounts SET opening_balance = 1100 WHERE id = $1`, [accountId]);
    await db.query(`UPDATE accounts SET opening_balance = 1200 WHERE id = $1`, [accountId]);
    await db.query(`UPDATE accounts SET opening_balance = 1300 WHERE id = $1`, [accountId]);
    const rows = await auditRowsFor(accountId);
    expect(rows).toHaveLength(3);
    // Each row's `new` is the next row's `old`: the chain is walkable, which is
    // what makes it an undo path rather than a list of disconnected facts.
    expect(Number(rows[0].new_values.opening_balance)).toBe(Number(rows[1].old_values.opening_balance));
    expect(Number(rows[1].new_values.opening_balance)).toBe(Number(rows[2].old_values.opening_balance));
  });

  test('user_info is NULL when no caller sets app.actor', async () => {
    await db.query(`UPDATE accounts SET opening_balance = 1400 WHERE id = $1`, [accountId]);
    const rows = await auditRowsFor(accountId);
    expect(rows[0].user_info).toBeNull();
  });

  test('SET LOCAL app.actor is recorded — the path the services can adopt with no second migration', async () => {
    await db.transaction(async (client) => {
      await client.query(`SET LOCAL app.actor = 'calibrate'`);
      await client.query(`UPDATE accounts SET opening_balance = 1500 WHERE id = $1`, [accountId]);
    });
    const rows = await auditRowsFor(accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_info).toBe('calibrate');
  });

  test('the trigger does not swallow the write — the column still ends up correct', async () => {
    await db.query(`UPDATE accounts SET opening_balance = 4242.42 WHERE id = $1`, [accountId]);
    const { rows } = await db.query(`SELECT opening_balance FROM accounts WHERE id = $1`, [accountId]);
    expect(Number(rows[0].opening_balance)).toBeCloseTo(4242.42, 2);
  });
});
