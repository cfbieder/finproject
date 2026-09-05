'use strict';
/**
 * securityChart.js — CR093 §5. One security's price history, with the index
 * overlay and MACD the owner asked for.
 *
 * ⚠️ THE MATH IS PURE AND THE DB IS A THIN FETCH, deliberately. Roadmap issue
 * #26 records nine tests written against a builder that reads every account's
 * snapshots: green on a fresh database, red on real data. EMA, MACD and rebasing
 * are arithmetic — they are tested here on invented series with no database at
 * all, so the assertions cannot be moved by what the portfolio happens to hold.
 *
 * ⚠️ THREE NUMBERS ON THIS SCREEN ALL LOOK LIKE "GAIN" AND ARE NOT THE SAME
 * THING, which is the failure this CR keeps catching in a new costume:
 *   price change    what the quote did over the CHOSEN PERIOD. No dividends, so
 *                   it is not total return.
 *   unrealized G/L  what THIS POSITION is up on its own cost basis, over a
 *                   holding period that is not the chosen one and may predate it
 *                   by years.
 *   the overlay's % what SPY or DIA did over the same window.
 * Each is labelled where it is shown. Reporting any of them as "return" would be
 * the same error CR058 §12.8 and CR056 §3.3 already settled twice.
 */

const db = require('../v2/db');

/** Periods the page offers. `months: null` means everything we hold. */
const PERIODS = [
  { key: '1M', label: '1M', months: 1 },
  { key: '3M', label: '3M', months: 3 },
  { key: '6M', label: '6M', months: 6 },
  { key: '1Y', label: '1Y', months: 12 },
  { key: '3Y', label: '3Y', months: 36 },
  { key: '5Y', label: '5Y', months: 60 },
  { key: 'MAX', label: 'Max', months: null },
];

// The conventional MACD parameterisation. The owner's "9/26/12" is these three
// numbers in the other order.
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

/**
 * ⚠️ THE WARM-UP MUST BE COMPUTED AND THEN THROWN AWAY, not rendered.
 *
 * MACD emits nothing until the slow EMA has seeded (26 bars) and the signal line
 * has seeded on top of it (another 9) — 34 bars before the first value, and the
 * slow EMA is not worth trusting until roughly 3× its period. Computing the
 * indicator over the DISPLAY window alone would mean a 1M chart drew ~0 usable
 * points and a 3M chart drew mostly warm-up while looking like an indicator.
 *
 * So the query fetches this many extra trading days BEFORE the window, the
 * indicator is computed over the whole thing, and only the points inside the
 * window are returned. 120 ≈ 3× the 34-bar seed plus slack for holidays.
 */
const MACD_LEAD_BARS = 120;

/**
 * Exponential moving average, seeded with the simple average of the first
 * `period` values — the standard construction. Returns an array the same length
 * as the input with `null` everywhere the average is not yet defined, because a
 * warm-up value and a real one must not be indistinguishable downstream.
 */
function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * MACD 12/26/9. Returns one entry per input bar, with nulls through the warm-up.
 *
 * ⚠️ The signal line is an EMA of the MACD LINE, and the MACD line does not
 * exist until the slow EMA does — so the signal EMA must be seeded from the
 * first defined MACD value, not from index 0. Seeding it from a run that starts
 * with nulls is how a signal line ends up drawn from the wrong origin and every
 * crossover shifts.
 */
function macd(closes, fast = MACD_FAST, slow = MACD_SLOW, signal = MACD_SIGNAL) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const line = closes.map((_, i) => (fastEma[i] === null || slowEma[i] === null
    ? null : fastEma[i] - slowEma[i]));

  const firstDefined = line.findIndex((v) => v !== null);
  const out = closes.map(() => ({ macd: null, signal: null, histogram: null }));
  if (firstDefined === -1) return out;

  const defined = line.slice(firstDefined);
  const signalEma = ema(defined, signal);
  for (let i = 0; i < defined.length; i += 1) {
    const idx = firstDefined + i;
    out[idx] = {
      macd: line[idx],
      signal: signalEma[i],
      histogram: signalEma[i] === null ? null : line[idx] - signalEma[i],
    };
  }
  return out;
}

/**
 * Rebase a series so its first point is 100.
 *
 * ⚠️ THIS IS WHY THE OVERLAY IS POSSIBLE AT ALL. DIA trades near $534 and a
 * holding may trade at $25; on one price axis the holding is a flat line at the
 * bottom and the chart says nothing. Both series start at 100 and the SHAPES
 * compare, which is the only comparison a level series supports.
 */
function rebase(values) {
  const base = values.find((v) => v !== null && v !== undefined && v !== 0);
  if (base === undefined) return values.map(() => null);
  return values.map((v) => (v === null || v === undefined ? null : (v / base) * 100));
}

/** Trading-day-agnostic: subtract calendar months and let the query find bars. */
function windowStart(endIso, months) {
  if (months === null) return null;
  const d = new Date(`${endIso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Assemble the chart from rows already fetched. Pure: no db, no clock.
 *
 * @param bars     [{ d, close }] for the subject, INCLUDING the MACD lead-in
 * @param from     first date of the DISPLAY window (bars before it are lead-in)
 * @param overlays [{ key, label, bars }] index series, same shape
 */
function buildSeries(bars, from, overlays = []) {
  const closes = bars.map((b) => Number(b.close));
  const ind = macd(closes);

  const startIdx = from ? bars.findIndex((b) => b.d >= from) : 0;
  const visible = startIdx === -1 ? [] : bars.slice(startIdx);
  if (!visible.length) return null;

  const visibleCloses = visible.map((b) => Number(b.close));
  const reb = rebase(visibleCloses);

  const series = visible.map((b, i) => ({
    d: b.d,
    close: Number(b.close),
    rebased: reb[i] === null ? null : Number(reb[i].toFixed(4)),
  }));

  const first = visibleCloses[0];
  const last = visibleCloses[visibleCloses.length - 1];

  const macdPoints = visible.map((b, i) => {
    const m = ind[startIdx + i];
    return {
      d: b.d,
      macd: m.macd === null ? null : Number(m.macd.toFixed(6)),
      signal: m.signal === null ? null : Number(m.signal.toFixed(6)),
      histogram: m.histogram === null ? null : Number(m.histogram.toFixed(6)),
    };
  });

  return {
    series,
    // ⚠️ PRICE CHANGE, not return: no dividends, and nothing to do with what
    // this position cost.
    price_change: {
      from: series[0].d,
      to: series[series.length - 1].d,
      from_close: first,
      to_close: last,
      abs: Number((last - first).toFixed(6)),
      pct: first ? (last - first) / first : null,
    },
    macd: macdPoints,
    // Stated so the page can say "the indicator is seeded from N bars before the
    // window" rather than leaving the reader to assume it began at the left edge.
    macd_lead_bars: startIdx,
    macd_complete: macdPoints.every((p) => p.signal !== null),
    overlays: overlays.map((o) => {
      // The overlay is rebased over ITS OWN bars inside the same window, so a
      // holiday the two markets do not share cannot shift its base.
      const ob = o.bars.filter((b) => b.d >= series[0].d && b.d <= series[series.length - 1].d);
      const oc = ob.map((b) => Number(b.close));
      const orb = rebase(oc);
      return {
        key: o.key,
        label: o.label,
        series: ob.map((b, i) => ({ d: b.d, rebased: orb[i] === null ? null : Number(orb[i].toFixed(4)) })),
        pct: oc.length && oc[0] ? (oc[oc.length - 1] - oc[0]) / oc[0] : null,
      };
    }),
  };
}

/**
 * The overlay pair. ⚠️ These are the ETFs, NOT the indices, and the label says
 * so: SPY and DIA track the S&P 500 and the Dow but carry fees and their own
 * dividend treatment, so calling a line "S&P 500" when it is SPY would be a
 * small, permanent lie on every chart. They cost nothing extra — both are
 * holdings this portfolio already prices, so the overlay needs no new vendor.
 */
const OVERLAY_SYMBOLS = [
  { key: 'SPY', label: 'S&P 500 (SPY)' },
  { key: 'DIA', label: 'Dow (DIA)' },
];

async function buildSecurityChart(securityId, { period = '1Y' } = {}) {
  const spec = PERIODS.find((p) => p.key === String(period).toUpperCase());
  if (!spec) {
    throw Object.assign(
      new Error(`unknown period "${period}" — one of ${PERIODS.map((p) => p.key).join(', ')}`),
      { status: 400 },
    );
  }

  const { rows: secRows } = await db.query(`
    SELECT s.id, s.ticker, s.name, s.asset_class, s.price_basis, s.quantity_unit,
           s.currency, s.sector_weights_as_of IS NOT NULL AS sector_asked
      FROM securities s WHERE s.id = $1`, [securityId]);
  if (!secRows.length) throw Object.assign(new Error('no such security'), { status: 404 });
  const sec = secRows[0];

  const { rows: bounds } = await db.query(`
    SELECT MIN(price_date)::text AS first, MAX(price_date)::text AS last, COUNT(*)::int AS bars
      FROM security_prices WHERE security_id = $1`, [securityId]);
  const have = bounds[0];

  const base = {
    security: {
      id: sec.id,
      ticker: sec.ticker,
      name: sec.name,
      asset_class: sec.asset_class,
      price_basis: sec.price_basis,
      quantity_unit: sec.quantity_unit,
      currency: sec.currency,
    },
    periods: PERIODS.map(({ key, label }) => ({ key, label })),
    period: spec.key,
  };

  // ⚠️ SAY WHY, never draw an empty axis. 45 of the 91 live holdings — 52% of
  // the money — are bonds, CDs and money-market funds with no ticker and no
  // quote. An empty chart reads as "this did not move"; the absence of a market
  // price is a fact about the instrument, not a gap in our data.
  if (!have.bars) {
    return {
      ...base,
      chartable: false,
      no_chart_reason: sec.price_basis === 'per_share'
        ? 'No price history has been loaded for this security yet.'
        : 'This instrument is not quoted on a market — a bond, brokered CD or '
          + 'deposit is held at face or par and has no daily close to chart. '
          + 'Its rating, coupon and maturity are on the Exposure page instead.',
      history: { first: null, last: null, bars: 0 },
      details: await details(securityId, sec),
    };
  }

  const requestedFrom = windowStart(have.last, spec.months);
  // Fetch the display window PLUS the MACD lead-in, in one query.
  const { rows: bars } = await db.query(`
    SELECT price_date::text AS d, close::float AS close
      FROM security_prices
     WHERE security_id = $1
       AND price_date >= COALESCE(
             (SELECT price_date FROM security_prices
               WHERE security_id = $1 AND price_date < $2::date
               ORDER BY price_date DESC OFFSET $3 LIMIT 1),
             '1900-01-01'::date)
     ORDER BY price_date`, [securityId, requestedFrom || have.first, MACD_LEAD_BARS]);

  const overlayRows = await Promise.all(OVERLAY_SYMBOLS.map(async (o) => {
    // ⚠️ Never overlay a security on itself — SPY charted against SPY draws two
    // identical lines and invites the reader to compare them.
    if (sec.ticker === o.key) return null;
    const { rows } = await db.query(`
      SELECT p.price_date::text AS d, p.close::float AS close
        FROM security_prices p JOIN securities s ON s.id = p.security_id
       WHERE s.ticker = $1 AND p.price_date >= $2::date
       ORDER BY p.price_date`, [o.key, requestedFrom || have.first]);
    return rows.length ? { ...o, bars: rows } : null;
  }));

  const built = buildSeries(bars, requestedFrom, overlayRows.filter(Boolean));
  if (!built) {
    return {
      ...base,
      chartable: false,
      no_chart_reason: `No closes inside the ${spec.key} window — history runs `
        + `${have.first} to ${have.last}.`,
      history: have,
      details: await details(securityId, sec),
    };
  }

  return {
    ...base,
    chartable: true,
    history: have,
    // ⚠️ What was ASKED for and what EXISTS, both. A 5Y period on a security
    // whose history starts two years ago must not silently render two years and
    // let the label say five.
    window: {
      requested_from: requestedFrom,
      actual_from: built.series[0].d,
      to: built.series[built.series.length - 1].d,
      truncated: Boolean(requestedFrom) && built.series[0].d > requestedFrom,
    },
    ...built,
    details: await details(securityId, sec),
  };
}

/**
 * The "other relevant details" the owner asked for, in the three groups CR093 §5
 * pins: our position, the instrument, and the quote.
 */
async function details(securityId, sec) {
  const { rows: pos } = await db.query(`
    WITH latest AS (
      SELECT DISTINCT ON (account_id) id, account_id FROM security_position_snapshots
       WHERE source = 'bank-feed' AND status = 'fetched'
       ORDER BY account_id, polled_on DESC)
    SELECT a.name AS account_name,
           p.quantity::float AS quantity,
           p.market_value::float AS market_value,
           p.cost_basis::float AS cost_basis,
           p.price::float AS price,
           p.price_basis, p.price_source
      FROM security_positions p
      JOIN latest l ON l.id = p.snapshot_id
      JOIN accounts a ON a.id = l.account_id
     WHERE p.security_id = $1
     ORDER BY p.market_value DESC NULLS LAST`, [securityId]);

  const { rows: totalRow } = await db.query(`
    WITH latest AS (
      SELECT DISTINCT ON (account_id) id FROM security_position_snapshots
       WHERE source = 'bank-feed' AND status = 'fetched'
       ORDER BY account_id, polled_on DESC)
    SELECT COALESCE(SUM(market_value), 0)::float AS mv FROM security_positions
     WHERE snapshot_id IN (SELECT id FROM latest)`);

  const { rows: sectors } = await db.query(`
    SELECT sector, weight::float AS weight FROM security_sector_weights
     WHERE security_id = $1 ORDER BY weight DESC`, [securityId]);

  const { rows: terms } = await db.query(`
    SELECT as_of::text, maturity_date::text, next_call_date::text,
           coupon_rate::float AS coupon_rate, coupon_type, payment_frequency,
           moodys_rating, sp_rating, fdic_insured
      FROM security_bond_terms WHERE security_id = $1`, [securityId]);

  const { rows: quote } = await db.query(`
    SELECT price_date::text AS last_close_on, close::float AS last_close,
           (CURRENT_DATE - price_date)::int AS age_days
      FROM security_prices WHERE security_id = $1
     ORDER BY price_date DESC LIMIT 1`, [securityId]);

  const { rows: band } = await db.query(`
    SELECT MAX(close)::float AS high, MIN(close)::float AS low
      FROM security_prices
     WHERE security_id = $1 AND price_date >= CURRENT_DATE - INTERVAL '52 weeks'`, [securityId]);

  const mv = pos.reduce((a, p) => a + (p.market_value || 0), 0);
  // ⚠️ NULL, not 0, when no lot carries a basis. A money-market sweep has market
  // value and no cost, and reading that as "cost 0" turns the whole balance into
  // gain — the fabricated-$1.28M shape CR058 §12.9 pins a test to.
  const covered = pos.filter((p) => p.cost_basis !== null && p.cost_basis !== undefined);
  const cost = covered.length ? covered.reduce((a, p) => a + p.cost_basis, 0) : null;

  return {
    position: {
      held: pos.length > 0,
      accounts: pos.map((p) => ({
        account_name: p.account_name,
        quantity: p.quantity,
        market_value: p.market_value === null ? null : p.market_value.toFixed(2),
        price: p.price,
        price_source: p.price_source,
      })),
      quantity: pos.reduce((a, p) => a + (p.quantity || 0), 0),
      quantity_unit: sec.quantity_unit,
      market_value: mv.toFixed(2),
      cost_basis: cost === null ? null : cost.toFixed(2),
      // ⚠️ THIS IS NOT THE CHART'S % CHANGE. It is this position against its own
      // cost over however long it has been held, which is not the chosen period.
      unrealized: cost === null ? null : (mv - cost).toFixed(2),
      cost_basis_covered: covered.length === pos.length,
      share_of_portfolio: totalRow[0].mv ? mv / totalRow[0].mv : 0,
    },
    instrument: {
      asset_class: sec.asset_class,
      price_basis: sec.price_basis,
      sectors,
      // Absence carries its reason, the same distinction migration 077 drew:
      // "we asked and it has none" is not "we never asked".
      sector_asked: sec.sector_asked,
      bond_terms: terms[0] || null,
    },
    quote: quote.length ? {
      last_close: quote[0].last_close,
      last_close_on: quote[0].last_close_on,
      age_days: quote[0].age_days,
      week52_high: band[0].high,
      week52_low: band[0].low,
    } : null,
  };
}

module.exports = {
  buildSecurityChart, buildSeries, ema, macd, rebase, windowStart, PERIODS,
};
