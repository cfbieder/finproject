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
           p.currency,
           -- CR090 P2 — the latest live quote for this instrument, if one was
           -- stored. LEFT, and gated on per-share pricing: a bond priced per 100 face
           -- or a deposit at par must never pick up a per-share number, which is
           -- the $25M shape CR061 §5 exists for. A position without a quote
           -- renders custodian-priced rather than disappearing.
           q.price::text        AS quote_price,
           q.quoted_at          AS quote_at,
           q.venue              AS quote_venue
      FROM security_positions p
      JOIN securities sec ON sec.id = p.security_id
      -- ONE name per position. A security can carry several fintable names since
      -- migration 081 (an FDIC sweep the feed reports under a ticker and a numeric
      -- id); a plain join returned one row per name and listed the sweep twice.
      -- The position's own symbol wins, so the page shows what the feed said.
      LEFT JOIN LATERAL (
        SELECT external_name FROM security_source_mappings
         WHERE security_id = sec.id AND source = 'fintable'
         ORDER BY (external_name = p.raw->>'symbol') DESC, id
         LIMIT 1
      ) m ON TRUE
      LEFT JOIN LATERAL (
        SELECT price, quoted_at, venue
          FROM security_quotes
         WHERE security_id = sec.id
         ORDER BY quoted_at DESC
         LIMIT 1
      ) q ON sec.price_basis = 'per_share'
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
 * How much of the account is cash and money market — CR090 P2.
 *
 * Two tests, not one, because classification lags price behaviour: an
 * instrument is cash-like if its asset class says so OR it is held at par.
 * CR061 §6.4 resolves a par-priced instrument to `unknown` on purpose — we can
 * see HOW it is priced without knowing WHAT it is — and three live positions
 * ($86,309) sit there. Reading the class alone would report Cash Mgt as holding
 * no cash.
 */
function summariseCashShare(positions) {
  let cash = 0;
  let total = 0;
  for (const p of positions) {
    const mv = Number(p.market_value) || 0;
    total += mv;
    if (p.asset_class === 'mmf' || p.asset_class === 'cash' || p.price_basis === 'par') cash += mv;
  }
  return {
    cash_value: cash.toFixed(2),
    cash_share: total === 0 ? 0 : cash / total,
  };
}

/**
 * The live-quote overlay — CR090 P2. A PANEL, never a revaluation.
 *
 * 🔴 The custodian's basis stays the account total and the only figure any other
 * fin surface consumes: the balance sheet, `/investment-returns` and the MTM
 * reconcile all key off it, and a second basis leaking into them recreates the
 * `balance_from_feed` disagreement CR056 documents. It is also what keeps the
 * Options residual legible.
 *
 * So the overlay is stated as a DIFFERENCE over the quoted positions only:
 *
 *     live_adjusted_total = custodian_balance + Σ(quantity × quote − market_value)
 *
 * Not `Σ(live) + Σ(custodian elsewhere)` — arithmetically the same for the
 * reported rows, but that form silently drops the residual (the $33K of option
 * contracts the feed never reports) and would show a smaller account.
 *
 * ⚠️ Freshness is the STALEST quote, never the newest, and coverage is a share
 * of value — because "47% refreshed" and "100% refreshed" are different claims
 * and only one of them is usually true. An account with nothing quotable returns
 * `quoted_positions: 0` and null figures, so the caller can grey the panel
 * rather than render a Δ of 0.00, which reads as "the market didn't move".
 */
function summariseQuotes(positions, { custodianBalance = null } = {}) {
  let quotedAtCustodian = 0;
  let quotedLive = 0;
  let totalValue = 0;
  let quoted = 0;
  let stalest = null;
  for (const p of positions) {
    const mv = Number(p.market_value) || 0;
    totalValue += mv;
    const price = p.quote_price == null ? null : Number(p.quote_price);
    const qty = Number(p.quantity);
    // `per_share` is re-checked here even though the SQL gates on it: this is
    // the arithmetic that multiplies a quantity by a price, and the one place
    // where a wrong basis becomes a wrong number.
    if (price === null || !Number.isFinite(price) || price <= 0) continue;
    if (p.price_basis !== 'per_share' || !Number.isFinite(qty)) continue;
    quoted += 1;
    quotedAtCustodian += mv;
    quotedLive += qty * price;
    if (!stalest || (p.quote_at && new Date(p.quote_at) < new Date(stalest))) stalest = p.quote_at;
  }
  const delta = quotedLive - quotedAtCustodian;
  const cb = custodianBalance == null ? null : Number(custodianBalance);
  return {
    quoted_positions: quoted,
    // Of REPORTED position value, the same denominator as `quotable_share`, so
    // the two figures on the page can be read against each other.
    coverage: totalValue === 0 ? 0 : quotedAtCustodian / totalValue,
    quoted_at_custodian: quoted ? quotedAtCustodian.toFixed(2) : null,
    quoted_live: quoted ? quotedLive.toFixed(2) : null,
    delta: quoted ? delta.toFixed(2) : null,
    live_adjusted_total: quoted && cb !== null ? (cb + delta).toFixed(2) : null,
    oldest_quote_at: stalest,
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
      quotes: summariseQuotes(pos, { custodianBalance: s.custodian_balance }),
      cash: summariseCashShare(pos),
      positions: pos.map((p) => ({
        // CR093 §5 — the stable handle for the security-detail chart. The symbol
        // cannot serve: a bond has none, and two custodians can spell one
        // instrument differently.
        security_id: p.security_id,
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
        // CR090 P2. The row states its own contribution to the overlay, so the
        // panel's Δ can be read back to the positions that produced it.
        quote_price: p.quote_price,
        quote_at: p.quote_at,
        quote_venue: p.quote_venue,
        quote_delta: p.quote_price != null && p.price_basis === 'per_share'
          && Number.isFinite(Number(p.quantity)) && Number.isFinite(Number(p.quote_price))
          ? (Number(p.quantity) * Number(p.quote_price) - (Number(p.market_value) || 0)).toFixed(2)
          : null,
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
  summariseQuotes,
  summariseCashShare,
  accountSnapshots,
  positionsFor,
  RESIDUAL_NOISE_FLOOR,
};
