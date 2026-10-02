/**
 * feedSyncHealth — keep a reconciliation row's `feed_synced_at` honest for
 * balances stored before bank-feed learned what "synced" means.
 *
 * On GoCardless (NORDIGEN) connections Fintable's `last_successful_update` is
 * the newest TRANSACTION's date stamped `T23:59:59Z` whenever a sync brings
 * nothing new (measured 2026-09-13: Erste Bank Polska 2026-07-10 against its
 * last transaction that day, while its sync with the bank finished that
 * afternoon). bank-feed stored that as `source_synced_at`, fin copied it into
 * `bankfeed_balances`, and a dormant account read "synced 64 days ago" in red.
 *
 * bank-feed 04815bd (2026-09-14) fixed the source: its health verdict and
 * `source_synced_at` now use when the bank was last REACHED, published as
 * `last_bank_sync_at` on every `accounts_health` entry. fin v3.61.3 had
 * re-read the verdict here as a stopgap; that part is gone. What remains is
 * this correction, because rows fin already stored keep the old value until a
 * newer balance replaces them — and an account whose balance never changes may
 * not get one soon.
 */

/**
 * Move each row's `feed_synced_at` forward to bank-feed's `last_bank_sync_at`
 * for its account when that is later; never move it backwards. Mutates and
 * returns `accounts`. A no-op when health could not be read.
 */
function applyBankSyncTimes(accounts, upstream) {
  const byAccount = upstream && upstream.ok && upstream.accounts_health;
  if (!byAccount) return accounts;
  for (const a of accounts || []) {
    const h = byAccount[a.feed_external_id];
    const at = h && h.last_bank_sync_at;
    if (!at) continue;
    const bank = new Date(at).getTime();
    if (!Number.isFinite(bank)) continue;
    const current = a.feed_synced_at ? new Date(a.feed_synced_at).getTime() : NaN;
    if (!Number.isFinite(current) || bank > current) a.feed_synced_at = new Date(bank).toISOString();
  }
  return accounts;
}

/**
 * Is bank-feed's OWN sync stalled? (2026-10-02)
 *
 * `staleFeeds` reads each bank's sync time as Fintable reports it, which stays
 * fresh while bank-feed itself refuses every batch — on 2026-10-01/02 its insert
 * guard rolled back every sync for 30 hours (a month-end batch crossed the ratio
 * by ONE row) and the Home strip read "all clear" throughout. The signal was
 * already in /v1/health/feeds: each connection's `last_synced_at` moves only on
 * a SUCCESSFUL bank-feed sync, judged against the service's own
 * `stale_threshold_hours`, and `service.most_recent_error` names the cause.
 *
 * Pure. `health` null (bank-feed unreachable) answers `null` — could-not-ask is
 * not "fine", and it is not "stalled" either.
 */
function feedServiceStatus(health, nowMs = Date.now()) {
  if (!health || !Array.isArray(health.feeds)) return null;
  const times = health.feeds
    .map((f) => (f.last_synced_at ? new Date(f.last_synced_at).getTime() : NaN))
    .filter(Number.isFinite);
  if (!times.length) return null;
  const lastSyncMs = Math.max(...times);
  const hoursSinceSync = Math.floor((nowMs - lastSyncMs) / 3600000);
  const threshold = Number(health.stale_threshold_hours) || 2;
  const svc = health.service || {};
  const errAt = svc.most_recent_error_at ? new Date(svc.most_recent_error_at).getTime() : NaN;
  // The error only explains the stall if it came AFTER the last success.
  const failingSince = Number.isFinite(errAt) && errAt > lastSyncMs;
  return {
    stalled: hoursSinceSync >= threshold,
    hoursSinceSync,
    lastSyncAt: new Date(lastSyncMs).toISOString(),
    lastError: failingSince ? String(svc.most_recent_error || '').slice(0, 300) : null,
  };
}

module.exports = { applyBankSyncTimes, feedServiceStatus };
