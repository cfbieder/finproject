'use strict';
/**
 * tradierPrices.js — CR093. Daily closes from Tradier.
 *
 * Supersedes fintable as the source for `security_prices`. Measured 2026-09-05
 * on the owner's own brokerage account: **3,112 daily bars for DIA back to
 * 2014-04-17**, against fintable's measured floor of ~2020-08. That depth is not
 * a nicety — MACD 12/26/9 emits nothing until ~35 points and its slow EMA is
 * untrustworthy until roughly 3x its period, so on the 44 days fin held, the
 * indicator would have been almost entirely warm-up.
 *
 * ⚠️ Tradier's docs claim history covers "the entire lifetime of the company".
 * It does not — DIA launched in 1998. The claim was checked rather than
 * repeated, and 2014 is simply where their data starts.
 *
 * ⚠️ ONLY `price_basis = 'per_share'` IS EVER ASKED. The same structural gate
 * CR061 P1 set: a CUSIP priced per-100-face or a deposit held at par must never
 * reach a ticker lookup, because 100,000 of face value at an equity's share
 * price books $25,000,000 from one bad classification.
 *
 * ⚠️ THIS IS A SECOND FEED INTO ONE COLUMN. `security_prices` is
 * UNIQUE (security_id, price_date) with a single `close`, and fintable rows
 * already occupy 2026-07-06..2026-09-02. CR089 measured fintable's OWN two
 * endpoints disagreeing by 0.65% about the same close, so two providers will
 * certainly disagree too. The `source` column exists to say which one a row came
 * from — but a row can only hold one — so this REPORTS every disagreement on the
 * overlap before adopting Tradier, rather than overwriting quietly and leaving a
 * chart and a valuation to differ with nothing to explain why.
 */

const db = require('../db');

const BASE = (process.env.TRADIER_API_URL || 'https://api.tradier.com').replace(/\/+$/, '');
const SOURCE = 'tradier';

/**
 * The custodian and the quote feed do not always spell a symbol the same way.
 * Fidelity and fintable write `BRKB`; Tradier wants `BRK.B`. Rather than encode
 * a guess about share classes, the alternate is TRIED and only kept if it
 * actually returns bars — quotability stays earned, exactly as CR061 P1 made it.
 */
function symbolCandidates(sym) {
  const s = String(sym || '').trim().toUpperCase();
  if (!s) return [];
  const out = [s];
  // A trailing share-class letter on a 4-5 character symbol: `BRKB` is Berkshire
  // class B, which Tradier spells with a SEPARATOR.
  //
  // 🔴 The separator is a SLASH, and this was asserted as a dot before it was
  // tested. Measured 2026-09-05: `BRK.B` and `BRK-B` both return no bars and no
  // sector; `BRK/B` returns both (25 bars, sector 103 Financial Services). The
  // dot is the common convention across market-data APIs, which is exactly why
  // guessing it felt safe — and the guess was wrong. Both forms are tried, in
  // the order that works, and neither is kept unless it actually returns bars.
  // Only when the final letter is a plausible CLASS letter. Without that guard
  // every unquotable fund costs three lookups instead of one — `FCNTX` would be
  // probed as `FCNT/X` and `FCNT.X`, which are not symbols and never will be.
  if (/^[A-Z]{3,4}[ABC]$/.test(s)) {
    out.push(`${s.slice(0, -1)}/${s.slice(-1)}`);
    out.push(`${s.slice(0, -1)}.${s.slice(-1)}`);
  }
  return out;
}

async function fetchDailyHistory(symbol, { start, end, token, fetchImpl = fetch } = {}) {
  const url = `${BASE}/v1/markets/history?symbol=${encodeURIComponent(symbol)}`
    + `&interval=daily&start=${start}&end=${end}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`tradier ${res.status}: ${body.slice(0, 120)}`);
  }
  const json = await res.json();
  // Tradier returns `{"history": null}` — not an empty array — for a symbol it
  // does not know. Treating null as "no bars" rather than as an error is what
  // lets an unquotable instrument be told apart from a broken lookup.
  const h = json && json.history;
  if (!h || h === 'null') return [];
  const days = Array.isArray(h.day) ? h.day : [h.day];
  return days.filter(Boolean).map((d) => ({ date: d.date, close: Number(d.close) }));
}

/**
 * Every date where both feeds have a close, and by how much they differ.
 * Reported, never resolved automatically: which feed is right is a judgement,
 * and a silent overwrite is how two numbers diverge with no record.
 */
function disagreements(existingByDate, bars, tolerancePct = 0.001) {
  const out = [];
  for (const b of bars) {
    const prev = existingByDate.get(b.date);
    if (prev === undefined) continue;
    const diff = b.close - prev;
    if (Math.abs(diff) / (prev || 1) > tolerancePct) {
      out.push({ date: b.date, was: prev, now: b.close, pct: (diff / (prev || 1)) * 100 });
    }
  }
  return out;
}

async function backfillFromTradier({ start, end, apply = false, token, fetchImpl = fetch } = {}) {
  const stats = { securities: 0, resolved: 0, bars: 0, written: 0, unresolved: [], failed: [], disagreed: [] };
  if (!token) throw new Error('TRADIER_ACCESS_TOKEN is not set');

  const { rows: secs } = await db.query(`
    SELECT id, ticker, quote_symbol FROM securities
     WHERE price_basis = 'per_share' AND ticker IS NOT NULL
     ORDER BY ticker`);
  stats.securities = secs.length;

  for (const sec of secs) {
    let bars = [];
    let used = null;
    try {
      // 🔴 Candidates come from the stored quote_symbol AND the raw ticker, not
      // whichever is set. `quote_symbol` is a previously RESOLVED value and it
      // can be wrong: the fintable backfill wrote `BRK.B` for Berkshire, and
      // because that string already contains a separator it generates no
      // alternates — so a stored wrong answer silently blocked rediscovery of
      // the right one (`BRK/B`). A cached resolution that cannot be re-derived
      // is worse than no cache at all.
      const cands = [...new Set([
        ...(sec.quote_symbol ? [sec.quote_symbol] : []),
        ...symbolCandidates(sec.ticker),
      ])];
      for (const cand of cands) {
        bars = await fetchDailyHistory(cand, { start, end, token, fetchImpl });
        if (bars.length) { used = cand; break; }
      }
    } catch (err) {
      stats.failed.push({ symbol: sec.ticker, error: err.message });
      continue;
    }
    if (!bars.length) { stats.unresolved.push(sec.ticker); continue; }

    stats.resolved += 1;
    stats.bars += bars.length;

    const { rows: prior } = await db.query(
      `SELECT price_date::text AS d, close::float AS c FROM security_prices
        WHERE security_id = $1 AND source <> $2`, [sec.id, SOURCE]);
    const d = disagreements(new Map(prior.map((r) => [r.d, r.c])), bars);
    if (d.length) stats.disagreed.push({ symbol: sec.ticker, count: d.length, worst: d.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0] });

    if (!apply) continue;

    if (used && used !== sec.quote_symbol) {
      await db.query('UPDATE securities SET quote_symbol = $2, updated_at = now() WHERE id = $1', [sec.id, used]);
    }
    // Batched, because this is ~3,000 bars per security across ~145 securities:
    // 423,000 single-row round trips is half an hour a stack, and there are two.
    // Chunked rather than one statement per security to stay well under the
    // 65,535 bound parameter limit (3 params per row => 500 rows = 1,500).
    for (let i = 0; i < bars.length; i += 500) {
      const chunk = bars.slice(i, i + 500);
      const values = chunk.map((_, k) => `($1,$${k * 3 + 2},$${k * 3 + 3},'USD',$${k * 3 + 4})`).join(',');
      const params = [sec.id];
      for (const b of chunk) params.push(b.date, b.close, SOURCE);
      await db.query(`
        INSERT INTO security_prices (security_id, price_date, close, currency, source)
        VALUES ${values}
        ON CONFLICT (security_id, price_date)
        DO UPDATE SET close = EXCLUDED.close, source = EXCLUDED.source`, params);
      stats.written += chunk.length;
    }
  }
  return stats;
}

module.exports = { backfillFromTradier, fetchDailyHistory, symbolCandidates, disagreements };
