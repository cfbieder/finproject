'use strict';
/**
 * exposure.test.js — CR093 P1.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1). Run via ./Scripts/test-fresh-db.sh.
 * Every identifier is INVENTED — the repo commits no real financial data.
 *
 * These pin the coverage rules, because that is where this feature can lie:
 * a sector chart that quietly absorbs what it could not classify looks complete
 * and describes the wrong denominator.
 */

const db = require('../../v2/db');
const { buildExposure } = require('../exposure');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('CR093 buildExposure (DB)', () => {
  let acctId; let snapId; const secIds = {};

  const security = async (ticker, over = {}) => {
    const r = { asset_class: 'equity', price_basis: 'per_share', as_of: null, ...over };
    const { rows } = await db.query(`
      INSERT INTO securities (ticker, name, asset_class, currency, price_basis, sector_weights_as_of)
      VALUES ($1,$1,$2,'USD',$3,$4) RETURNING id`,
    [ticker, r.asset_class, r.price_basis, r.as_of]);
    secIds[ticker] = rows[0].id;
    return rows[0].id;
  };

  const position = (id, mv) => db.query(`
    INSERT INTO security_positions (snapshot_id, account_id, security_id, quantity, market_value, currency, price_source)
    VALUES ($1,$2,$3,1,$4,'USD','custodian')`, [snapId, acctId, id, mv]);

  const weight = (id, sector, w) => db.query(`
    INSERT INTO security_sector_weights (security_id, sector, weight, source)
    VALUES ($1,$2,$3,'test')`, [id, sector, w]);

  beforeEach(async () => {
    const { rows: a } = await db.query(`
      INSERT INTO accounts (name, account_type, section, currency, opening_balance)
      VALUES ('CR093 Exposure Test','asset','balance_sheet','USD',0) RETURNING id`);
    acctId = a[0].id;
    const { rows: s } = await db.query(`
      INSERT INTO security_position_snapshots
        (account_id, polled_on, source, status, positions_count, sum_market_value, raw)
      VALUES ($1,'2026-09-05','bank-feed','fetched',0,0,'{}'::jsonb) RETURNING id`, [acctId]);
    snapId = s[0].id;
  });

  afterEach(async () => {
    await db.query('DELETE FROM security_positions WHERE account_id = $1', [acctId]);
    await db.query('DELETE FROM security_position_snapshots WHERE account_id = $1', [acctId]);
    for (const id of Object.values(secIds)) {
      await db.query('DELETE FROM security_sector_weights WHERE security_id = $1', [id]);
      await db.query('DELETE FROM securities WHERE id = $1', [id]);
    }
    for (const k of Object.keys(secIds)) delete secIds[k];
    await db.query('DELETE FROM accounts WHERE id = $1', [acctId]);
  });

  const find = (rows, key, val) => rows.find((r) => r[key] === val);

  test('a fund is spread across its sectors by weight, not booked whole', async () => {
    const id = await security('ZZFUND');
    await position(id, 1000);
    await weight(id, 'technology', 0.6);
    await weight(id, 'healthcare', 0.4);
    const r = await buildExposure();
    expect(Number(find(r.by_sector, 'sector', 'technology').market_value)).toBeCloseTo(600, 2);
    expect(Number(find(r.by_sector, 'sector', 'healthcare').market_value)).toBeCloseTo(400, 2);
  });

  test('🔴 a bond is NOT COVERED-by-nature, and never a gap to be closed', async () => {
    // Most of this portfolio is bonds. If they landed in the same bucket as an
    // unclassified equity, the bucket would be permanently huge and would tell
    // the owner nothing about whether the pipeline works.
    const id = await security('ZZBOND', { asset_class: 'bond' });
    await position(id, 5000);
    const r = await buildExposure();
    expect(r.sector_coverage.not_covered).toHaveLength(0);
    expect(Number(r.sector_coverage.not_applicable_value)).toBeCloseTo(5000, 2);
  });

  test('🔴 a par instrument is not-applicable even when its asset_class is unknown', async () => {
    // Three FDIC deposits are classed `unknown` and held at par. Reading them as
    // "not covered" would park $86,309 of cash in a bucket meant to shrink.
    const id = await security('ZZFDIC', { asset_class: 'unknown', price_basis: 'par' });
    await position(id, 7000);
    const r = await buildExposure();
    expect(r.sector_coverage.not_covered).toHaveLength(0);
    expect(Number(r.sector_coverage.not_applicable_value)).toBeCloseTo(7000, 2);
  });

  test('🔴 an EQUITY holding with no weights and no as_of IS not-covered', async () => {
    // The three closed-end funds. Both vendors report them as financial_services
    // — their manager's sector — so the loader refuses the answer and leaves no
    // as_of. They must surface, not vanish into "not applicable".
    const id = await security('ZZCEF');
    await position(id, 900);
    const r = await buildExposure();
    expect(r.sector_coverage.not_covered.map((x) => x.ticker)).toContain('ZZCEF');
    expect(Number(r.sector_coverage.not_covered_value)).toBeCloseTo(900, 2);
  });

  test('an equity ASKED about, with no sectors, is not-applicable rather than not-covered', async () => {
    const id = await security('ZZASKED', { as_of: '2026-09-05' });
    await position(id, 400);
    const r = await buildExposure();
    expect(r.sector_coverage.not_covered).toHaveLength(0);
  });

  test('🔴 nothing uncovered is redistributed across the sectors we DO know', async () => {
    // Spreading it pro-rata would invent exposure never measured, and is the
    // shape that makes a chart look complete while describing a wrong total.
    const f = await security('ZZF2');
    await position(f, 1000); await weight(f, 'energy', 1.0);
    const g = await security('ZZG2');
    await position(g, 1000);
    const r = await buildExposure();
    expect(Number(find(r.by_sector, 'sector', 'energy').market_value)).toBeCloseTo(1000, 2);
    expect(Number(r.sector_coverage.sectored_value)).toBeCloseTo(1000, 2);
    expect(Number(r.total_market_value)).toBeCloseTo(2000, 2);
  });

  test('sector shares carry BOTH denominators', async () => {
    // Share of the sectored sleeve is what a pie chart shows; share of the whole
    // portfolio is what the owner holds. Only the first makes an 11.8% position
    // look like 32%.
    const f = await security('ZZF3');
    await position(f, 1000); await weight(f, 'technology', 1.0);
    const b = await security('ZZB3', { asset_class: 'bond' });
    await position(b, 3000);
    const r = await buildExposure();
    const t = find(r.by_sector, 'sector', 'technology');
    expect(t.share_of_sectored).toBeCloseTo(1.0, 4);
    expect(t.share_of_portfolio).toBeCloseTo(0.25, 4);
  });
});

dbDescribe('CR093 setSectorWeights (DB)', () => {
  const { setSectorWeights } = require('../exposure');
  let id;

  beforeEach(async () => {
    const { rows } = await db.query(`
      INSERT INTO securities (ticker, name, asset_class, currency, price_basis)
      VALUES ('ZZMANUAL','ZZMANUAL','equity','USD','per_share') RETURNING id`);
    id = rows[0].id;
  });
  afterEach(async () => {
    await db.query('DELETE FROM security_sector_weights WHERE security_id = $1', [id]);
    await db.query('DELETE FROM securities WHERE id = $1', [id]);
  });

  test('a single sector at 100% is stored and marks the security answered', async () => {
    await setSectorWeights(id, [{ sector: 'utilities', weight: 1 }]);
    const { rows } = await db.query(
      'SELECT sector, weight::float AS w, source FROM security_sector_weights WHERE security_id = $1', [id]);
    expect(rows).toEqual([{ sector: 'utilities', w: 1, source: 'manual' }]);
    const { rows: s } = await db.query('SELECT sector_weights_as_of FROM securities WHERE id = $1', [id]);
    expect(s[0].sector_weights_as_of).not.toBeNull();
  });

  test('a diversified fund can carry several sectors', async () => {
    await setSectorWeights(id, [
      { sector: 'technology', weight: 0.5 },
      { sector: 'healthcare', weight: 0.3 },
      { sector: 'energy', weight: 0.2 },
    ]);
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM security_sector_weights WHERE security_id = $1', [id]);
    expect(rows[0].n).toBe(3);
  });

  test('🔴 a set that does not sum to 100% is REFUSED', async () => {
    // The dangerous case: 90% is well-formed and stores the fund at 90% of its
    // own value, under-reporting it forever.
    await expect(setSectorWeights(id, [
      { sector: 'technology', weight: 0.6 }, { sector: 'energy', weight: 0.3 },
    ])).rejects.toThrow(/sum to 90.0%/);
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM security_sector_weights WHERE security_id = $1', [id]);
    expect(rows[0].n).toBe(0);
  });

  test('🔴 a refused write leaves NOTHING behind — the delete rolls back too', async () => {
    await setSectorWeights(id, [{ sector: 'utilities', weight: 1 }]);
    await expect(setSectorWeights(id, [{ sector: 'energy', weight: 0.4 }])).rejects.toThrow();
    const { rows } = await db.query('SELECT sector FROM security_sector_weights WHERE security_id = $1', [id]);
    expect(rows.map((r) => r.sector)).toEqual(['utilities']);   // the old answer survives
  });

  test('replaces rather than merges, so a removed sector actually goes', async () => {
    await setSectorWeights(id, [{ sector: 'technology', weight: 0.5 }, { sector: 'energy', weight: 0.5 }]);
    await setSectorWeights(id, [{ sector: 'technology', weight: 1 }]);
    const { rows } = await db.query('SELECT sector FROM security_sector_weights WHERE security_id = $1', [id]);
    expect(rows.map((r) => r.sector)).toEqual(['technology']);
  });

  test('an unknown sector, a duplicate, or a zero weight is rejected', async () => {
    await expect(setSectorWeights(id, [{ sector: 'crypto', weight: 1 }])).rejects.toThrow(/unknown sector/);
    await expect(setSectorWeights(id, [
      { sector: 'energy', weight: 0.5 }, { sector: 'energy', weight: 0.5 },
    ])).rejects.toThrow(/given twice/);
    await expect(setSectorWeights(id, [
      { sector: 'energy', weight: 1 }, { sector: 'utilities', weight: 0 },
    ])).rejects.toThrow(/must be >0/);
  });
});
