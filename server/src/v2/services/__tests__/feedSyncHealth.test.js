/**
 * feedSyncHealth — a stored `feed_synced_at` older than the last time the bank
 * was reached is moved forward; nothing else is touched.
 *
 * Fixtures are shaped like bank-feed's `/v1/health/feeds` `upstream` block
 * after 04815bd (2026-09-14), which publishes `last_bank_sync_at` per account.
 * The values are the live ones measured 2026-09-13/14: Erste Bank Polska's
 * stored `source_synced_at` was its last transaction's date, 2026-07-10.
 *
 * Pure function: no DB, no service.
 */

const { applyBankSyncTimes } = require('../feedSyncHealth');

const upstream = (health) => ({ ok: true, accounts_health: health });

describe('applyBankSyncTimes', () => {
  test("moves a quiet account's stored time forward to bank-feed's last_bank_sync_at", () => {
    const rows = [{ feed_external_id: 'acc_erste', feed_synced_at: '2026-07-10 23:59:59+00' }];
    applyBankSyncTimes(rows, upstream({ acc_erste: { state: 'ok', last_bank_sync_at: '2026-09-13T19:14:24Z' } }));
    expect(rows[0].feed_synced_at).toBe('2026-09-13T19:14:24.000Z');
  });

  test('never moves it backwards', () => {
    const rows = [{ feed_external_id: 'acc_chase', feed_synced_at: '2026-09-14T05:30:00Z' }];
    applyBankSyncTimes(rows, upstream({ acc_chase: { state: 'ok', last_bank_sync_at: '2026-09-14T05:23:46Z' } }));
    expect(rows[0].feed_synced_at).toBe('2026-09-14T05:30:00Z');
  });

  test('fills a missing stored time', () => {
    const rows = [{ feed_external_id: 'acc_erste', feed_synced_at: null }];
    applyBankSyncTimes(rows, upstream({ acc_erste: { last_bank_sync_at: '2026-09-13T19:14:24Z' } }));
    expect(rows[0].feed_synced_at).toBe('2026-09-13T19:14:24.000Z');
  });

  test('leaves rows alone when there is nothing better to say', () => {
    const rows = [
      { feed_external_id: 'acc_unknown', feed_synced_at: '2026-07-01T00:00:00Z' },
      { feed_external_id: 'acc_nofield', feed_synced_at: '2026-07-01T00:00:00Z' },
      { feed_external_id: 'acc_garbage', feed_synced_at: '2026-07-01T00:00:00Z' },
    ];
    applyBankSyncTimes(rows, upstream({
      acc_nofield: { state: 'ok', days_since_upstream_sync: 0 },
      acc_garbage: { last_bank_sync_at: 'not a date' },
    }));
    for (const r of rows) expect(r.feed_synced_at).toBe('2026-07-01T00:00:00Z');
  });

  test('could-not-ask changes nothing', () => {
    for (const absent of [null, undefined, { ok: false, reason: '503' }, { ok: true }]) {
      const rows = [{ feed_external_id: 'acc_erste', feed_synced_at: '2026-07-10 23:59:59+00' }];
      applyBankSyncTimes(rows, absent);
      expect(rows[0].feed_synced_at).toBe('2026-07-10 23:59:59+00');
    }
  });
});

// 2026-10-01/02: bank-feed's insert guard rolled back every sync for ~30h while
// every bank's upstream sync stayed fresh, so `staleFeeds` read 0 throughout.
const { feedServiceStatus } = require('../feedSyncHealth');

describe('feedServiceStatus', () => {
  const NOW = Date.parse('2026-10-02T11:10:00Z');
  const health = (lastSyncs, err = null) => ({
    stale_threshold_hours: 2,
    feeds: lastSyncs.map((t) => ({ last_synced_at: t })),
    service: err ? { most_recent_error: err, most_recent_error_at: '2026-10-02T11:02:04Z' } : {},
  });

  test('🔴 the live case: last success 30h ago, failing since → stalled, with the cause', () => {
    const s = feedServiceStatus(health(['2026-10-01T04:28:41Z', '2026-09-30T06:00:00Z'], 'insert guard: 67 new …'), NOW);
    expect(s).toMatchObject({ stalled: true, hoursSinceSync: 30, lastError: 'insert guard: 67 new …' });
  });

  test('a recent success is not stalled, and an OLDER error is not reported as the cause', () => {
    const h = health(['2026-10-02T10:24:00Z'], 'old failure');
    h.service.most_recent_error_at = '2026-10-01T12:00:00Z';
    expect(feedServiceStatus(h, NOW)).toMatchObject({ stalled: false, hoursSinceSync: 0, lastError: null });
  });

  test('could-not-ask is null — neither fine nor stalled', () => {
    expect(feedServiceStatus(null, NOW)).toBeNull();
    expect(feedServiceStatus({ feeds: [] }, NOW)).toBeNull();
  });
});
