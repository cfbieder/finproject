'use strict';
/**
 * tradierDividends.js — CR093 §5b. Distribution history, so an equity can state
 * a yield.
 *
 * fin had NO distribution data anywhere — `security_transactions` holds 0 rows —
 * so "what does this pay" was unanswerable for everything that is not a bond.
 *
 * ⚠️ A CAPITAL-GAINS DISTRIBUTION IS NOT YIELD. Tradier returns five types
 * across the live holdings (CD cash · SC special cash · LT and ST capital gains ·
 * NP non-periodic), and DGRW carries four of them at once. Summing them would
 * let one year-end turnover distribution present itself as a permanent income
 * rate, and it would look entirely plausible. Only CD counts toward the yield;
 * the rest is carried through and reported separately, never dropped.
 *
 * ⚠️ "PAYS NOTHING" IS NOT "WE HAVE NO DATA". Measured 2026-09-05: 43 of 47 live
 * quotable holdings return distributions. BRK/B and KD genuinely pay none;
 * FCNTX is an open-end fund Tradier does not cover. `dividends_as_of` records
 * that we asked, so a 0.00% yield is distinguishable from a blank one.
 */

const db = require('../db');
const { symbolCandidates } = require('./tradierPrices');

const BASE = (process.env.TRADIER_API_URL || 'https://api.tradier.com').replace(/\/+$/, '');
const SOURCE = 'tradier';

/** The types this project knows. An unknown one is an error, not a silent skip:
 *  a sixth type joining the yield unnoticed is exactly the failure mode. */
const KNOWN_TYPES = new Set(['CD', 'SC', 'LT', 'ST', 'NP']);
/** The only type that is INCOME. See the header. */
const INCOME_TYPES = new Set(['CD']);

/**
 * One symbol's distribution history.
 *
 * ⚠️ The payload nests three levels deep and CARRIES NULLS AT EVERY ONE. QQQ and
 * SPY each return two `results` entries, the first with `cash_dividends: null` —
 * reading `results[0]` would report both as paying nothing. Every non-null table
 * is collected instead, and measured 2026-09-05 no symbol returns two of them,
 * so nothing is double-counted today; the UNIQUE constraint is what keeps that
 * true if one ever does.
 */
async function fetchDividends(symbol, { token, fetchImpl = fetch } = {}) {
  const url = `${BASE}/beta/markets/fundamentals/dividends?symbols=${encodeURIComponent(symbol)}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`tradier ${res.status}: ${body.slice(0, 120)}`);
  }
  return parseDividends(await res.json());
}

/** Pure, so the null-nesting above is pinned by a test rather than by a probe. */
function parseDividends(json) {
  const out = [];
  for (const req of Array.isArray(json) ? json : []) {
    for (const result of (req && req.results) || []) {
      const table = result && result.tables && result.tables.cash_dividends;
      if (!Array.isArray(table)) continue;
      for (const d of table) {
        if (!d || !d.ex_date) continue;
        const amount = Number(d.cash_amount);
        // A zero or negative distribution is not a payment. The CHECK constraint
        // would reject it; dropping it here keeps the loader's count honest.
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const type = String(d.dividend_type || '').toUpperCase();
        if (!KNOWN_TYPES.has(type)) {
          throw new Error(`unknown dividend_type "${type}" on ${d.ex_date} — `
            + 'it must be classified as income or not before it can be stored');
        }
        out.push({
          ex_date: String(d.ex_date).slice(0, 10),
          pay_date: d.pay_date ? String(d.pay_date).slice(0, 10) : null,
          cash_amount: amount,
          dividend_type: type,
          frequency: Number.isFinite(Number(d.frequency)) ? Number(d.frequency) : null,
        });
      }
    }
  }
  return out;
}

/**
 * Trailing-twelve-month income and what was excluded from it.
 *
 * ⚠️ TRAILING, NOT `latest x frequency`. The forward form looks more current and
 * rests on a field that is not stable — UTF reports frequencies of 12, 0 AND 4
 * across its history, and a bond ETF's monthly distribution varies. Twelve
 * months of actual payments is a measurement; the other is an extrapolation from
 * one data point.
 */
function trailingTwelveMonths(rows, asOf) {
  const cutoff = new Date(`${asOf}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const from = cutoff.toISOString().slice(0, 10);

  let income = 0;
  let excluded = 0;
  const excludedTypes = new Set();
  let first = null;
  for (const r of rows) {
    if (r.ex_date <= from || r.ex_date > asOf) continue;
    if (INCOME_TYPES.has(r.dividend_type)) {
      income += Number(r.cash_amount);
      if (!first || r.ex_date < first) first = r.ex_date;
    } else {
      excluded += Number(r.cash_amount);
      excludedTypes.add(r.dividend_type);
    }
  }
  return {
    from,
    to: asOf,
    income: Number(income.toFixed(8)),
    excluded: Number(excluded.toFixed(8)),
    excluded_types: [...excludedTypes].sort(),
    first_income_ex_date: first,
  };
}

/**
 * Load distributions for every security we can price.
 *
 * Scoped to `per_share`: a bond, CD or deposit has no ticker and pays a COUPON,
 * which migration 078 already holds from the custodian's own statements. Asking
 * a quote vendor about it would be asking the wrong source a question it cannot
 * answer.
 */
async function loadDividends({ apply = false, token, fetchImpl = fetch } = {}) {
  const stats = {
    securities: 0, resolved: 0, rows: 0, written: 0, paysNothing: [], unresolved: [], failed: [],
  };
  if (!token) throw new Error('TRADIER_ACCESS_TOKEN is not set');

  const { rows: secs } = await db.query(`
    SELECT s.id, s.ticker, s.quote_symbol, s.name
      FROM securities s
     WHERE s.price_basis = 'per_share'
       AND COALESCE(s.quote_symbol, s.ticker) IS NOT NULL
       AND EXISTS (SELECT 1 FROM security_prices p WHERE p.security_id = s.id)
     ORDER BY s.ticker`);

  const today = new Date().toISOString().slice(0, 10);

  for (const sec of secs) {
    stats.securities += 1;
    // The stored quote_symbol first — it is the form already proven to work.
    const candidates = [...new Set([
      ...(sec.quote_symbol ? [sec.quote_symbol] : []),
      ...symbolCandidates(sec.ticker),
    ])];

    let rows = null;
    let used = null;
    let error = null;
    for (const c of candidates) {
      try {
        const got = await fetchDividends(c, { token, fetchImpl });
        // An empty answer from a symbol Tradier KNOWS is a real "pays nothing";
        // keep looking only while nothing has answered at all.
        if (got.length) { rows = got; used = c; break; }
        if (rows === null) { rows = []; used = c; }
      } catch (err) {
        error = err;
      }
    }

    if (rows === null) {
      stats.failed.push({ ticker: sec.ticker, error: error ? error.message : 'no candidate answered' });
      continue;
    }
    stats.resolved += 1;
    stats.rows += rows.length;
    if (!rows.length) stats.paysNothing.push(sec.ticker);

    if (!apply) continue;

    for (const r of rows) {
      const { rowCount } = await db.query(`
        INSERT INTO security_dividends
          (security_id, ex_date, pay_date, cash_amount, dividend_type, frequency, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (security_id, ex_date, dividend_type) DO UPDATE
          SET cash_amount = EXCLUDED.cash_amount,
              pay_date = EXCLUDED.pay_date,
              frequency = EXCLUDED.frequency`,
      [sec.id, r.ex_date, r.pay_date, r.cash_amount, r.dividend_type, r.frequency, SOURCE]);
      stats.written += rowCount;
    }
    // ⚠️ Set even when ZERO rows came back. That is the whole point of the
    // column: it separates "asked, and this pays nothing" from "never asked".
    await db.query(
      'UPDATE securities SET dividends_as_of = $2, updated_at = now() WHERE id = $1',
      [sec.id, today],
    );
    if (used && used !== sec.quote_symbol && rows.length) {
      await db.query('UPDATE securities SET quote_symbol = $2 WHERE id = $1', [sec.id, used]);
    }
  }
  return stats;
}

module.exports = {
  loadDividends, fetchDividends, parseDividends, trailingTwelveMonths,
  INCOME_TYPES, KNOWN_TYPES,
};
