'use strict';
/**
 * ingestHoldings.js — CR061 P1.
 *
 * bank-feed's `/v1/holdings` → fin's `security_position_snapshots` /
 * `security_positions`, filling tables that have been 0 rows since May 2026.
 *
 * READ-ONLY with respect to the ledger. This writes position snapshots and
 * securities. It books nothing, reconciles nothing against the balances fin
 * already holds, re-anchors no `opening_balance`, and never touches
 * `balance_from_feed` (CR090 §0, owner-confirmed 2026-09-03).
 *
 * ── Four things it deliberately does NOT do ─────────────────────────────────
 *
 * 1. It does not write `security_lots`. That table requires `acquired_date` and
 *    `cost_per_share`, which a daily snapshot has neither of; writing snapshots
 *    there would fabricate both and poison CR020's lot model permanently.
 *
 * 2. It does not divide `cost_basis` by `quantity`. The upstream sends the
 *    POSITION TOTAL, and that division yields dollars-per-share for an equity, a
 *    price fraction for a bond and 1.00 for a money-market fund — three units,
 *    one column. Whoever needs per-share cost does it once, downstream.
 *
 * 3. It does not fill `valued_on`. `polled_on` is when the custodian was asked;
 *    nothing upstream states when the values were true (CR089). The column stays
 *    NULL until a proven detector fills it, and no consumer may fall back.
 *
 * 4. It does not overwrite a manual classification. `classification_source`
 *    is the record of an owner decision; the rules propose, they do not overrule.
 */

const db = require('../db');
const bankFeedClient = require('./bankFeedClient');
const { classify } = require('./investmentClassification');

const SOURCE = 'bank-feed';
const MAPPING_SOURCE = 'fintable';

/**
 * bank-feed's INTERNAL account id ("39") → its stable external UUID.
 *
 * ⚠️ Not optional plumbing. `/v1/holdings` reports the internal id, while fin's
 * `account_source_mappings.external_name` keys on the UUID — and that internal
 * id has already been re-keyed once, in lockstep across both repos (fin 063/051,
 * bank-feed 006). Keying fin's holdings on the internal id would orphan every
 * snapshot at the next re-consent, and §4.8 says nothing recovers a lost day.
 * This is the same resolution `refreshBankFeedV2.ingestBalances` performs, for
 * the same reason.
 */
async function buildFeedIdToUuid() {
  const resp = await bankFeedClient.accounts();
  const list = Array.isArray(resp) ? resp : (resp && resp.accounts) || [];
  const map = new Map();
  for (const a of list) {
    if (a && a.id != null && a.external_id) map.set(String(a.id), String(a.external_id));
  }
  return map;
}

/**
 * Feed account UUID → fin account id, for accounts fin actually tracks.
 *
 * ⚠️ `ignored = FALSE` is load-bearing, not hygiene. The owner deliberately does
 * not track one Fidelity account (CR061 §10.1); without this clause its
 * positions would be ingested and every "unmapped brokerage account" rule would
 * fire on it forever — the warning CR074 forbids, and the identical scoping
 * CR060 needed for a bank belonging to another entity.
 */
async function buildAccountMap() {
  const { rows } = await db.query(`
    SELECT external_name, account_id
      FROM account_source_mappings
     WHERE source = $1 AND account_id IS NOT NULL AND ignored = FALSE
  `, [SOURCE]);
  const map = new Map();
  for (const r of rows) map.set(String(r.external_name), r.account_id);
  return map;
}

/**
 * Resolve one upstream symbol to a `securities` row, creating it on first sight.
 *
 * Resolution goes through `security_source_mappings`, NOT `securities.ticker`.
 * That table exists for exactly this (`UNIQUE(source, external_name)`), and
 * resolving on ticker would mint duplicate `securities` rows for one instrument
 * once CR019's Quicken promote runs, since that routes through its own staging
 * id rather than the ticker.
 */
async function resolveSecurity(position, cache) {
  const symbol = String(position.symbol || '').trim();
  if (!symbol) return null;
  if (cache.has(symbol)) return cache.get(symbol);

  const existing = await db.query(`
    SELECT s.id
      FROM security_source_mappings m
      JOIN securities s ON s.id = m.security_id
     WHERE m.source = $1 AND m.external_name = $2
  `, [MAPPING_SOURCE, symbol]);

  if (existing.rows.length) {
    cache.set(symbol, existing.rows[0].id);
    return existing.rows[0].id;
  }

  const c = classify(position);
  // `ticker` is left NULL for anything that is not a plain listed ticker: a
  // CUSIP is not a ticker, and the column is UNIQUE, so putting one there would
  // both lie and eventually collide.
  const isTicker = /^[A-Z]{1,5}$/.test(symbol.toUpperCase());
  const { rows } = await db.query(`
    INSERT INTO securities
      (ticker, name, asset_class, currency, price_basis, quantity_unit, classification_source)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [
    isTicker ? symbol.toUpperCase() : null,
    position.name || symbol,
    c.asset_class,
    (position.currency || 'USD').toUpperCase().slice(0, 3),
    c.price_basis,
    c.quantity_unit,
    c.classification_source,
  ]);
  const securityId = rows[0].id;

  await db.query(`
    INSERT INTO security_source_mappings (security_id, source, external_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (source, external_name) DO NOTHING
  `, [securityId, MAPPING_SOURCE, symbol]);

  cache.set(symbol, securityId);
  return securityId;
}

/**
 * Ingest one account's snapshot.
 *
 * A snapshot with no `polled_on` writes nothing: 'absent' means the upstream
 * named no date, so there is no row to key and re-asking is cheap. The absence
 * of a header IS the record.
 */
async function ingestAccountSnapshot(entry, finAccountId, securityCache) {
  if (!entry.polled_on) return { header: 0, positions: 0 };

  const { rows } = await db.query(`
    INSERT INTO security_position_snapshots
      (account_id, feed_account_id, polled_on, source, status,
       custodian_balance, positions_count, sum_market_value, raw)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (account_id, polled_on, source)
    DO UPDATE SET status = EXCLUDED.status,
                  custodian_balance = EXCLUDED.custodian_balance,
                  positions_count = EXCLUDED.positions_count,
                  sum_market_value = EXCLUDED.sum_market_value,
                  raw = EXCLUDED.raw,
                  fetched_at = NOW()
    RETURNING id
  `, [
    finAccountId,
    entry.feed_account_id || null,
    entry.polled_on,
    SOURCE,
    entry.status,
    entry.custodian_balance,
    entry.positions_count || 0,
    entry.sum_market_value,
    entry.raw || null,
  ]);
  const snapshotId = rows[0].id;

  const positions = entry.positions || [];
  if (positions.length === 0) return { header: 1, positions: 0 };

  // Replace, never merge. A symbol that has LEFT the account must not survive as
  // a stale row inflating Σ positions — which CR090's residual row would then
  // absorb as "not reported by the feed", the one number it exists to make
  // legible. Re-fetching the same poll date is expected and its quantities can
  // legitimately differ, so the later fetch wins wholesale.
  await db.query(`DELETE FROM security_positions WHERE snapshot_id = $1`, [snapshotId]);

  let written = 0;
  for (const p of positions) {
    const securityId = await resolveSecurity(p, securityCache);
    if (!securityId) continue;
    const { rows: secRows } = await db.query(`SELECT price_basis FROM securities WHERE id = $1`, [securityId]);
    await db.query(`
      INSERT INTO security_positions
        (snapshot_id, account_id, security_id, quantity, price, price_basis,
         price_source, market_value, cost_basis, currency, raw)
      VALUES ($1, $2, $3, $4, $5, $6, 'custodian', $7, $8, $9, $10)
    `, [
      snapshotId, finAccountId, securityId,
      p.quantity, p.price,
      // Copied AS AT this snapshot: a later reclassification must not silently
      // restate what an old snapshot meant.
      secRows[0] ? secRows[0].price_basis : null,
      p.value,
      // POSITION TOTAL, verbatim. See note 2 in the header.
      p.cost_basis,
      (p.currency || null),
      JSON.stringify({ symbol: p.symbol, name: p.name }),
    ]);
    written += 1;
  }
  return { header: 1, positions: written };
}

/**
 * Ingest every tracked account's latest holdings snapshot.
 *
 * Best-effort by design and never throws into a caller's transaction path: the
 * ledger ingest is the important half, and a holdings hiccup must not fail it.
 * Anything it could not place is COUNTED, never silently dropped — an unresolved
 * account is exactly the shape CR060's orphaned-mapping guard exists for.
 */
async function ingestHoldings({ asOf } = {}) {
  const summary = {
    accounts: 0, headers: 0, positions: 0,
    unmapped: [], securities_created: 0, statuses: {}, error: null,
  };

  let resp;
  try {
    resp = await bankFeedClient.holdings(asOf || undefined);
  } catch (err) {
    summary.error = err.message;
    return summary;
  }

  const list = (resp && resp.holdings) || [];
  const accountMap = await buildAccountMap();
  const feedIdToUuid = await buildFeedIdToUuid();
  const securityCache = new Map();
  const securitiesBefore = (await db.query(`SELECT count(*)::int AS n FROM securities`)).rows[0].n;

  for (const entry of list) {
    const feedUuid = feedIdToUuid.get(String(entry.account_id));
    const finAccountId = feedUuid ? accountMap.get(feedUuid) : undefined;
    if (!finAccountId) {
      // Not an error on its own: the owner deliberately does not track one
      // account, and OCME's accounts are served to a different app. It is
      // reported so a re-consent that re-keys an account cannot stop holdings
      // silently — which is how a feed once went dead for seven weeks.
      summary.unmapped.push({ feed_account_id: entry.account_id, uuid: feedUuid || null });
      continue;
    }
    summary.accounts += 1;
    summary.statuses[entry.status] = (summary.statuses[entry.status] || 0) + 1;
    const r = await ingestAccountSnapshot({ ...entry, feed_account_id: feedUuid }, finAccountId, securityCache);
    summary.headers += r.header;
    summary.positions += r.positions;
  }

  summary.securities_created =
    (await db.query(`SELECT count(*)::int AS n FROM securities`)).rows[0].n - securitiesBefore;
  return summary;
}

/**
 * The reconciliation CR090 renders: custodian balance vs Σ positions, per account.
 *
 * ⚠️ Computed in SQL, in NUMERIC, deliberately. In JS floats the subtraction of
 * two exact decimals gives 0.010000000000218279 for a residual that is exactly
 * 0.01 — measured in this feature's own test suite — which would paint a
 * fraction of a cent of noise onto four accounts that actually tie.
 */
async function residualsByAccount({ asOf } = {}) {
  const { rows } = await db.query(`
    SELECT DISTINCT ON (s.account_id)
           s.account_id,
           a.name AS account_name,
           s.polled_on,
           s.valued_on,
           s.status,
           s.positions_count,
           s.sum_market_value::text  AS sum_market_value,
           s.custodian_balance::text AS custodian_balance,
           (s.custodian_balance - s.sum_market_value)::text AS residual
      FROM security_position_snapshots s
      JOIN accounts a ON a.id = s.account_id
     WHERE s.source = $1
       AND ($2::date IS NULL OR s.polled_on <= $2::date)
     ORDER BY s.account_id, s.polled_on DESC, s.fetched_at DESC
  `, [SOURCE, asOf || null]);
  return rows;
}

module.exports = {
  ingestHoldings,
  residualsByAccount,
  // exposed for tests:
  buildAccountMap,
  buildFeedIdToUuid,
  resolveSecurity,
  ingestAccountSnapshot,
};
