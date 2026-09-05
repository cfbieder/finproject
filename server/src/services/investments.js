'use strict';
/**
 * investments.js — CR090 P1. The read side of the Investments section.
 *
 * READ-ONLY, and that is the CR's standing non-goal rather than an accident of
 * this file: nothing here books to the ledger, reconciles against the balances
 * fin already holds, re-anchors an `opening_balance`, or touches
 * `balance_from_feed` (CR090 §0, owner-confirmed 2026-09-03).
 *
 * ── The one shape the whole page turns on ──
 *
 * The account total is ALWAYS the custodian balance. Positions sum to a
 * labelled subtotal, and the difference between them is an explicit residual
 * row. On four accounts that is cents; on Fidelity Options it is ~$31.5K,
 * because fintable does not report option contracts. Run everywhere, the row
 * makes that anomaly legible instead of absorbing it — and if fintable ever
 * starts reporting the contracts, it shrinks to zero with no code change.
 *
 * ⚠️ Every figure is computed in SQL over NUMERIC. In JS floats the residual
 * subtraction gives 0.010000000000218279 for a residual that is exactly 0.01 —
 * measured in this feature's own tests — which would paint a fraction of a cent
 * of noise onto four accounts that actually tie.
 */

const db = require('../v2/db');

const SOURCE = 'bank-feed';

// Below this, a residual is rounding rather than a finding. P0 measured the four
// reconciling accounts at 0.0139–0.50 once both halves come from one capture
// (they were $10 wide when paired across two fetches), so $1 is comfortably
// above the noise and three orders of magnitude below the real gap.
const RESIDUAL_NOISE_FLOOR = 1;

/**
 * The latest snapshot per tracked account, with its residual.
 *
 * `valued_on` is selected but NOT defaulted to `polled_on`. A poll date is when
 * the custodian was asked; the 09-02 snapshot carries 08-31's closing prices
 * (CR089), and nothing upstream states the valuation date. The caller renders
 * "polled" when `valued_on` is null — a nullable column read with a silent
 * fallback is the same defect wearing a schema.
 */
async function accountSnapshots({ asOf } = {}) {
  const { rows } = await db.query(`
    SELECT DISTINCT ON (s.account_id)
           s.id AS snapshot_id,
           s.account_id,
           a.name AS account_name,
           a.currency,
           s.polled_on::text            AS polled_on,
           s.valued_on::text            AS valued_on,
           s.status,
           s.positions_count,
           s.sum_market_value::text     AS sum_market_value,
           s.custodian_balance::text    AS custodian_balance,
           (s.custodian_balance - s.sum_market_value)::text AS residual,
           s.fetched_at
      FROM security_position_snapshots s
      JOIN accounts a ON a.id = s.account_id
     WHERE s.source = $1
       AND ($2::date IS NULL OR s.polled_on <= $2::date)
     ORDER BY s.account_id, s.polled_on DESC, s.fetched_at DESC
  `, [SOURCE, asOf || null]);
  return rows;
}

/** Positions for a set of snapshots, largest first. */
async function positionsFor(snapshotIds) {
  if (!snapshotIds.length) return [];
  const { rows } = await db.query(`
    SELECT p.snapshot_id,
           p.security_id,
           COALESCE(sec.ticker, m.external_name) AS symbol,
           sec.name        AS name,
           sec.asset_class,
           p.quantity::text     AS quantity,
           p.price::text        AS price,
           p.price_basis,
           p.price_source,
           p.market_value::text AS market_value,
           p.cost_basis::text   AS cost_basis,
           p.currency
      FROM security_positions p
      JOIN securities sec ON sec.id = p.security_id
      LEFT JOIN security_source_mappings m
        ON m.security_id = sec.id AND m.source = 'fintable'
     WHERE p.snapshot_id = ANY($1::int[])
     ORDER BY p.snapshot_id, p.market_value DESC NULLS LAST
  `, [snapshotIds]);
  return rows;
}

/**
 * Unrealized gain/loss, and the coverage that decides whether it can be shown.
 *
 * ⚠️ Per account this is the SUM of the covered positions' G/L — never
 * `market value − Σ cost basis`, which is wrong whenever coverage is partial.
 * And the identity `cost + unrealized = market value` is NOT asserted anywhere:
 * a money-market fund carries market value with no basis, so an account holding
 * one breaks it every day (CR058 §12.9 pins a test to that fact).
 *
 * Coverage bands mirror CR056 so the owner reads one instrument, not two:
 * ≥90% plain · 50–90% badged · <50% suppressed.
 */
function summariseUnrealized(positions) {
  let coveredValue = 0;
  let totalValue = 0;
  let costBasis = 0;
  let gain = 0;
  let covered = 0;
  for (const p of positions) {
    const mv = Number(p.market_value) || 0;
    totalValue += mv;
    const cb = p.cost_basis == null ? null : Number(p.cost_basis);
    // Two exclusions, and the second was found by reading the rendered page.
    //
    // `> 0`, not `!= null`: a zero basis is "no basis by nature" (cash and
    // money-market), and dividing by it would make the percentage infinite.
    //
    // And `price_basis !== 'par'`: a money-market fund is bought and held AT
    // par, so its unrealized is structurally zero — not measured to be zero.
    // Counting it as covered reported "unrealized $0.00, 100% covered" for an
    // account holding nothing but a cash sweep, which claims a measurement
    // nobody made. Excluded, that account correctly reports no cost basis.
    if (cb !== null && cb > 0 && p.price_basis !== 'par') {
      coveredValue += mv;
      costBasis += cb;
      gain += mv - cb;
      covered += 1;
    }
  }
  const coverage = totalValue === 0 ? 0 : coveredValue / totalValue;
  return {
    covered_positions: covered,
    coverage,                                   // share of VALUE, not of count
    band: coverage >= 0.9 ? 'full' : (coverage >= 0.5 ? 'partial' : 'insufficient'),
    cost_basis: covered ? costBasis.toFixed(2) : null,
    unrealized: covered ? gain.toFixed(2) : null,
    unrealized_pct: covered && costBasis > 0 ? (gain / costBasis) : null,
  };
}

/**
 * How fresh this account's prices are, weighted by value.
 *
 * ⚠️ Reports the STALEST material component first, never the newest. A header
 * stamped with the newest timestamp on the page is the single most likely way
 * this surface tells a lie.
 */
function summariseFreshness(positions) {
  let quotable = 0;
  let total = 0;
  const sources = {};
  for (const p of positions) {
    const mv = Number(p.market_value) || 0;
    total += mv;
    if (p.price_basis === 'per_share') quotable += mv;
    sources[p.price_source] = (sources[p.price_source] || 0) + mv;
  }
  return {
    quotable_share: total === 0 ? 0 : quotable / total,
    // 0% quotable is a FACT about the account (bonds and money-market have no
    // market quote by nature), not a warning — CR074: a rule that cannot NOT
    // fire carries no information.
    unquotable_by_nature: total > 0 && quotable === 0,
    value_by_price_source: Object.fromEntries(
      Object.entries(sources).map(([k, v]) => [k, v.toFixed(2)]),
    ),
  };
}

/**
 * The portfolio: one entry per tracked account, each reconciling to its
 * custodian balance.
 */
async function buildPortfolio({ asOf } = {}) {
  const snapshots = await accountSnapshots({ asOf });
  const positions = await positionsFor(snapshots.map((s) => s.snapshot_id));
  const bySnapshot = new Map();
  for (const p of positions) {
    if (!bySnapshot.has(p.snapshot_id)) bySnapshot.set(p.snapshot_id, []);
    bySnapshot.get(p.snapshot_id).push(p);
  }

  const accounts = snapshots.map((s) => {
    const pos = bySnapshot.get(s.snapshot_id) || [];
    const residual = s.residual == null ? null : Number(s.residual);
    return {
      account_id: s.account_id,
      account_name: s.account_name,
      currency: s.currency,
      polled_on: s.polled_on,
      // Deliberately passed through as null rather than filled in. See
      // accountSnapshots().
      valued_on: s.valued_on,
      status: s.status,
      positions_count: s.positions_count,
      sum_market_value: s.sum_market_value,
      custodian_balance: s.custodian_balance,
      residual: s.residual,
      // A back-dated snapshot has no custodian balance (the feed reports only
      // today's), so it has no residual — and "no residual" must not render as
      // a reconciled zero.
      residual_known: residual !== null,
      residual_material: residual !== null && Math.abs(residual) >= RESIDUAL_NOISE_FLOOR,
      unrealized: summariseUnrealized(pos),
      freshness: summariseFreshness(pos),
      positions: pos.map((p) => ({
        symbol: p.symbol,
        // `—` rather than an echo of the symbol: for a CUSIP the upstream sets
        // name == symbol, and repeating it down 31 rows is noise, while a blank
        // is a finding.
        name: p.name && p.name !== p.symbol ? p.name : null,
        asset_class: p.asset_class,
        quantity: p.quantity,
        price: p.price,
        price_basis: p.price_basis,
        price_source: p.price_source,
        market_value: p.market_value,
        // POSITION TOTAL. Never divided here — that quotient has three
        // different units across the three conventions.
        cost_basis: p.cost_basis,
        currency: p.currency,
        share_of_account: s.sum_market_value && Number(s.sum_market_value) !== 0
          ? Number(p.market_value) / Number(s.sum_market_value)
          : null,
      })),
    };
  });

  // ⚠️ The portfolio total sums CUSTODIAN BALANCES, never position rows.
  // Summing positions would understate by every unreported option contract.
  const total = accounts.reduce((sum, a) => sum + (Number(a.custodian_balance) || 0), 0);
  const unreconciled = accounts.reduce(
    (sum, a) => sum + (a.residual_material ? Number(a.residual) : 0), 0);

  return {
    as_of: asOf || null,
    accounts,
    totals: {
      custodian_balance: total.toFixed(2),
      unreconciled_residual: unreconciled.toFixed(2),
      accounts: accounts.length,
    },
  };
}

/** A single account's series — how its value moved, poll by poll. */
/**
 * One account's snapshot history — BOTH sources, each labelled and each carrying
 * its own dating.
 *
 * ⚠️ This filtered on `source = 'bank-feed'` until CR090 P3, which was correct
 * when statements did not exist and silently wrong afterwards: CR061 P2 put 117
 * quarterly snapshots back to 2016-03-31 into the same table and this query
 * returned 64 rows starting 2026-07-04. A decade of history was queryable and
 * unreachable.
 *
 * ⚠️ `observed_on` is the date the row is TRUE FOR, and it is not the same column
 * for both sources. A statement states its own period end (`valued_on`); the feed
 * knows only when it asked (`polled_on`) and its `valued_on` is NULL by design
 * (CR089 — nothing upstream states it). Coalescing them into one field is exactly
 * the conflation CR089 exists to prevent, so `source` ships beside it and the
 * caller must render the two differently. Both raw columns are returned as well,
 * so nothing downstream has to guess which one it got.
 *
 * Ordered by the date each row describes, NOT by `polled_on` — a statement
 * ingested today describes 2016.
 *
 * 🔴 `limit` applies to the FEED ONLY, and that is not a detail. A single
 * `ORDER BY … DESC LIMIT n` over both sources truncates the OLDEST rows first —
 * which are precisely the decade of quarterly statements, thrown away to make
 * room for daily polls of last week. The feed grows by 365 rows a year against
 * roughly 4 for statements, so the irreplaceable series would have been squeezed
 * out silently and the chart would simply have got shorter over time.
 *
 * Statements are returned in full. Their cadence bounds them: ~4 a year per
 * account, 42 for the longest-running one.
 */
async function accountHistory(accountId, { limit = 400 } = {}) {
  const { rows } = await db.query(`
    WITH shaped AS (
      SELECT source,
             COALESCE(valued_on, polled_on) AS observed_on,
             polled_on, valued_on, status, positions_count,
             sum_market_value, custodian_balance
        FROM security_position_snapshots
       WHERE account_id = $1 AND status = 'fetched'
    )
    SELECT source,
           observed_on::text AS observed_on,
           polled_on::text   AS polled_on,
           valued_on::text   AS valued_on,
           status,
           positions_count,
           sum_market_value::text  AS sum_market_value,
           custodian_balance::text AS custodian_balance
      FROM (
        SELECT * FROM shaped WHERE source = 'statement'
        UNION ALL
        SELECT * FROM (
          SELECT * FROM shaped WHERE source <> 'statement'
           ORDER BY observed_on DESC
           LIMIT $2
        ) recent_feed
      ) merged_series
     ORDER BY observed_on, source
  `, [accountId, limit]);
  return rows;
}

module.exports = {
  buildPortfolio,
  accountHistory,
  // exposed for tests:
  summariseUnrealized,
  summariseFreshness,
  accountSnapshots,
  RESIDUAL_NOISE_FLOOR,
};
