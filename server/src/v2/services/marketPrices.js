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
      -- One row per security even when it carries several fintable names
      -- (migration 081): a plain join would probe, and write closes for, it twice.
      LEFT JOIN LATERAL (
        SELECT external_name FROM security_source_mappings
         WHERE security_id = s.id AND source = 'fintable'
         ORDER BY id
         LIMIT 1
      ) m ON TRUE
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

// ---------------------------------------------------------------------------
// Live quotes — CR090 P2's overlay panel
// ---------------------------------------------------------------------------

/** fintable takes at most 50 symbols per call (CR061 §5). */
const QUOTE_BATCH = 50;

/**
 * Is this quote safe to store? CR061 §5's magnitude refusal, as a pure function.
 *
 * The failure to design against is a CUSIP's 100,000 face priced at an equity's
 * $250 — $25M from one bad classification. `probeableSecurities` is the
 * structural half and this is the residue: a ratio outside 1/5..5 against the
 * custodian's own price for the same instrument is a units error, not a market
 * move. ⚠️ Deliberately NOT 20%: a single-name equity moves >20% on earnings,
 * and a snapshot straddling a split gives exactly 2× or 0.5×.
 *
 * A refusal is never silence — the caller records the reason, the position keeps
 * its custodian price, and the overlay's coverage drops by that position's
 * weight. A refused position that read as "didn't move" is CR085's dead-state
 * defect class.
 */
const MAGNITUDE_LIMIT = 5;

function classifyQuote({ quotePrice, custodianPrice, priceBasis }) {
  const q = Number(quotePrice);
  if (!Number.isFinite(q) || q <= 0) return { ok: false, reason: 'no price' };
  // The structural gate, restated here because this function is also the one a
  // future caller will reach for first.
  if (priceBasis !== 'per_share') return { ok: false, reason: `not per-share (${priceBasis})` };
  const c = Number(custodianPrice);
  // No custodian price to compare against: accept, because the structural gate
  // has already run and a missing comparison is not evidence of an error.
  if (!Number.isFinite(c) || c <= 0) return { ok: true, ratio: null };
  const ratio = q / c;
  if (ratio > MAGNITUDE_LIMIT || ratio < 1 / MAGNITUDE_LIMIT) {
    return { ok: false, reason: `${ratio.toFixed(1)}× the custodian price`, ratio };
  }
  return { ok: true, ratio };
}

/**
 * The form the QUOTE endpoint accepts, which is not always the one we store.
 *
 * 🔴 `quote_symbol` is "a symbol SOME price feed resolved", and the feeds do not
 * agree. Berkshire class B is stored as `BRK/B` — written by the TRADIER
 * backfill (`tradierPrices.js`), which measured that `BRK.B` and `BRK-B` return
 * no bars there while `BRK/B` returns both bars and sector. fintable's quote
 * endpoint wants the opposite: measured 2026-09-16, `BRK/B` → **422
 * validation_failed**, `BRK.B` → a price, and `BRKB` (what the custodian calls
 * it) → an empty list, the silent variant CR061 §4.7 priced at $25,202.
 *
 * ⚠️ That 422 fails the WHOLE batch, so this one symbol cost all 46 quotes on
 * the first live run — which is why the fetch below also splits a failed batch.
 *
 * Normalised for the fintable REQUEST only, and this mapping is fintable's: the
 * stored value stays as it is because Tradier's closes are keyed under it, and
 * a caller fetching from Tradier must NOT route through here.
 */
function quoteRequestSymbol(stored) {
  const s = String(stored || '').trim().toUpperCase().replace(/\//g, '.');
  return /^[A-Z][A-Z.]{0,9}$/.test(s) ? s : null;
}

/**
 * The securities worth quoting: the ones actually HELD in the latest snapshot
 * per account, per-share, with a symbol a quote has already been observed under.
 *
 * Held, not "every probeable security": 46 symbols against 158 equities, which
 * is one batch instead of four, and a quote for something nobody owns would be
 * stored and never read. `quote_symbol` is NULL until a symbol has actually
 * returned data (see backfillCloses), so this asks only about symbols known to
 * resolve — the same earned-quotability rule.
 */
async function heldQuotableSecurities() {
  const { rows } = await db.query(`
    WITH latest AS (
      SELECT DISTINCT ON (account_id) id
        FROM security_position_snapshots
       WHERE source = 'bank-feed'
       ORDER BY account_id, polled_on DESC, fetched_at DESC
    )
    SELECT s.id, s.quote_symbol, s.price_basis,
           -- The custodian's own price for the same instrument, for the
           -- magnitude check. Largest holding wins when an instrument sits in
           -- several accounts; they carry the same price.
           (ARRAY_AGG(p.price ORDER BY p.market_value DESC NULLS LAST))[1] AS custodian_price
      FROM latest l
      JOIN security_positions p ON p.snapshot_id = l.id
      JOIN securities s ON s.id = p.security_id
     WHERE s.price_basis = 'per_share'
       AND s.quote_symbol IS NOT NULL
     GROUP BY s.id, s.quote_symbol, s.price_basis
     ORDER BY s.id`);
  return rows;
}

/**
 * Fetch and store live quotes for everything held and quotable.
 *
 * ⚠️ Never called on a render path (CR061 §5). A scheduled script and an
 * explicit button call it; the page only ever reads what is stored, and states
 * how old it is. A failed fetch therefore degrades to custodian prices with
 * nothing on screen breaking.
 *
 * `quoted_at` is the feed's own `as_of` — when the price was TRUE, not when we
 * asked. Re-running while the market is shut re-sends the same `as_of`, which
 * the UNIQUE(security_id, quoted_at, source) index absorbs: the second write is
 * a no-op rather than a duplicate row claiming a fresh observation.
 */
async function refreshQuotes({ fetchImpl, now = new Date() } = {}) {
  const securities = await heldQuotableSecurities();
  const summary = {
    at: now.toISOString(),
    requested: securities.length,
    returned: 0,
    stored: 0,
    unchanged: 0,
    refused: [],   // a quote arrived and the guards rejected it
    failed: [],    // the endpoint would not answer for this symbol
    missing: [],   // asked, answered, no quote for it
    error: null,
  };
  if (!securities.length) return summary;

  const byRequestSymbol = new Map();
  for (const s of securities) {
    const req = quoteRequestSymbol(s.quote_symbol);
    if (!req) {
      summary.failed.push({ symbol: s.quote_symbol, reason: 'not a form the quote endpoint accepts' });
      continue;
    }
    byRequestSymbol.set(req, s);
  }
  const symbols = [...byRequestSymbol.keys()];
  const quotes = [];

  /**
   * 🔴 A failed batch is SPLIT, never abandoned. Two different failures look
   * identical from here and neither may cost the other symbols their quotes:
   * a 503 (the endpoint 503'd four batches in five when measured) and a 422 on
   * ONE invalid ticker, which fails the whole request — `BRK/B` did exactly that
   * on the first live run and cost all 46. Halving isolates the bad symbol in
   * log₂(n) calls and reports it by name; everything else still lands.
   */
  const fetchBatch = async (batch) => {
    try {
      quotes.push(...(await fetchQuotes(batch, { fetchImpl })));
    } catch (err) {
      if (batch.length === 1) {
        summary.failed.push({ symbol: batch[0], reason: err.message });
        return;
      }
      const mid = Math.ceil(batch.length / 2);
      await fetchBatch(batch.slice(0, mid));
      await fetchBatch(batch.slice(mid));
    }
  };

  for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
    await fetchBatch(symbols.slice(i, i + QUOTE_BATCH));
  }
  summary.returned = quotes.length;
  // An `error` means the run as a whole got nothing; individual casualties are
  // in `failed` with their reasons, so a partial run is not reported as a failure.
  if (!quotes.length && summary.failed.length) summary.error = summary.failed[0].reason;

  const seen = new Set();
  for (const q of quotes) {
    // The endpoint echoes the form it was asked for; normalise anyway, so a
    // response spelled back differently resolves rather than being dropped.
    const sec = byRequestSymbol.get(q.symbol) || byRequestSymbol.get(quoteRequestSymbol(q.symbol));
    if (!sec) continue;                     // not something we asked about
    seen.add(quoteRequestSymbol(q.symbol) || q.symbol);
    const verdict = classifyQuote({
      quotePrice: q.price,
      custodianPrice: sec.custodian_price,
      priceBasis: sec.price_basis,
    });
    if (!verdict.ok) {
      summary.refused.push({ symbol: q.symbol, reason: verdict.reason });
      continue;
    }
    const { rowCount } = await db.query(`
      INSERT INTO security_quotes (security_id, quoted_at, price, currency, source, venue)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (security_id, quoted_at, source) DO NOTHING
    `, [sec.id, q.as_of || now.toISOString(), q.price, q.currency || 'USD', SOURCE, q.feed || null]);
    if (rowCount) summary.stored += 1; else summary.unchanged += 1;
  }
  summary.missing = symbols.filter((s) => !seen.has(s));

  // Retention: the latest per security plus seven days (CR061 §6.3). Unbounded
  // growth for data with no audit value is the alternative.
  const { rowCount: pruned } = await db.query(`
    DELETE FROM security_quotes q
     WHERE q.quoted_at < NOW() - INTERVAL '7 days'
       AND q.id <> (SELECT id FROM security_quotes
                     WHERE security_id = q.security_id
                     ORDER BY quoted_at DESC LIMIT 1)
  `);
  summary.pruned = pruned;
  return summary;
}

module.exports = {
  fetchDailyCloses,
  fetchQuotes,
  probeableSecurities,
  backfillCloses,
  heldQuotableSecurities,
  classifyQuote,
  quoteRequestSymbol,
  refreshQuotes,
  MAGNITUDE_LIMIT,
  QUOTE_BATCH,
  PriceFeedError,
};
