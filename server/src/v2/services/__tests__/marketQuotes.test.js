'use strict';
/**
 * marketQuotes.test.js — CR090 P2. The live-quote refresh.
 *
 * The guard these tests exist for is CR061 §5's $25M shape: a CUSIP's 100,000
 * face priced at an equity's $250. Two layers, and both are asserted here —
 * the structural gate (a non per-share security is never asked about) and the
 * magnitude refusal (a price wildly unlike the custodian's is not stored).
 *
 * A refusal must also be LOUD: it is reported with its reason, because a
 * refused position that silently keeps its custodian price reads as "didn't
 * move", which is CR085's dead-state defect class.
 *
 * No network: every test injects a fake fetch. The DB half seeds its own
 * account, security and snapshot in 1971 and cleans up by tag.
 */

const marketPrices = require('../marketPrices');
const { classifyQuote, refreshQuotes, quoteRequestSymbol } = marketPrices;
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

describe('classifyQuote — the magnitude refusal (pure)', () => {
  const at = (quotePrice, custodianPrice) =>
    classifyQuote({ quotePrice, custodianPrice, priceBasis: 'per_share' });

  test('accepts an ordinary move', () => {
    expect(at(101, 100).ok).toBe(true);
    expect(at(131, 100).ok).toBe(true); // a >20% earnings move is NOT an error
    expect(at(50, 100).ok).toBe(true);  // nor is a 2× split
  });

  test('🔴 refuses a units error, and names it', () => {
    // The shape: 0.9989 (fraction of par) against a $250 share price.
    const r = at(250, 0.9989);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/custodian price/);
  });

  test('refuses the inverse too', () => {
    expect(at(1, 250).ok).toBe(false);
  });

  test('🔴 refuses anything not priced per share, whatever the number', () => {
    expect(classifyQuote({ quotePrice: 100, custodianPrice: 99, priceBasis: 'per_1_face' }).ok).toBe(false);
    expect(classifyQuote({ quotePrice: 1, custodianPrice: 1, priceBasis: 'par' }).ok).toBe(false);
  });

  test('a missing custodian price is not evidence of an error — accepted', () => {
    // The structural gate has already run; refusing here would drop a new
    // holding's first quote for no reason.
    expect(at(100, null).ok).toBe(true);
    expect(at(100, 0).ok).toBe(true);
  });

  test('no usable price is refused rather than stored as zero', () => {
    expect(at(0, 100).ok).toBe(false);
    expect(at(null, 100).ok).toBe(false);
  });
});

describe('quoteRequestSymbol — the endpoints disagree about one instrument (pure)', () => {
  test('🔴 the stored BRK/B is asked for as BRK.B', () => {
    // Measured live: `/prices?symbols=BRK%2FB` → 422 validation_failed, and that
    // 422 fails the whole batch; `BRK.B` → 200 with a price; `BRKB` (what the
    // custodian calls it) → 200 with an EMPTY list, which is the silent variant.
    expect(quoteRequestSymbol('BRK/B')).toBe('BRK.B');
  });

  test('ordinary tickers pass through untouched', () => {
    expect(quoteRequestSymbol('AAPL')).toBe('AAPL');
    expect(quoteRequestSymbol('brk.b')).toBe('BRK.B');
  });

  test('anything that is not a ticker is refused rather than sent', () => {
    expect(quoteRequestSymbol('912828 YL8')).toBeNull();
    expect(quoteRequestSymbol('')).toBeNull();
    expect(quoteRequestSymbol(null)).toBeNull();
  });
});

dbDescribe('refreshQuotes (DB)', () => {
  const TAG = 'QTEST';
  const ids = {};

  const fakeFetch = (payload) => async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: payload }),
  });

  async function cleanup() {
    await db.query(`DELETE FROM security_quotes WHERE security_id IN (SELECT id FROM securities WHERE name LIKE $1)`, [`${TAG}%`]);
    await db.query(`DELETE FROM security_positions WHERE security_id IN (SELECT id FROM securities WHERE name LIKE $1)`, [`${TAG}%`]);
    await db.query(`DELETE FROM security_position_snapshots WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE $1)`, [`${TAG}%`]);
    await db.query(`DELETE FROM securities WHERE name LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
    ids.account = (await db.query(
      `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
       VALUES ($1, 'asset', 'balance_sheet', FALSE, 'USD', TRUE) RETURNING id`, [`${TAG} Brokerage`]
    )).rows[0].id;

    const security = async (name, ticker, basis, quoteSymbol) => (await db.query(
      `INSERT INTO securities (ticker, name, asset_class, currency, price_basis, quantity_unit, quote_symbol)
       VALUES ($1,$2,$3,'USD',$4,$5,$6) RETURNING id`,
      [ticker, name, basis === 'per_share' ? 'equity' : 'bond', basis,
        basis === 'per_share' ? 'shares' : 'face', quoteSymbol]
    )).rows[0].id;

    ids.good = await security(`${TAG} Good`, `${TAG}G`, 'per_share', `${TAG}G`);
    ids.wild = await security(`${TAG} Wild`, `${TAG}W`, 'per_share', `${TAG}W`);
    // A bond: per-100-face, and it carries a quote_symbol on purpose — the
    // structural gate, not the absence of a symbol, is what must keep it out.
    ids.bond = await security(`${TAG} Bond`, `${TAG}B`, 'per_100_face', `${TAG}B`);

    ids.snapshot = (await db.query(
      `INSERT INTO security_position_snapshots
         (account_id, polled_on, source, status, custodian_balance, positions_count, sum_market_value, fetched_at)
       VALUES ($1, CURRENT_DATE, 'bank-feed', 'fetched', 3000, 3, 3000, NOW()) RETURNING id`,
      [ids.account]
    )).rows[0].id;

    const position = (securityId, qty, price, basis) => db.query(
      `INSERT INTO security_positions
         (snapshot_id, account_id, security_id, quantity, price, price_basis, price_source, market_value, currency)
       VALUES ($1,$2,$3,$4,$5,$6,'custodian',$7,'USD')`,
      [ids.snapshot, ids.account, securityId, qty, price, basis, Number(qty) * Number(price)]
    );
    await position(ids.good, 10, 100, 'per_share');
    await position(ids.wild, 10, 100, 'per_share');
    await position(ids.bond, 1000, 0.9989, 'per_100_face');
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('🔴 a per-100-face security is never asked about', async () => {
    const held = await marketPrices.heldQuotableSecurities();
    const symbols = held.map((h) => h.quote_symbol);
    expect(symbols).toContain(`${TAG}G`);
    expect(symbols).not.toContain(`${TAG}B`);
  });

  test('stores a sane quote and refuses a wild one, naming the refusal', async () => {
    const summary = await refreshQuotes({
      fetchImpl: fakeFetch([
        { symbol: `${TAG}G`, price: '104.50', currency: 'USD', as_of: '2026-09-15T19:59:59Z', feed: 'iex' },
        // 250 against a custodian 100 — the units-error shape.
        { symbol: `${TAG}W`, price: '25000', currency: 'USD', as_of: '2026-09-15T19:59:59Z', feed: 'iex' },
      ]),
    });

    const stored = await db.query(
      `SELECT security_id, price::text, source, venue FROM security_quotes WHERE security_id = ANY($1::int[])`,
      [[ids.good, ids.wild, ids.bond]]);
    expect(stored.rows.map((r) => r.security_id)).toEqual([ids.good]);
    expect(Number(stored.rows[0].price)).toBeCloseTo(104.5, 2);
    expect(stored.rows[0].venue).toBe('iex');

    expect(summary.refused.map((r) => r.symbol)).toContain(`${TAG}W`);
    expect(summary.stored).toBeGreaterThanOrEqual(1);
  });

  test('re-running on the same as_of stores nothing new — a quote is one observation', async () => {
    const quote = fakeFetch([
      { symbol: `${TAG}G`, price: '104.50', currency: 'USD', as_of: '2026-09-15T19:59:59Z', feed: 'iex' },
    ]);
    const summary = await refreshQuotes({ fetchImpl: quote });
    const { rows } = await db.query(`SELECT COUNT(*)::int n FROM security_quotes WHERE security_id = $1`, [ids.good]);
    expect(rows[0].n).toBe(1);
    expect(summary.unchanged).toBeGreaterThanOrEqual(1);
  });

  test('🔴 one invalid symbol does not cost the batch its quotes', async () => {
    // What actually happened on the first live run: `BRK/B` in the list made
    // `/prices?symbols=` answer 422 for ALL 46 symbols, and the refresh stored
    // nothing. A failed batch is split, so the bad symbol is isolated by name
    // and everything else still lands.
    await db.query(`DELETE FROM security_quotes WHERE security_id = $1`, [ids.good]);
    const poison = `${TAG}W`;
    const fetchImpl = async (url) => {
      const asked = decodeURIComponent(String(url).split('symbols=')[1] || '').split(',');
      if (asked.includes(poison)) {
        return { ok: false, status: 422, text: async () => '{"error":{"type":"validation_failed"}}' };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: asked.map((symbol) => ({
            symbol, price: '104.50', currency: 'USD', as_of: '2026-09-16T13:45:00Z', feed: 'iex',
          })),
        }),
      };
    };

    const summary = await refreshQuotes({ fetchImpl });
    expect(summary.failed.map((f) => f.symbol)).toContain(poison);
    expect(summary.failed[0].reason).toMatch(/422/);
    // The good one still stored, despite sharing the batch with the poison.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int n FROM security_quotes WHERE security_id = $1`, [ids.good]);
    expect(rows[0].n).toBe(1);
  });

  test('an upstream failure is reported, not thrown — the page keeps the old quotes', async () => {
    const failing = async () => ({ ok: false, status: 503, text: async () => '{"error":{"type":"unavailable"}}' });
    const summary = await refreshQuotes({ fetchImpl: failing });
    expect(summary.error).toMatch(/503/);
    expect(summary.stored).toBe(0);
    const { rows } = await db.query(`SELECT COUNT(*)::int n FROM security_quotes WHERE security_id = $1`, [ids.good]);
    expect(rows[0].n).toBe(1); // the previous observation survives
  });
});
