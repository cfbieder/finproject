/**
 * A brokerage (MTM) row marked at the latest month-end is CURRENT, not work (DB).
 *
 * Found by the owner on 2026-11-03: Fidelity Stocks was marked correctly at 2026-10-31, then
 * reappeared as "MTM GAP" for 146.45 of November activity, with "Last calibrated: no record yet"
 * — that column reads only cash re-anchors, which a brokerage row never has. The mark existed
 * and the page showed no trace of it.
 *
 * Rule: an mtm row whose last `source='mtm'` entry is on or after the latest COMPLETED
 * month-end carries `mtm_current_to` (the mark's date) and is not counted as unreconciled.
 * `reconciled` stays drift-only, because the drift is real.
 */
const db = require('../../db');
const { balanceReconcile } = require('../bankFeedReconciliation');

const TAG = '__test_mtm_current__';

async function mkAccount(suffix) {
  const { rows } = await db.query(
    `INSERT INTO accounts (name, account_type, section, currency, opening_balance, is_active)
     VALUES ($1, 'asset', 'balance_sheet', 'USD', 1000, FALSE) RETURNING id`,
    [`${TAG}_${suffix}`]
  );
  return rows[0].id;
}
async function mkFeed(accountId, suffix, mode, balance) {
  await db.query(
    `INSERT INTO account_source_mappings (account_id, source, external_name, reconcile_mode, ignored)
     VALUES ($1, 'bank-feed', $2, $3, FALSE)`,
    [accountId, `${TAG}_${suffix}`, mode]
  );
  await db.query(
    `INSERT INTO bankfeed_balances (feed_account_external_id, balance, currency, balance_date, source)
     VALUES ($1, $2, 'USD', DATE '2026-11-02', 'fintable')`,
    [`${TAG}_${suffix}`, balance]
  );
}
const tx = (accountId, date, amount, source) => db.query(
  `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, source, accepted)
   VALUES ($1, 't', $2, 'USD', $2, 'USD', $3, $4, TRUE)`,
  [date, amount, accountId, source]
);

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('balanceReconcile — an MTM row marked at the latest month-end is current (DB)', () => {
  const ids = {};
  const row = (res, id) => res.accounts.find((a) => a.account_id === id);

  beforeAll(async () => {
    // Marked at 10-31, then 146.45 of November activity: drift 146.45, feed says 950.
    ids.marked = await mkAccount('marked');
    await mkFeed(ids.marked, 'marked', 'mtm', 950);
    await tx(ids.marked, '2026-10-31', -50, 'mtm');
    await tx(ids.marked, '2026-11-02', 146.45, 'manual');
    // Last marked at 09-30: October is unmarked, so it is still a gap.
    ids.behind = await mkAccount('behind');
    await mkFeed(ids.behind, 'behind', 'mtm', 900);
    await tx(ids.behind, '2026-09-30', -50, 'mtm');
    // A cash account with drift and an mtm-sourced row it should never read as a mark.
    ids.cash = await mkAccount('cash');
    await mkFeed(ids.cash, 'cash', 'calibrate', 900);
    await tx(ids.cash, '2026-10-31', -50, 'mtm');
  });

  afterAll(async () => {
    await db.query(`DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE $1)`, [`${TAG}%`]);
    await db.query(`DELETE FROM bankfeed_balances WHERE feed_account_external_id LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM account_source_mappings WHERE external_name LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
    await db.close();
  });

  test('marked at the latest month-end: current, with its mark shown, and not counted', async () => {
    const res = await balanceReconcile({ asOf: '2026-11-03' });
    const r = row(res, ids.marked);
    expect(r.reconciled).toBe(false);          // the drift is real
    expect(r.drift).toBeCloseTo(146.45, 2);
    expect(r.last_mtm_date).toBe('2026-10-31');
    expect(r.last_mtm_amount).toBe(-50);
    expect(r.mtm_current_to).toBe('2026-10-31');
    const counted = res.accounts.filter((a) => a.reconciled === false && !a.mtm_current_to).length;
    expect(res.total_unreconciled).toBe(counted);
    expect(res.accounts.filter((a) => a.reconciled === false).length).toBe(counted + res.accounts.filter((a) => a.reconciled === false && a.mtm_current_to).length);
  });

  test('last marked before the latest month-end: still a gap', async () => {
    const r = row(await balanceReconcile({ asOf: '2026-11-03' }), ids.behind);
    expect(r.last_mtm_date).toBe('2026-09-30');
    expect(r.mtm_current_to).toBeNull();
  });

  test('a new month-end passing makes the same mark a gap again', async () => {
    const r = row(await balanceReconcile({ asOf: '2026-12-01' }), ids.marked);
    expect(r.mtm_current_to).toBeNull();
  });

  test('a calibrate row never reads as current from an mtm-sourced row', async () => {
    const r = row(await balanceReconcile({ asOf: '2026-11-03' }), ids.cash);
    expect(r.reconciled).toBe(false);
    expect(r.mtm_current_to).toBeNull();
  });
});
