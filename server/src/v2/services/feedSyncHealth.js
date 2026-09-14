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

module.exports = { applyBankSyncTimes };
