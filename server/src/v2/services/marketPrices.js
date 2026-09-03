'use strict';
/**
 * marketPrices.js — CR061 P1. fin's first market-price source.
 *
 * Two distinct uses, kept apart on purpose:
 *
 *   DATED CLOSES  → `security_prices`, one row per (security, date).
 *                   Valuation and history. `GET /prices/{sym}/history`.
 *   LIVE QUOTES   → `security_quotes`, one row per (security, timestamp).
 *                   CR090's overlay panel. `GET /prices?symbols=`.
 *
 * ⚠️ A quote is not a close, and merging them makes the price history
 * unauditable: `security_prices` is UNIQUE(security_id, price_date) with a
 * single `close`, so an intraday quote and a custodian price both dated today
 * would collide and last-writer-wins with no timestamp to tell them apart.
 *
 * ── What this feed is, measured 2026-09-02/03 ──
 *
 * Public and unauthenticated — no credential, which is why prices live in fin
 * rather than behind bank-feed (a market fact is not per-account bank data).
 * Backed by IEX: ONE exchange at a low single-digit share of consolidated
 * volume, so for a thin name the last print can be materially older than the
 * last sale. Good enough to value a position; not a quote, and never labelled
 * one.
 *
 * ⚠️ `/prices?symbols=` 503s often — four of five batches during measurement.
 * `/prices/{sym}/history` did not, but neither number is inherited by the other.
 * Nothing may depend on a price arriving, and nothing fetches on a render path.
 *
 * ⚠️ The two endpoints DISAGREE about the same close by ~0.65%: `previous_close`
 * from the quote endpoint is not the history endpoint's `close`. The history
 * bars are the authoritative series; `previous_close` is never stored.
 */

const { quoteSymbolCandidates } = require('./investmentClassification');
const db = require('../db');

const BASE = (process.env.FINTABLE_PRICES_URL || 'https://fintable.io/api/v2').replace(/\/+$/, '');
const TIMEOUT_MS = 8000;
const SOURCE = 'fintable';

class PriceFeedError extends Error {
  constructor(message, status) { super(message); this.name = 'PriceFeedError'; this.status = status; }
}

async function request(path, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // No Authorization header, deliberately: this endpoint is public, and
    // sending a bearer token to a public host is a credential leak with no gain.
    const res = await fetchImpl(`${BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const type = body && body.error ? body.error.type : '';
      throw new PriceFeedError(`GET ${path} → ${res.status} ${type}`.trim(), res.status);
    }
    return body || {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Daily closes for one ticker.
 *
 * ⚠️ The parameters are `start`/`end`. `from`/`to` returns **404 with a
 * misleading message** — *"No price history for that ticker and range"* — which
 * reads as "this ticker has no history" rather than "you sent the wrong
 * parameter names". CR061 rev 2 recorded the endpoint as non-existent on
 * exactly that mistake, and planned around its absence for a day.
 *
 * The bars also carry the TRADING CALENDAR: non-trading days are absent rather
 * than repeated, which is how "the last trading day of the month" stops being a
 * guess when a month ends on a weekend.
 */
async function fetchDailyCloses(symbol, { start, end, ...opts } = {}) {
  const q = new URLSearchParams();
  if (start) q.set('start', start);
  if (end) q.set('end', end);
  const body = await request(`/prices/${encodeURIComponent(symbol)}/history?${q}`, opts);
  const d = body.data || {};
  return {
    symbol: d.symbol || symbol,
    currency: d.currency || 'USD',
    feed: d.feed || null,
    bars: (d.bars || []).map((b) => ({ date: b.date, close: b.close })),
  };
}

/** Live quotes for up to 50 tickers. Best-effort by contract — see the header. */
async function fetchQuotes(symbols, opts = {}) {
  if (!symbols.length) return [];
  const body = await request(`/prices?symbols=${symbols.map(encodeURIComponent).join(',')}`, opts);
  return (body.data || []).map((q) => ({
    symbol: q.symbol,
    price: q.price,
    currency: q.currency || 'USD',
    as_of: q.as_of,       // when the price was TRUE — not when we asked
    feed: q.feed || null,
  }));
}

/**
 * Securities it is SAFE to ask about.
 *
 * `price_basis = 'per_share'` is the whole gate, and it is structural rather
 * than a threshold: a CUSIP priced per-100-face or a deposit held at par must
 * never reach a ticker lookup, because 100,000 of face value at an equity's
 * share price books $25,000,000 from one bad classification.
 */
async function probeableSecurities() {
  const { rows } = await db.query(`
    SELECT s.id, s.ticker, s.quote_symbol, s.asset_class, m.external_name AS feed_symbol
      FROM securities s
      LEFT JOIN security_source_mappings m
        ON m.security_id = s.id AND m.source = 'fintable'
     WHERE s.price_basis = 'per_share'
     ORDER BY s.id`);
  return rows;
}

/**
 * Backfill dated closes for every probeable security.
 *
 * Quotability is EARNED here: `quote_symbol` is written only once a symbol has
 * actually returned bars. A security that never returns any keeps NULL, which is
 * a fact about the instrument (a mutual fund has no intraday market) rather than
 * a failure — and it is why "no quote because it is a fund" can be told apart
 * from "no quote because the lookup is broken".
 */
async function backfillCloses({ start, end, apply = false, fetchImpl } = {}) {
  const securities = await probeableSecurities();
  const summary = { securities: securities.length, resolved: 0, unresolved: [], bars: 0, written: 0, failed: [] };

  for (const s of securities) {
    const candidates = s.quote_symbol
      ? [s.quote_symbol]
      : quoteSymbolCandidates(s.ticker || s.feed_symbol || '');
    if (!candidates.length) { summary.unresolved.push(s.feed_symbol || s.ticker); continue; }

    let got = null;
    let usedSymbol = null;
    for (const cand of candidates) {
      try {
        const r = await fetchDailyCloses(cand, { start, end, fetchImpl });
        if (r.bars.length) { got = r; usedSymbol = cand; break; }
      } catch (err) {
        // A 404 here means "this ticker has no bars", which for a fund is the
        // expected answer, not an error worth failing the run over.
        if (!(err instanceof PriceFeedError) || err.status >= 500) {
          summary.failed.push({ symbol: cand, error: err.message });
        }
      }
    }

    if (!got) { summary.unresolved.push(s.feed_symbol || s.ticker); continue; }
    summary.resolved += 1;
    summary.bars += got.bars.length;

    if (!apply) continue;

    if (usedSymbol !== s.quote_symbol) {
      await db.query(`UPDATE securities SET quote_symbol = $1, updated_at = NOW() WHERE id = $2`,
        [usedSymbol, s.id]);
    }
    for (const bar of got.bars) {
      await db.query(`
        INSERT INTO security_prices (security_id, price_date, close, currency, source)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (security_id, price_date)
        DO UPDATE SET close = EXCLUDED.close, source = EXCLUDED.source
      `, [s.id, bar.date, bar.close, got.currency, SOURCE]);
      summary.written += 1;
    }
  }
  return summary;
}

module.exports = {
  fetchDailyCloses,
  fetchQuotes,
  probeableSecurities,
  backfillCloses,
  PriceFeedError,
};
