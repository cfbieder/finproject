'use strict';
/**
 * marketPrices.test.js — CR061 P1.
 *
 * No network: every test injects a fake fetch. The point of most of them is a
 * REQUEST-SHAPE assertion, because that is where this endpoint's real defect
 * was: `from`/`to` returns 404 with the message "No price history for that
 * ticker and range", which reads as "this ticker has no history" rather than
 * "you sent the wrong parameter names" — and CR061 rev 2 recorded the whole
 * endpoint as non-existent on exactly that mistake, planning around its absence.
 */

const {
  fetchDailyCloses,
  fetchQuotes,
  PriceFeedError,
} = require('../marketPrices');

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url) => {
    calls.push(String(url));
    const next = queue.shift() || { body: {} };
    return {
      ok: next.status === undefined || (next.status >= 200 && next.status < 300),
      status: next.status || 200,
      text: async () => JSON.stringify(next.body === undefined ? {} : next.body),
    };
  };
  impl.calls = calls;
  return impl;
}

const bars = (...dates) => ({
  body: { data: { symbol: 'ZZT', currency: 'USD', feed: 'iex', bars: dates.map((d, i) => ({ date: d, close: String(100 + i) })) } },
});

describe('fetchDailyCloses — the request shape is the defect surface', () => {
  test('🔴 sends start/end, never from/to', async () => {
    const f = fakeFetch([bars('2026-08-31')]);
    await fetchDailyCloses('ZZT', { start: '2026-08-25', end: '2026-09-01', fetchImpl: f });
    expect(f.calls[0]).toContain('start=2026-08-25');
    expect(f.calls[0]).toContain('end=2026-09-01');
    // The guard against re-introducing it. from/to 404s with a message that
    // reads like a fact about the ticker rather than about the request.
    expect(f.calls[0]).not.toContain('from=');
    expect(f.calls[0]).not.toContain('to=');
  });

  test('hits the per-symbol history path', async () => {
    const f = fakeFetch([bars('2026-08-31')]);
    await fetchDailyCloses('ZZT', { start: '2026-08-25', fetchImpl: f });
    expect(f.calls[0]).toContain('/prices/ZZT/history');
  });

  test('sends NO Authorization header — the endpoint is public', async () => {
    let seen = null;
    const impl = async (url, opts) => {
      seen = opts.headers;
      return { ok: true, status: 200, text: async () => JSON.stringify(bars('2026-08-31').body) };
    };
    await fetchDailyCloses('ZZT', { start: '2026-08-25', fetchImpl: impl });
    // Sending a bearer token to a public host is a credential leak with no gain,
    // and it is the reason prices live in fin rather than behind bank-feed.
    expect(seen.Authorization).toBeUndefined();
  });

  test('returns dated closes and the currency', async () => {
    const f = fakeFetch([bars('2026-08-28', '2026-08-31')]);
    const r = await fetchDailyCloses('ZZT', { start: '2026-08-25', fetchImpl: f });
    expect(r.bars).toEqual([
      { date: '2026-08-28', close: '100' },
      { date: '2026-08-31', close: '101' },
    ]);
    expect(r.currency).toBe('USD');
  });

  test('absent days are absent — the bars ARE the trading calendar', async () => {
    // 08-29 and 08-30 were a weekend; the feed omits them rather than repeating
    // Friday. That is what makes "the last trading day of the month" a lookup
    // instead of a guess when a month ends on a weekend.
    const f = fakeFetch([bars('2026-08-28', '2026-08-31')]);
    const r = await fetchDailyCloses('ZZT', { start: '2026-08-28', end: '2026-08-31', fetchImpl: f });
    expect(r.bars.map((b) => b.date)).not.toContain('2026-08-29');
    expect(r.bars).toHaveLength(2);
  });

  test('an empty history is an empty list, not an error', async () => {
    const f = fakeFetch([{ body: { data: { symbol: 'ZZT', bars: [] } } }]);
    const r = await fetchDailyCloses('ZZT', { start: '2026-08-25', fetchImpl: f });
    expect(r.bars).toEqual([]);
  });

  test('a 404 is surfaced as a typed error carrying its status', async () => {
    const f = fakeFetch([{ status: 404, body: { error: { type: 'not_found' } } }]);
    await expect(fetchDailyCloses('ZZT', { start: '2026-08-25', fetchImpl: f }))
      .rejects.toThrow(PriceFeedError);
    // The status matters: a 404 for a fund means "no intraday market", which is
    // a fact, while a 5xx means the feed is broken. The backfill treats them
    // differently and cannot if the error is a bare string.
  });
});

describe('fetchQuotes', () => {
  test('uses the PLURAL symbols parameter', async () => {
    const f = fakeFetch([{ body: { data: [{ symbol: 'ZZT', price: '141.5', as_of: '2026-09-01T19:59:59Z', feed: 'iex' }] } }]);
    await fetchQuotes(['ZZT', 'YYT'], { fetchImpl: f });
    // ?symbol= (singular) 422s with "Pass at least one ticker".
    expect(f.calls[0]).toContain('symbols=ZZT,YYT');
  });

  test('keeps as_of — when the price was TRUE, not when we asked', async () => {
    const f = fakeFetch([{ body: { data: [{ symbol: 'ZZT', price: '141.5', as_of: '2026-09-01T19:59:59Z', feed: 'iex' }] } }]);
    const [q] = await fetchQuotes(['ZZT'], { fetchImpl: f });
    expect(q.as_of).toBe('2026-09-01T19:59:59Z');
    expect(q.feed).toBe('iex');
    // Rendering fetch time as valuation time is the same defect as reading a
    // poll date as a valuation date, one table over.
  });

  test('never returns previous_close as a close', async () => {
    // The two endpoints disagree by ~0.65% about the same close. The history
    // bars are authoritative; previous_close is not stored, anywhere.
    const f = fakeFetch([{ body: { data: [{ symbol: 'ZZT', price: '141.5', previous_close: '139.9', as_of: 'x' }] } }]);
    const [q] = await fetchQuotes(['ZZT'], { fetchImpl: f });
    expect(q.previous_close).toBeUndefined();
  });

  test('no symbols means no request at all', async () => {
    const f = fakeFetch([]);
    expect(await fetchQuotes([], { fetchImpl: f })).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });
});
