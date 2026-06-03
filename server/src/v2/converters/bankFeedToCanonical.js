/**
 * bankFeedToCanonical — normalizes the bank-feed /v1/transactions contract
 * shape (CR021 §3.2) into `bankfeed_staging` row shape, and provides the
 * shared cross-source dedup predicate used by both the bank-feed promote step
 * and the PS reverse-dedup (CR022 R2).
 *
 * Pure module: no DB, no network. Unit-tested in
 * services/__tests__/bankFeedImport.test.js.
 *
 * Contract row shape (live, fintable upstream):
 *   {
 *     id, account_id, source, external_id, transaction_date,
 *     amount: "-362.2100", currency: "PLN", description, merchant,
 *     category_hint, pending, ingested_at
 *   }
 * Note: `account_id` here is bank-feed's INTERNAL numeric id (e.g. "6"), not
 * the stable account UUID. The mapping table (account_source_mappings) and our
 * `feed_account_external_id` column key on the UUID (`/v1/accounts.external_id`),
 * so the caller passes an internal-id → UUID resolver. There is no separate
 * `raw` field on the list contract, so the whole tx object is preserved as raw.
 */

const MATCH_TOLERANCE_DAYS = 1;

/** Round to 4 decimal places as an integer count of minor-units (avoids float drift). */
function toMinorUnits4(value) {
  return Math.round(Math.abs(Number(value)) * 10000);
}

/** Parse 'YYYY-MM-DD' into a UTC epoch-day integer. Returns null if unparseable. */
function toEpochDay(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.floor(ms / 86400000);
}

function normDesc(s) {
  return (s == null ? '' : String(s)).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a feed transaction's internal account_id to its account UUID.
 * `resolver` may be a Map, a plain object, or a function (id) => uuid.
 */
function resolveExternalId(internalId, resolver) {
  if (!resolver || internalId == null) return null;
  const key = String(internalId);
  if (typeof resolver === 'function') return resolver(key) || null;
  if (resolver instanceof Map) return resolver.get(key) || null;
  return resolver[key] || null;
}

/**
 * Normalize a single contract transaction into a staging-row object.
 * Returns null for rows that must be filtered out of staging (pending=true).
 * Throws if a required field (external_id / source / amount / date) is missing
 * or unparseable — the caller decides whether to skip-and-count or fail.
 *
 * @param {object} tx        one /v1/transactions row
 * @param {object} opts
 * @param {Map|object|function} [opts.accountExternalIdById]  internal id → UUID
 */
function normalizeFeedTransaction(tx, opts = {}) {
  if (!tx || typeof tx !== 'object') {
    throw new Error('normalizeFeedTransaction: tx must be an object');
  }
  if (tx.pending === true) return null; // filtered out of staging

  const externalId = tx.external_id;
  const source = tx.source;
  if (!externalId) throw new Error('normalizeFeedTransaction: missing external_id');
  if (!source) throw new Error('normalizeFeedTransaction: missing source');

  const amount = Number(tx.amount);
  if (!Number.isFinite(amount)) {
    throw new Error(`normalizeFeedTransaction: non-numeric amount "${tx.amount}" (external_id=${externalId})`);
  }

  const date = typeof tx.transaction_date === 'string' ? tx.transaction_date.slice(0, 10) : null;
  if (!date || toEpochDay(date) === null) {
    throw new Error(`normalizeFeedTransaction: bad transaction_date "${tx.transaction_date}" (external_id=${externalId})`);
  }

  const currency = tx.currency ? String(tx.currency).trim().toUpperCase().slice(0, 3) : null;

  return {
    external_id: String(externalId),
    source: String(source),
    feed_account_external_id: resolveExternalId(tx.account_id, opts.accountExternalIdById),
    transaction_date: date,
    amount,                       // numeric, signed; outflow negative per contract
    currency,
    base_amount: tx.base_amount != null ? Number(tx.base_amount) : null,
    base_currency: tx.base_currency ? String(tx.base_currency).toUpperCase().slice(0, 3) : 'USD',
    description: tx.description != null ? String(tx.description).slice(0, 500) : null,
    merchant: tx.merchant != null ? String(tx.merchant).slice(0, 200) : null,
    category_hint: tx.category_hint != null ? String(tx.category_hint).slice(0, 100) : null,
    activity_type: tx.activity_type != null ? String(tx.activity_type).slice(0, 40) : null,
    pending: tx.pending === true,
    raw: tx,                      // whole contract row (no separate raw field on the list endpoint)
  };
}

// ── CR024 Phase 2: Fidelity activity categorizer ──────────────────────────────
//
// Maps a SnapTrade activity_type (+ the account's trade_treatment) to a promote
// action. Category names (not ids) so promote resolves them per-DB. Returns:
//   { action: 'income'|'transfer', category: '<COA leaf name>' }  → insert, categorized
//   { action: 'suppress' }                                        → never promote (net-zero plumbing)
//   { action: 'review' }                                          → insert uncategorized (accepted=FALSE)
//
// activity_type is null for non-Fidelity rows (PKO/GoCardless) → 'review', i.e. the
// pre-Phase-2 behavior (promote uncategorized to the review queue). Unknown/new
// SnapTrade types (e.g. PAYMENT, FEE) fail safe to 'review' — never dropped, never
// mis-booked.
function categorizeFidelityActivity(activityType, tradeTreatment) {
  if (activityType == null) return { action: 'review' };
  switch (String(activityType).toUpperCase()) {
    case 'INTEREST':         return { action: 'income',   category: 'Interest Income' };
    case 'DIVIDEND':         return { action: 'income',   category: 'Financial Income - Dividend' };
    case 'REI':              return { action: 'transfer', category: 'Transfer - Securities Trades' };
    case 'BUY':
    case 'SELL':
      return tradeTreatment === 'income'
        ? { action: 'income',   category: 'Option Trade' }
        : { action: 'transfer', category: 'Transfer - Securities Trades' };
    case 'CONTRIBUTION':
    case 'WITHDRAWAL':       return { action: 'transfer', category: 'Transfer - Bank' };
    case 'LOAN':
    case 'JOURNALED':
    case 'OPTIONEXPIRATION': return { action: 'suppress' };
    default:                 return { action: 'review' };
  }
}

/**
 * Normalize a batch: filter pending, skip-and-count bad rows, and collapse
 * in-batch duplicates by (source, external_id) keeping the last occurrence
 * (DB ON CONFLICT would do the same, but collapsing keeps insertMany counts
 * deterministic and the unit tests honest).
 *
 * @returns {{ rows, filteredPending, skipped, duplicatesCollapsed, unresolvedAccounts }}
 */
function normalizeBatch(txs, opts = {}) {
  const byKey = new Map();
  let filteredPending = 0;
  let skipped = 0;
  let duplicatesCollapsed = 0;
  const unresolvedAccounts = new Set();

  for (const tx of txs || []) {
    let row;
    try {
      row = normalizeFeedTransaction(tx, opts);
    } catch (err) {
      skipped++;
      continue;
    }
    if (row === null) { filteredPending++; continue; }
    if (!row.feed_account_external_id) unresolvedAccounts.add(String(tx && tx.account_id));
    const key = `${row.source}::${row.external_id}`;
    if (byKey.has(key)) duplicatesCollapsed++;
    byKey.set(key, row);
  }

  return {
    rows: Array.from(byKey.values()),
    filteredPending,
    skipped,
    duplicatesCollapsed,
    unresolvedAccounts: Array.from(unresolvedAccounts),
  };
}

/**
 * Cross-source dedup predicate (CR022 R2). Given a target transaction and a set
 * of candidate rows from the OTHER source, return the single best match, or null.
 *
 * Match key: same fin account_id, same currency, ABS(amount) equal to 4dp,
 * transaction_date within ±toleranceDays. Both `target` and `candidates` carry
 * fin account ids (the bank-feed side is resolved via account_source_mappings
 * before this is called), so this stays a pure function.
 *
 * Tie-break (the "two genuinely distinct same-day, same-amount" case): when more
 * than one candidate satisfies the key, link only if exactly one matches the
 * target description; otherwise return null and DO NOT merge — a visible
 * duplicate in the review queue beats silent collapse of two real transactions
 * (CR022 §3.3, §9).
 *
 * @param {object} target      {account_id, amount, currency, transaction_date, description?}
 * @param {object[]} candidates
 * @param {object} [opts] {toleranceDays}
 */
function findPsMatch(target, candidates, opts = {}) {
  if (!target || !Array.isArray(candidates) || candidates.length === 0) return null;
  const toleranceDays = opts.toleranceDays != null ? opts.toleranceDays : MATCH_TOLERANCE_DAYS;

  const tAccount = String(target.account_id);
  const tCurrency = target.currency ? String(target.currency).toUpperCase() : null;
  const tUnits = toMinorUnits4(target.amount);
  const tDay = toEpochDay(target.transaction_date);
  if (tDay === null) return null;

  const matches = candidates.filter((c) => {
    if (String(c.account_id) !== tAccount) return false;
    const cCurrency = c.currency ? String(c.currency).toUpperCase() : null;
    if (cCurrency !== tCurrency) return false;
    if (toMinorUnits4(c.amount) !== tUnits) return false;
    const cDay = toEpochDay(c.transaction_date);
    if (cDay === null) return false;
    return Math.abs(cDay - tDay) <= toleranceDays;
  });

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Ambiguous key: disambiguate only by an exact description match.
  const tDesc = normDesc(target.description);
  if (tDesc) {
    const exact = matches.filter((c) => normDesc(c.description) === tDesc);
    if (exact.length === 1) return exact[0];
  }
  return null; // conservative: do not merge when ambiguous
}

module.exports = {
  normalizeFeedTransaction,
  normalizeBatch,
  findPsMatch,
  categorizeFidelityActivity,
  // exposed for tests / reuse
  MATCH_TOLERANCE_DAYS,
  _toMinorUnits4: toMinorUnits4,
  _toEpochDay: toEpochDay,
  _normDesc: normDesc,
};
