'use strict';
/**
 * removePromoted.test.js — deleting a bank-feed-promoted transaction.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434 via
 * DATABASE_URL. Seeds a throwaway account + staging row, cleans up by unique
 * name / source tag — never TRUNCATE.
 *
 * The defect: `bankfeed_staging.promoted_transaction_id` is an FK with NO
 * ACTION, so a bare DELETE on the transaction raised
 *   "violates foreign key constraint bankfeed_staging_promoted_transaction_id_fkey"
 * and NO fed transaction could be deleted from the UI. Releasing the pointer
 * alone is not enough — promote() re-promotes any row with
 * `promoted_transaction_id IS NULL AND suppressed = FALSE`, so the deleted row
 * would return on the next refresh. Both halves are asserted here.
 */

const repo = require('../transactions');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('transactions.remove — bank-feed promoted row (DB)', () => {
  const ACCT = 'TestRemovePromotedAcct';
  const EXT = 'test-remove-promoted-1';
  let acctId;

  async function cleanup() {
    await db.query(`DELETE FROM bankfeed_staging WHERE external_id = $1`, [EXT]);
    if (acctId) await db.query(`DELETE FROM transactions WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
    acctId = null;
  }

  beforeEach(async () => {
    await cleanup();
    acctId = (await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 0) RETURNING id`,
      [ACCT]
    )).rows[0].id;
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('deletes the transaction and suppresses its staging row', async () => {
    const txId = (await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, source)
       VALUES ('2026-07-26','Top-Up by *5778', 200, 'EUR', 232, 'USD', $1, 'bank-feed') RETURNING id`,
      [acctId]
    )).rows[0].id;

    const stagingId = (await db.query(
      `INSERT INTO bankfeed_staging (external_id, source, transaction_date, amount, currency, promoted_transaction_id)
       VALUES ($1, 'fintable', '2026-07-26', 200, 'EUR', $2) RETURNING id`,
      [EXT, txId]
    )).rows[0].id;

    // Against the pre-fix `remove()` this line throws the FK violation.
    await expect(repo.remove(txId)).resolves.toBe(true);

    const gone = await db.query(`SELECT id FROM transactions WHERE id = $1`, [txId]);
    expect(gone.rowCount).toBe(0);

    // The staging row survives — it is the feed's record that this arrived —
    // but must be suppressed, or promote() books it again on the next refresh.
    const staging = (await db.query(
      `SELECT promoted_transaction_id, suppressed FROM bankfeed_staging WHERE id = $1`,
      [stagingId]
    )).rows[0];
    expect(staging.promoted_transaction_id).toBeNull();
    expect(staging.suppressed).toBe(true);
  });

  test('a transaction with no staging row still deletes, and missing ids return false', async () => {
    const txId = (await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, source)
       VALUES ('2026-07-26','manual', -10, 'USD', -10, 'USD', $1, 'manual') RETURNING id`,
      [acctId]
    )).rows[0].id;

    await expect(repo.remove(txId)).resolves.toBe(true);
    await expect(repo.remove(txId)).resolves.toBe(false);
  });
});
