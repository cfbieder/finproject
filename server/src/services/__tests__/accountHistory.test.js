'use strict';
/**
 * accountHistory.test.js — CR090 P3.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1). Run via ./Scripts/test-fresh-db.sh.
 * Every identifier is INVENTED — the repo commits no real financial data.
 *
 * These pin the two things that were silently wrong, and the one that was about
 * to be: the query filtered to the feed and hid a decade of statements; the
 * two sources are dated by DIFFERENT columns and must not be conflated; and a
 * single ORDER BY … DESC LIMIT would have thrown the statements away first.
 */

const db = require('../../v2/db');
const { accountHistory } = require('../investments');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('CR090 P3 accountHistory (DB)', () => {
  let acctId;

  const snap = async (over) => {
    const r = {
      source: 'statement', polled_on: null, valued_on: null, status: 'fetched',
      custodian_balance: '100.00', positions_count: 1, sum_market_value: '100.00', ...over,
    };
    await db.query(`
      INSERT INTO security_position_snapshots
        (account_id, polled_on, valued_on, source, status, custodian_balance,
         positions_count, sum_market_value, raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}'::jsonb)`,
    [acctId, r.polled_on, r.valued_on, r.source, r.status, r.custodian_balance,
      r.positions_count, r.sum_market_value]);
  };

  beforeEach(async () => {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ('CR090P3 History Test','asset','balance_sheet','USD',0) RETURNING id`,
    );
    acctId = rows[0].id;
  });

  afterEach(async () => {
    await db.query('DELETE FROM security_position_snapshots WHERE account_id = $1', [acctId]);
    await db.query('DELETE FROM accounts WHERE id = $1', [acctId]);
  });

  test('🔴 statement snapshots are RETURNED, not filtered out', async () => {
    // The query read `source = 'bank-feed'` until P3, so 117 statement snapshots
    // reaching back to 2016 were queryable and unreachable from the app.
    await snap({ source: 'statement', valued_on: '2016-03-31', polled_on: '2016-03-31' });
    await snap({ source: 'bank-feed', polled_on: '2026-07-04' });
    const rows = await accountHistory(acctId);
    expect(rows.map((r) => r.source)).toEqual(['statement', 'bank-feed']);
  });

  test('🔴 observed_on comes from a DIFFERENT column per source', async () => {
    // A statement states the date its figures are true for; the feed knows only
    // when it asked, and its valued_on is NULL by design (CR089). Coalescing
    // without saying which was used is the conflation CR089 exists to prevent.
    await snap({ source: 'statement', valued_on: '2024-06-30', polled_on: '2026-09-05' });
    await snap({ source: 'bank-feed', polled_on: '2026-07-04', valued_on: null });
    const [stmt, feed] = await accountHistory(acctId);

    expect(stmt.observed_on).toBe('2024-06-30');   // NOT the day it was ingested
    expect(stmt.valued_on).toBe('2024-06-30');
    expect(feed.observed_on).toBe('2026-07-04');
    expect(feed.valued_on).toBeNull();             // must stay null, never filled in
  });

  test('ordering is by the date each row DESCRIBES, not by when it was polled', async () => {
    // A statement ingested today describes 2016. Ordering on polled_on would put
    // the whole decade after the feed.
    await snap({ source: 'bank-feed', polled_on: '2026-07-04' });
    // polled_on differs from valued_on deliberately: these were ingested today
    // and describe 2016 and 2020. (The snapshot key is (account, polled_on,
    // source), so the two ingest dates must differ as they do in practice, where
    // the ingest sets polled_on = valued_on = the statement's period end.)
    await snap({ source: 'statement', valued_on: '2016-03-31', polled_on: '2026-09-05' });
    await snap({ source: 'statement', valued_on: '2020-09-30', polled_on: '2026-09-04' });
    const rows = await accountHistory(acctId);
    expect(rows.map((r) => r.observed_on)).toEqual(['2016-03-31', '2020-09-30', '2026-07-04']);
  });

  test('🔴 the limit bounds the FEED only — statements are never crowded out', async () => {
    // One `ORDER BY … DESC LIMIT n` over both sources truncates the OLDEST rows
    // first, which are exactly the quarterly statements. The feed grows ~365
    // rows a year against ~4, so the irreplaceable series would have been
    // squeezed out silently and the chart would just have got shorter.
    for (let i = 0; i < 6; i += 1) {
      await snap({ source: 'bank-feed', polled_on: `2026-07-0${i + 1}` });
    }
    await snap({ source: 'statement', valued_on: '2016-03-31', polled_on: '2016-03-31' });
    await snap({ source: 'statement', valued_on: '2016-06-30', polled_on: '2016-06-30' });

    const rows = await accountHistory(acctId, { limit: 2 });
    const bySource = rows.reduce((a, r) => ({ ...a, [r.source]: (a[r.source] || 0) + 1 }), {});
    expect(bySource.statement).toBe(2);   // both kept
    expect(bySource['bank-feed']).toBe(2); // only the limit applies here
    expect(rows[0].observed_on).toBe('2016-03-31');
  });

  test('a non-fetched snapshot is not history', async () => {
    // `absent` means upstream has no such day and `partial` means the fetch
    // broke; plotting either as a value would draw a hole as a number.
    await snap({ source: 'bank-feed', polled_on: '2026-07-04', status: 'absent', sum_market_value: null, custodian_balance: null });
    await snap({ source: 'statement', valued_on: '2016-03-31', polled_on: '2016-03-31' });
    const rows = await accountHistory(acctId);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('statement');
  });
});
