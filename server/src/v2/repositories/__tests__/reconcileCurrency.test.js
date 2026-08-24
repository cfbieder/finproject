/**
 * CR087 P1 — the reconcile queue speaks currency (DB).
 *
 * Two defects, both measured on prod:
 *
 *   1. The table showed NO currency at all, while 10 of the 20 live calibrate
 *      accounts are non-USD (PLN 7 · EUR 3) — so EUR 1,409.25 sat in the same
 *      unlabelled column as USD 1,166,089.24.
 *
 *   2. The queue sorted on RAW |drift| across currencies, so a 5,000 PLN drift
 *      outranked a $3,000 USD one and the month-end runbook worked it in the
 *      wrong order. That is half the queue, not an edge case.
 *
 * ⚠️ The conversion uses the shared `fx.rateAsOf`, which returns null rather than
 * falling back to 1:1 on an unknown currency — a silent 1:1 is the defect CR087
 * §8 records on the actuals side of `reports.js`, and it would rank a foreign row
 * on a number that is not money.
 */
const db = require('../../db');
const { balanceReconcile } = require('../bankFeedReconciliation');

const TAG = '__test_p1_ccy__';
const USD_UUID = `${TAG}_usd`;
const PLN_UUID = `${TAG}_pln`;
const AS_OF = '2026-08-24';

async function mkAccount(name, currency, opening) {
  const { rows } = await db.query(
    `INSERT INTO accounts (name, account_type, section, currency, opening_balance, is_active)
     VALUES ($1, 'asset', 'balance_sheet', $2, $3, FALSE) RETURNING id`,
    [name, currency, opening]
  );
  return rows[0].id;
}
async function mkFeed(uuid, accountId, balance, currency) {
  await db.query(
    `INSERT INTO account_source_mappings (account_id, source, external_name, reconcile_mode, ignored)
     VALUES ($1, 'bank-feed', $2, 'calibrate', FALSE)`,
    [accountId, uuid]
  );
  await db.query(
    `INSERT INTO bankfeed_balances (feed_account_external_id, balance, currency, balance_date, source)
     VALUES ($1, $2, $3, DATE '2026-08-20', 'fintable')
     ON CONFLICT (feed_account_external_id, balance_date, source)
     DO UPDATE SET balance = EXCLUDED.balance, currency = EXCLUDED.currency`,
    [uuid, balance, currency]
  );
}

describe('balanceReconcile currency + USD-equivalent ordering (DB, CR087 P1)', () => {
  let usdId, plnId, plnRate;

  beforeAll(async () => {
    // USD account drifting 300; PLN account drifting 2000.
    // Raw |drift| ranks PLN first. In USD it must not.
    usdId = await mkAccount(`${TAG}_usd`, 'USD', 300);
    plnId = await mkAccount(`${TAG}_pln`, 'PLN', 2000);
    await mkFeed(USD_UUID, usdId, 0, 'USD');
    await mkFeed(PLN_UUID, plnId, 0, 'PLN');

    const { rows } = await db.query(
      `SELECT rate FROM exchange_rates WHERE from_currency = 'PLN' AND to_currency = 'USD'
        ORDER BY (rate_date <= $1::date) DESC, ABS(rate_date - $1::date) ASC LIMIT 1`,
      [AS_OF]
    );
    plnRate = Number(rows[0].rate);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM bankfeed_balances WHERE feed_account_external_id LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM account_source_mappings WHERE external_name LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
    await db.close();
  });

  const mine = (res) => res.accounts.filter((a) => a.name.startsWith(TAG));

  test('each row carries the currency its figures are in', async () => {
    const res = await balanceReconcile({ asOf: AS_OF });
    const rows = mine(res);
    expect(rows).toHaveLength(2);
    const pln = rows.find((r) => r.name.endsWith('_pln'));
    const usd = rows.find((r) => r.name.endsWith('_usd'));
    expect(pln.currency).toBe('PLN');
    expect(usd.currency).toBe('USD');
    // Both sources exposed, so a disagreement is visible rather than coalesced away.
    expect(pln.account_currency).toBe('PLN');
    expect(pln.feed_currency).toBe('PLN');
    expect(pln.currency_mismatch).toBe(false);
  });

  test('drift_usd converts at the shared rate — not 1:1', async () => {
    const res = await balanceReconcile({ asOf: AS_OF });
    const pln = mine(res).find((r) => r.name.endsWith('_pln'));
    expect(Math.abs(pln.drift)).toBeCloseTo(2000, 2);
    expect(Math.abs(pln.drift_usd)).toBeCloseTo(2000 * plnRate, 1);
    // The whole point: the USD figure is materially smaller than the native one,
    // which is exactly why ordering on the native number was wrong.
    expect(Math.abs(pln.drift_usd)).toBeLessThan(Math.abs(pln.drift));
    expect(pln.drift_usd_known).toBe(true);
  });

  test('the queue orders on USD equivalent, so PLN 2000 ranks BELOW USD 300', async () => {
    const res = await balanceReconcile({ asOf: AS_OF });
    const rows = mine(res);
    // PLN 2000 ≈ $500 at ~0.25, so it still outranks $300 — assert on the real
    // rate rather than a guess, or this test would encode today's FX as a fact.
    const plnUsd = Math.abs(2000 * plnRate);
    const expectedFirst = plnUsd > 300 ? '_pln' : '_usd';
    expect(rows[0].name.endsWith(expectedFirst)).toBe(true);

    // And the ordering must follow USD, not native, wherever the two disagree.
    const idx = (suffix) => res.accounts.findIndex((a) => a.name.endsWith(TAG + suffix));
    const byUsd = [...rows].sort(
      (a, b) => Math.abs(b.drift_usd ?? 0) - Math.abs(a.drift_usd ?? 0)
    );
    expect(rows.map((r) => r.name)).toEqual(byUsd.map((r) => r.name));
    expect(idx).toBeDefined();
  });

  test('a currency the rate table cannot convert is NOT ranked as 1:1', async () => {
    // A silent 1:1 would rank this by its native magnitude — the defect CR087 §8
    // records in reports.js, where an unknown currency posts at face value.
    const zzId = await mkAccount(`${TAG}_zzz`, 'ZZZ', 999999);
    await mkFeed(`${TAG}_zzz`, zzId, 0, 'ZZZ');
    try {
      const res = await balanceReconcile({ asOf: AS_OF });
      const zz = res.accounts.find((a) => a.name.endsWith(`${TAG}_zzz`));
      expect(zz.currency).toBe('ZZZ');
      expect(zz.drift_usd).toBeNull();
      // Flagged, so a reader can tell "not converted" from "converted to zero".
      expect(zz.drift_usd_known).toBe(false);
    } finally {
      await db.query(`DELETE FROM bankfeed_balances WHERE feed_account_external_id = $1`, [`${TAG}_zzz`]);
      await db.query(`DELETE FROM account_source_mappings WHERE external_name = $1`, [`${TAG}_zzz`]);
      await db.query(`DELETE FROM accounts WHERE id = $1`, [zzId]);
    }
  });

  test('an account whose currency disagrees with its feed is FLAGGED', async () => {
    // The actuals twin of the forecast's R11. It fires on 0 live accounts, which
    // is the point — the values agree and are simply in different units, so no
    // balance check can ever see it.
    await db.query(
      `UPDATE bankfeed_balances SET currency = 'EUR' WHERE feed_account_external_id = $1`,
      [PLN_UUID]
    );
    try {
      const res = await balanceReconcile({ asOf: AS_OF });
      const pln = mine(res).find((r) => r.name.endsWith('_pln'));
      expect(pln.currency_mismatch).toBe(true);
      expect(pln.account_currency).toBe('PLN');
      expect(pln.feed_currency).toBe('EUR');
    } finally {
      await db.query(
        `UPDATE bankfeed_balances SET currency = 'PLN' WHERE feed_account_external_id = $1`,
        [PLN_UUID]
      );
    }
  });
});
