/**
 * setBankFeedMapping pins a promote cutoff (migration 043 / CR059 follow-up).
 *
 * A NULL promote_from_date means "promote every staged row, whatever its date".
 * That is the mechanism behind the 2026-07-14 Black Card incident: mapping an
 * account back-filled its whole staged history over a period a manual upload
 * already covered — 31 duplicates, $8.4K gross, net only +$267, so a balance
 * check could not see it.
 *
 * Mapping an account now pins the cutoff to the earliest row already staged for
 * it, which leaves today's behavior identical (everything staged still promotes)
 * while blocking a row that arrives LATER dated before that point.
 *
 * DB-backed against the dev Postgres on :5434, like bankFeedImport.test.js.
 * Skip with SKIP_DB_TESTS=1. Every row it writes carries a unique external_name
 * prefix and is deleted afterwards, so it never touches real mappings.
 */

const db = require('../../db');
const accountSourceMappings = require('../accountSourceMappings');

const TAG = `cr059-cutoff-${Date.now()}`;
const ext = (n) => `${TAG}-${n}`;
const maybe = process.env.SKIP_DB_TESTS === '1' ? describe.skip : describe;

maybe('setBankFeedMapping — promote cutoff pinning', () => {
  let accountId;

  beforeAll(async () => {
    // Seed the account instead of borrowing the first asset/liability row: a
    // fresh CI database holds only the income/expense COA rows the migrations
    // and ci-seed.sql create, so the borrowed form found nothing there.
    const r = await db.query(
      `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
       VALUES ($1, 'asset', 'balance_sheet', FALSE, 'USD', TRUE) RETURNING id`,
      [TAG],
    );
    accountId = r.rows[0].id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM bankfeed_staging WHERE feed_account_external_id LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM account_source_mappings WHERE external_name LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [TAG]);
    if (db.pool && db.pool.end) await db.pool.end();
  });

  const stage = (externalName, date) => db.query(
    `INSERT INTO bankfeed_staging
       (external_id, source, feed_account_external_id, transaction_date, amount, currency, description)
     VALUES ($1, 'bank-feed', $2, $3, -1.00, 'USD', 'cutoff test')`,
    [`${externalName}-${date}`, externalName, date],
  );

  test('a mapped account with staged rows is pinned to the EARLIEST staged date', async () => {
    const name = ext('earliest');
    await stage(name, '2026-05-11');
    await stage(name, '2026-06-02');

    const row = await accountSourceMappings.setBankFeedMapping(name, accountId, false);
    // Everything already staged still promotes; anything older now cannot.
    expect(String(row.promote_from_date).slice(0, 10)).toBe('2026-05-11');
  });

  test('a mapped account with nothing staged is pinned to today, not left open', async () => {
    const row = await accountSourceMappings.setBankFeedMapping(ext('empty'), accountId, false);
    expect(row.promote_from_date).not.toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    expect(String(row.promote_from_date).slice(0, 10)).toBe(today);
  });

  test('an ignore-only row keeps a NULL cutoff — nothing promotes, so a pin would just go stale', async () => {
    const row = await accountSourceMappings.setBankFeedMapping(ext('ignored'), null, true);
    expect(row.account_id).toBeNull();
    expect(row.promote_from_date).toBeNull();
  });

  test('an existing cutoff is never overwritten by a re-save', async () => {
    const name = ext('preserve');
    await stage(name, '2026-05-20');
    await accountSourceMappings.setBankFeedMapping(name, accountId, false);
    await db.query(
      `UPDATE account_source_mappings SET promote_from_date = '2026-07-01' WHERE external_name = $1`,
      [name],
    );

    // Re-saving (e.g. the owner toggling ignore) must not move a cutoff that was
    // deliberately set — that would silently re-open a back-fill window.
    const again = await accountSourceMappings.setBankFeedMapping(name, accountId, false);
    expect(String(again.promote_from_date).slice(0, 10)).toBe('2026-07-01');
  });

  test('an ignored row later mapped gets a cutoff at that point', async () => {
    const name = ext('promote-later');
    await accountSourceMappings.setBankFeedMapping(name, null, true);
    await stage(name, '2026-04-01');

    const mapped = await accountSourceMappings.setBankFeedMapping(name, accountId, false);
    expect(mapped.account_id).toBe(accountId);
    expect(String(mapped.promote_from_date).slice(0, 10)).toBe('2026-04-01');
  });
});
