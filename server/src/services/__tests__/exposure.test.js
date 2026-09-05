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
const { buildExposure, summariseFixedIncome, gradeOf } = require('../exposure');

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

describe('CR093 gradeOf — a split rating rounds DOWN', () => {
  test('one agency alone decides the grade', () => {
    expect(gradeOf('Aa2', null)).toBe('aa');
    expect(gradeOf(null, 'BBB-')).toBe('bbb');
    expect(gradeOf(null, null)).toBeNull();
  });

  test('🔴 disagreement takes the LOWER grade, never the higher', () => {
    // Rounding up understates exactly the risk the panel is drawn to show, and
    // "lower of the two" is the market's own convention for split ratings.
    expect(gradeOf('Baa2', 'BB+')).toBe('bb');
    expect(gradeOf('Ba1', 'BBB-')).toBe('bb');
    expect(gradeOf('A1', 'A-')).toBe('a');     // same letter, different notch
  });

  test('an unrecognised rating does not silently become a grade', () => {
    expect(gradeOf('WR', null)).toBeNull();
    expect(gradeOf('NR', 'NR')).toBeNull();
  });
});

/**
 * ⚠️ NO DATABASE, deliberately.
 *
 * `buildFixedIncome` reads EVERY account's latest snapshot — that is what a
 * portfolio view is — so a DB-backed assertion about its totals is an assertion
 * about whatever rows the database happens to hold. Written that way first,
 * eight of these nine were green on CI's empty database and red on dev's real
 * one: roadmap issue #26, and the exact thing `docs/guides/testing-and-ci.md`
 * warns against. The decision logic is now a pure function, and these rows are
 * invented.
 */
describe('CR093 summariseFixedIncome — the rules, on invented rows', () => {
  // The shape `buildFixedIncome`'s query returns, defaulted so each test states
  // only what it is about.
  const row = (over = {}) => ({
    id: over.id ?? 1,
    ticker: null,
    name: over.name || 'ZZ TEST',
    price_basis: over.price_basis || 'per_100_face',
    quantity_unit: 'face',
    as_of: over.as_of === undefined ? '2026-06-30' : over.as_of,
    maturity_date: over.maturity_date ?? null,
    next_call_date: null,
    coupon_rate: over.coupon_rate ?? null,
    coupon_type: null,
    payment_frequency: null,
    moodys_rating: over.moodys || null,
    sp_rating: over.sp || null,
    fdic_insured: over.fdic || false,
    mv: over.mv,
    quantity: 1,
  });
  const at = (r, k) => r.find((b) => b.bucket === k);
  const inYears = (n) => new Date(Date.now() + n * 365.25 * 86400e3).toISOString().slice(0, 10);

  test('a rated bond lands in its letter grade', () => {
    const r = summariseFixedIncome([row({ mv: 1000, moodys: 'Baa2', sp: 'BBB-', coupon_rate: 5, maturity_date: '2030-01-15' })], 4000);
    expect(Number(at(r.by_credit, 'bbb').market_value)).toBeCloseTo(1000, 2);
    expect(r.share_of_portfolio).toBeCloseTo(0.25, 6);
  });

  test('🔴 a CD is FDIC-INSURED, not "not rated"', () => {
    // These are the largest single block in this sleeve. Filing them beside
    // genuinely unrated corporate paper would say this portfolio carries credit
    // risk it does not carry.
    const r = summariseFixedIncome([row({ mv: 2000, price_basis: 'per_1_face', fdic: true, coupon_rate: 4, maturity_date: '2029-05-15' })], 2000);
    expect(Number(at(r.by_credit, 'fdic_insured').market_value)).toBeCloseTo(2000, 2);
    expect(at(r.by_credit, 'not_rated')).toBeUndefined();
    expect(r.credit_coverage.fdic_insured).toHaveLength(1);
  });

  test('🔴 a bond FUND has no single rating, and that is not a gap in our data', () => {
    const r = summariseFixedIncome([row({ mv: 5000, price_basis: 'per_share', as_of: null })], 5000);
    expect(Number(at(r.by_credit, 'fund').market_value)).toBeCloseTo(5000, 2);
    expect(at(r.by_credit, 'no_terms')).toBeUndefined();
  });

  test('🔴 "no statement covers it yet" is its own bucket, separate from "unrated"', () => {
    // A bond bought since the last quarter-end. This is the ONLY bucket that
    // should shrink, and it does so by itself when the next statement lands — so
    // it must not be mixed with a bond the custodian genuinely rates NR.
    const r = summariseFixedIncome([
      row({ id: 1, mv: 300, as_of: null }),
      row({ id: 2, mv: 700, coupon_rate: 6, maturity_date: '2029-01-01' }),
    ], 1000);
    expect(Number(at(r.by_credit, 'no_terms').market_value)).toBeCloseTo(300, 2);
    expect(Number(at(r.by_credit, 'not_rated').market_value)).toBeCloseTo(700, 2);
  });

  test('nothing unrated is redistributed across the grades we DO know', () => {
    const r = summariseFixedIncome([
      row({ id: 1, mv: 1000, moodys: 'A2', coupon_rate: 4, maturity_date: '2030-01-01' }),
      row({ id: 2, mv: 9000, as_of: null }),
    ], 10000);
    expect(Number(at(r.by_credit, 'a').market_value)).toBeCloseTo(1000, 2);
    expect(Number(r.credit_coverage.rated_value)).toBeCloseTo(1000, 2);
    // 10% rated, and the page must be able to say so.
    expect(r.credit_coverage.share_rated).toBeCloseTo(0.1, 6);
  });

  test('investment grade is reported against what is RATED, not against the sleeve', () => {
    // Both denominators, as everywhere else here: 100% of the rated money is
    // investment grade while only 20% of the sleeve is rated at all, and quoting
    // the first alone would describe a portfolio that is 80% unexamined.
    const r = summariseFixedIncome([
      row({ id: 1, mv: 1000, moodys: 'A2', coupon_rate: 4, maturity_date: '2030-01-01' }),
      row({ id: 2, mv: 4000, price_basis: 'per_1_face', fdic: true, coupon_rate: 4, maturity_date: '2029-01-01' }),
    ], 5000);
    expect(r.credit_coverage.investment_grade_share_of_rated).toBeCloseTo(1, 6);
    expect(r.credit_coverage.share_rated).toBeCloseTo(0.2, 6);
  });

  test('the maturity ladder bands by years from today', () => {
    const r = summariseFixedIncome([
      row({ id: 1, mv: 100, coupon_rate: 3, maturity_date: inYears(0.3) }),
      row({ id: 2, mv: 200, coupon_rate: 3, maturity_date: inYears(8) }),
    ], 300);
    expect(Number(at(r.by_maturity, 'under_1y').market_value)).toBeCloseTo(100, 2);
    expect(Number(at(r.by_maturity, '5_10y').market_value)).toBeCloseTo(200, 2);
  });

  test('🔴 the ladder keeps "a fund has none" apart from "we have no statement yet"', () => {
    // One `no_maturity` bucket merged $566,878 of bond funds with $348,563 of
    // bonds bought since the last quarter-end and labelled the whole 40.8% of
    // the sleeve "funds". The first is permanent, the second closes itself; a
    // single label describes a third of the band as something it is not.
    const r = summariseFixedIncome([
      row({ id: 1, mv: 300, price_basis: 'per_share', as_of: null }),
      row({ id: 2, mv: 700, as_of: null }),
    ], 1000);
    expect(Number(at(r.by_maturity, 'fund').market_value)).toBeCloseTo(300, 2);
    expect(Number(at(r.by_maturity, 'no_terms').market_value)).toBeCloseTo(700, 2);
    expect(at(r.by_maturity, 'no_maturity')).toBeUndefined();
  });

  test('the weighted average coupon weights by value and excludes what has none', () => {
    const r = summariseFixedIncome([
      row({ id: 1, mv: 1000, coupon_rate: 4, maturity_date: '2030-01-01' }),
      row({ id: 2, mv: 3000, coupon_rate: 6, maturity_date: '2030-01-01' }),
      row({ id: 3, mv: 96000, price_basis: 'per_share', as_of: null }),
    ], 100000);
    // (4×1000 + 6×3000) / 4000 = 5.5 — the fund's 96,000 must not drag it to 0.22.
    expect(r.weighted_average_coupon).toBeCloseTo(5.5, 4);
    expect(Number(r.weighted_average_coupon_base)).toBeCloseTo(4000, 2);
  });

  test('terms carry the statement date range they came from', () => {
    const r = summariseFixedIncome([
      row({ id: 1, mv: 1000, as_of: '2025-12-31', coupon_rate: 4, maturity_date: '2030-01-01' }),
      row({ id: 2, mv: 1000, as_of: '2026-06-30', coupon_rate: 4, maturity_date: '2030-01-01' }),
    ], 2000);
    expect(r.terms_as_of).toEqual({ earliest: '2025-12-31', latest: '2026-06-30' });
  });

  test('an empty sleeve does not divide by zero', () => {
    const r = summariseFixedIncome([], 0);
    expect(r.by_credit).toEqual([]);
    expect(r.share_of_portfolio).toBe(0);
    expect(r.weighted_average_coupon).toBeNull();
  });
});
