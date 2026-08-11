'use strict';
/**
 * CR076 D2 — the sweep's opening cash is the CANONICAL balance.
 *
 * `getOpeningBankCash` used to read the `closing_balance` column off each account's latest
 * transaction. Every other balance in Fin is `opening_balance + Σ(amount)` from
 * `opening_balance_date` — `services/reports.js` says so, and its comment calls closing_balance
 * "prone to stale PS data". The sweep was the last reader on the old method, and it is the reader
 * whose number rides all 36 years: it is `startingCash`, and the sweep pins its band to it.
 *
 * On prod the two disagreed by 11,276.93 across 5 of 17 accounts — `PKO EUR` stored −4,848.85 EUR
 * against a book value of +151.15, and `PKO TFI` had no `closing_balance` row at all, so 6,000 PLN
 * counted as ZERO.
 *
 * DB-backed and SELF-SEEDING, deliberately: an ambient-data test here would pass whenever dev
 * happened to agree. Each case below seeds a throwaway account whose stored `closing_balance` is
 * WRONG, so the old implementation fails it by construction.
 */
const db = require('../../../v2/db');
const { getOpeningBankCash } = require('../crud');

const TAG = 'CR076D2';
const AS_OF = '2025-12-31';

const describeOrSkip = process.env.SKIP_DB_TESTS ? describe.skip : describe;

describeOrSkip('CR076 D2 — getOpeningBankCash', () => {
  let bankRootId;
  const madeAccountIds = [];

  const seedAccount = async ({ name, currency, opening, openingDate = '2025-01-01' }) => {
    const res = await db.query(
      `INSERT INTO accounts (name, parent_id, account_type, section, currency,
                             opening_balance, opening_balance_date)
       VALUES ($1, $2, 'asset', 'balance_sheet', $3, $4, $5) RETURNING id`,
      [`${TAG} ${name}`, bankRootId, currency, opening, openingDate]
    );
    madeAccountIds.push(res.rows[0].id);
    return res.rows[0].id;
  };

  // `currency` is NOT NULL on `transactions`, and it is set to the ACCOUNT's currency here on
  // purpose: `getOpeningBankCash` reads the account's, and a test that seeded a different one
  // would be asserting a state prod does not have (verified: 0 such rows).
  const seedTxn = async (accountId, currency, { amount, date, closingBalance }) =>
    db.query(
      `INSERT INTO transactions (account_id, transaction_date, amount, currency,
                                 description1, closing_balance)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [accountId, date, amount, currency, `${TAG} txn`, closingBalance]
    );

  // Set only when THIS suite created the root, so the cleanup removes exactly what it made.
  let createdRoot = false;

  beforeAll(async () => {
    const root = await db.query(`SELECT id FROM accounts WHERE name = 'Bank Accounts' LIMIT 1`);
    if (root.rows.length) {
      bankRootId = root.rows[0].id;
      return;
    }
    // This used to `throw`, and it made CI RED — `ci-seed.sql` carries no `Bank Accounts`
    // root, so every run against a fresh migrations+seed database failed all six tests
    // here while dev (which has the root) stayed green. Confirmed on 2026-08-10: five
    // consecutive red runs on `main`, unannounced — roadmap Known Issue #12's exact shape,
    // and the suite that reports it is the one that cannot see it.
    //
    // Every other fixture in this file is already self-seeded and cleaned up; the root was
    // the one borrowed row. It is now seeded too, which is the documented pattern for a
    // DB-backed suite here — and it keeps the dev/prod path byte-identical, because the
    // branch only runs when the root is genuinely absent.
    const made = await db.query(
      `INSERT INTO accounts (name, parent_id, account_type, section, currency,
                             opening_balance, opening_balance_date)
       VALUES ('Bank Accounts', NULL, 'asset', 'balance_sheet', 'USD', 0, '2025-01-01')
       RETURNING id`
    );
    bankRootId = made.rows[0].id;
    createdRoot = true;
  });

  afterAll(async () => {
    if (madeAccountIds.length) {
      await db.query(`DELETE FROM transactions WHERE account_id = ANY($1)`, [madeAccountIds]);
      await db.query(`DELETE FROM accounts WHERE id = ANY($1)`, [madeAccountIds]);
    }
    // Only if we made it. On dev and prod the root is real data and must survive.
    if (createdRoot && bankRootId) {
      await db.query(`DELETE FROM accounts WHERE id = $1`, [bankRootId]);
    }
  });

  test('a stale closing_balance is IGNORED in favour of opening + transactions', async () => {
    const before = await getOpeningBankCash(db, AS_OF);
    const id = await seedAccount({ name: 'Stale', currency: 'USD', opening: 1000 });
    // The book says 1000 + 250 = 1250. The stored closing_balance says 9999 — the shape of the
    // PKO EUR defect, where the column had drifted from the ledger.
    await seedTxn(id, 'USD', { amount: 250, date: '2025-06-01', closingBalance: 9999 });

    const after = await getOpeningBankCash(db, AS_OF);
    expect(after - before).toBeCloseTo(1250, 2);   // NOT 9999
  });

  test('an account with NO closing_balance row anywhere still counts', async () => {
    // `PKO TFI` on prod: 6,000 PLN that the old query could not see at all, because its
    // `latest_balances` CTE required `closing_balance IS NOT NULL`.
    const before = await getOpeningBankCash(db, AS_OF);
    const id = await seedAccount({ name: 'NoClosing', currency: 'USD', opening: 6000 });
    await seedTxn(id, 'USD', { amount: 0, date: '2025-06-01', closingBalance: null });

    const after = await getOpeningBankCash(db, AS_OF);
    expect(after - before).toBeCloseTo(6000, 2);   // NOT 0
  });

  test('an account with no transactions at all contributes its opening balance', async () => {
    const before = await getOpeningBankCash(db, AS_OF);
    await seedAccount({ name: 'NoTxns', currency: 'USD', opening: 4200 });
    const after = await getOpeningBankCash(db, AS_OF);
    expect(after - before).toBeCloseTo(4200, 2);
  });

  test('transactions AFTER the as-of date are excluded', async () => {
    const before = await getOpeningBankCash(db, AS_OF);
    const id = await seedAccount({ name: 'Future', currency: 'USD', opening: 100 });
    await seedTxn(id, 'USD', { amount: 50, date: '2025-12-30', closingBalance: null });
    await seedTxn(id, 'USD', { amount: 777, date: '2026-03-01', closingBalance: null });

    const after = await getOpeningBankCash(db, AS_OF);
    expect(after - before).toBeCloseTo(150, 2);   // the 777 is next year's money
  });

  test('transactions BEFORE opening_balance_date are excluded (they are already in it)', async () => {
    // Double-counting here is the classic additive-balance error, and `reports.js` guards it the
    // same way.
    const before = await getOpeningBankCash(db, AS_OF);
    const id = await seedAccount({
      name: 'PreOpening', currency: 'USD', opening: 500, openingDate: '2025-07-01',
    });
    await seedTxn(id, 'USD', { amount: 99, date: '2025-01-15', closingBalance: null });
    await seedTxn(id, 'USD', { amount: 25, date: '2025-08-01', closingBalance: null });

    const after = await getOpeningBankCash(db, AS_OF);
    expect(after - before).toBeCloseTo(525, 2);   // 500 + 25, not 624
  });

  test('a non-USD account is converted, and the currency comes from the ACCOUNT', async () => {
    const rate = await db.query(
      `SELECT rate FROM exchange_rates WHERE from_currency='EUR' AND to_currency='USD'
       ORDER BY ABS(rate_date - $1::date) ASC LIMIT 1`, [AS_OF]
    );
    if (!rate.rows.length) return;               // no EUR rate in this DB; nothing to assert

    const before = await getOpeningBankCash(db, AS_OF);
    const id = await seedAccount({ name: 'Euro', currency: 'EUR', opening: 1000 });
    await seedTxn(id, 'EUR', { amount: 200, date: '2025-06-01', closingBalance: null });

    const after = await getOpeningBankCash(db, AS_OF);
    expect(after - before).toBeCloseTo(1200 * parseFloat(rate.rows[0].rate), 2);
  });
});
