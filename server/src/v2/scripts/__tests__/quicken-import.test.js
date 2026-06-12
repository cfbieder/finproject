/**
 * Quicken Import Parser Tests (Phase B)
 *
 * Pure-parsing tests need no DB. The DB-backed test runs against the dev
 * Postgres on localhost:5434 (matching the convention in calibration.test.js).
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const {
  parseDate,
  parseAmount,
  parsePrice,
  parsePriceBlock,
  parseQifBlock,
  parseQif,
  runParse,
  parseFxCsv,
  seedFxRates,
  runSeedFx,
} = require('../quicken-import');

// Helpers (defined ahead of dbDescribe blocks)
function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

// Connection comes from the environment like every other DB-backed suite —
// never a hardcoded credential (set SKIP_DB_TESTS=1 to skip without a DB).
const TEST_DB_URL = process.env.DATABASE_URL;
const FIXTURES_DIR = path.resolve(__dirname, '../../../../../Samples/quicken/fixtures');

// ═══════════════════════════════════════════════════════════════════════════
// PURE PARSING — no DB
// ═══════════════════════════════════════════════════════════════════════════

describe('parseDate', () => {
  test("apostrophe-year format (Quicken Cash file convention)", () => {
    expect(parseDate("6/19'14")).toBe('2014-06-19');
    expect(parseDate("7/ 1'14")).toBe('2014-07-01');
    expect(parseDate("12/31'99")).toBe('1999-12-31');
  });

  test('slash-year format (Quicken Invst file convention)', () => {
    expect(parseDate('3/21/98')).toBe('1998-03-21');
    expect(parseDate('10/10/2024')).toBe('2024-10-10');
  });

  test('year pivot at 50: 00-49 → 20xx, 50-99 → 19xx', () => {
    expect(parseDate("1/1' 0")).toBe('2000-01-01');
    expect(parseDate("1/1'49")).toBe('2049-01-01');
    expect(parseDate("1/1'50")).toBe('1950-01-01');
    expect(parseDate("1/1'99")).toBe('1999-01-01');
  });

  test('leading-space padding (Quicken pads single-digit days/years)', () => {
    expect(parseDate("10/10' 1")).toBe('2001-10-10');
    expect(parseDate(" 4/30' 9")).toBe('2009-04-30');
  });

  test('returns null on garbage input', () => {
    expect(parseDate('garbage')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate('99/99/99')).toBeNull();
  });
});

describe('parseAmount', () => {
  test('strips commas, handles negatives', () => {
    expect(parseAmount('1,500,000.00')).toBe(1500000);
    expect(parseAmount('-22,500.00')).toBe(-22500);
    expect(parseAmount('0.58')).toBe(0.58);
  });

  test('returns null on bad input', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe('parsePrice (handles fractional Wall Street notation)', () => {
  test('decimal prices', () => {
    expect(parsePrice('36.75')).toBe(36.75);
    expect(parsePrice('100')).toBe(100);
    expect(parsePrice('0.0001')).toBe(0.0001);
  });

  test('whole + fraction (pre-2001 quotes)', () => {
    expect(parsePrice('36 3/4')).toBe(36.75);
    expect(parsePrice('100 1/8')).toBe(100.125);
    expect(parsePrice('25 5/16')).toBeCloseTo(25.3125, 4);
  });

  test('pure fraction (rare)', () => {
    expect(parsePrice('3/8')).toBe(0.375);
    expect(parsePrice('1/2')).toBe(0.5);
  });

  test('returns null on garbage', () => {
    expect(parsePrice('abc')).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('5/0')).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});

describe('parsePriceBlock', () => {
  test('decimal price block', () => {
    const p = parsePriceBlock(`"ABT",20.0241," 4/30' 9"`, 'x.QIF', 1);
    expect(p).toMatchObject({ ticker: 'ABT', close: 20.0241, price_date: '2009-04-30' });
  });

  test('fractional price block (pre-decimalization)', () => {
    const p = parsePriceBlock(`"ABT",36 3/4," 8/ 2'13"`, 'x.QIF', 1);
    expect(p).toMatchObject({ ticker: 'ABT', close: 36.75, price_date: '2013-08-02' });
  });

  test('returns null if regex fails', () => {
    expect(parsePriceBlock('garbage line', 'x.QIF', 1)).toBeNull();
  });
});

describe('parseQifBlock', () => {
  test('simple cash row with category', () => {
    const text = ['D6/19\'14', 'U-22,500.00', 'T-22,500.00', 'PBanke Fee', 'LBank Fees'].join('\n');
    const row = parseQifBlock(text, 'x.QIF', 10, 'PLN');
    expect(row.transaction_date).toBe('2014-06-19');
    expect(row.amount).toBe(-22500);
    expect(row.currency).toBe('PLN');
    expect(row.payee).toBe('Banke Fee');
    expect(row.quicken_category).toBe('Bank Fees');
    expect(row.transfer_target_account).toBeNull();
    expect(row.splits).toEqual([]);
  });

  test('transfer row (bracketed L tag)', () => {
    const text = ['D6/19\'14', 'T-100,000.00', 'PTransfer', 'L[BNP]'].join('\n');
    const row = parseQifBlock(text, 'x.QIF', 10);
    expect(row.transfer_target_account).toBe('BNP');
    expect(row.quicken_category).toBeNull();
  });

  test('split row: parent has no children of its own but emits N child entries', () => {
    const text = [
      'D8/ 6\'14',
      'T-14,118.43',
      'PPKO - Bruzdowa',
      'L--Split--',
      'SInt Exp',
      '$-10,769.59',
      'S[Mortgage - PKO_Bruzdowa]',
      '$-3,348.84',
    ].join('\n');
    const row = parseQifBlock(text, 'x.QIF', 10);
    expect(row.amount).toBe(-14118.43);
    expect(row.splits).toHaveLength(2);
    expect(row.splits[0].category).toBe('Int Exp');
    expect(row.splits[0].amount).toBe(-10769.59);
    expect(row.splits[1].transfer_target_account).toBe('Mortgage - PKO_Bruzdowa');
    expect(row.splits[1].amount).toBe(-3348.84);
    const sum = row.splits.reduce((s, c) => s + c.amount, 0);
    expect(Math.abs(sum - row.amount)).toBeLessThan(0.01);
  });

  test('split with empty S tag: category stays null (Quicken zero-amount adjustment marker)', () => {
    const text = [
      'D8/ 6\'14',
      'T0.00',
      'PPKO - Niemena',
      'L--Split--',
      'S',
      '$0.00',
      'EsSplit Amount Adjustment',
    ].join('\n');
    const row = parseQifBlock(text, 'x.QIF', 10);
    expect(row.splits).toHaveLength(1);
    expect(row.splits[0].category).toBeNull();
    expect(row.splits[0].transfer_target_account).toBeNull();
  });

  test('check number is folded into memo', () => {
    const text = ['D7/ 1\'14', 'T100.00', 'PInt In', 'NDEP', 'LInt Inc'].join('\n');
    const row = parseQifBlock(text, 'x.QIF', 10);
    expect(row.memo).toBe('check#DEP');
  });

  test('cleared status', () => {
    const text = ['D6/19\'14', 'T-100', 'C*', 'PTransfer', 'L[BNP]'].join('\n');
    const row = parseQifBlock(text, 'x.QIF', 10);
    expect(row.cleared_status).toBe('*');
  });
});

describe('parseQif (full file)', () => {
  test('cash_simple.QIF fixture parses to 6 blocks with !Type:Cash header', () => {
    const text = fs.readFileSync(
      path.join(FIXTURES_DIR, 'cash_simple.QIF'),
      'utf8'
    );
    const parsed = parseQif(text, 'cash_simple.QIF', 'PLN');
    expect(parsed.header).toBe('Cash');
    expect(parsed.rows).toHaveLength(6);

    // Spot-check a few rows
    expect(parsed.rows[0].amount).toBe(1500000);
    expect(parsed.rows[0].transfer_target_account).toBe('Mortgage - PKO_Bruzdowa');
    expect(parsed.rows[3].splits).toHaveLength(2);
    expect(parsed.rows[4].transaction_date).toBe('1998-03-21'); // slash-year format
    expect(parsed.rows[5].transaction_date).toBe('2001-10-10'); // year pivot test
  });

  test('all rows tag UTF-8 BOM is stripped if present', () => {
    const textWithBom = '﻿' + '!Type:Cash\nD6/19\'14\nT100\n^\n';
    const parsed = parseQif(textWithBom, 'x.QIF');
    expect(parsed.header).toBe('Cash');
    expect(parsed.rows).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVESTMENT-BLOCK PARSING — no DB (Phase D)
// ═══════════════════════════════════════════════════════════════════════════

describe('parseQif (investment file)', () => {
  test('inv_actions.QIF: dispatches all blocks under !Type:Invst', () => {
    const parsed = parseQif(readFixture('inv_actions.QIF'), 'inv_actions.QIF');
    expect(parsed.firstHeader).toBe('Invst');
    expect(parsed.cashRows).toHaveLength(0);
    expect(parsed.invstRows).toHaveLength(14);
    expect(parsed.securityRows).toHaveLength(0);
    expect(parsed.priceRows).toHaveLength(0);
  });

  test('inv_actions.QIF: action types and security names extracted correctly', () => {
    const parsed = parseQif(readFixture('inv_actions.QIF'), 'inv_actions.QIF');
    const actions = parsed.invstRows.map((r) => r.action);
    expect(actions).toEqual([
      'Buy', 'Div', 'XIn', 'IntInc', 'Sell', 'ReinvDiv', 'Cash', 'MargInt',
      'RtrnCap', 'CGLong', 'ShtSell', 'CvrShrt', 'StkSplit', 'ShrsIn',
    ]);

    const buy = parsed.invstRows.find((r) => r.action === 'Buy');
    expect(buy.security_name).toBe('Philip Morris');
    expect(buy.shares).toBe(50);
    expect(buy.price).toBe(43.1875);
    expect(buy.fees).toBe(19.95);
    expect(buy.amount).toBe(2179.33);
    expect(buy.transaction_date).toBe('1998-03-23');
  });

  test('inv_actions.QIF: XIn captures transfer_target_account and $ amount', () => {
    const parsed = parseQif(readFixture('inv_actions.QIF'), 'inv_actions.QIF');
    const xin = parsed.invstRows.find((r) => r.action === 'XIn');
    expect(xin.transfer_target_account).toBe('Chase (C)');
    expect(xin.transfer_amount).toBe(4619.95);
    expect(xin.payee).toBe('Transfer');
  });

  test('inv_security_and_prices.QIF: routes Security and Prices blocks correctly', () => {
    const parsed = parseQif(readFixture('inv_security_and_prices.QIF'), 'inv_sec.QIF');
    expect(parsed.firstHeader).toBe('Security');
    expect(parsed.cashRows).toHaveLength(0);
    expect(parsed.invstRows).toHaveLength(0);
    expect(parsed.securityRows).toHaveLength(3);
    expect(parsed.priceRows).toHaveLength(5);
  });

  test('inv_security_and_prices.QIF: security master fields extracted', () => {
    const parsed = parseQif(readFixture('inv_security_and_prices.QIF'), 'inv_sec.QIF');
    const abt = parsed.securityRows.find((r) => r.ticker === 'ABT');
    expect(abt.quicken_security_name).toBe('ABBOTT LABORATORIES');
    expect(abt.quicken_type).toBe('Stock');
    expect(abt.quicken_goal).toBe('Growth & Income');

    const spy = parsed.securityRows.find((r) => r.ticker === 'SPY');
    expect(spy.quicken_type).toBe('ETF');
    expect(spy.quicken_goal).toBeNull();
  });

  test('inv_security_and_prices.QIF: price rows extract ticker/date/close', () => {
    const parsed = parseQif(readFixture('inv_security_and_prices.QIF'), 'inv_sec.QIF');
    expect(parsed.priceRows[0]).toMatchObject({
      ticker: 'ABT',
      close: 20.0241,
      price_date: '2009-04-30',
    });
    expect(parsed.priceRows[3]).toMatchObject({
      ticker: 'SPY',
      close: 100.5,
      price_date: '2009-12-31',
    });
    expect(parsed.priceRows[4]).toMatchObject({
      ticker: 'SPY',
      close: 125.75,
      price_date: '2014-06-30',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FX CSV PARSING — no DB
// ═══════════════════════════════════════════════════════════════════════════

describe('parseFxCsv', () => {
  test('valid header + rows', () => {
    const text = 'year,month,rate\n2014,6,3.0436\n2014,7,3.0488\n';
    const rows = parseFxCsv(text);
    expect(rows).toEqual([
      { year: 2014, month: 6, rate: 3.0436 },
      { year: 2014, month: 7, rate: 3.0488 },
    ]);
  });

  test('header column order flexibility', () => {
    const text = 'rate,month,year\n3.0436,6,2014\n';
    const rows = parseFxCsv(text);
    expect(rows).toEqual([{ year: 2014, month: 6, rate: 3.0436 }]);
  });

  test('BOM is stripped', () => {
    const text = '﻿' + 'year,month,rate\n2014,6,3.0436\n';
    const rows = parseFxCsv(text);
    expect(rows).toHaveLength(1);
  });

  test('header missing required column throws', () => {
    expect(() => parseFxCsv('year,rate\n2014,3.04\n')).toThrow(/header row must contain/);
  });

  test('month out of range throws', () => {
    expect(() => parseFxCsv('year,month,rate\n2014,13,3.04\n')).toThrow(/month out of range/);
  });

  test('zero or negative rate throws', () => {
    expect(() => parseFxCsv('year,month,rate\n2014,6,0\n')).toThrow(/rate must be positive/);
    expect(() => parseFxCsv('year,month,rate\n2014,6,-1.5\n')).toThrow(/rate must be positive/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DB-BACKED — uses dev Postgres on localhost:5434
// Skipped automatically when SKIP_DB_TESTS=1 (CI without DB access)
// ═══════════════════════════════════════════════════════════════════════════

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('runParse (DB-backed)', () => {
  let pool;
  let batchId;

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DB_URL });
  });

  beforeEach(() => {
    batchId = randomUUID();
  });

  afterEach(async () => {
    // Clean up any rows left by this batch
    if (batchId) {
      await pool.query('DELETE FROM quicken_staging WHERE import_batch_id = $1', [batchId]);
      await pool.query('DELETE FROM quicken_import_batches WHERE id = $1', [batchId]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  test('parses cash_simple.QIF fixture into staging', async () => {
    const fixturePath = path.join(FIXTURES_DIR, 'cash_simple.QIF');
    const result = await runParse({
      files: [{ path: fixturePath, currency: 'PLN' }],
      batchId,
      label: 'test cash_simple',
      pool,
    });

    expect(result.batchId).toBe(batchId);
    // 5 standalone rows + 1 split parent + 2 split children = 8 rows total
    expect(result.totalStaged).toBe(8);

    const { rows } = await pool.query(
      'SELECT COUNT(*) AS n FROM quicken_staging WHERE import_batch_id = $1',
      [batchId]
    );
    expect(parseInt(rows[0].n, 10)).toBe(8);

    // Batch row should be 'parsed'
    const { rows: batchRows } = await pool.query(
      'SELECT status, parsed_at FROM quicken_import_batches WHERE id = $1',
      [batchId]
    );
    expect(batchRows[0].status).toBe('parsed');
    expect(batchRows[0].parsed_at).not.toBeNull();
  });

  test('split children link to parent via split_parent_id', async () => {
    const fixturePath = path.join(FIXTURES_DIR, 'cash_simple.QIF');
    await runParse({
      files: [{ path: fixturePath, currency: 'PLN' }],
      batchId,
      pool,
    });

    const { rows: parents } = await pool.query(
      `SELECT id, amount FROM quicken_staging
        WHERE import_batch_id = $1 AND split_parent_id IS NULL AND amount = -14118.43`,
      [batchId]
    );
    expect(parents).toHaveLength(1);
    const parentId = parents[0].id;

    const { rows: children } = await pool.query(
      `SELECT amount, quicken_category, transfer_target_account
         FROM quicken_staging WHERE split_parent_id = $1 ORDER BY id`,
      [parentId]
    );
    expect(children).toHaveLength(2);
    expect(children[0].quicken_category).toBe('Int Exp');
    expect(parseFloat(children[0].amount)).toBeCloseTo(-10769.59, 2);
    expect(children[1].transfer_target_account).toBe('Mortgage - PKO_Bruzdowa');
    expect(parseFloat(children[1].amount)).toBeCloseTo(-3348.84, 2);
  });

  test('re-parsing the same batch wipes prior staging rows first (idempotent)', async () => {
    const fixturePath = path.join(FIXTURES_DIR, 'cash_simple.QIF');
    await runParse({
      files: [{ path: fixturePath, currency: 'PLN' }],
      batchId,
      pool,
    });
    const r2 = await runParse({
      files: [{ path: fixturePath, currency: 'PLN' }],
      batchId,
      pool,
    });

    const { rows } = await pool.query(
      'SELECT COUNT(*) AS n FROM quicken_staging WHERE import_batch_id = $1',
      [batchId]
    );
    expect(parseInt(rows[0].n, 10)).toBe(8);
    expect(r2.totalStaged).toBe(8);
  });

  test('transfer detection lands in transfer_target_account', async () => {
    const fixturePath = path.join(FIXTURES_DIR, 'cash_simple.QIF');
    await runParse({
      files: [{ path: fixturePath, currency: 'PLN' }],
      batchId,
      pool,
    });

    const { rows } = await pool.query(
      `SELECT transfer_target_account FROM quicken_staging
        WHERE import_batch_id = $1 AND transfer_target_account IS NOT NULL
        ORDER BY id`,
      [batchId]
    );
    // 1 standalone transfer ('Opening Balance' to Mortgage) + 1 split-child transfer
    expect(rows).toHaveLength(2);
    expect(rows[0].transfer_target_account).toBe('Mortgage - PKO_Bruzdowa');
    expect(rows[1].transfer_target_account).toBe('Mortgage - PKO_Bruzdowa');
  });
});

dbDescribe('runParse — investment file routing (DB-backed)', () => {
  let pool;
  let batchId;

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DB_URL });
  });

  beforeEach(() => {
    batchId = randomUUID();
  });

  afterEach(async () => {
    if (batchId) {
      await pool.query('DELETE FROM quicken_price_staging WHERE import_batch_id = $1', [batchId]);
      await pool.query('DELETE FROM quicken_security_master_staging WHERE import_batch_id = $1', [batchId]);
      await pool.query('DELETE FROM quicken_securities_staging WHERE import_batch_id = $1', [batchId]);
      await pool.query('DELETE FROM quicken_staging WHERE import_batch_id = $1', [batchId]);
      await pool.query('DELETE FROM quicken_import_batches WHERE id = $1', [batchId]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  test('inv_actions.QIF routes cash-only actions to quicken_staging, security actions to quicken_securities_staging', async () => {
    const fp = path.join(FIXTURES_DIR, 'inv_actions.QIF');
    const result = await runParse({
      files: [{ path: fp, currency: 'USD' }],
      batchId,
      pool,
    });

    // 14 invst blocks, of which 4 are cash-only (XIn, IntInc?? no, IntInc has a Y so it's security-side; let me check)
    // Per CASH_ONLY_INVST_ACTIONS = {XIn, XOut, Cash, MargInt}
    // From the fixture: XIn(1), Cash(1), MargInt(1) = 3 cash-only.
    // Security-side: Buy, Div, IntInc, Sell, ReinvDiv, RtrnCap, CGLong, ShtSell, CvrShrt, StkSplit, ShrsIn = 11
    expect(result.totalStaged).toBe(14);

    const cashCount = (await pool.query(
      'SELECT COUNT(*)::int AS n FROM quicken_staging WHERE import_batch_id = $1',
      [batchId]
    )).rows[0].n;
    expect(cashCount).toBe(3);

    const invstCount = (await pool.query(
      'SELECT COUNT(*)::int AS n FROM quicken_securities_staging WHERE import_batch_id = $1',
      [batchId]
    )).rows[0].n;
    expect(invstCount).toBe(11);

    // Verify cash-only routing: action names landed in quicken_category
    const cashActions = (await pool.query(
      `SELECT quicken_category FROM quicken_staging WHERE import_batch_id = $1
        ORDER BY id`,
      [batchId]
    )).rows.map((r) => r.quicken_category);
    expect(cashActions.sort()).toEqual(['Cash', 'MargInt', 'XIn']);

    // Verify Buy lands with all numeric fields populated
    const buy = (await pool.query(
      `SELECT shares, price, fees, gross_amount FROM quicken_securities_staging
        WHERE import_batch_id = $1 AND quicken_action = 'Buy'`,
      [batchId]
    )).rows[0];
    expect(parseFloat(buy.shares)).toBe(50);
    expect(parseFloat(buy.price)).toBe(43.1875);
    expect(parseFloat(buy.fees)).toBe(19.95);
    expect(parseFloat(buy.gross_amount)).toBe(2179.33);
  });

  test('inv_security_and_prices.QIF routes Security and Prices blocks to their staging tables', async () => {
    const fp = path.join(FIXTURES_DIR, 'inv_security_and_prices.QIF');
    const result = await runParse({
      files: [{ path: fp, currency: 'USD' }],
      batchId,
      pool,
    });
    expect(result.totalStaged).toBe(8); // 3 security master + 5 prices

    const secMaster = (await pool.query(
      `SELECT ticker, quicken_type FROM quicken_security_master_staging
        WHERE import_batch_id = $1 ORDER BY ticker`,
      [batchId]
    )).rows;
    expect(secMaster).toEqual([
      { ticker: 'ABBV', quicken_type: 'Stock' },
      { ticker: 'ABT', quicken_type: 'Stock' },
      { ticker: 'SPY', quicken_type: 'ETF' },
    ]);

    const prices = (await pool.query(
      `SELECT ticker, COUNT(*)::int AS n FROM quicken_price_staging
        WHERE import_batch_id = $1 GROUP BY ticker ORDER BY ticker`,
      [batchId]
    )).rows;
    expect(prices).toEqual([
      { ticker: 'ABT', n: 3 },
      { ticker: 'SPY', n: 2 },
    ]);
  });
});

dbDescribe('runSeedFx (DB-backed)', () => {
  let pool;
  const TEST_CURRENCY = 'TST'; // sentinel currency — won't collide with real PLN/EUR/etc.

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DB_URL });
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM budget_fx_rates WHERE currency = $1', [TEST_CURRENCY]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM budget_fx_rates WHERE currency = $1', [TEST_CURRENCY]);
    await pool.end();
  });

  test('upserts rates from fx_pln_sample.csv format under sentinel currency', async () => {
    const csvPath = path.join(FIXTURES_DIR, 'fx_pln_sample.csv');
    const result = await runSeedFx({ csvPath, currency: TEST_CURRENCY, pool });
    expect(result.parsed).toBe(9);
    expect(result.upserted).toBe(9);
    expect(result.coverage).toEqual({ from: '2014-06', to: '2015-02' });

    const { rows } = await pool.query(
      'SELECT year, month, rate FROM budget_fx_rates WHERE currency = $1 ORDER BY year, month',
      [TEST_CURRENCY]
    );
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({ year: 2014, month: 6 });
    expect(parseFloat(rows[0].rate)).toBeCloseTo(3.0436, 4);
    expect(rows[8]).toMatchObject({ year: 2015, month: 2 });
  });

  test('idempotent: re-running with same CSV does not duplicate', async () => {
    const csvPath = path.join(FIXTURES_DIR, 'fx_pln_sample.csv');
    await runSeedFx({ csvPath, currency: TEST_CURRENCY, pool });
    await runSeedFx({ csvPath, currency: TEST_CURRENCY, pool });

    const { rows } = await pool.query(
      'SELECT COUNT(*) AS n FROM budget_fx_rates WHERE currency = $1',
      [TEST_CURRENCY]
    );
    expect(parseInt(rows[0].n, 10)).toBe(9);
  });

  test('upserts overwrite existing rate (idempotent UPDATE)', async () => {
    await pool.query(
      `INSERT INTO budget_fx_rates (currency, year, month, rate)
         VALUES ($1, 2014, 6, 999.99)`,
      [TEST_CURRENCY]
    );

    const csvPath = path.join(FIXTURES_DIR, 'fx_pln_sample.csv');
    await runSeedFx({ csvPath, currency: TEST_CURRENCY, pool });

    const { rows } = await pool.query(
      'SELECT rate FROM budget_fx_rates WHERE currency = $1 AND year = 2014 AND month = 6',
      [TEST_CURRENCY]
    );
    expect(parseFloat(rows[0].rate)).toBeCloseTo(3.0436, 4); // overwrote 999.99
  });

  test('rejects malformed currency code', async () => {
    await expect(seedFxRates(pool, 'pln', [{ year: 2014, month: 6, rate: 3.0 }])).rejects.toThrow(
      /3 uppercase letters/
    );
    await expect(seedFxRates(pool, 'EURO', [{ year: 2014, month: 6, rate: 3.0 }])).rejects.toThrow(
      /3 uppercase letters/
    );
  });
});
