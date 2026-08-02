'use strict';
/**
 * neutralize.test.js — smart securities-trade neutralization.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434 via
 * DATABASE_URL. Seeds a throwaway account + transactions, cleans up by unique
 * name — never TRUNCATE.
 *
 * Covers the two behaviours:
 *  - PAIR: an offsetting leg already exists (e.g. SPAXX redemption ↔ assigned
 *    puts) → both set to the transfer category, NO new row.
 *  - MIRROR: a lone trade → an offsetting entry is created.
 */

const repo = require('../transactions');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('transactions.neutralize (DB)', () => {
  const ACCT = 'TestNeutralizeAcct';
  let acctId;
  let categoryId;

  async function freshAccount() {
    await cleanup();
    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 0) RETURNING id`,
      [ACCT]
    );
    acctId = a.rows[0].id;
  }

  async function addTx(amount, date = '2026-06-02', category = null) {
    return (await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, category_id, source, accepted)
       VALUES ($1,'t',$2,'USD',$2,'USD',$3,$4,'bank-feed',FALSE) RETURNING id`,
      [date, amount, acctId, category]
    )).rows[0].id;
  }

  async function cleanup() {
    if (acctId) await db.query(`DELETE FROM transactions WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
    acctId = null;
  }

  beforeAll(async () => {
    categoryId = (await db.query(
      `SELECT id FROM accounts WHERE name = 'Transfer - Securities Trades' LIMIT 1`
    )).rows[0].id;
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('PAIR: existing offsetting leg → both set to transfer, no new row', async () => {
    await freshAccount();
    const buyId = await addTx(-41750);                 // assigned-puts buy
    const redemptionId = await addTx(41750, '2026-06-02', categoryId); // SPAXX redemption (already transfer)

    const before = (await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id=$1`, [acctId])).rows[0].n;
    const out = await repo.neutralize(buyId, categoryId);

    expect(out.paired).toBe(true);
    const after = (await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id=$1`, [acctId])).rows[0].n;
    expect(after).toBe(before); // NO new entry

    const rows = (await db.query(`SELECT id, category_id, accepted FROM transactions WHERE account_id=$1`, [acctId])).rows;
    expect(rows.every((r) => r.category_id === categoryId && r.accepted === true)).toBe(true);
    expect(out.offset.id).toBe(redemptionId);
  });

  test('dryRun: previews action without writing (pair vs mirror)', async () => {
    await freshAccount();
    const lone = await addTx(-500);
    const before = (await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id=$1`, [acctId])).rows[0].n;

    const planMirror = await repo.neutralize(lone, categoryId, { dryRun: true });
    expect(planMirror.action).toBe('mirror');
    expect(planMirror.dryRun).toBe(true);

    await addTx(500); // now there IS an offsetting leg
    const planPair = await repo.neutralize(lone, categoryId, { dryRun: true });
    expect(planPair.action).toBe('pair');

    const after = (await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id=$1`, [acctId])).rows[0].n;
    expect(after).toBe(before + 1); // only the addTx(500), nothing from dryRuns
  });

  test('CR032 guard: a real-trade-categorized leg is NOT consumed → mirrors instead', async () => {
    await freshAccount();
    const optionTradeId = (await db.query(
      `SELECT id FROM accounts WHERE name = 'Option Trade' LIMIT 1`
    )).rows[0].id;
    // The assigned-puts buy the user deliberately categorized as a real Option Trade…
    const buyId = await addTx(-30000, '2026-06-08', optionTradeId);
    // …must NOT be swallowed when neutralizing the equal-and-opposite SPAXX redemption.
    const redemptionId = await addTx(30000, '2026-06-08', categoryId);

    const out = await repo.neutralize(redemptionId, categoryId);
    expect(out.paired).toBe(false);                    // guard refused → MIRROR path

    const rows = (await db.query(
      `SELECT amount, source FROM transactions WHERE account_id=$1 ORDER BY amount`, [acctId]
    )).rows;
    expect(rows).toHaveLength(3);                       // buy + redemption + new mirror
    const mirror = rows.find((r) => r.source === 'auto-offset');
    expect(Number(mirror.amount)).toBeCloseTo(-30000, 2);
    // the buy keeps its Option Trade category — not dragged into the transfer bucket
    const buy = (await db.query(`SELECT category_id FROM transactions WHERE id=$1`, [buyId])).rows[0];
    expect(buy.category_id).toBe(optionTradeId);
    expect(redemptionId).toBeDefined();
  });

  test('MIRROR: lone trade → offsetting entry created', async () => {
    await freshAccount();
    const buyId = await addTx(-41750);

    const out = await repo.neutralize(buyId, categoryId);
    expect(out.paired).toBe(false);

    const rows = (await db.query(
      `SELECT amount, category_id, source FROM transactions WHERE account_id=$1 ORDER BY amount`, [acctId]
    )).rows;
    expect(rows).toHaveLength(2);                       // original + mirror
    expect(Number(rows[0].amount)).toBeCloseTo(-41750, 2);
    expect(Number(rows[1].amount)).toBeCloseTo(41750, 2); // mirror
    expect(rows[1].source).toBe('auto-offset');
    expect(rows.every((r) => r.category_id === categoryId)).toBe(true);
  });

  // ── CR065: a counter-leg is claimable exactly once ────────────────────────
  //
  // The prod defect these pin down: fintable delivered two genuine $150,000 CD
  // purchases into Fidelity Cash Mgt on 2026-07-30. Neutralizing the first
  // inserted a +150,000 mirror; neutralizing the second FOUND that mirror —
  // same account, negated amount, same date, same category — and paired with it
  // instead of inserting its own. Both legs claimed one counter-leg and the
  // account ran $150,000 light.

  /** Every transfer-categorized row in the account must sum to zero. */
  async function transferImbalance() {
    return Number((await db.query(
      `SELECT COALESCE(SUM(amount), 0)::float AS net FROM transactions
        WHERE account_id = $1 AND category_id = $2`, [acctId, categoryId]
    )).rows[0].net);
  }

  test('two IDENTICAL same-day trades each get their own counter-leg', async () => {
    await freshAccount();
    const cdA = await addTx(-150000, '2026-07-30');
    const cdB = await addTx(-150000, '2026-07-30');

    const outA = await repo.neutralize(cdA, categoryId);
    const outB = await repo.neutralize(cdB, categoryId);

    expect(outA.action).toBe('mirror');
    expect(outB.action).toBe('mirror');                  // NOT 'pair' — the bug
    expect(outB.offset.id).not.toBe(outA.offset.id);     // not the same leg twice

    const mirrors = (await db.query(
      `SELECT id FROM transactions WHERE account_id=$1 AND source='auto-offset'`, [acctId]
    )).rows;
    expect(mirrors).toHaveLength(2);
    expect(await transferImbalance()).toBeCloseTo(0, 2); // the invariant holds
  });

  test('a REAL counter-leg is claimed once; the second trade mirrors instead', async () => {
    await freshAccount();
    const cdA = await addTx(-150000, '2026-07-30');
    const cdB = await addTx(-150000, '2026-07-30');
    const redemption = await addTx(150000, '2026-07-30');  // one genuine funding leg

    const outA = await repo.neutralize(cdA, categoryId);
    const outB = await repo.neutralize(cdB, categoryId);

    expect(outA.action).toBe('pair');
    expect(outA.offset.id).toBe(redemption);
    expect(outB.action).toBe('mirror');                    // must not re-claim it
    expect(outB.offset.id).not.toBe(redemption);
    expect(await transferImbalance()).toBeCloseTo(0, 2);
  });

  test('pair links are symmetric, and a mirror is never a pair candidate', async () => {
    await freshAccount();
    const buyId = await addTx(-9000);
    const out = await repo.neutralize(buyId, categoryId);

    const link = (await db.query(
      `SELECT id, paired_with_id FROM transactions WHERE account_id=$1 ORDER BY id`, [acctId]
    )).rows;
    expect(link).toHaveLength(2);
    expect(link[0].paired_with_id).toBe(link[1].id);
    expect(link[1].paired_with_id).toBe(link[0].id);

    // A third leg of the same magnitude must not consume the spent mirror.
    const later = await addTx(-9000);
    const out2 = await repo.neutralize(later, categoryId);
    expect(out2.action).toBe('mirror');
    expect(out2.offset.id).not.toBe(out.offset.id);
  });

  test('re-neutralizing an already-paired row is a no-op, not a second offset', async () => {
    await freshAccount();
    const buyId = await addTx(-2500);
    await repo.neutralize(buyId, categoryId);

    const before = (await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id=$1`, [acctId])).rows[0].n;
    const again = await repo.neutralize(buyId, categoryId);
    const after = (await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id=$1`, [acctId])).rows[0].n;

    expect(again.action).toBe('already-paired');
    expect(after).toBe(before);
    expect(await transferImbalance()).toBeCloseTo(0, 2);

    const plan = await repo.neutralize(buyId, categoryId, { dryRun: true });
    expect(plan.action).toBe('already-paired');
  });

  test('the database refuses a double-claim even if the query guard is bypassed', async () => {
    await freshAccount();
    const a = await addTx(-700);
    const b = await addTx(-700);
    const leg = await addTx(700);

    await db.query(`UPDATE transactions SET paired_with_id = $1 WHERE id = $2`, [leg, a]);
    // The partial unique index (migration 053) is the backstop under the WHERE
    // clause: two rows may not name the same counter-leg, whatever the code
    // above them believes. Correctness stops depending on a predicate.
    await expect(
      db.query(`UPDATE transactions SET paired_with_id = $1 WHERE id = $2`, [leg, b])
    ).rejects.toThrow(/uq_transactions_paired_with|duplicate key/i);
  });
});
