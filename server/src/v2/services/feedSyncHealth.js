/**
 * feedSyncHealth — fin's reading of bank-feed's connection health: was the
 * BANK actually reached?
 *
 * bank-feed classifies a connection `stale` when Fintable's
 * `last_successful_update` is more than 48h old, treating that field as the
 * last successful sync with the bank. **For GoCardless (NORDIGEN) connections
 * it is not.** Measured 2026-09-13 on all 13 live connections: whenever a sync
 * brings no new transactions, the field carries the date of the NEWEST
 * TRANSACTION stamped `T23:59:59Z` — Erste Bank Polska `2026-07-10T23:59:59Z`
 * against its last transaction on 2026-07-10, Revolut 09-07/09-07, Bank Pekao
 * 09-04/09-04 — while each connection's `sync_status` shows a sync with the
 * bank that FINISHED that same afternoon. A dormant account therefore read as
 * "silent 64 days", fin told the owner to re-authorise a working consent, and
 * a needless reconnect can re-key accounts (CR091 U3).
 *
 * The classifier belongs to bank-feed (a separate repo); until it changes,
 * fin re-reads the verdict here, in one place, for every surface that shows it
 * (Balance Calibration, Bank Feed Setup, the Home attention strip, mobile).
 *
 * The rule, deliberately narrow:
 *   - a connection is reached-recently when `sync_status.state === 'finished'`
 *     and `finished_at` is inside bank-feed's own `stale_threshold_hours`;
 *   - `stale` + reached-recently  →  `quiet` (no new data, not a problem):
 *     attention false;
 *   - `needs_reconnect` / `unhealthy` / `never_synced` are never touched —
 *     they outrank staleness and are not about data age;
 *   - an unknown or missing `sync_status` changes nothing. Only `finished` has
 *     been observed; guessing what other states mean would trade one false
 *     reading for another.
 *
 * A genuinely stalled connection (no finished sync inside the window — the
 * seven-week Revolut gap) keeps `stale`, which is what the alarm is for.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** ISO time of the connection's last FINISHED sync with the bank, or null. */
function bankSyncedAt(conn) {
  const s = conn && conn.sync_status;
  if (!s || s.state !== 'finished' || !s.finished_at) return null;
  const t = new Date(s.finished_at).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Returns a copy of bank-feed's `upstream` health block with every connection
 * and account-health entry carrying `bank_synced_at` / `days_since_bank_sync`,
 * and with stale-but-reached connections reclassified `quiet`. The derived
 * lists (`needs_attention`, `provider_notices`) are filtered to match.
 * An absent or `ok:false` block is returned unchanged — could-not-ask stays
 * could-not-ask.
 */
function reclassifyUpstream(upstream, { nowMs = Date.now() } = {}) {
  if (!upstream || !upstream.ok) return upstream;
  const windowMs = (Number(upstream.stale_threshold_hours) || 48) * HOUR_MS;

  const byConnection = new Map();
  const connections = (upstream.connections || []).map((c) => {
    const at = bankSyncedAt(c);
    const ageMs = at == null ? null : nowMs - new Date(at).getTime();
    const reached = ageMs != null && ageMs <= windowMs;
    const next = {
      ...c,
      bank_synced_at: at,
      days_since_bank_sync: ageMs == null ? null : Math.max(0, Math.floor(ageMs / DAY_MS)),
    };
    if (reached && c.state === 'stale') {
      next.state = 'quiet';
      next.attention = false;
    }
    // Fintable's status text has proved stale ("Bank access has expired" on
    // connections syncing that day — CR091 U2), so once the bank has answered
    // inside the window it is not repeated as a notice.
    if (reached) next.notice = null;
    byConnection.set(String(c.connection_id), next);
    return next;
  });

  let accountsHealth = upstream.accounts_health;
  if (accountsHealth && typeof accountsHealth === 'object') {
    accountsHealth = {};
    for (const [externalId, h] of Object.entries(upstream.accounts_health)) {
      const conn = h && byConnection.get(String(h.connection_id));
      if (!conn) {
        accountsHealth[externalId] = h;
        continue;
      }
      const next = {
        ...h,
        bank_synced_at: conn.bank_synced_at,
        days_since_bank_sync: conn.days_since_bank_sync,
      };
      if (conn.state === 'quiet' && h.state === 'stale') {
        next.state = 'quiet';
        next.attention = false;
      }
      if ('notice' in h) next.notice = conn.notice ?? null;
      accountsHealth[externalId] = next;
    }
  }

  const stillAttention = (item) => {
    const conn = byConnection.get(String(item.connection_id));
    return !conn || conn.attention !== false;
  };
  const stillNotice = (item) => {
    const conn = byConnection.get(String(item.connection_id));
    return !conn || !!conn.notice;
  };

  return {
    ...upstream,
    connections,
    accounts_health: accountsHealth,
    needs_attention: Array.isArray(upstream.needs_attention)
      ? upstream.needs_attention.filter(stillAttention)
      : upstream.needs_attention,
    provider_notices: Array.isArray(upstream.provider_notices)
      ? upstream.provider_notices.filter(stillNotice)
      : upstream.provider_notices,
  };
}

/**
 * `feed_synced_at` on a reconciliation row is the stored `source_synced_at`,
 * which is the same misleading field — so a quiet account read "synced 64 days
 * ago" in red. Move it forward to the connection's last finished bank sync
 * when that is later; never move it backwards. Mutates and returns `accounts`.
 * Expects an upstream block already passed through `reclassifyUpstream`.
 */
function applyBankSyncTimes(accounts, upstream) {
  const byAccount = upstream && upstream.ok && upstream.accounts_health;
  if (!byAccount) return accounts;
  for (const a of accounts || []) {
    const h = byAccount[a.feed_external_id];
    if (!h || !h.bank_synced_at) continue;
    const current = a.feed_synced_at ? new Date(a.feed_synced_at).getTime() : NaN;
    const bank = new Date(h.bank_synced_at).getTime();
    if (!Number.isFinite(current) || bank > current) a.feed_synced_at = h.bank_synced_at;
  }
  return accounts;
}

module.exports = { bankSyncedAt, reclassifyUpstream, applyBankSyncTimes };
