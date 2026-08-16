/**
 * CR060 — attachFeedHealth: putting a dead connection next to the account it kills.
 *
 * The behaviour under test is one distinction, and it is the whole reason this
 * logic is separate from the route:
 *
 *   feed_health: null   we could not ASK (health service down, token missing)
 *   state: 'unknown'    we asked, and this account has no upstream counterpart
 *
 * Collapsing them lets an outage of the health service render as a quiet blank
 * on every row — a reconciliation page that looks perfectly fine at exactly the
 * moment the thing reporting breakage is itself broken. That is the same shape
 * as the failure this CR exists for (a feed that stops produces no error), so
 * reproducing it inside the fix would be a poor joke.
 *
 * Pure function, no DB and no service — these run anywhere.
 */

const { attachFeedHealth } = require('../bankFeed');

const rows = () => ({
  accounts: [
    { name: 'Chase Checking', feed_external_id: 'acc_chase' },
    { name: 'Pekao Main', feed_external_id: 'acc_pekao' },
    { name: 'Manual Thing', feed_external_id: 'acc_orphan' },
  ],
});

const healthyUpstream = {
  ok: true,
  accounts_health: {
    acc_chase: { state: 'ok', attention: false, institution_name: 'Chase', days_since_upstream_sync: 0 },
    acc_pekao: { state: 'needs_reconnect', attention: true, institution_name: 'Bank Pekao', days_since_upstream_sync: 3 },
  },
};

describe('attachFeedHealth (CR060)', () => {
  test('attaches each account its own connection state, keyed on feed_external_id', () => {
    const r = attachFeedHealth(rows(), healthyUpstream);
    expect(r.upstream_ok).toBe(true);
    expect(r.upstream_reason).toBeNull();
    expect(r.accounts[0].feed_health.state).toBe('ok');
    expect(r.accounts[1].feed_health.state).toBe('needs_reconnect');
    expect(r.accounts[1].feed_health.attention).toBe(true);
    expect(r.accounts[1].feed_health.institution_name).toBe('Bank Pekao');
  });

  test('an account the upstream does not know reads null, and does NOT inherit a healthy look', () => {
    const r = attachFeedHealth(rows(), healthyUpstream);
    expect(r.accounts[2].feed_health).toBeNull();
    // The page must not be able to read this as "fine".
    expect(r.accounts[2].feed_health?.state).toBeUndefined();
  });

  test('when the health service is UNREACHABLE every row is null and the page is told why', () => {
    // The falsifying case. If this ever passes with upstream_ok true, or with a
    // row carrying a state, the outage has become invisible.
    const r = attachFeedHealth(rows(), { ok: false, reason: '503 service_unavailable' });
    expect(r.upstream_ok).toBe(false);
    expect(r.upstream_reason).toMatch(/503/);
    for (const a of r.accounts) expect(a.feed_health).toBeNull();
  });

  test('a missing upstream block is an outage, not a clean bill of health', () => {
    for (const absent of [null, undefined, {}]) {
      const r = attachFeedHealth(rows(), absent);
      expect(r.upstream_ok).toBe(false);
      expect(r.upstream_reason).toBeTruthy();
      expect(r.accounts.every((a) => a.feed_health === null)).toBe(true);
    }
  });

  test('ok:true with no accounts_health still yields nulls, not crashes', () => {
    const r = attachFeedHealth(rows(), { ok: true });
    expect(r.upstream_ok).toBe(true);
    expect(r.accounts.every((a) => a.feed_health === null)).toBe(true);
  });

  test('an empty account list is not an error', () => {
    expect(() => attachFeedHealth({ accounts: [] }, healthyUpstream)).not.toThrow();
    expect(() => attachFeedHealth({}, healthyUpstream)).not.toThrow();
  });
});
