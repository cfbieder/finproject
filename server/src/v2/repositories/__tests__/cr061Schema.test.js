'use strict';
/**
 * cr061Schema.test.js — CR061 P1, migration 075.
 *
 * The guarantees that live in the DATABASE. Every one of these is a constraint
 * the design leans on in prose, and prose does not enforce anything: the whole
 * reason `asset_class` lost its DEFAULT is that an unclassified CUSIP silently
 * becoming a `stock` — and a stock is quote-eligible — is the path by which a
 * 100,000-face bond gets priced at an equity's $250 and books $25,000,000.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1). Run via ./Scripts/test-fresh-db.sh so
 * these meet a database built the way CI builds one.
 */

const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('CR061 migration 075 — the constraints, not the intentions (DB)', () => {
  let acctId;
  let secId;

  beforeAll(async () => {
    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ('CR061 Test Brokerage','asset','balance_sheet','USD',0) RETURNING id`);
    acctId = a.rows[0].id;
    const s = await db.query(
      `INSERT INTO securities (ticker, name, asset_class, currency)
       VALUES ('CR61T','CR061 Test Security','equity','USD') RETURNING id`);
    secId = s.rows[0].id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM security_positions WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM security_position_snapshots WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM security_quotes WHERE security_id = $1`, [secId]);
    await db.query(`DELETE FROM securities WHERE id = $1`, [secId]);
    await db.query(`DELETE FROM accounts WHERE id = $1`, [acctId]);
    await db.close();
  });

  const mkSnapshot = (over = {}) => {
    const o = { polled_on: '2026-09-02', source: 'bank-feed', status: 'fetched', ...over };
    return db.query(
      `INSERT INTO security_position_snapshots
         (account_id, polled_on, source, status, custodian_balance, positions_count, sum_market_value)
       VALUES ($1,$2,$3,$4,100.00,1,100.00) RETURNING id`,
      [acctId, o.polled_on, o.source, o.status],
    ).then((r) => r.rows[0].id);
  };

  // ---- the default that had to go -----------------------------------------

  test('securities.asset_class has NO default — an unclassified insert FAILS', async () => {
    // Before 075 this silently became 'stock', and a stock is quote-eligible.
    await expect(
      db.query(`INSERT INTO securities (ticker, name, currency) VALUES ('CR61X','No class','USD')`),
    ).rejects.toThrow(/asset_class/);
  });

  test('the classification vocabulary can express a mutual fund', async () => {
    // The live portfolio holds $147,988 of FCNTX. The pre-075 vocabulary
    // (stock/etf/bond/mf/misc) had no value the new writers use for it.
    const r = await db.query(
      `INSERT INTO securities (ticker, name, asset_class, currency)
       VALUES ('CR61MF','Test Fund','mutual_fund','USD') RETURNING asset_class`);
    expect(r.rows[0].asset_class).toBe('mutual_fund');
    await db.query(`DELETE FROM securities WHERE ticker = 'CR61MF'`);
  });

  test('an unknown asset_class is rejected outright', async () => {
    await expect(
      db.query(`INSERT INTO securities (ticker, name, asset_class, currency)
                VALUES ('CR61Z','Bad','equities','USD')`),
    ).rejects.toThrow(/securities_asset_class_chk/);
  });

  test('CR019 legacy values still insert — this migration must not break that CR', async () => {
    const r = await db.query(
      `INSERT INTO securities (ticker, name, asset_class, currency)
       VALUES ('CR61L','Legacy','stock','USD') RETURNING asset_class`);
    expect(r.rows[0].asset_class).toBe('stock');
    await db.query(`DELETE FROM securities WHERE ticker = 'CR61L'`);
  });

  test('quote_symbol starts NULL — quotability is earned, not inferred', async () => {
    const r = await db.query(`SELECT quote_symbol, classification_source FROM securities WHERE id = $1`, [secId]);
    expect(r.rows[0].quote_symbol).toBeNull();
    expect(r.rows[0].classification_source).toBeNull();
  });

  test('price_basis and quantity_unit are constrained to their real vocabularies', async () => {
    await expect(
      db.query(`UPDATE securities SET price_basis = 'per_unit' WHERE id = $1`, [secId]),
    ).rejects.toThrow(/securities_price_basis_chk/);
    await expect(
      db.query(`UPDATE securities SET quantity_unit = 'units' WHERE id = $1`, [secId]),
    ).rejects.toThrow(/securities_quantity_unit_chk/);
    // ...and the real ones work, including the bond convention.
    await db.query(
      `UPDATE securities SET price_basis = 'per_1_face', quantity_unit = 'face' WHERE id = $1`, [secId]);
    const r = await db.query(`SELECT price_basis, quantity_unit FROM securities WHERE id = $1`, [secId]);
    expect(r.rows[0]).toEqual({ price_basis: 'per_1_face', quantity_unit: 'face' });
    await db.query(`UPDATE securities SET price_basis = 'per_share', quantity_unit = 'shares' WHERE id = $1`, [secId]);
  });

  // ---- the snapshot header -------------------------------------------------

  test('status is constrained to four values — a typo cannot become a fifth state', async () => {
    await expect(mkSnapshot({ status: 'ok', polled_on: '2026-09-05' }))
      .rejects.toThrow(/sps_status_chk/);
    for (const s of ['fetched', 'empty', 'absent', 'partial']) {
      const id = await mkSnapshot({ status: s, polled_on: '2026-08-0' + (['fetched', 'empty', 'absent', 'partial'].indexOf(s) + 1) });
      expect(id).toBeGreaterThan(0);
    }
  });

  test('valued_on is nullable — nothing upstream states the valuation date', async () => {
    const id = await mkSnapshot({ polled_on: '2026-09-06' });
    const r = await db.query(`SELECT polled_on, valued_on FROM security_position_snapshots WHERE id = $1`, [id]);
    expect(r.rows[0].valued_on).toBeNull();
    // ⚠️ The two are different questions. A consumer that falls back to
    // polled_on when valued_on is null mis-dates the series by one to two days,
    // invisibly — which is the defect CR089 exists to kill.
    expect(r.rows[0].polled_on).not.toBeNull();
  });

  test('one snapshot per (account, poll date, source) — a refetch updates, never forks', async () => {
    await mkSnapshot({ polled_on: '2026-09-07' });
    await expect(mkSnapshot({ polled_on: '2026-09-07' })).rejects.toThrow(/duplicate key/);
    // A different SOURCE for the same day is legitimate: the statement backfill
    // (P2) and the feed can both describe 2026-09-07.
    const id = await mkSnapshot({ polled_on: '2026-09-07', source: 'statement' });
    expect(id).toBeGreaterThan(0);
  });

  // ---- positions ------------------------------------------------------------

  test('a duplicated security in one snapshot is REJECTED, not deduped', async () => {
    const snapId = await mkSnapshot({ polled_on: '2026-09-08' });
    const ins = () => db.query(
      `INSERT INTO security_positions (snapshot_id, account_id, security_id, quantity, price, market_value, currency)
       VALUES ($1,$2,$3,100,141.5,14150,'USD')`, [snapId, acctId, secId]);
    await ins();
    // Keeping one of the pair would make SUM(market_value) under-count, and
    // CR090's residual row would absorb it as "not reported by the feed" — the
    // one number that row exists to make legible.
    await expect(ins()).rejects.toThrow(/duplicate key/);
  });

  test('price_source is constrained — provenance cannot become a free-text field', async () => {
    const snapId = await mkSnapshot({ polled_on: '2026-09-09' });
    await expect(db.query(
      `INSERT INTO security_positions (snapshot_id, account_id, security_id, quantity, price_source)
       VALUES ($1,$2,$3,1,'guessed')`, [snapId, acctId, secId],
    )).rejects.toThrow(/sp_price_source_chk/);
  });

  test('deleting a snapshot takes its positions — no orphans inflating a sum', async () => {
    const snapId = await mkSnapshot({ polled_on: '2026-09-10' });
    await db.query(
      `INSERT INTO security_positions (snapshot_id, account_id, security_id, quantity, market_value)
       VALUES ($1,$2,$3,1,100)`, [snapId, acctId, secId]);
    await db.query(`DELETE FROM security_position_snapshots WHERE id = $1`, [snapId]);
    const r = await db.query(`SELECT count(*)::int AS n FROM security_positions WHERE snapshot_id = $1`, [snapId]);
    expect(r.rows[0].n).toBe(0);
  });

  test('money and quantity keep their precision — never rounded to a float', async () => {
    const snapId = await mkSnapshot({ polled_on: '2026-09-11' });
    await db.query(
      `INSERT INTO security_positions (snapshot_id, account_id, security_id, quantity, price, market_value, cost_basis, currency)
       VALUES ($1,$2,$3,123.06900000,531.57000000,65419.7883,28923.2456,'USD')`,
      [snapId, acctId, secId]);
    const r = await db.query(
      `SELECT quantity::text AS q, market_value::text AS mv, cost_basis::text AS cb
         FROM security_positions WHERE snapshot_id = $1`, [snapId]);
    expect(r.rows[0].q).toBe('123.06900000');
    expect(r.rows[0].mv).toBe('65419.7883');
    // ⚠️ The POSITION TOTAL. cost_basis / quantity gives dollars-per-share for
    // an equity, a price FRACTION for a bond and 1.00 for a money-market fund.
    expect(r.rows[0].cb).toBe('28923.2456');
  });

  // ---- quotes ---------------------------------------------------------------

  test('a quote is not a close — quotes live in their own table, keyed by TIME', async () => {
    await db.query(
      `INSERT INTO security_quotes (security_id, quoted_at, price, source, venue)
       VALUES ($1,'2026-09-02T19:59:59Z',325.25,'fintable','iex')`, [secId]);
    // Two quotes the same DAY must both survive; security_prices could not hold
    // them (UNIQUE on security_id + price_date, one `close`, no timestamp).
    await db.query(
      `INSERT INTO security_quotes (security_id, quoted_at, price, source, venue)
       VALUES ($1,'2026-09-02T15:31:00Z',324.10,'fintable','iex')`, [secId]);
    const r = await db.query(
      `SELECT count(*)::int AS n FROM security_quotes WHERE security_id = $1`, [secId]);
    expect(r.rows[0].n).toBe(2);
  });

  test('the same quote twice is idempotent, not a second row', async () => {
    await db.query(
      `INSERT INTO security_quotes (security_id, quoted_at, price, source, venue)
       VALUES ($1,'2026-09-03T19:59:59Z',326.00,'fintable','iex')`, [secId]);
    await expect(db.query(
      `INSERT INTO security_quotes (security_id, quoted_at, price, source, venue)
       VALUES ($1,'2026-09-03T19:59:59Z',326.00,'fintable','iex')`, [secId],
    )).rejects.toThrow(/duplicate key/);
  });
});
