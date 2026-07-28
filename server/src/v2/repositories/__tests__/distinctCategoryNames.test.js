'use strict';
/**
 * distinctCategoryNames.test.js — options for the Ledger's category filter.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434 via
 * DATABASE_URL. Seeds a throwaway account + categories, cleans up by unique
 * name — never TRUNCATE.
 *
 * Guards the bug this replaced: the Ledger derived its category options from the
 * rows already LOADED, which is the first page only (TRANSACTION_BATCH_SIZE =
 * 500). On PKO (4,572 rows) that meant the filter could offer categories from
 * just the most recent ~11% of the account and silently omitted the rest —
 * `Financial Income - UB Dividend` sat at position 532, so five United Beverages
 * dividends were unfindable through the UI. The regression test that matters is
 * therefore "a category far outside any page limit is still listed".
 */

const repo = require('../transactions');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('transactions.distinctCategoryNames (DB)', () => {
  const ACCT = 'TestDistinctCatAcct';
  const OTHER_ACCT = 'TestDistinctCatOtherAcct';
  const CAT_RECENT = 'TestDistinctCatRecent';
  const CAT_OLD = 'TestDistinctCatOld';
  const CAT_OTHER = 'TestDistinctCatOtherOnly';

  let acctId, otherAcctId, recentId, oldId, otherCatId;

  async function cleanup() {
    await db.query(
      `DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE name = ANY($1::text[]))`,
      [[ACCT, OTHER_ACCT]]
    );
    await db.query(`DELETE FROM accounts WHERE name = ANY($1::text[])`,
      [[ACCT, OTHER_ACCT, CAT_RECENT, CAT_OLD, CAT_OTHER]]);
  }

  const mkAccount = async (name, type, section) => (await db.query(
    `INSERT INTO accounts (name, account_type, section, currency) VALUES ($1,$2,$3,'PLN') RETURNING id`,
    [name, type, section]
  )).rows[0].id;

  const addTx = (accountId, categoryId, date, amount = 1) => db.query(
    `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, category_id, source)
     VALUES ($1,'t',$2,'PLN',$2,'PLN',$3,$4,'test')`,
    [date, amount, accountId, categoryId]
  );

  beforeAll(async () => {
    await cleanup();
    acctId = await mkAccount(ACCT, 'asset', 'balance_sheet');
    otherAcctId = await mkAccount(OTHER_ACCT, 'asset', 'balance_sheet');
    recentId = await mkAccount(CAT_RECENT, 'expense', 'profit_loss');
    oldId = await mkAccount(CAT_OLD, 'income', 'profit_loss');
    otherCatId = await mkAccount(CAT_OTHER, 'expense', 'profit_loss');

    // One old row in CAT_OLD, then 600 newer rows in CAT_RECENT — so the old
    // category falls outside a 500-row first page, exactly like the real case.
    await addTx(acctId, oldId, '2023-07-21', 1187000);
    for (let i = 0; i < 600; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      const month = String((i % 12) + 1).padStart(2, '0');
      await addTx(acctId, recentId, `2026-${month}-${day}`);
    }
    await addTx(otherAcctId, otherCatId, '2026-01-15');
  });

  afterAll(async () => {
    await cleanup();
    await db.end?.();
  });

  test('lists a category buried far beyond the first page', async () => {
    const names = await repo.distinctCategoryNames({ accountName: ACCT });
    expect(names).toContain(CAT_OLD);     // position ~601 by date desc
    expect(names).toContain(CAT_RECENT);
  });

  test('scopes to the account — other accounts\' categories are excluded', async () => {
    const names = await repo.distinctCategoryNames({ accountName: ACCT });
    expect(names).not.toContain(CAT_OTHER);
  });

  test('respects a date range', async () => {
    const names = await repo.distinctCategoryNames({
      accountName: ACCT, startDate: '2026-01-01', endDate: '2026-12-31',
    });
    // The 2023 row is outside the window, so its category should not be offered —
    // the filter must not list options that would return nothing.
    expect(names).not.toContain(CAT_OLD);
    expect(names).toContain(CAT_RECENT);
  });

  test('returns distinct, sorted names', async () => {
    const names = await repo.distinctCategoryNames({ accountName: ACCT });
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
  });

  test('without an account name it spans accounts', async () => {
    const names = await repo.distinctCategoryNames({
      startDate: '2026-01-15', endDate: '2026-01-15',
    });
    expect(names).toContain(CAT_OTHER);
  });
});
