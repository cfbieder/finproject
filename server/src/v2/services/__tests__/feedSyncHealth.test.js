/**
 * feedSyncHealth — a quiet account is not a silent feed.
 *
 * Fixtures are the live connections measured 2026-09-13: for GoCardless
 * connections Fintable's `last_successful_update` is the newest transaction's
 * date at 23:59:59 whenever nothing new arrived, while `sync_status` shows the
 * sync with the bank finished that afternoon. bank-feed classifies those
 * `stale`; these tests pin fin re-reading them as `quiet` — and, just as
 * important, NOT re-reading a connection that really has stopped.
 *
 * Pure functions: no DB, no service.
 */

const { bankSyncedAt, reclassifyUpstream, applyBankSyncTimes } = require('../feedSyncHealth');

const NOW = Date.parse('2026-09-13T19:30:00Z');

const erste = {
  connection_id: 'conn_erste',
  institution_name: 'Erste Bank Polska',
  provider: 'NORDIGEN',
  last_successful_update: '2026-07-10T23:59:59Z',
  sync_status: { state: 'finished', finished_at: '2026-09-13T19:14:24Z' },
  state: 'stale',
  attention: true,
  days_since_upstream_sync: 64,
  notice: null,
};
// Syncing today, but carrying Fintable's leftover "access expired" text.
const pko = {
  connection_id: 'conn_pko',
  institution_name: 'PKO Bank Polski',
  provider: 'NORDIGEN',
  last_successful_update: '2026-09-13T18:01:47Z',
  sync_status: { state: 'finished', finished_at: '2026-09-13T18:01:47Z' },
  state: 'ok',
  attention: false,
  days_since_upstream_sync: 0,
  notice: 'READY Bank access has expired. Please reconnect this bank.',
};
// Really stopped: last finished sync with the bank five days ago.
const stalled = {
  connection_id: 'conn_stalled',
  institution_name: 'Revolut',
  last_successful_update: '2026-09-07T23:59:59Z',
  sync_status: { state: 'finished', finished_at: '2026-09-08T10:00:00Z' },
  state: 'stale',
  attention: true,
  days_since_upstream_sync: 5,
  notice: null,
};
const expired = {
  connection_id: 'conn_expired',
  institution_name: 'Wise',
  sync_status: { state: 'finished', finished_at: '2026-09-13T18:00:00Z' },
  state: 'needs_reconnect',
  attention: true,
  notice: null,
};

const upstream = (connections, extra = {}) => ({
  ok: true,
  stale_threshold_hours: 48,
  connections,
  accounts_health: Object.fromEntries(
    connections.map((c) => [
      `acc_${c.connection_id}`,
      { connection_id: c.connection_id, institution_name: c.institution_name, state: c.state, attention: c.attention, notice: c.notice },
    ])
  ),
  needs_attention: connections.filter((c) => c.attention).map((c) => ({ connection_id: c.connection_id, state: c.state })),
  provider_notices: connections.filter((c) => c.notice).map((c) => ({ connection_id: c.connection_id, notice: c.notice })),
  ...extra,
});

describe('bankSyncedAt', () => {
  test('only a FINISHED sync counts as reaching the bank', () => {
    expect(bankSyncedAt(erste)).toBe('2026-09-13T19:14:24.000Z');
    expect(bankSyncedAt({ sync_status: { state: 'running', started_at: '2026-09-13T19:13:00Z' } })).toBeNull();
    expect(bankSyncedAt({ sync_status: { state: 'error', finished_at: '2026-09-13T19:00:00Z' } })).toBeNull();
    expect(bankSyncedAt({ sync_status: null })).toBeNull();
    expect(bankSyncedAt({ sync_status: { state: 'finished', finished_at: 'not a date' } })).toBeNull();
  });
});

describe('reclassifyUpstream', () => {
  test('a dormant account whose bank synced today is QUIET, not stale, and needs no attention', () => {
    const r = reclassifyUpstream(upstream([erste]), { nowMs: NOW });
    const c = r.connections[0];
    expect(c.state).toBe('quiet');
    expect(c.attention).toBe(false);
    expect(c.bank_synced_at).toBe('2026-09-13T19:14:24.000Z');
    expect(c.days_since_bank_sync).toBe(0);
    // The data age is kept — "no new transactions for 64 days" is still true.
    expect(c.days_since_upstream_sync).toBe(64);
    expect(r.accounts_health.acc_conn_erste.state).toBe('quiet');
    expect(r.accounts_health.acc_conn_erste.attention).toBe(false);
    expect(r.needs_attention).toEqual([]);
  });

  test('a connection with no finished bank sync inside the window STAYS stale — the alarm still works', () => {
    const r = reclassifyUpstream(upstream([stalled]), { nowMs: NOW });
    expect(r.connections[0].state).toBe('stale');
    expect(r.connections[0].attention).toBe(true);
    expect(r.connections[0].days_since_bank_sync).toBe(5);
    expect(r.accounts_health.acc_conn_stalled.state).toBe('stale');
    expect(r.needs_attention.map((n) => n.connection_id)).toEqual(['conn_stalled']);
  });

  test('needs_reconnect is never downgraded, however recent the sync', () => {
    const r = reclassifyUpstream(upstream([expired]), { nowMs: NOW });
    expect(r.connections[0].state).toBe('needs_reconnect');
    expect(r.connections[0].attention).toBe(true);
    expect(r.needs_attention).toHaveLength(1);
  });

  test('an unknown sync_status changes nothing', () => {
    const running = { ...erste, sync_status: { state: 'running', started_at: '2026-09-13T19:13:00Z' } };
    const r = reclassifyUpstream(upstream([running]), { nowMs: NOW });
    expect(r.connections[0].state).toBe('stale');
    expect(r.connections[0].bank_synced_at).toBeNull();
  });

  test("Fintable's leftover 'access expired' notice is dropped once the bank answered inside the window", () => {
    const r = reclassifyUpstream(upstream([pko]), { nowMs: NOW });
    expect(r.connections[0].state).toBe('ok');
    expect(r.connections[0].notice).toBeNull();
    expect(r.accounts_health.acc_conn_pko.notice).toBeNull();
    expect(r.provider_notices).toEqual([]);
  });

  test('uses bank-feed\'s own threshold, not a second guess', () => {
    const at72h = { ...erste, sync_status: { state: 'finished', finished_at: '2026-09-10T19:00:00Z' } };
    expect(reclassifyUpstream(upstream([at72h]), { nowMs: NOW }).connections[0].state).toBe('stale');
    expect(
      reclassifyUpstream(upstream([at72h], { stale_threshold_hours: 96 }), { nowMs: NOW }).connections[0].state
    ).toBe('quiet');
  });

  test('could-not-ask passes through untouched', () => {
    for (const absent of [null, undefined, { ok: false, reason: '503' }]) {
      expect(reclassifyUpstream(absent, { nowMs: NOW })).toBe(absent);
    }
  });

  test('does not mutate the block it was given', () => {
    const input = upstream([erste]);
    reclassifyUpstream(input, { nowMs: NOW });
    expect(input.connections[0].state).toBe('stale');
    expect(input.accounts_health.acc_conn_erste.state).toBe('stale');
  });
});

describe('applyBankSyncTimes', () => {
  const up = () => reclassifyUpstream(upstream([erste, stalled]), { nowMs: NOW });

  test("moves a quiet account's synced time forward to the bank sync", () => {
    const rows = [{ feed_external_id: 'acc_conn_erste', feed_synced_at: '2026-07-10 23:59:59+00' }];
    applyBankSyncTimes(rows, up());
    expect(rows[0].feed_synced_at).toBe('2026-09-13T19:14:24.000Z');
  });

  test('never moves it backwards, and leaves rows without health alone', () => {
    const rows = [
      { feed_external_id: 'acc_conn_stalled', feed_synced_at: '2026-09-12T00:00:00Z' },
      { feed_external_id: 'acc_unknown', feed_synced_at: '2026-07-01T00:00:00Z' },
    ];
    applyBankSyncTimes(rows, up());
    expect(rows[0].feed_synced_at).toBe('2026-09-12T00:00:00Z');
    expect(rows[1].feed_synced_at).toBe('2026-07-01T00:00:00Z');
  });

  test('fills a missing synced time, and does nothing when health could not be read', () => {
    const rows = [{ feed_external_id: 'acc_conn_erste', feed_synced_at: null }];
    applyBankSyncTimes(rows, up());
    expect(rows[0].feed_synced_at).toBe('2026-09-13T19:14:24.000Z');
    const untouched = [{ feed_external_id: 'acc_conn_erste', feed_synced_at: null }];
    applyBankSyncTimes(untouched, { ok: false });
    expect(untouched[0].feed_synced_at).toBeNull();
  });
});
